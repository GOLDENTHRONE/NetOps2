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
 * flows.mjs — the P0 scenarios (5 negative F1-F5 + 5 positive P+1..P+5),
 * each run through BEFORE (current code) and AFTER (P0) so tests can assert
 * "bug present before, fixed after" and "positive flows unchanged".
 * All data generic/synthetic.
 */

import {
  AUTH_TIMEOUT,
  P0,
  STALE_TIME,
  GC_TIME,
  authRouteBefore,
  getClusterReadiness,
  makeAuthRouteAfter,
  makeReadinessAfter,
  readinessLabel,
  settleCheck,
} from './model.mjs';

// -------- F1: table, healthy + one transient blip ---------------------------
// A Ready cluster (version ok + auth ok) gets ONE version blip (502), then ok.
export function f1_tableBlip() {
  const seq = [
    { versionError: null, auth: { tracked: true, error: null } }, // ok -> Ready
    { versionError: { status: 502 }, auth: { tracked: true, error: null } }, // blip
    { versionError: null, auth: { tracked: true, error: null } }, // ok again
  ];
  // BEFORE: getClusterReadiness has no debounce -> the blip flips to Unavailable.
  const before = seq.map(s => getClusterReadiness(s.versionError, s.auth));
  // AFTER: debounce keeps last-good on a single blip.
  const afterStep = makeReadinessAfter();
  const after = seq.map(s => afterStep(s.versionError, s.auth));
  return {
    before: before.map(readinessLabel), // ['Ready','Unavailable','Ready']
    beforeRaw: before,
    after, // ['ready','ready-reconnecting','ready']
    afterLabel: after.map(readinessLabel), // ['Ready','Ready','Ready']
  };
}

// -------- F2: open a cluster whose auth is slow (6s), token valid -----------
export function f2_openSlowAuth(latencyMs = 6000) {
  const attempts = [{ http: 200, latencyMs }];
  const beforeSettled = settleCheck(attempts, AUTH_TIMEOUT, 0); // 5s -> 408
  const afterSettled = settleCheck(attempts, P0.AUTH_TIMEOUT_MS, P0.OPEN_GATE_RETRY); // 15s -> ok
  return {
    before: authRouteBefore(beforeSettled), // 'unreachable'
    after: makeAuthRouteAfter()(afterSettled), // 'cluster'
    beforeSettled,
    afterSettled,
  };
}

// -------- F3: return at ~4 min, background re-check blips --------------------
// Prior success cached; cache stale (3-5min) so a background re-check runs and
// blips (network-fail -> 502). Token was and is valid.
export function f3_returnFourMinBlip() {
  // BEFORE: had success, but a failed background refetch flips isSuccess->error.
  const before = {
    immediate: authRouteBefore(null), // shows cached page first
    final: authRouteBefore({ status: 502 }), // then flips to gate
  };
  // AFTER: prime a prior success, then feed the blip.
  const step = makeAuthRouteAfter();
  step(null); // prior success on the page
  const after = {
    immediate: 'cluster',
    final: step({ status: 502 }), // keep-last-good
  };
  return { before, after };
}

// -------- F4: cluster genuinely down (repeated 502) -------------------------
export function f4_genuinelyDown() {
  const step = makeAuthRouteAfter();
  step(null); // it was healthy once (we had it open)
  const errors = [{ status: 502 }, { status: 502 }, { status: 502 }];
  const before = errors.map(e => authRouteBefore(e)); // gate on the 1st already
  const after = errors.map(e => step(e)); // reconnecting, then honest gate
  return {
    before, // ['unreachable','unreachable','unreachable']
    after, // ['cluster-reconnecting','unreachable','unreachable']
  };
}

// -------- F5: token genuinely expired / revoked (401/403) -------------------
export function f5_expired(status = 401) {
  const stepA = makeAuthRouteAfter();
  stepA(null); // even with a prior success...
  return {
    before: authRouteBefore({ status }), // 'expired' (401) / 'forbidden' (403)
    after: stepA({ status }), // must be immediate too — keep-last-good bypassed
  };
}

// -------- Positive flows (must be unchanged: before === after) ---------------
export function pPositive() {
  // P+1 valid + fast open
  const p1Attempts = [{ http: 200, latencyMs: 300 }];
  const p1Before = authRouteBefore(settleCheck(p1Attempts, AUTH_TIMEOUT, 0));
  const p1After = makeAuthRouteAfter()(settleCheck(p1Attempts, P0.AUTH_TIMEOUT_MS, P0.OPEN_GATE_RETRY));

  // P+3 first-ever open, still in flight (no cache)
  const p3Before = authRouteBefore('pending');
  const p3After = makeAuthRouteAfter()('pending');

  // P+5 OIDC expired -> login redirect kept
  const p5Before = authRouteBefore({ status: 401 }, { authType: 'oidc' });
  const p5After = makeAuthRouteAfter()({ status: 401 }, { authType: 'oidc' });

  return {
    p1: { before: p1Before, after: p1After }, // cluster/cluster
    p3: { before: p3Before, after: p3After }, // checking/checking
    p5: { before: p5Before, after: p5After }, // expired vs login? see note in test
  };
}

// -------- Return-after-away lifecycle (2 / 4 / 6 min), before vs after -------
// Models the cache windows [V0.4]: <3min fresh (no re-check), 3-5min stale
// (background re-check), >5min gc-ed (cold "checking").
export function returnAfterAway({ awayMs, bgHttp = 200, bgLatencyMs = 300 }) {
  const fresh = awayMs < STALE_TIME;
  const gcTimeExceeded = awayMs > GC_TIME;
  const refetched = !fresh; // stale or cold -> a re-check runs

  // BEFORE
  let before;
  if (!refetched) {
    before = { immediate: 'cluster', final: 'cluster', refetched, cold: false };
  } else {
    const settled = settleCheck([{ http: bgHttp, latencyMs: bgLatencyMs }], AUTH_TIMEOUT, 0);
    const cold = gcTimeExceeded;
    before = {
      immediate: cold ? 'checking' : 'cluster',
      final: authRouteBefore(settled),
      refetched,
      cold,
    };
  }

  // AFTER
  let after;
  const step = makeAuthRouteAfter();
  if (!refetched) {
    step(null); // fresh cache implies a prior success
    after = { immediate: 'cluster', final: 'cluster', refetched, cold: false };
  } else {
    const cold = gcTimeExceeded;
    // Only the STALE window (3-5min) still holds cached last-good; a COLD (>5min,
    // gc-ed) query has NO cached data, so keep-last-good does NOT apply there —
    // a cold blip is an honest gate, same as before. Prime prior-success only
    // when the cache is still present.
    if (!cold) step(null);
    const settled = settleCheck(
      [{ http: bgHttp, latencyMs: bgLatencyMs }],
      P0.AUTH_TIMEOUT_MS,
      P0.OPEN_GATE_RETRY
    );
    after = {
      immediate: cold ? 'checking' : 'cluster',
      final: step(settled),
      refetched,
      cold,
    };
  }

  return { before, after };
}
