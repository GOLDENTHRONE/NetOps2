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
 * P1 (#17) — unsubscribe-grace tests, driving the REAL webSocket.ts with a fake global
 * WebSocket + fake timers. Verifies: the last listener leaving does NOT close the socket
 * immediately; a re-subscribe to the same cluster+url within the grace window REUSES the
 * same live socket (no close/open churn, accounting/liveness preserved); no re-subscribe
 * tears down exactly once after the window; rapid cycles keep a single teardown; a
 * superseded/closed socket is a safe no-op; multiple listeners defer teardown to the last
 * one; and the #9 "full unmount" teardown is now eventual (within/after the grace).
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

// Force a positive grace window for this suite (production default is 3000 ms; test default
// is 0). Keep every other resilience value real. NOTE: the factory is hoisted above module
// top-level vars, so the window literal must be inlined here (kept in sync with GRACE below).
vi.mock('../../../resilience', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../resilience')>();
  return { ...actual, WATCH_UNSUBSCRIBE_GRACE_MS: 500 };
});
const GRACE = 500;

// Spy on accounting so we can assert teardown happens only on a REAL teardown, not on reuse.
const accountTeardown = vi.fn();
const accountOpen = vi.fn();
vi.mock('./watchAccounting', () => ({
  accountTeardown: (k: string) => accountTeardown(k),
  accountOpen: (k: string, u: string) => accountOpen(k, u),
  accountFrame: () => {},
  isWatchAccountingEnabled: () => false,
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
  static get open() {
    return MockWS.instances.filter(s => s.readyState !== 3).length;
  }
  static reset() {
    MockWS.instances = [];
  }
}

// Unique url per test so webSocket.ts module-global maps (sockets/listeners/pending) never
// leak a connectionKey between tests. Within one test the url is stable (so shared-key cases
// reuse it).
let uid = 0;
const conn = (onMessage: (d: any) => void = () => {}) => [
  { cluster: '', url: `/watch/ns-${uid}`, onMessage },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  uid++;
  MockWS.reset();
  accountTeardown.mockClear();
  accountOpen.mockClear();
  (globalThis as any).WebSocket = MockWS as any;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWebSockets — P1 (#17) unsubscribe grace', () => {
  it('last listener leaving does NOT close immediately (eventual teardown — #9 timing)', async () => {
    const h = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    expect(MockWS.open).toBe(1);

    h.unmount();
    // Still open right after unmount — teardown is deferred by the grace window.
    expect(MockWS.instances[0].readyState).not.toBe(3);
    expect(accountTeardown).not.toHaveBeenCalled();

    // After the window with no re-subscribe → exactly one close + one accounting teardown.
    await advance(GRACE + 50);
    expect(MockWS.instances[0].readyState).toBe(3);
    expect(MockWS.instances.length).toBe(1); // no new socket ever opened
    expect(accountTeardown).toHaveBeenCalledTimes(1);
  });

  it('re-subscribe to the same key within grace REUSES the socket (no churn)', async () => {
    const h1 = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    const first = MockWS.instances[0];
    expect(MockWS.open).toBe(1);

    h1.unmount(); // schedule grace teardown
    await advance(Math.floor(GRACE / 2)); // still within the window
    expect(first.readyState).not.toBe(3);

    // New consumer mounts for the SAME cluster+url before the window expires.
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();

    // Same socket reused: no second instance, original never closed, no teardown ran.
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.instances[0]).toBe(first);
    expect(first.readyState).not.toBe(3);
    expect(accountTeardown).not.toHaveBeenCalled();
    expect(accountOpen).toHaveBeenCalledTimes(1); // only the original open

    // And the pending teardown was cancelled — advancing past the window keeps it alive.
    await advance(GRACE + 50);
    expect(MockWS.instances[0]).toBe(first);
    expect(first.readyState).not.toBe(3);
    expect(accountTeardown).not.toHaveBeenCalled();
  });

  it('rapid unsubscribe/subscribe cycles settle to a single live socket', async () => {
    for (let i = 0; i < 4; i++) {
      const h = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
      await flush();
      if (i === 0) act(() => MockWS.instances[0].fireOpen());
      h.unmount();
      await advance(Math.floor(GRACE / 3)); // always re-subscribe within the window
    }
    // One socket throughout; final re-subscribe keeps it alive.
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.open).toBe(1);
    expect(accountTeardown).not.toHaveBeenCalled();
  });

  it('multiple listeners: teardown is scheduled only when the LAST one leaves', async () => {
    const a = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    const b = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    // Shared: still one socket.
    expect(MockWS.instances.length).toBe(1);

    a.unmount(); // one listener remains → no teardown, no grace
    await advance(GRACE + 50);
    expect(MockWS.instances[0].readyState).not.toBe(3);
    expect(accountTeardown).not.toHaveBeenCalled();

    b.unmount(); // last listener → grace scheduled
    expect(MockWS.instances[0].readyState).not.toBe(3);
    await advance(GRACE + 50);
    expect(MockWS.instances[0].readyState).toBe(3);
    expect(accountTeardown).toHaveBeenCalledTimes(1);
  });

  it('a socket reused across the grace keeps #16 silent-death liveness working', async () => {
    const h1 = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    const first = MockWS.instances[0];

    h1.unmount(); // schedule grace teardown
    await advance(200); // within the window
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' })); // reuse same key
    await flush();
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.instances[0]).toBe(first); // same socket reused

    // No frames for longer than the liveness timeout: the ORIGINAL liveness timer (armed at
    // the first open and NOT cleared by the grace reuse) must still trip and close the socket.
    await advance(WATCH_LIVENESS_TIMEOUT_MS + 1000);
    expect(first.readyState).toBe(3); // liveness survived the reuse and fired
  });

  it('a socket that already closed during the grace is a safe no-op at teardown', async () => {
    const h = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    h.unmount(); // schedule grace
    // Socket drops on its own during the window.
    act(() => MockWS.instances[0].close());
    expect(MockWS.instances[0].readyState).toBe(3);
    // Grace fires: must not throw, must not open anything, teardown stays consistent.
    await advance(GRACE + 50);
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.open).toBe(0);
  });
});
