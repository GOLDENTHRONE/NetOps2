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
 * P1 (#19) — resume-time freshness revalidation, driving the REAL webSocket.ts with a fake
 * global WebSocket + fake timers. On tab-visible, a connection whose last activity is older
 * than the freshness horizon gets exactly ONE bounded confirmLiveness; a recently-active
 * connection is skipped; a failed confirm uses the existing #16 recovery; a listener-less
 * (#17 grace) socket is skipped; confirms are deduped; disabled horizon = old behaviour.
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

// Enable the resume horizon (prod default is 10000; test default is 0) and the #17 grace
// (so the listener-less case is exercisable). Keep every other resilience value real
// (notably WATCH_LIVENESS_TIMEOUT_MS = 180000). Literals inlined (factory is hoisted).
vi.mock('../../../resilience', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../resilience')>();
  // Grace > horizon so the listener-less socket survives in #17 grace past H (lets us prove
  // #19 skips it rather than racing #17's teardown).
  return { ...actual, WATCH_RESUME_FRESHNESS_HORIZON_MS: 5000, WATCH_UNSUBSCRIBE_GRACE_MS: 20000 };
});
const H = 5000;

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

let uid = 0;
const conn = (confirmLiveness?: () => Promise<boolean>, onMessage: (d: any) => void = () => {}) => [
  {
    cluster: '',
    url: `/watch/res-${uid}`,
    onMessage,
    ...(confirmLiveness ? { confirmLiveness } : {}),
  },
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
// Dispatch a real visibilitychange with the document visible (jsdom default).
async function resume() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  uid++;
  MockWS.reset();
  (globalThis as any).WebSocket = MockWS as any;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWebSockets — P1 (#19) resume freshness', () => {
  it('recent activity (age <= H) → NO confirm on resume', async () => {
    const confirm = vi.fn(async () => true);
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen()); // markActivity now
    await advance(Math.floor(H / 2)); // still within the horizon
    await resume();
    expect(confirm).not.toHaveBeenCalled();
    expect(MockWS.open).toBe(1);
  });

  it('stale activity (age > H) → exactly ONE confirm, socket kept on success', async () => {
    const confirm = vi.fn(async () => true);
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    const sock = MockWS.instances[0];
    act(() => sock.fireOpen());
    await advance(H + 1000); // hidden long enough; still < 180s so #16 doesn't act on its own
    await resume();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sock.readyState).not.toBe(3); // healthy confirm → same socket retained
    expect(MockWS.instances.length).toBe(1); // no reconnect, no new socket
  });

  it('failed confirm on resume → existing #16 recovery (socket closed → reconnect)', async () => {
    const confirm = vi.fn(async () => false);
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    const sock = MockWS.instances[0];
    act(() => sock.fireOpen());
    await advance(H + 1000);
    await resume();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sock.readyState).toBe(3); // closeForLiveness closed the dead socket
  });

  it('a successful confirm records activity → a second resume within H skips (coalesce)', async () => {
    const confirm = vi.fn(async () => true);
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    await advance(H + 1000);
    await resume();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    // Immediately resume again (rapid flap): activity was just recorded → skip.
    await resume();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('in-flight confirm is not duplicated by a second resume', async () => {
    let resolveFn: (v: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>(r => (resolveFn = r)));
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    await advance(H + 1000);
    await resume(); // starts a confirm (unresolved)
    await resume(); // second resume while the first confirm is in flight
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFn(true);
      await Promise.resolve();
    });
  });

  it('listener-less (#17 grace) socket is skipped on resume', async () => {
    const confirm = vi.fn(async () => true);
    const h = renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    const sock = MockWS.instances[0];
    act(() => sock.fireOpen());
    h.unmount(); // grace (4000ms) → socket stays listener-less, not torn down yet
    await advance(H + 1000);
    await resume();
    await flush();
    expect(confirm).not.toHaveBeenCalled(); // #17 grace owns it; #19 must not touch it
    expect(sock.readyState).not.toBe(3); // not closed by resume
  });

  it('a #17-reused socket participates normally on resume', async () => {
    const confirm = vi.fn(async () => true);
    const h1 = renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' }));
    await flush();
    act(() => MockWS.instances[0].fireOpen());
    h1.unmount(); // grace
    await advance(1000); // within grace
    renderHook(() => useWebSockets({ connections: conn(confirm), type: 'json' })); // reuse (listeners≥1)
    await flush();
    expect(MockWS.instances.length).toBe(1);
    await advance(H + 1000);
    await resume();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1); // reused socket revalidates like any mounted list
  });

  it('two independent connections each confirm once', async () => {
    const c1 = vi.fn(async () => true);
    const c2 = vi.fn(async () => true);
    renderHook(() =>
      useWebSockets({
        connections: [
          { cluster: '', url: `/watch/a-${uid}`, onMessage: () => {}, confirmLiveness: c1 },
          { cluster: '', url: `/watch/b-${uid}`, onMessage: () => {}, confirmLiveness: c2 },
        ],
        type: 'json',
      })
    );
    await flush();
    MockWS.instances.forEach(s => act(() => s.fireOpen()));
    await advance(H + 1000);
    await resume();
    await flush();
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
  });
});
