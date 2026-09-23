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
  WATCH_RECONNECT,
  WATCH_RECONNECT_BASE_MS,
  WATCH_RECONNECT_CAP_MS,
} from '../../../resilience';
import { clusterFetch } from './fetch';
import { useKubeObjectList } from './useKubeObjectList';
import { useWebSockets } from './webSocket';

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
        safetyIntervalMs: safetyInterval,
        fetchTimestamps,
        fetchCountAfter90s: fetchTimestamps.length,
        silentDeathReconnectAttempts: 0,
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
});
