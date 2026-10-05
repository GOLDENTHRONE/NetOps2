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

// P2: live-subset watch event COALESCING (WS_P2_LOADED_CHURN_DESIGN.md). These tests run
// with WATCH_COALESCE_MAX_MS forced positive (production has it on; the default UNDER_TEST
// is 0, which is the synchronous A1 behaviour exercised by useKubeObjectList.test.tsx — that
// file is the knob=0 parity proof). We drive the visible path with a manually controlled
// requestAnimationFrame and keep the deadline large so only the frame flush fires, except
// the dedicated hidden-tab test which uses fake timers.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clusterFetch } from './fetch';
import { DEFAULT_LIST_LIMIT, useKubeObjectList } from './useKubeObjectList';

const mockUseWebSockets = vi.fn();
const mockClusterFetch = vi.mocked(clusterFetch);

vi.mock('./webSocket', () => ({
  useWebSockets: (...args: any[]) => mockUseWebSockets(...args),
  BASE_WS_URL: 'http://localhost:3000',
  useAnyWatchReconnecting: () => false,
}));

vi.mock('./multiplexer', () => ({
  WebSocketManager: { subscribe: vi.fn().mockResolvedValue(() => {}) },
}));

vi.mock('./fetch', () => ({ clusterFetch: vi.fn() }));

// Force a positive coalescing deadline for this suite. Large (100s) so, in the visible
// tests, the rAF flush (which we drive manually) always happens first and the setTimeout
// deadline never fires on wall-clock. The hidden-tab test advances fake timers to it.
// NOTE: the factory is hoisted above module top-level vars, so the deadline literal must be
// inlined here (kept in sync with MAX_MS below).
vi.mock('../../../resilience', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../resilience')>();
  return { ...actual, WATCH_COALESCE_MAX_MS: 100000 };
});
const MAX_MS = 100000;

// ---- manual requestAnimationFrame so the "frame flush" is deterministic ----------------
const rafMap = new Map<number, FrameRequestCallback>();
let rafId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'false');
  localStorage.clear();
  rafMap.clear();
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafMap.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafMap.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run every queued animation-frame callback (the "paint"), inside act(). */
const runFrame = () => {
  const cbs = [...rafMap.values()];
  rafMap.clear();
  act(() => cbs.forEach(cb => cb(0)));
};

const liveMockClass = class {
  static apiVersion = 'v1';
  static apiName = 'pods';
  static apiEndpoint = { apiInfo: [{ group: '', resource: 'pods', version: 'v1' }] };
  constructor(public jsonData: any) {}
  get metadata() {
    return this.jsonData?.metadata;
  }
} as any;

function makePod(name: string, resourceVersion: string, uid = name) {
  return { metadata: { name, namespace: 'default', resourceVersion, uid } };
}

function makeListResponse({
  items = [] as any[],
  resourceVersion = '1',
  continueToken,
}: {
  items?: any[];
  resourceVersion?: string;
  continueToken?: string;
} = {}) {
  return {
    kind: 'PodList',
    apiVersion: 'v1',
    metadata: {
      resourceVersion,
      continue: continueToken,
      remainingItemCount: continueToken ? 3 : undefined,
    },
    items,
  };
}

const firstPage = (items: any[], rv = '1') =>
  ({
    json: () =>
      Promise.resolve(makeListResponse({ items, resourceVersion: rv, continueToken: 'tok' })),
  } as Response);

function queryClientWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const renderLive = (qc: QueryClient, cluster = 'default') =>
  renderHook(
    () =>
      useKubeObjectList({
        kubeObjectClass: liveMockClass,
        requests: [{ cluster }],
        queryParams: { limit: DEFAULT_LIST_LIMIT },
        liveSubsetWatch: true,
      }),
    { wrapper: queryClientWrapper(qc) }
  );

const lastConns = () => mockUseWebSockets.mock.calls.at(-1)![0].connections;
const evt = (type: string, uid: string, rv: string, name = uid) => ({
  type,
  object: { kind: 'Pod', metadata: { uid, name, namespace: 'default', resourceVersion: rv } },
});
const rvOf = (r: any, uid: string) =>
  r.result.current.items?.find((i: any) => i.jsonData.metadata.uid === uid)?.jsonData.metadata
    .resourceVersion;

describe('P2 live-subset coalescing', () => {
  it('buffers loaded MODIFIED and applies on the frame as ONE write (seq 1: repeated MOD same UID)', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => {
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5'));
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '6'));
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '7'));
    });
    // Not applied yet — still buffered.
    expect(rvOf(r, 'p1')).toBe('1');
    expect(setSpy).not.toHaveBeenCalled();

    runFrame();
    await waitFor(() => expect(rvOf(r, 'p1')).toBe('7'));
    // Three events collapsed into exactly ONE cache write.
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('seq 2: MOD A → DELETE A removes A in one write', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1'), makePod('p2', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));

    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => {
      lastConns()[0].onMessage(evt('MODIFIED', 'p2', '5'));
      lastConns()[0].onMessage(evt('DELETED', 'p2', '6'));
    });
    runFrame();
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(r.result.current.items?.[0].jsonData.metadata.uid).toBe('p1');
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('seq 3: DELETE A → ADDED A (same name, NEW uid) — DELETE applied, ADDED ignored', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    act(() => {
      lastConns()[0].onMessage(evt('DELETED', 'p1', '5'));
      lastConns()[0].onMessage(evt('ADDED', 'p1-NEW', '6', 'p1')); // same name, new uid → ignored
    });
    runFrame();
    await waitFor(() => expect(r.result.current.items?.length).toBe(0));
  });

  it('seq 4: DELETE loaded A → ADDED new B — A removed, B absent', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1'), makePod('p2', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));

    act(() => {
      lastConns()[0].onMessage(evt('DELETED', 'p1', '5'));
      lastConns()[0].onMessage(evt('ADDED', 'bNew', '6'));
    });
    runFrame();
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(r.result.current.items?.[0].jsonData.metadata.uid).toBe('p2');
  });

  it('seq 5/6/7 + boundedness: out-of-page ADDED/MOD/DELETE never buffered; burst → ONE write, O(loaded)', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => {
      for (let i = 0; i < 2000; i++) {
        lastConns()[0].onMessage(evt('ADDED', 'add-' + i, String(100 + i))); // in-range new → ignored
        lastConns()[0].onMessage(evt('MODIFIED', 'mod-' + i, String(100 + i))); // out-of-page → ignored
        lastConns()[0].onMessage(evt('DELETED', 'del-' + i, String(100 + i))); // out-of-page → ignored
      }
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '9')); // the only loaded member
    });
    // Filtered-before-buffer: 6000 non-member events wrote nothing; the member is buffered.
    expect(setSpy).not.toHaveBeenCalled();
    runFrame();
    await waitFor(() => expect(rvOf(r, 'p1')).toBe('9'));
    expect(r.result.current.items?.length).toBe(1); // never grew toward the collection
    expect(setSpy).toHaveBeenCalledTimes(1); // exactly one flush despite the 6001-event burst
  });

  it('preserves watch arrival order across UIDs (move-to-end): a newer same-UID event does not drop another UID', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1'), makePod('p2', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));

    const setSpy = vi.spyOn(qc, 'setQueryData');
    // Arrival order: p1@5, p2@6, p1@7. Folding must apply p2@6 and p1@7 (NOT drop p2@6 by
    // applying p1@7 first — which a first-insertion-order Map would do, tripping the RV guard).
    act(() => {
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5'));
      lastConns()[0].onMessage(evt('MODIFIED', 'p2', '6'));
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '7'));
    });
    runFrame();
    await waitFor(() => expect(rvOf(r, 'p1')).toBe('7'));
    expect(rvOf(r, 'p2')).toBe('6'); // NOT dropped
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple distinct loaded UIDs into one write', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1'), makePod('p2', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));

    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => {
      lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5'));
      lastConns()[0].onMessage(evt('MODIFIED', 'p2', '6'));
    });
    runFrame();
    await waitFor(() => expect(rvOf(r, 'p1')).toBe('5'));
    expect(rvOf(r, 'p2')).toBe('6');
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('hidden tab: no rAF is armed; the deadline timer flushes within WATCH_COALESCE_MAX_MS', async () => {
    const visSpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
      const r = renderHook(
        () =>
          useKubeObjectList({
            kubeObjectClass: liveMockClass,
            requests: [{ cluster: 'default' }],
            queryParams: { limit: DEFAULT_LIST_LIMIT },
            liveSubsetWatch: true,
          }),
        { wrapper: queryClientWrapper(qc) }
      );
      // Drain the list fetch microtasks under fake timers.
      await vi.waitFor(() => expect(r.result.current.items?.length).toBe(1));

      const setSpy = vi.spyOn(qc, 'setQueryData');
      act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
      expect(rafMap.size).toBe(0); // hidden → no animation frame scheduled
      expect(setSpy).not.toHaveBeenCalled(); // still buffered, nothing applied yet

      // Before the deadline, no flush.
      act(() => vi.advanceTimersByTime(MAX_MS - 1));
      expect(setSpy).not.toHaveBeenCalled();

      // At the deadline the fallback timer flushes exactly once (the applied value is
      // covered by the visible-path tests; here we assert the hidden/starved timer fires).
      act(() => vi.advanceTimersByTime(1));
      expect(setSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      visSpy.mockRestore();
    }
  });

  it('teardown (unmount) drains pending work and cancels the frame — no STRAY write after unmount', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => r.unmount()); // teardown flushes the pending buffer (≤1 write) and cancels the rAF
    const afterUnmount = setSpy.mock.calls.length;
    expect(rafMap.size).toBe(0); // rAF cancelled — no leak

    runFrame(); // a late frame must NOT produce any further write
    expect(setSpy.mock.calls.length).toBe(afterUnmount);
  });

  it('seq 8: Load More re-baseline clears pending buffer — a stale buffered event never applies', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    // Buffer a MOD for p1 at the OLD baseline (do NOT flush).
    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    expect(rvOf(r, 'p1')).toBe('1');

    // Load More re-baselines to a fresh LIST (p1@10, p2@12 at RV12, no continue).
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            items: [makePod('p1', '10'), makePod('p2', '12')],
            resourceVersion: '12',
          })
        ),
    } as Response);
    await act(async () => {
      await r.result.current.loadMore?.();
    });
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));

    // The stale buffered MOD p1@5 must have been dropped by the connections-change cleanup.
    runFrame();
    expect(rvOf(r, 'p1')).toBe('10'); // fresh baseline, NOT the stale @5
    await waitFor(() => expect(lastConns()[0]?.url).toContain('resourceVersion=12'));
  });

  it('seq 9: 410/ERROR while events pending clears the buffer and invalidates', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValue(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    const invSpy = vi.spyOn(qc, 'invalidateQueries');
    const setSpy = vi.spyOn(qc, 'setQueryData');
    act(() => lastConns()[0].onMessage({ type: 'ERROR', object: { metadata: {} } } as any));
    expect(invSpy).toHaveBeenCalled();

    runFrame(); // pending buffer was cleared → nothing applies
    expect(setSpy).not.toHaveBeenCalled();
    expect(rvOf(r, 'p1')).toBe('1');
  });

  // --- High-churn simulation (write/commit-rate reduction + correctness at scale) --------
  // Measures the metric P2 directly controls: cache writes (= React render commits = the
  // dominant main-thread cost on a churning large list). The wall-clock FPS/GC/interaction
  // numbers the full plan lists require a real browser + cluster rig, which this cloud
  // container does not have; those are projected from the commit-rate reduction in the
  // report. AFTER is measured through the REAL hook (frame-batched flush); BEFORE is the
  // synchronous 1-write-per-event baseline (what WATCH_COALESCE_MAX_MS=0 does, cross-checked
  // by the A1 suite). We also assert the coalesced final state equals the exact expected
  // per-UID state, i.e. coalescing does not change the result at scale.
  const FPS = 60;
  const WINDOW_S = 3;

  const seeded = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const runChurn = async (N: number, rate: number) => {
    const qc = new QueryClient();
    const initial = Array.from({ length: N }, (_, i) => makePod('p' + i, '1'));
    mockClusterFetch.mockResolvedValueOnce(firstPage(initial));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(N));

    const frames = FPS * WINDOW_S;
    const total = rate * WINDOW_S;
    const rnd = seeded(N * 100000 + rate);
    const expected = new Map<string, string>(); // uid -> last RV
    let rv = 1;

    const setSpy = vi.spyOn(qc, 'setQueryData');
    let delivered = 0;
    for (let f = 0; f < frames; f++) {
      const thisFrame = Math.round((total * (f + 1)) / frames) - delivered;
      for (let k = 0; k < thisFrame; k++) {
        const uid = 'p' + Math.floor(rnd() * N);
        rv += 1;
        expected.set(uid, String(rv));
        lastConns()[0].onMessage(evt('MODIFIED', uid, String(rv)));
      }
      delivered += thisFrame;
      runFrame(); // simulate one paint
    }

    const afterWrites = setSpy.mock.calls.length;
    const beforeWrites = total; // synchronous: one cache write per member event

    // Correctness at scale: every churned UID reflects its LAST event's RV.
    await waitFor(() => {
      for (const [uid, wantRv] of expected) {
        expect(rvOf(r, uid)).toBe(wantRv);
      }
    });
    expect(r.result.current.items?.length).toBe(N); // never grew

    // eslint-disable-next-line no-console
    console.log(
      `[churn] loaded=${N} rate=${rate}/s window=${WINDOW_S}s | ` +
        `writes BEFORE=${beforeWrites} (${(beforeWrites / WINDOW_S).toFixed(0)}/s) ` +
        `AFTER=${afterWrites} (${(afterWrites / WINDOW_S).toFixed(0)}/s) | ` +
        `reduction=${(beforeWrites / afterWrites).toFixed(1)}x`
    );

    // Commit rate must be capped near the frame rate and strictly below the event rate.
    expect(afterWrites).toBeLessThanOrEqual(frames);
    expect(afterWrites).toBeLessThan(beforeWrites);
    r.unmount();
  };

  it('churn: loaded=1000 @ 100/200/400 ev/s — commits capped at frame rate, state correct', async () => {
    await runChurn(1000, 100);
    await runChurn(1000, 200);
    await runChurn(1000, 400);
  }, 60000);

  it('churn: loaded=2000 @ 100/200/400 ev/s — commits capped at frame rate, state correct', async () => {
    await runChurn(2000, 100);
    await runChurn(2000, 200);
    await runChurn(2000, 400);
  }, 60000);

  it('seq 12: cluster switch clears the buffer — a stale buffered event never applies to the new cluster', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValue(firstPage([makePod('p1', '1')]));
    const r = renderHook(
      ({ cluster }: { cluster: string }) =>
        useKubeObjectList({
          kubeObjectClass: liveMockClass,
          requests: [{ cluster }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
          liveSubsetWatch: true,
        }),
      { wrapper: queryClientWrapper(qc), initialProps: { cluster: 'default' } }
    );
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));

    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    // Switch cluster → connections change → cleanup clears the buffer + cancels the frame.
    mockClusterFetch.mockResolvedValue(firstPage([makePod('q1', '1')]));
    r.rerender({ cluster: 'other' });
    await waitFor(() =>
      expect(r.result.current.items?.some((i: any) => i.jsonData.metadata.uid === 'q1')).toBe(true)
    );

    const setSpy = vi.spyOn(qc, 'setQueryData');
    runFrame();
    expect(setSpy).not.toHaveBeenCalled(); // stale 'default' buffer did not flush
  });
});
