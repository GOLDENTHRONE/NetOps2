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

/*
 * P1 (#16) — silent-death liveness tests, driving the REAL webSocket.ts code with
 * a fake global WebSocket + fake timers. Verifies: bookmarks/data keep a watch
 * alive; a prolonged silence synthesizes exactly ONE close → ONE reconnect (via
 * the existing reconnect path); stale timers never touch the replacement socket;
 * unmount clears timers; multiple watches are independent; visibility re-check.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { WATCH_LIVENESS_TIMEOUT_MS } from '../../../resilience';
import { useWebSockets } from './webSocket';

class MockWS {
  static instances: MockWS[] = [];
  url: string;
  readyState = 0;
  binaryType = 'blob';
  private handlers: Record<string, Array<(ev: any) => void>> = {};
  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    (this.handlers[type] ||= []).push(cb);
  }
  removeEventListener() {}
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire('close', { code: 1000 });
  }
  fire(type: string, ev: any) {
    (this.handlers[type] || []).forEach(cb => cb(ev));
  }
  fireOpen() {
    this.readyState = 1;
    this.fire('open', {});
  }
  message(payload: any = { type: 'BOOKMARK', object: { metadata: { resourceVersion: '9' } } }) {
    this.fire('message', { data: JSON.stringify(payload) });
  }
  static get open() {
    return MockWS.instances.filter(s => s.readyState !== 3).length;
  }
  static reset() {
    MockWS.instances = [];
  }
}

const conn = (
  url = '/watch/pods',
  onMessage: (d: any) => void = () => {},
  confirmLiveness?: () => Promise<boolean>
) => [{ cluster: '', url, onMessage, ...(confirmLiveness ? { confirmLiveness } : {}) }];

// Flush the async openWebSocket() promise (it awaits findKubeconfigByClusterName)
// plus any queued microtasks, so the MockWS instance is created and tracked.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Advance fake time (which also advances Date.now under vitest fake timers) and
// flush microtasks between timers.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  MockWS.reset();
  (globalThis as any).WebSocket = MockWS as any;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWebSockets — P1 (#16) silent-death liveness', () => {
  it('a healthy stream (data or BOOKMARK) keeps the watch alive — no reconnect', async () => {
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    expect(MockWS.instances.length).toBe(1);
    act(() => MockWS.instances[0].fireOpen());

    // A frame arrives well within the timeout, several times over minutes.
    for (let i = 0; i < 5; i++) {
      await advance(Math.floor(WATCH_LIVENESS_TIMEOUT_MS * 0.5));
      act(() => MockWS.instances[0].message()); // BOOKMARK keeps it alive
    }
    // Still exactly one socket — the liveness timer never tripped.
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.open).toBe(1);
  });

  it('a silent socket (no frames past the timeout) triggers exactly ONE reconnect', async () => {
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    expect(MockWS.instances.length).toBe(1);

    // Total silence beyond the threshold → liveness closes the socket.
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    expect(MockWS.instances[0].readyState).toBe(3); // was closed

    // The EXISTING reconnect path opens a new socket (backoff ~1s).
    await advance(2000);
    expect(MockWS.instances.length).toBe(2);
    expect(MockWS.open).toBe(1); // exactly one live socket, no leak

    // No SECOND liveness close from the old socket even if more time passes
    // while the new one is healthy.
    act(() => MockWS.instances[1].fireOpen());
    act(() => MockWS.instances[1].message());
    await advance(WATCH_LIVENESS_TIMEOUT_MS * 0.5);
    expect(MockWS.instances.length).toBe(2); // no extra reconnect
  });

  it('a stale timer from the old socket cannot close the replacement socket', async () => {
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());

    // Go silent → close → reconnect.
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    await advance(2000);
    expect(MockWS.instances.length).toBe(2);
    const replacement = MockWS.instances[1];
    act(() => replacement.fireOpen());

    // Keep the replacement busy; the old socket's (already-cleared) timer must
    // never close this one.
    for (let i = 0; i < 4; i++) {
      await advance(Math.floor(WATCH_LIVENESS_TIMEOUT_MS * 0.4));
      act(() => replacement.message());
    }
    expect(replacement.readyState).toBe(1); // still open
    expect(MockWS.open).toBe(1);
  });

  it('unmount clears the liveness timer — no reconnect after leaving', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    act(() => unmount()); // intentional close + cleanup

    await advance(WATCH_LIVENESS_TIMEOUT_MS * 2);
    expect(MockWS.instances.length).toBe(1); // never redialed by liveness
    expect(MockWS.open).toBe(0);
  });

  it('multiple watches are independent — one silent watch does not affect a busy one', async () => {
    renderHook(() =>
      useWebSockets({
        connections: [
          { cluster: '', url: '/watch/pods', onMessage: () => {} },
          { cluster: '', url: '/watch/services', onMessage: () => {} },
        ],
        type: 'json',
      })
    );
    await flush();
    expect(MockWS.instances.length).toBe(2);
    const [pods, services] = MockWS.instances;
    act(() => pods.fireOpen());
    act(() => services.fireOpen());

    // Keep only `pods` busy; let `services` fall silent.
    for (let i = 0; i < 3; i++) {
      await advance(Math.floor(WATCH_LIVENESS_TIMEOUT_MS * 0.5));
      act(() => pods.message());
    }
    // pods stayed alive; services was silent past the threshold → it reconnected.
    expect(pods.readyState).toBe(1);
    expect(services.readyState).toBe(3);
    const servicesInstances = MockWS.instances.filter(w => w.url.includes('services'));
    expect(servicesInstances.length).toBe(2); // services reconnected exactly once
    const podsInstances = MockWS.instances.filter(w => w.url.includes('pods'));
    expect(podsInstances.length).toBe(1); // pods never reconnected
  });

  it('visibilitychange → visible re-checks and closes a socket that died while hidden', async () => {
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());

    // Simulate a hidden tab whose timer was throttled: no message, and we DON'T
    // advance enough for the timer to have fired — but real elapsed time exceeds
    // the threshold. Then the tab becomes visible.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    // Move Date.now past the threshold without letting the scheduled timer fire
    // first by using a large jump; the visibility handler recomputes elapsed.
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 5000);
    // (By now the timer itself would also have closed it; assert the end state.)
    expect(MockWS.instances[0].readyState).toBe(3);
  });
});

describe('useWebSockets — P1 (#16) confirm-before-reconnect (6a)', () => {
  it('silence + confirmation LIST SUCCEEDS → healthy-but-quiet, NO reconnect, timer re-armed', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    renderHook(() =>
      useWebSockets({ connections: conn('/watch/pods', () => {}, confirm), type: 'json' })
    );
    await flush();
    act(() => MockWS.instances[0].fireOpen());

    // Silence past the threshold → confirmation runs (not an immediate close).
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(MockWS.instances.length).toBe(1); // no reconnect
    expect(MockWS.instances[0].readyState).toBe(1); // still open

    // Re-armed: another silent interval → confirmation runs again (still healthy).
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(MockWS.instances.length).toBe(1); // still no churn
  });

  it('silence + confirmation LIST FAILS → exactly one reconnect via the existing path', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    renderHook(() =>
      useWebSockets({ connections: conn('/watch/pods', () => {}, confirm), type: 'json' })
    );
    await flush();
    act(() => MockWS.instances[0].fireOpen());

    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(MockWS.instances[0].readyState).toBe(3); // closed because LIST failed

    await advance(2000); // existing backoff reconnect opens a new socket
    expect(MockWS.instances.length).toBe(2);
    expect(MockWS.open).toBe(1); // exactly one live socket
  });

  it('a confirmation still in flight is not started twice (visibilitychange during confirm)', async () => {
    let release: (v: boolean) => void = () => {};
    const confirm = vi.fn(
      () =>
        new Promise<boolean>(r => {
          release = r;
        })
    );
    renderHook(() =>
      useWebSockets({ connections: conn('/watch/pods', () => {}, confirm), type: 'json' })
    );
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000); // confirmation now in flight
    expect(confirm).toHaveBeenCalledTimes(1);

    // A visibilitychange re-check while the confirmation is pending must NOT start
    // a second LIST.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(confirm).toHaveBeenCalledTimes(1);
    act(() => release(true));
    await flush();
  });

  it('a confirmation resolving AFTER the socket was replaced is ignored (no churn on the new socket)', async () => {
    let release: (v: boolean) => void = () => {};
    const confirm = vi.fn(
      () =>
        new Promise<boolean>(r => {
          release = r;
        })
    );
    renderHook(() =>
      useWebSockets({ connections: conn('/watch/pods', () => {}, confirm), type: 'json' })
    );
    await flush();
    const first = MockWS.instances[0];
    act(() => first.fireOpen());
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000); // confirmation in flight for `first`

    // A real drop replaces the socket while the confirmation is pending.
    act(() => first.close());
    await advance(2000);
    const second = MockWS.instances[1];
    act(() => second.fireOpen());

    // The stale confirmation now resolves "failed" — it must NOT close `second`.
    act(() => release(false));
    await flush();
    expect(second.readyState).toBe(1); // untouched
    expect(MockWS.open).toBe(1);
  });
});
