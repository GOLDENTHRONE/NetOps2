/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { getAppUrl } from '../../../../helpers/getAppUrl';
import { getHeadlampWebSocketProtocol } from '../../../../helpers/getHeadlampAPIHeaders';
import { findKubeconfigByClusterName } from '../../../../stateless/findKubeconfigByClusterName';
import { getUserIdFromLocalStorage } from '../../../../stateless/getUserIdFromLocalStorage';
import { getCluster } from '../../../cluster';
import {
  WATCH_LIVENESS_TIMEOUT_MS,
  WATCH_RECONNECT,
  WATCH_RECONNECT_BASE_MS,
  WATCH_RECONNECT_CAP_MS,
  withJitter,
} from '../../../resilience';
import { makeUrl } from './makeUrl';

/**
 * Get the WebSocket base URL dynamically to support runtime port configuration
 */
export function getBaseWsUrl(): string {
  return getAppUrl().replace('http', 'ws');
}

// @deprecated BASE_WS_URL is deprecated for Electron apps with custom ports.
// It's evaluated at module load time, before window.headlampBackendPort is set.
// Use getBaseWsUrl() instead for runtime port configuration.
export const BASE_WS_URL = getBaseWsUrl();

/**
 * Configuration for establishing a WebSocket connection to watch Kubernetes resources.
 * Used by the multiplexer to manage multiple WebSocket connections efficiently.
 *
 * @template T The expected type of data that will be received over the WebSocket
 */
export type WebSocketConnectionRequest<T> = {
  /**
   * The Kubernetes cluster identifier to connect to.
   * Used for routing WebSocket messages in multi-cluster environments.
   */
  cluster: string;

  /**
   * The WebSocket endpoint URL to connect to.
   * Should be a full URL including protocol and any query parameters.
   * Example: 'https://cluster.example.com/api/v1/pods/watch'
   */
  url: string;

  /**
   * Callback function that handles incoming messages from the WebSocket.
   * @param data The message payload, typed as T (e.g., K8s Pod, Service, etc.)
   */
  onMessage: (data: T) => void;

  /**
   * P1 (#16): confirm-before-reconnect. When the liveness timer sees a prolonged
   * silence, it does NOT assume the socket is dead (Kubernetes does not guarantee
   * periodic BOOKMARKs — see WS_BOOKMARK_PRODUCTION_DEPENDENCY_REVIEW.md). Instead
   * it calls this to run ONE authoritative LIST refetch for this watch and returns
   * whether that fetch succeeded (fresh data arrived). `true` → healthy (quiet or
   * resynced by the existing list→watch machinery, no forced close); `false` →
   * the list itself failed → the socket is treated as stale and the existing
   * reconnect path runs. Optional: if absent, liveness falls back to closing.
   */
  confirmLiveness?: () => Promise<boolean>;
};

/**
 * Keeps track of open WebSocket connections and active listeners
 */
const sockets = new Map<string, WebSocket | symbol>();
const listeners = new Map<string, Array<(update: any) => void>>();

// --- P1: auto-reconnect + freshness state ----------------------------------
/** Sockets we closed on purpose (cleanup / superseded) — must NOT reconnect. */
const intentionalClose = new WeakSet<WebSocket>();
/** Consecutive reconnect attempts per connection, for exponential backoff. */
const reconnectAttempts = new Map<string, number>();
/** Pending reconnect timers per connection, so we can cancel on unsubscribe. */
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Per-connection live/reconnecting state, for the freshness indicator (Item 3). */
const watchStates = new Map<string, 'live' | 'reconnecting'>();
const watchStateSubscribers = new Set<() => void>();

// --- P1 (#16): silent-death liveness ---------------------------------------
/** Last time ANY frame (data or BOOKMARK) arrived, per connection. */
const lastActivity = new Map<string, number>();
/** Pending liveness timers per connection, so we can cancel on close/cleanup. */
const livenessTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Confirm-before-reconnect callback per connection (authoritative LIST refetch). */
const livenessConfirm = new Map<string, () => Promise<boolean>>();
/** Connections with a confirmation LIST currently in flight (at most one each). */
const livenessConfirming = new Set<string>();

function setWatchState(connectionKey: string, state: 'live' | 'reconnecting' | 'gone') {
  if (state === 'gone') {
    if (!watchStates.has(connectionKey)) return;
    watchStates.delete(connectionKey);
  } else {
    if (watchStates.get(connectionKey) === state) return;
    watchStates.set(connectionKey, state);
  }
  watchStateSubscribers.forEach(fn => fn());
}

/** True while any watch connection is currently reconnecting after a drop. */
export function isAnyWatchReconnecting(): boolean {
  for (const s of watchStates.values()) {
    if (s === 'reconnecting') return true;
  }
  return false;
}

/**
 * React hook: whether any live watch is currently reconnecting. Drives the
 * global "reconnecting…" freshness hint (Item 3). Safe (uses a stable snapshot).
 */
export function useAnyWatchReconnecting(): boolean {
  return useSyncExternalStore(
    cb => {
      watchStateSubscribers.add(cb);
      return () => watchStateSubscribers.delete(cb);
    },
    isAnyWatchReconnecting,
    () => false
  );
}

// --- P1 (#16): silent-death detection --------------------------------------
// A socket can die with NO close/error event (half-open behind an idle L7 LB,
// OS sleep, NAT timeout). It then "looks open" while no frames arrive, which is
// indistinguishable from a healthy-but-quiet watch. We request BOOKMARK frames
// (allowWatchBookmarks, added on the watch URL) so a healthy watch is never
// truly silent, and here we detect prolonged silence and synthesize a `close`
// so the EXISTING reconnect/backoff/freshness machinery recovers it. We never
// build a second reconnect system, and we never mark this close intentional (it
// MUST redial). All decisions use real elapsed time (Date.now()), so a throttled
// or coalesced timer in a background tab can only detect death LATER, never
// produce a false positive.

/** Cancel any pending liveness timer for a connection. */
function clearLiveness(connectionKey: string) {
  const timer = livenessTimers.get(connectionKey);
  if (timer) {
    clearTimeout(timer);
    livenessTimers.delete(connectionKey);
  }
}

/** (Re)arm the liveness timer to fire `afterMs` from now. */
function armLiveness(connectionKey: string, socket: WebSocket, afterMs: number) {
  if (WATCH_LIVENESS_TIMEOUT_MS <= 0) return;
  clearLiveness(connectionKey);
  const timer = setTimeout(() => {
    livenessTimers.delete(connectionKey);
    checkLiveness(connectionKey, socket);
  }, Math.max(0, afterMs));
  livenessTimers.set(connectionKey, timer);
}

/**
 * On prolonged silence, CONFIRM before reconnecting (6a). Robust to throttled /
 * coalesced timers: the verdict is based on real elapsed time, and a socket that
 * has already been replaced/closed is ignored.
 *
 * Because Kubernetes does not guarantee periodic BOOKMARKs, silence alone does
 * NOT mean the socket is dead. So instead of closing, we ask the watch layer to
 * run ONE authoritative LIST refetch (`confirmLiveness`):
 *  - refetch SUCCEEDS  → the watch is healthy (quiet), or the fresh list carried a
 *    newer resourceVersion and the EXISTING list→watch machinery will rebuild the
 *    socket on its own. Either way we do NOT force a close; we just re-arm.
 *  - refetch FAILS     → the list itself is unreachable → treat as stale and use
 *    the EXISTING reconnect path (synthesize a non-intentional close).
 * At most one confirmation runs per connection; a result for a superseded socket
 * is ignored.
 */
function checkLiveness(connectionKey: string, socket: WebSocket) {
  if (WATCH_LIVENESS_TIMEOUT_MS <= 0) return;
  // Stale timer from a socket that is no longer the current one — ignore.
  if (sockets.get(connectionKey) !== socket) return;
  const last = lastActivity.get(connectionKey) ?? Date.now();
  const elapsed = Date.now() - last;
  if (elapsed < WATCH_LIVENESS_TIMEOUT_MS) {
    // A frame arrived since we armed (timer fired late / was throttled) — re-arm
    // for the remaining time instead of declaring death.
    armLiveness(connectionKey, socket, WATCH_LIVENESS_TIMEOUT_MS - elapsed);
    return;
  }

  const confirm = livenessConfirm.get(connectionKey);
  if (!confirm) {
    // No confirmation available (e.g. multiplexer / non-list socket) — fall back
    // to the original behavior: synthesize a close so the existing reconnect runs.
    closeForLiveness(connectionKey, socket);
    return;
  }
  // At most ONE confirmation LIST in flight per connection.
  if (livenessConfirming.has(connectionKey)) return;
  livenessConfirming.add(connectionKey);
  confirm()
    .then(healthy => {
      livenessConfirming.delete(connectionKey);
      // The socket may have been replaced/closed (real close, reconnect, or a
      // list→watch rebuild) while the LIST was running — ignore a stale result.
      if (sockets.get(connectionKey) !== socket) return;
      if (healthy) {
        // Healthy-but-quiet: do NOT close. Reset activity + re-arm so we don't
        // immediately re-confirm (avoids a tight loop / churn).
        markActivity(connectionKey);
        armLiveness(connectionKey, socket, WATCH_LIVENESS_TIMEOUT_MS);
      } else {
        // Authoritative LIST failed → genuinely stale/unreachable → reconnect.
        closeForLiveness(connectionKey, socket);
      }
    })
    .catch(() => {
      livenessConfirming.delete(connectionKey);
      if (sockets.get(connectionKey) !== socket) return;
      closeForLiveness(connectionKey, socket);
    });
}

/** Synthesize a non-intentional close so the EXISTING reconnect + freshness chip
 *  path runs. Clears our timer first so one silent socket triggers at most one. */
function closeForLiveness(connectionKey: string, socket: WebSocket) {
  clearLiveness(connectionKey);
  try {
    socket.close();
  } catch {
    /* ignore */
  }
}

/** Record that a frame arrived (does not re-arm; the running timer re-checks the
 *  timestamp when it fires — cheap even on a busy socket). */
function markActivity(connectionKey: string) {
  if (WATCH_LIVENESS_TIMEOUT_MS <= 0) return;
  lastActivity.set(connectionKey, Date.now());
}

// When the tab becomes visible again, timers may have been throttled while
// hidden — re-evaluate every open socket immediately so a genuinely dead one is
// caught on return. Never a false positive (checkLiveness uses real elapsed time).
if (typeof document !== 'undefined' && WATCH_LIVENESS_TIMEOUT_MS > 0) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const [key, sock] of sockets.entries()) {
      if (typeof sock !== 'symbol') checkLiveness(key, sock);
    }
  });
}

/**
 * Create new WebSocket connection to the backend
 *
 * @param url - WebSocket URL
 * @param options - Connection options
 *
 * @returns WebSocket connection
 */
export async function openWebSocket<T>(
  url: string,
  {
    protocols: moreProtocols = [],
    type = 'binary',
    cluster = getCluster() ?? '',
    onMessage,
  }: {
    /**
     * Any additional protocols to include in WebSocket connection
     */
    protocols?: string | string[];
    /**
     *
     */
    type: 'json' | 'binary';
    /**
     * Cluster name
     */
    cluster?: string;
    /**
     * Message callback
     */
    onMessage: (data: T) => void;
  }
) {
  const connectionKey = cluster + url;
  const path = [url];
  const protocols = ['base64.binary.k8s.io', ...(moreProtocols ?? [])];
  const backendTokenProtocol = getHeadlampWebSocketProtocol();
  if (backendTokenProtocol !== null) {
    protocols.push(backendTokenProtocol);
  }

  if (cluster) {
    path.unshift('clusters', cluster);

    try {
      const kubeconfig = await findKubeconfigByClusterName(cluster);

      if (kubeconfig !== null) {
        const userID = getUserIdFromLocalStorage();
        protocols.push(`base64url.headlamp.authorization.k8s.io.${userID}`);
      }
    } catch (error) {
      console.error('Error while finding kubeconfig:', error);
    }
  }

  const socket = new WebSocket(makeUrl([getBaseWsUrl(), ...path], {}), protocols);
  socket.binaryType = 'arraybuffer';
  // P1 (#16): arm silent-death liveness when the socket opens.
  socket.addEventListener('open', () => {
    markActivity(connectionKey);
    armLiveness(connectionKey, socket, WATCH_LIVENESS_TIMEOUT_MS);
  });
  socket.addEventListener('message', (body: MessageEvent) => {
    // P1 (#16): every incoming frame (data OR bookmark) counts as activity.
    // Record it BEFORE parsing so even a malformed frame keeps the watch "alive".
    markActivity(connectionKey);
    const data = type === 'json' ? JSON.parse(body.data) : body.data;
    const callbacks = listeners.get(connectionKey) ?? [onMessage];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    });
  });
  socket.addEventListener('error', error => {
    console.error('WebSocket error:', error);
  });
  // P1 (#16): a closing socket must not leave a liveness timer chasing it. The
  // reconnect (if any) arms a fresh timer when its new socket opens.
  socket.addEventListener('close', () => {
    clearLiveness(connectionKey);
  });

  return socket;
}

/**
 * Creates or joins mutiple existing WebSocket connections
 *
 * @param url - endpoint URL
 * @param options - WebSocket options
 */
export function useWebSockets<T>({
  connections,
  enabled = true,
  protocols,
  type = 'json',
}: {
  enabled?: boolean;
  /** Make sure that connections value is stable between renders */
  connections: Array<WebSocketConnectionRequest<T>>;
  /**
   * Any additional protocols to include in WebSocket connection
   * make sure that the value is stable between renders
   */
  protocols?: string | string[];
  /**
   * Type of websocket data
   */
  type?: 'json' | 'binary';
}) {
  useEffect(() => {
    if (!enabled) return;

    // Open a socket for a connection and track it, wiring auto-reconnect so an
    // unexpected drop redials (backoff + jitter) instead of leaving it stale.
    // Message delivery always reads the `listeners` map, so the onMessage passed
    // here is only a never-used fallback.
    function openAndTrack(
      connectionKey: string,
      cluster: string,
      url: string,
      expectedPending: symbol
    ) {
      openWebSocket(url, { protocols, type, cluster, onMessage: () => {} })
        .then(socket => {
          // A newer connection/reconnect replaced this pending one while opening.
          if (sockets.get(connectionKey) !== expectedPending) {
            intentionalClose.add(socket);
            socket.close();
            return;
          }
          // All listeners unsubscribed while the socket was opening.
          if ((listeners.get(connectionKey)?.length ?? 0) === 0) {
            intentionalClose.add(socket);
            socket.close();
            sockets.delete(connectionKey);
            setWatchState(connectionKey, 'gone');
            return;
          }
          sockets.set(connectionKey, socket);
          // Reset backoff + mark live only when the socket actually OPENS, not
          // when openWebSocket resolves (it resolves while still CONNECTING). A
          // socket that closes before it ever establishes must keep backing off,
          // otherwise "closed before connection established" becomes a tight ~1s
          // reconnect loop instead of exponential backoff.
          socket.addEventListener('open', () => {
            if (sockets.get(connectionKey) !== socket) return;
            reconnectAttempts.set(connectionKey, 0);
            setWatchState(connectionKey, 'live');
          });
          attachReconnect(socket, connectionKey, cluster, url);
        })
        .catch(err => {
          console.error(err);
          // The open itself failed; treat like a drop and back off + retry.
          if (sockets.get(connectionKey) === expectedPending) {
            scheduleReconnect(connectionKey, cluster, url);
          }
        });
    }

    // Schedule a backoff+jitter reconnect for a connection that still has
    // listeners. Marks the slot pending so nothing else opens meanwhile.
    function scheduleReconnect(connectionKey: string, cluster: string, url: string) {
      if (!WATCH_RECONNECT || (listeners.get(connectionKey)?.length ?? 0) === 0) {
        sockets.delete(connectionKey);
        setWatchState(connectionKey, 'gone');
        return;
      }
      const attempt = reconnectAttempts.get(connectionKey) ?? 0;
      reconnectAttempts.set(connectionKey, attempt + 1);
      const base = Math.min(WATCH_RECONNECT_BASE_MS * 2 ** attempt, WATCH_RECONNECT_CAP_MS);
      const pending = Symbol('reconnectingWebSocket');
      sockets.set(connectionKey, pending);
      setWatchState(connectionKey, 'reconnecting');
      const timer = setTimeout(() => {
        reconnectTimers.delete(connectionKey);
        if (sockets.get(connectionKey) !== pending) return;
        if ((listeners.get(connectionKey)?.length ?? 0) === 0) {
          sockets.delete(connectionKey);
          setWatchState(connectionKey, 'gone');
          return;
        }
        openAndTrack(connectionKey, cluster, url, pending);
      }, withJitter(base));
      reconnectTimers.set(connectionKey, timer);
    }

    // Redial when a live socket closes unexpectedly (not one we closed ourselves).
    function attachReconnect(
      socket: WebSocket,
      connectionKey: string,
      cluster: string,
      url: string
    ) {
      socket.addEventListener('close', () => {
        if (intentionalClose.has(socket)) {
          intentionalClose.delete(socket);
          return;
        }
        if (sockets.get(connectionKey) !== socket) return; // already superseded
        scheduleReconnect(connectionKey, cluster, url);
      });
    }

    /** Open a connection to websocket */
    function connect({ cluster, url, onMessage, confirmLiveness }: WebSocketConnectionRequest<T>) {
      const connectionKey = cluster + url;

      // Always register the current listener, even when reusing an existing socket.
      listeners.set(connectionKey, [...(listeners.get(connectionKey) ?? []), onMessage]);
      // P1 (#16): register the confirm-before-reconnect LIST for this connection.
      if (confirmLiveness) {
        livenessConfirm.set(connectionKey, confirmLiveness);
      }

      if (!sockets.has(connectionKey)) {
        // Mark socket as pending, so we don't open more than one
        const pendingSocket = Symbol('pendingWebSocket');
        sockets.set(connectionKey, pendingSocket);
        openAndTrack(connectionKey, cluster, url, pendingSocket);
      }

      return () => {
        const connectionKey = cluster + url;

        // Clean up the listener
        const newListeners = listeners.get(connectionKey)?.filter(it => it !== onMessage) ?? [];
        listeners.set(connectionKey, newListeners);

        // No one is listening to the connection so we can close it and cancel any
        // pending reconnect (this close is intentional — it must NOT redial).
        if (newListeners.length === 0) {
          const timer = reconnectTimers.get(connectionKey);
          if (timer) {
            clearTimeout(timer);
            reconnectTimers.delete(connectionKey);
          }
          reconnectAttempts.delete(connectionKey);
          // P1 (#16): drop liveness state so no timer/confirmation outlives the
          // connection (a pending confirmation's result is also ignored via the
          // socket-identity guard in checkLiveness).
          clearLiveness(connectionKey);
          lastActivity.delete(connectionKey);
          livenessConfirm.delete(connectionKey);
          livenessConfirming.delete(connectionKey);
          const maybeExisting = sockets.get(connectionKey);
          if (maybeExisting) {
            if (typeof maybeExisting !== 'symbol') {
              intentionalClose.add(maybeExisting);
              maybeExisting.close();
            }
            sockets.delete(connectionKey);
          }
          setWatchState(connectionKey, 'gone');
        }
      };
    }

    const disconnectCallbacks = connections.map(endpoint => connect(endpoint));

    return () => {
      disconnectCallbacks.forEach(fn => fn());
    };
  }, [enabled, type, connections, protocols]);
}
