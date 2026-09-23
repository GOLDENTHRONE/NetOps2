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

/* @vitest-environment jsdom */

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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WATCH_FALLBACK_REFETCH_MS,
  WATCH_RECONNECT,
  WATCH_RECONNECT_BASE_MS,
  WATCH_RECONNECT_CAP_MS,
  watchFallbackRefetchInterval,
} from '../../../resilience';
import { clusterFetch } from './fetch';
import { WebSocketManager } from './multiplexer';
import { useKubeObjectList } from './useKubeObjectList';
import { isAnyWatchReconnecting, useWebSockets } from './webSocket';

vi.mock('./fetch', () => ({ clusterFetch: vi.fn() }));
vi.mock('./hooks', async importOriginal => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useEndpoints: () => ({
      endpoint: { version: 'v1', resource: 'configmaps' },
      error: null,
    }),
  };
});

vi.mock('../../../../helpers/getAppUrl', () => ({ getAppUrl: () => 'http://localhost:4466' }));
vi.mock('../../../../helpers/getHeadlampAPIHeaders', () => ({
  getHeadlampWebSocketProtocol: () => null,
}));
vi.mock('../../../../stateless/findKubeconfigByClusterName', () => ({
  findKubeconfigByClusterName: async () => null,
}));
vi.mock('../../../../stateless/getUserIdFromLocalStorage', () => ({
  getUserIdFromLocalStorage: () => '',
}));

class SimulatorWebSocket {
  static instances: SimulatorWebSocket[] = [];
  private handlers = new Map<string, Array<(event: unknown) => void>>();
  readonly url: string;
  readyState = 0;
  binaryType = 'blob';

  constructor(url: string) {
    this.url = url;
    SimulatorWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  removeEventListener() {}

  close() {
    this.readyState = 3;
    this.emit('close', { code: 1000 });
  }

  emit(type: string, event: unknown = {}) {
    this.handlers.get(type)?.forEach(handler => handler(event));
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  drop() {
    this.readyState = 3;
    this.emit('close', { code: 1006 });
  }

  /**
   * Model a "silent death": the underlying transport is dead but the browser
   * never fires a 'close' (or any) event — e.g. a half-open TCP connection or a
   * network partition where the FIN is never received. readyState flips to
   * CLOSED to reflect the dead transport, but crucially NO event is emitted, so
   * the reconnect path (which keys off the 'close' event) is never triggered.
   * This is what makes "silently dead" distinct from "healthy and idle" (both
   * emit no events, but the latter stays readyState OPEN).
   */
  goSilent() {
    this.readyState = 3;
  }

  static reset() {
    SimulatorWebSocket.instances = [];
  }
}

const connections = [{ cluster: '', url: '/watch/configmaps', onMessage: vi.fn() }];

async function flushOpening() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('WebSocket reconnect simulator', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    SimulatorWebSocket.reset();
    vi.stubGlobal('WebSocket', SimulatorWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records real close-driven reconnects at 1s, 2s, and 4s backoff', async () => {
    expect(WATCH_RECONNECT).toBe(true);

    const timestamps: number[] = [];
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();

    const firstSocket = SimulatorWebSocket.instances[0];
    firstSocket.open();
    firstSocket.drop();
    timestamps.push(Date.now());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS - 1);
    });
    expect(SimulatorWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    timestamps.push(Date.now());
    expect(SimulatorWebSocket.instances).toHaveLength(2);

    SimulatorWebSocket.instances[1].drop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS * 2);
    });
    timestamps.push(Date.now());
    expect(SimulatorWebSocket.instances).toHaveLength(3);

    SimulatorWebSocket.instances[2].drop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS * 4);
    });
    timestamps.push(Date.now());
    expect(SimulatorWebSocket.instances).toHaveLength(4);

    const gaps = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
    console.log(
      JSON.stringify({
        timestamps,
        reconnectAttempts: SimulatorWebSocket.instances.length - 1,
        backoffGapsMs: gaps,
        expectedBackoffMs: [
          WATCH_RECONNECT_BASE_MS,
          WATCH_RECONNECT_BASE_MS * 2,
          Math.min(WATCH_RECONNECT_BASE_MS * 4, WATCH_RECONNECT_CAP_MS),
        ],
        capMs: WATCH_RECONNECT_CAP_MS,
      })
    );

    expect(gaps).toEqual([
      WATCH_RECONNECT_BASE_MS,
      WATCH_RECONNECT_BASE_MS * 2,
      Math.min(WATCH_RECONNECT_BASE_MS * 4, WATCH_RECONNECT_CAP_MS),
    ]);
    unmount();
  });

  it('does not reconnect when opened socket dies silently without close', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();

    SimulatorWebSocket.instances[0].open();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_CAP_MS * 2);
    });

    console.log(
      JSON.stringify({
        elapsedMs: WATCH_RECONNECT_CAP_MS * 2,
        reconnectAttempts: SimulatorWebSocket.instances.length - 1,
        expectedReconnectAttempts: 0,
      })
    );

    expect(SimulatorWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it('triggers safety-net HTTP refetch after silent death', async () => {
    const fetchTimestamps: number[] = [];
    vi.mocked(clusterFetch).mockImplementation(async () => {
      fetchTimestamps.push(Date.now());
      return new Response(
        JSON.stringify({
          apiVersion: 'v1',
          kind: 'ConfigMapList',
          metadata: { resourceVersion: '1' },
          items: [],
        }),
        { status: 200 }
      );
    });

    class SimulatedConfigMap {
      static apiVersion = 'v1';
      static apiName = 'configmaps';
      static kind = 'ConfigMap';

      constructor(public jsonData: unknown) {}
    }

    SimulatedConfigMap.apiEndpoint = { apiInfo: [{ version: 'v1', resource: 'configmaps' }] };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const startedAt = Date.now();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: SimulatedConfigMap as any,
          requests: [{ cluster: 'watch-test' }],
        }),
      { wrapper }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchTimestamps).toEqual([startedAt]);

    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    // Silent death: the transport is now dead, but no 'close' event ever fires,
    // so the reconnect path is never triggered. The 90s HTTP safety-net is the
    // ONLY thing that can refresh the list from here.
    socket.goSilent();
    const query = queryClient
      .getQueryCache()
      .getAll()
      .find(candidate => typeof candidate.options.refetchInterval === 'function');
    const refetchInterval = query?.options.refetchInterval;
    expect(typeof refetchInterval).toBe('function');
    const intervalMs = (refetchInterval as (query: unknown) => number)({
      state: { data: { list: { metadata: {} } } },
    });
    expect(intervalMs).toBe(90000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetchTimestamps).toEqual([startedAt]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    console.log(
      JSON.stringify({
        safetyIntervalMs: intervalMs,
        fetchTimestamps,
        fetchCountAfter90s: fetchTimestamps.length,
        silentDeathReconnectAttempts: SimulatorWebSocket.instances.length - 1,
      })
    );

    expect(fetchTimestamps).toEqual([startedAt, startedAt + 90000]);
    hook.unmount();
    queryClient.clear();
  });

  it('records mount, reuse, and navigation socket timing', async () => {
    const events: Array<{ type: string; resource: string; timestamp: number }> = [];
    const originalWebSocket = SimulatorWebSocket;
    class TimingWebSocket extends originalWebSocket {
      constructor(url: string) {
        super(url);
        events.push({ type: 'construct', resource: url, timestamp: Date.now() });
      }

      close() {
        events.push({ type: 'close', resource: this.url, timestamp: Date.now() });
        super.close();
      }
    }
    vi.stubGlobal('WebSocket', TimingWebSocket);

    const firstResource = [{ cluster: '', url: '/watch/configmaps', onMessage: vi.fn() }];
    const secondResource = [{ cluster: '', url: '/watch/pods', onMessage: vi.fn() }];
    const invokedAt = Date.now();
    const hook = renderHook(({ resource }) => useWebSockets({ connections: resource }), {
      initialProps: { resource: firstResource },
    });
    const afterInvocation = Date.now();
    await flushOpening();

    const firstSocket = SimulatorWebSocket.instances[0];
    firstSocket.open();
    hook.rerender({ resource: firstResource });
    await flushOpening();
    const afterSameResourceRerender = Date.now();
    const constructorsAfterSameResourceRerender = events.filter(
      event => event.type === 'construct'
    ).length;

    hook.rerender({ resource: secondResource });
    await flushOpening();
    const afterDifferentResourceRerender = Date.now();

    console.log(
      JSON.stringify({
        invokedAt,
        afterInvocation,
        constructorDelayMs: events[0].timestamp - invokedAt,
        sameResource: {
          rerenderAt: afterSameResourceRerender,
          constructorsAfterRerender: constructorsAfterSameResourceRerender,
        },
        differentResource: {
          rerenderAt: afterDifferentResourceRerender,
          events,
          oldSocketCloseBeforeNewConstructor:
            events[1].type === 'close' && events[1].timestamp <= events[2].timestamp,
        },
      })
    );

    expect(events[0]).toMatchObject({ type: 'construct', timestamp: invokedAt });
    expect(afterInvocation - invokedAt).toBe(0);
    expect(constructorsAfterSameResourceRerender).toBe(1);
    expect(events.filter(event => event.type === 'construct')).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'close', timestamp: events[2].timestamp });
    expect(events[1].timestamp).toBeLessThanOrEqual(events[2].timestamp);
    hook.unmount();
  });

  // =====================================================================
  // BATCH A — Socket lifecycle gaps (items 1.2, 1.5, 1.6)
  // =====================================================================

  it('BATCH A / 1.2: constructs the new socket with zero simulated-time delay after navigation', async () => {
    const constructTimestamps: number[] = [];
    class TimingWebSocket extends SimulatorWebSocket {
      constructor(url: string) {
        super(url);
        constructTimestamps.push(Date.now());
      }
    }
    vi.stubGlobal('WebSocket', TimingWebSocket);

    const first = [{ cluster: '', url: '/watch/configmaps', onMessage: vi.fn() }];
    const second = [{ cluster: '', url: '/watch/pods', onMessage: vi.fn() }];
    const hook = renderHook(({ resource }) => useWebSockets({ connections: resource }), {
      initialProps: { resource: first },
    });
    await flushOpening();
    SimulatorWebSocket.instances[0].open();

    const navigationAt = Date.now();
    hook.rerender({ resource: second });
    await flushOpening();
    const newSocketConstructedAt = constructTimestamps[constructTimestamps.length - 1];
    const navigationDelayMs = newSocketConstructedAt - navigationAt;

    console.log(
      JSON.stringify({
        item: '1.2',
        navigationAt,
        newSocketConstructedAt,
        navigationDelayMs,
        socketsConstructed: constructTimestamps.length,
      })
    );

    expect(constructTimestamps.length).toBe(2);
    expect(navigationDelayMs).toBe(0);
    hook.unmount();
  });

  it('BATCH A / 1.5: gives each resource on a multi-watch page its own independent socket', async () => {
    const multi = [
      { cluster: '', url: '/watch/configmaps', onMessage: vi.fn() },
      { cluster: '', url: '/watch/pods', onMessage: vi.fn() },
      { cluster: '', url: '/watch/services', onMessage: vi.fn() },
    ];
    const { unmount } = renderHook(() => useWebSockets({ connections: multi }));
    await flushOpening();

    const urls = SimulatorWebSocket.instances.map(s => s.url);
    const uniqueUrls = new Set(urls);

    console.log(
      JSON.stringify({
        item: '1.5',
        requestedConnections: multi.length,
        socketsCreated: SimulatorWebSocket.instances.length,
        socketUrls: urls,
        allIndependent:
          SimulatorWebSocket.instances.length === multi.length && uniqueUrls.size === multi.length,
      })
    );

    // webSocket.ts:361 `connections.map(endpoint => connect(endpoint))` opens one
    // socket per connectionKey (`cluster + url`), so distinct URLs => distinct sockets.
    expect(SimulatorWebSocket.instances).toHaveLength(3);
    expect(uniqueUrls.size).toBe(3);
    unmount();
  });

  it('BATCH A / 1.6: on full unmount closes the socket and clears the pending reconnect timer', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();

    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    socket.drop(); // unexpected close -> schedules a reconnect timer + pending slot

    // Unmount BEFORE the reconnect timer fires: cleanup (webSocket.ts:341-357)
    // must clearTimeout the pending reconnect and drop the slot.
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_CAP_MS * 2);
    });

    console.log(
      JSON.stringify({
        item: '1.6',
        socketsAfterUnmountAndWait: SimulatorWebSocket.instances.length,
        reconnectFiredAfterUnmount: SimulatorWebSocket.instances.length > 1,
        firstSocketClosed: socket.readyState === 3,
      })
    );

    expect(SimulatorWebSocket.instances).toHaveLength(1); // no reconnect socket built
    expect(socket.readyState).toBe(3);
  });

  // =====================================================================
  // BATCH B — Message handling (items 2.1-2.7) through the real message
  // handler (openWebSocket 'message' listener -> legacy onMessage ->
  // KubeList.applyUpdate -> react-query cache).
  // =====================================================================

  it('BATCH B / 2.1-2.7: applies real watch events through the production message path', async () => {
    class WatchConfigMap {
      static apiVersion = 'v1';
      static apiName = 'configmaps';
      static kind = 'ConfigMap';
      static apiEndpoint = { apiInfo: [{ version: 'v1', resource: 'configmaps' }] };
      cluster?: string;
      constructor(public jsonData: any, cluster?: string) {
        if (cluster) this.cluster = cluster;
      }
      get metadata() {
        return this.jsonData.metadata;
      }
    }

    vi.mocked(clusterFetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            apiVersion: 'v1',
            kind: 'ConfigMapList',
            metadata: { resourceVersion: '10' },
            items: [
              {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: { uid: 'a', name: 'cm-a', resourceVersion: '5' },
              },
            ],
          }),
          { status: 200 }
        )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: WatchConfigMap as any,
          requests: [{ cluster: 'watch-test' }],
        }),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = SimulatorWebSocket.instances[0];
    socket.open();

    const getItems = () => {
      const q = queryClient
        .getQueryCache()
        .getAll()
        .find(
          c =>
            Array.isArray(c.queryKey) && c.queryKey[0] === 'kubeObject' && c.queryKey[1] === 'list'
        );
      return (((q?.state.data as any)?.list?.items ?? []) as any[]).map(
        i => i.jsonData.metadata.uid
      );
    };
    const emit = async (payload: unknown) => {
      await act(async () => {
        socket.emit('message', { data: JSON.stringify(payload) });
        await Promise.resolve();
      });
    };
    const results: Record<string, unknown> = { initial: getItems() };

    // 2.1 ADDED
    await emit({
      type: 'ADDED',
      object: { metadata: { uid: 'b', name: 'cm-b', resourceVersion: '11' } },
    });
    results.afterAdded = getItems();

    // 2.2 MODIFIED (must update in place, not duplicate)
    await emit({
      type: 'MODIFIED',
      object: { metadata: { uid: 'a', name: 'cm-a2', resourceVersion: '12' } },
    });
    results.afterModified = getItems();

    // 2.3 DELETED
    await emit({
      type: 'DELETED',
      object: { metadata: { uid: 'b', name: 'cm-b', resourceVersion: '13' } },
    });
    results.afterDeleted = getItems();

    // 2.4 BOOKMARK (only resourceVersion advances; list unchanged; no warning)
    await emit({ type: 'BOOKMARK', object: { metadata: { resourceVersion: '14' } } });
    results.afterBookmark = getItems();

    // 2.5 ERROR (must not corrupt the list; must invalidateQueries)
    const invalidateBefore = invalidateSpy.mock.calls.length;
    await emit({ type: 'ERROR', object: { kind: 'Status', metadata: { resourceVersion: '0' } } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    results.afterError = getItems();
    const invalidateAfterError = invalidateSpy.mock.calls.length > invalidateBefore;

    // 2.6 Unknown/malformed event type (silently ignored, no crash)
    let unknownThrew = false;
    try {
      await emit({
        type: 'TOTALLY_UNKNOWN',
        object: { metadata: { uid: 'z', resourceVersion: '20' } },
      });
    } catch {
      unknownThrew = true;
    }
    results.afterUnknown = getItems();

    // 2.7 Malformed JSON (real behaviour of the message handler)
    let malformedError: unknown = null;
    try {
      socket.emit('message', { data: '{ this is not valid json' });
    } catch (e) {
      malformedError = e;
    }

    console.log(
      JSON.stringify({
        item: '2.1-2.7',
        ...results,
        invalidateCalledOnError: invalidateAfterError,
        unknownEventThrew: unknownThrew,
        malformedJsonThrew: malformedError !== null,
        malformedJsonErrorName: (malformedError as Error | null)?.name ?? null,
      })
    );

    expect(results.afterAdded).toEqual(['a', 'b']); // 2.1 added
    expect(results.afterModified).toEqual(['a', 'b']); // 2.2 updated, not duplicated
    expect(results.afterDeleted).toEqual(['a']); // 2.3 removed
    expect(results.afterBookmark).toEqual(['a']); // 2.4 list unchanged
    expect(invalidateAfterError).toBe(true); // 2.5 re-list, not corrupt
    expect(results.afterError).toEqual(['a']); // 2.5 list intact
    expect(unknownThrew).toBe(false); // 2.6 ignored, no crash
    expect(results.afterUnknown).toEqual(['a']); // 2.6 list unchanged
    // 2.7 NOTE: JSON.parse at webSocket.ts:181 is OUTSIDE the callback try/catch,
    // so malformed JSON throws a SyntaxError out of the 'message' listener. In a
    // browser this surfaces as an uncaught listener exception (logged, app not
    // crashed, message dropped) — it is NOT gracefully handled at the parse site.
    expect(malformedError).toBeInstanceOf(SyntaxError);

    hook.unmount();
    queryClient.clear();
  });

  // =====================================================================
  // BATCH C — Reconnect deep-dive (items 3.1-3.5)
  // =====================================================================

  it('BATCH C / 3.1: caps exponential backoff at WATCH_RECONNECT_CAP_MS and holds there', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    SimulatorWebSocket.instances[0].open();

    const expected = [1, 2, 4, 8, 16, 32, 64].map(m =>
      Math.min(WATCH_RECONNECT_BASE_MS * m, WATCH_RECONNECT_CAP_MS)
    );
    const gaps: number[] = [];
    let last = Date.now();
    for (let i = 0; i < expected.length; i++) {
      // Each reconnected socket flaps closed without ever opening -> attempt climbs.
      SimulatorWebSocket.instances[SimulatorWebSocket.instances.length - 1].drop();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(expected[i]);
      });
      const now = Date.now();
      gaps.push(now - last);
      last = now;
    }

    console.log(
      JSON.stringify({
        item: '3.1',
        backoffGapsMs: gaps,
        expectedMs: expected,
        capMs: WATCH_RECONNECT_CAP_MS,
        heldAtCap:
          gaps[gaps.length - 1] === WATCH_RECONNECT_CAP_MS &&
          gaps[gaps.length - 2] === WATCH_RECONNECT_CAP_MS,
      })
    );

    expect(gaps).toEqual(expected);
    expect(gaps[gaps.length - 1]).toBe(WATCH_RECONNECT_CAP_MS);
    expect(gaps[gaps.length - 2]).toBe(WATCH_RECONNECT_CAP_MS);
    unmount();
  });

  it('BATCH C / 3.2: resets backoff to base after a socket successfully reconnects and opens', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    SimulatorWebSocket.instances[0].open();

    let t = Date.now();
    SimulatorWebSocket.instances[0].drop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS);
    });
    const firstGap = Date.now() - t;
    expect(SimulatorWebSocket.instances).toHaveLength(2);

    // The reconnected socket OPENS -> webSocket.ts:258-262 resets attempts to 0.
    SimulatorWebSocket.instances[1].open();

    t = Date.now();
    SimulatorWebSocket.instances[1].drop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS);
    });
    const secondGap = Date.now() - t;
    expect(SimulatorWebSocket.instances).toHaveLength(3);

    console.log(
      JSON.stringify({
        item: '3.2',
        firstGap,
        secondGap,
        base: WATCH_RECONNECT_BASE_MS,
        resetToBase: secondGap === WATCH_RECONNECT_BASE_MS,
      })
    );

    expect(firstGap).toBe(WATCH_RECONNECT_BASE_MS);
    expect(secondGap).toBe(WATCH_RECONNECT_BASE_MS);
    unmount();
  });

  it('BATCH C / 3.3: performs no reconnect attempts when WATCH_RECONNECT is false', async () => {
    vi.resetModules();
    const actualResilience = await vi.importActual<typeof import('../../../resilience')>(
      '../../../resilience'
    );
    vi.doMock('../../../resilience', () => ({ ...actualResilience, WATCH_RECONNECT: false }));
    try {
      // Re-import the hook AND the renderer together from the reset module graph so
      // they share one React instance (avoids a dual-React invalid-hook error).
      const { renderHook: freshRenderHook, act: freshAct } = await import('@testing-library/react');
      const { useWebSockets: useWebSocketsNoReconnect } = await import('./webSocket');

      const { unmount } = freshRenderHook(() => useWebSocketsNoReconnect({ connections }));
      await freshAct(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      SimulatorWebSocket.instances[0].open();
      SimulatorWebSocket.instances[0].drop();
      await freshAct(async () => {
        await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_CAP_MS * 2);
      });

      console.log(
        JSON.stringify({
          item: '3.3',
          reconnectAttempts: SimulatorWebSocket.instances.length - 1,
          expected: 0,
        })
      );

      expect(SimulatorWebSocket.instances).toHaveLength(1);
      unmount();
    } finally {
      vi.doUnmock('../../../resilience');
      vi.resetModules();
    }
  });

  it('BATCH C / 3.4: cancels a scheduled reconnect if all listeners leave before it fires', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    socket.drop(); // schedules a reconnect (pending slot + timer)

    // Advance only PART of the backoff so the timer has NOT fired yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS / 2);
    });
    expect(SimulatorWebSocket.instances).toHaveLength(1);

    // Navigate away (all listeners removed) BEFORE the reconnect fires. The
    // "remaining listeners" guard (webSocket.ts:291) plus the cleanup clearTimeout
    // (webSocket.ts:342-346) must prevent a zombie reconnect.
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_CAP_MS * 2);
    });

    console.log(
      JSON.stringify({
        item: '3.4',
        socketsAfter: SimulatorWebSocket.instances.length,
        zombieReconnect: SimulatorWebSocket.instances.length > 1,
      })
    );

    expect(SimulatorWebSocket.instances).toHaveLength(1);
  });

  it('BATCH C / 3.5: keeps increasing backoff across rapid flapping with no erroneous reset', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    SimulatorWebSocket.instances[0].open();

    const expected = [1, 2, 4, 8, 16].map(m => WATCH_RECONNECT_BASE_MS * m);
    const gaps: number[] = [];
    let last = Date.now();
    for (let i = 0; i < expected.length; i++) {
      SimulatorWebSocket.instances[SimulatorWebSocket.instances.length - 1].drop();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(expected[i]);
      });
      const now = Date.now();
      gaps.push(now - last);
      last = now;
    }

    console.log(
      JSON.stringify({
        item: '3.5',
        backoffGapsMs: gaps,
        expectedMs: expected,
        monotonicIncrease: gaps.every((g, i) => i === 0 || g > gaps[i - 1]),
      })
    );

    expect(gaps).toEqual(expected);
    unmount();
  });

  // =====================================================================
  // BATCH D — Fallback deep-dive (items 4.1-4.4)
  // =====================================================================

  it('BATCH D / 4.1: disables the safety-net fallback entirely when the interval is 0', async () => {
    vi.resetModules();
    vi.stubEnv('REACT_APP_WATCH_FALLBACK_REFETCH_MS', '0');
    try {
      const resilience = await import('../../../resilience');
      const resultNoPages = resilience.watchFallbackRefetchInterval(false);
      const resultWithPages = resilience.watchFallbackRefetchInterval(true);

      console.log(
        JSON.stringify({
          item: '4.1',
          constant: resilience.WATCH_FALLBACK_REFETCH_MS,
          resultNoPages,
          resultWithPages,
        })
      );

      expect(resilience.WATCH_FALLBACK_REFETCH_MS).toBe(0);
      expect(resultNoPages).toBe(false);
      expect(resultWithPages).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('BATCH D / 4.2: disables fallback while paginating (continue token) but returns the interval otherwise', async () => {
    const withPages = watchFallbackRefetchInterval(true);
    const withoutPages = watchFallbackRefetchInterval(false);

    console.log(
      JSON.stringify({
        item: '4.2',
        constant: WATCH_FALLBACK_REFETCH_MS,
        withContinueToken: withPages,
        withoutContinueToken: withoutPages,
      })
    );

    expect(withPages).toBe(false);
    expect(withoutPages).toBe(WATCH_FALLBACK_REFETCH_MS);
  });

  it('BATCH D / 4.3: repeats the safety-net refetch every interval while the socket stays silently dead', async () => {
    const fetchTimestamps: number[] = [];
    vi.mocked(clusterFetch).mockImplementation(async () => {
      fetchTimestamps.push(Date.now());
      return new Response(
        JSON.stringify({
          apiVersion: 'v1',
          kind: 'ConfigMapList',
          metadata: { resourceVersion: '1' },
          items: [],
        }),
        { status: 200 }
      );
    });
    class CM {
      static apiVersion = 'v1';
      static apiName = 'configmaps';
      static kind = 'ConfigMap';
      static apiEndpoint = { apiInfo: [{ version: 'v1', resource: 'configmaps' }] };
      constructor(public jsonData: unknown) {}
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const startedAt = Date.now();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useKubeObjectList({ kubeObjectClass: CM as any, requests: [{ cluster: 'watch-test' }] }),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    socket.goSilent();

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    const offsets = fetchTimestamps.map(t => t - startedAt);
    console.log(
      JSON.stringify({ item: '4.3', offsetsMs: offsets, fetchCount: fetchTimestamps.length })
    );

    expect(offsets).toEqual([0, 90000, 180000, 270000]);
    hook.unmount();
    queryClient.clear();
  });

  it('BATCH D / 4.4: still runs the safety-net refetch even after the socket reconnects before the interval', async () => {
    const fetchTimestamps: number[] = [];
    vi.mocked(clusterFetch).mockImplementation(async () => {
      fetchTimestamps.push(Date.now());
      return new Response(
        JSON.stringify({
          apiVersion: 'v1',
          kind: 'ConfigMapList',
          metadata: { resourceVersion: '1' },
          items: [],
        }),
        { status: 200 }
      );
    });
    class CM {
      static apiVersion = 'v1';
      static apiName = 'configmaps';
      static kind = 'ConfigMap';
      static apiEndpoint = { apiInfo: [{ version: 'v1', resource: 'configmaps' }] };
      constructor(public jsonData: unknown) {}
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const startedAt = Date.now();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useKubeObjectList({ kubeObjectClass: CM as any, requests: [{ cluster: 'watch-test' }] }),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    socket.drop(); // drop well before the 90s fallback...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS);
    });
    SimulatorWebSocket.instances[SimulatorWebSocket.instances.length - 1].open(); // ...and reconnect
    const socketsAfterReconnect = SimulatorWebSocket.instances.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90000 - WATCH_RECONNECT_BASE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    const offsets = fetchTimestamps.map(t => t - startedAt);
    console.log(
      JSON.stringify({
        item: '4.4',
        socketsAfterReconnect,
        reconnectHappened: socketsAfterReconnect > 1,
        fetchOffsetsMs: offsets,
        note: 'fallback (useKubeObjectList.ts:735-739) has no socket-state guard; refetch fires regardless',
      })
    );

    expect(socketsAfterReconnect).toBeGreaterThan(1);
    expect(offsets).toEqual([0, 90000]);
    hook.unmount();
    queryClient.clear();
  });

  // =====================================================================
  // BATCH E — Freshness chip (items 5.1-5.3) — the core of the P1 question
  // =====================================================================

  it('BATCH E / 5.1: writes reconnecting state only via scheduleReconnect (single writer)', async () => {
    // watchStates writers (via setWatchState in webSocket.ts):
    //   'live'         -> socket 'open' handler                 (line 261)
    //   'reconnecting' -> scheduleReconnect ONLY                (line 287)
    //   'gone'         -> cleanup / no-listeners / superseded   (lines 249,279,293,356)
    // scheduleReconnect is reachable only from a real 'close' event
    // (attachReconnect, line 314) or an open failure (line 269). isAnyWatchReconnecting
    // (line 99) / useAnyWatchReconnecting (line 110) drive the WatchFreshnessChip.
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    const afterOpen = isAnyWatchReconnecting();
    socket.drop();
    const afterCloseEvent = isAnyWatchReconnecting();

    console.log(JSON.stringify({ item: '5.1', afterOpen, afterCloseEvent }));

    expect(afterOpen).toBe(false);
    expect(afterCloseEvent).toBe(true);
    unmount();
  });

  it('BATCH E / 5.2: never flips to reconnecting after a silent death — chip stays hidden', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    socket.goSilent(); // dead transport, NO close event ever fires

    const readings: Array<{ elapsedMs: number; reconnecting: boolean }> = [];
    const start = Date.now();
    readings.push({ elapsedMs: 0, reconnecting: isAnyWatchReconnecting() });
    for (const step of [30000, 30000, 30000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
      readings.push({ elapsedMs: Date.now() - start, reconnecting: isAnyWatchReconnecting() });
    }

    console.log(
      JSON.stringify({
        item: '5.2',
        readings,
        reconnectAttempts: SimulatorWebSocket.instances.length - 1,
      })
    );

    // Raw evidence: reconnecting stays FALSE at 0/30/60/90s. No close event means
    // scheduleReconnect (the only 'reconnecting' writer) is never reached, so the
    // freshness chip never appears. Only the 90s HTTP fallback (Batch D) refreshes.
    expect(readings.map(r => r.reconnecting)).toEqual([false, false, false, false]);
    expect(SimulatorWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it('BATCH E / 5.3: returns to live (reconnecting=false) after a successful reconnect', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections }));
    await flushOpening();
    const socket = SimulatorWebSocket.instances[0];
    socket.open();
    expect(isAnyWatchReconnecting()).toBe(false);
    socket.drop();
    const duringReconnect = isAnyWatchReconnecting();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_RECONNECT_BASE_MS);
    });
    SimulatorWebSocket.instances[SimulatorWebSocket.instances.length - 1].open();
    const afterRecovery = isAnyWatchReconnecting();

    console.log(JSON.stringify({ item: '5.3', duringReconnect, afterRecovery }));

    expect(duringReconnect).toBe(true);
    expect(afterRecovery).toBe(false);
    unmount();
  });

  // =====================================================================
  // BATCH F — Multiplexer (item 6.1) — low priority, off by default
  // =====================================================================

  it('BATCH F / 6.1: multiplexer has ERROR handling but no self-healing reconnect or freshness wiring', () => {
    WebSocketManager.socketMultiplexer = null;
    WebSocketManager.connecting = false;
    WebSocketManager.isReconnecting = false;
    WebSocketManager.activeSubscriptions.clear();
    WebSocketManager.listeners.clear();
    WebSocketManager.errorListeners.clear();

    // (a) RECONNECT: handleWebSocketClose (multiplexer.ts:315-322) only sets a flag;
    //     it opens no socket and schedules no timer -> no auto-redial.
    WebSocketManager.activeSubscriptions.set('c:/p:', { clusterId: 'c', path: '/p', query: '' });
    const timersBefore = vi.getTimerCount();
    WebSocketManager.handleWebSocketClose();
    const scheduledReconnectTimer = vi.getTimerCount() > timersBefore;

    // (b) ERROR: handleWebSocketMessage (multiplexer.ts:344-391) routes ERROR frames.
    let errorSeen: Error | null = null;
    WebSocketManager.errorListeners.set('c:/p:', new Set([(e: Error) => (errorSeen = e)]));
    WebSocketManager.handleWebSocketMessage({
      data: JSON.stringify({
        clusterId: 'c',
        path: '/p',
        query: '',
        type: 'ERROR',
        data: JSON.stringify({ error: 'boom' }),
      }),
    } as MessageEvent);

    // (c) BOOKMARK: no multiplexer-specific handling — forwarded verbatim to data
    //     listeners; BOOKMARK semantics live downstream in KubeList.applyUpdate.
    let forwarded: any = null;
    WebSocketManager.listeners.set('c:/p:', new Set([(u: any) => (forwarded = u)]));
    WebSocketManager.handleWebSocketMessage({
      data: JSON.stringify({
        clusterId: 'c',
        path: '/p',
        query: '',
        data: JSON.stringify({ type: 'BOOKMARK', object: { metadata: { resourceVersion: '9' } } }),
      }),
    } as MessageEvent);

    console.log(
      JSON.stringify({
        item: '6.1',
        autoReconnectAfterClose: scheduledReconnectTimer,
        isReconnectingFlagOnly: WebSocketManager.isReconnecting,
        errorHandled: errorSeen !== null,
        bookmarkForwardedVerbatim: forwarded?.type === 'BOOKMARK',
        note: 'reconnect+freshness-state absent on multiplexer path (see multiplexer.ts:304-322); off by default',
      })
    );

    expect(scheduledReconnectTimer).toBe(false); // no self-healing redial
    expect(WebSocketManager.isReconnecting).toBe(true); // flag only, no action
    expect(errorSeen).not.toBeNull(); // ERROR handling present
    expect(forwarded?.type).toBe('BOOKMARK'); // no bookmark-specific branch

    WebSocketManager.activeSubscriptions.clear();
    WebSocketManager.listeners.clear();
    WebSocketManager.errorListeners.clear();
    WebSocketManager.isReconnecting = false;
  });
});
