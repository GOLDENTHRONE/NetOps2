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
import { gtDebug } from '../../../gtDebug';
import {
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
  socket.addEventListener('message', (body: MessageEvent) => {
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
      socket.addEventListener('close', (ev: CloseEvent) => {
        if (intentionalClose.has(socket)) {
          intentionalClose.delete(socket);
          return;
        }
        if (sockets.get(connectionKey) !== socket) return; // already superseded
        // TEMP diagnostics: a watch dropped/handshake-failed. A 403/401 handshake
        // is NOT transient — reconnecting won't fix it until credentials refresh.
        gtDebug('watch.close', {
          cluster,
          code: ev.code,
          reason: ev.reason || null,
          attempt: reconnectAttempts.get(connectionKey) ?? 0,
        });
        scheduleReconnect(connectionKey, cluster, url);
      });
    }

    /** Open a connection to websocket */
    function connect({ cluster, url, onMessage }: WebSocketConnectionRequest<T>) {
      const connectionKey = cluster + url;

      // Always register the current listener, even when reusing an existing socket.
      listeners.set(connectionKey, [...(listeners.get(connectionKey) ?? []), onMessage]);

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
