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
 * ===========================================================================
 * model.mjs — code-verified model of the "All Clusters" status + cluster-open
 * behaviour on branch GT_D_V1, PLUS the P0 resilience changes, so tests can
 * compare BEFORE (current code) vs AFTER (P0) deterministically.
 *
 * Every BEFORE constant/rule was re-read from source and confirmed by the live
 * baseline (STEP V0 report: "spec matches code exactly, zero drift"). Source
 * anchors are cited inline. ALL DATA IS GENERIC/SYNTHETIC — no real cluster
 * names, hosts, tokens, or namespaces appear anywhere.
 *
 *   BEFORE (verified):
 *     testAuth timeout 5000            clusterApi.ts:38-41   [V0.1 TRUE]
 *     AuthRoute retry:0, gate on any isError
 *                                      RouteSwitcher.tsx:176,227  [V0.2 TRUE]
 *     backoff pure 2**n, no jitter     index.ts:344          [V0.3 TRUE]
 *     staleTime 3min, gcTime unset (v5 default 5min)
 *                                      queryClient.ts:22     [V0.4 TRUE]
 *     abort -> 408 / non-ok -> 502     clusterRequests.ts:185 / :179
 *     readiness                        clusterStatus.ts (getClusterReadiness)
 *     AuthRoute screen order           RouteSwitcher.tsx:221,227,273
 *
 *   AFTER (P0 spec, p7.txt):
 *     authTimeout 5s -> 15s; open-gate retry 0 -> 1 (jittered);
 *     keep-last-good on blip (408/502/network) with debounce threshold 2;
 *     401/403 always immediate; poll jitter +/-15%. staleTime/gcTime untouched.
 * ===========================================================================
 */

// --- verified constants (ms) — BEFORE --------------------------------------
export const DEFAULT_TIMEOUT = 2 * 60 * 1000; // 120000 — /version
export const AUTH_TIMEOUT = 5 * 1000; // 5000 — testAuth (current)
export const STALE_TIME = 3 * 60 * 1000; // 180000
export const GC_TIME = 5 * 60 * 1000; // 300000 (react-query v5 default)
export const versionFetchInterval = 10000;
export const authCheckInterval = 10000;
export const maxBackoff = versionFetchInterval * 6; // 60000

// --- P0 config knobs (defaults from p7.txt) --------------------------------
export const P0 = {
  AUTH_TIMEOUT_MS: 15 * 1000, // 5s -> 15s
  OPEN_GATE_RETRY: 1, // 0 -> 1 (open gate only)
  RETRY_BASE_DELAY_MS: 1000, // ~1s
  STATUS_FAIL_THRESHOLD: 2, // debounce
  KEEP_LAST_GOOD: true,
  JITTER_PCT: 0.15,
};

// --- backoff + jitter -------------------------------------------------------
export function backoff(base, cap, consecutiveFailures) {
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, cap);
}
// BEFORE: pure 2**n (index.ts:344). AFTER: same, wrapped in +/-JITTER_PCT.
export function withJitter(ms, pct = P0.JITTER_PCT, rnd = Math.random) {
  const j = ms * pct;
  return Math.round(ms - j + rnd() * 2 * j);
}
export function jitterBounds(ms, pct = P0.JITTER_PCT) {
  return { min: Math.round(ms * (1 - pct)), max: Math.round(ms * (1 + pct)) };
}

/**
 * One request against a client-side timeout. A response slower than the timeout
 * is ABORTED -> HTTP 408 (clusterRequests.ts:185); a plain failure -> 502
 * (clusterRequests.ts:179); http 200 -> null (success); any other http -> that.
 * @param {number|'network-fail'} http
 * @param {number} latencyMs
 * @param {number} timeoutMs
 * @returns {null|{status:number}}
 */
export function probe(http, latencyMs, timeoutMs) {
  if (latencyMs > timeoutMs) return { status: 408 };
  if (http === 'network-fail') return { status: 502 };
  if (http === 200) return null;
  return { status: http };
}

/**
 * Settle a check given its attempts, a timeout, and a retry budget.
 * BEFORE: retryBudget 0. AFTER open gate: retryBudget 1 (a transient first
 * attempt can be rescued by a later successful attempt).
 * @param {Array<{http:number|'network-fail', latencyMs:number}>} attempts
 * @returns {null|{status:number}}  null = success
 */
export function settleCheck(attempts, timeoutMs, retryBudget) {
  const n = Math.min(attempts.length, retryBudget + 1);
  let last = null;
  for (let i = 0; i < n; i++) {
    const r = probe(attempts[i].http, attempts[i].latencyMs, timeoutMs);
    if (r === null) return null; // a success ends the check
    last = r;
  }
  return last;
}

const isBlip = status => status === 408 || status === 502 || status === 0;

// --- table readiness (clusterStatus.ts getClusterReadiness) — BEFORE --------
export function getClusterStatus(error) {
  if (error === undefined) return 'loading';
  if (error === null) return 'active';
  if (error.status === 401) return 'auth-error';
  if (error.status === 403) return 'permission-error';
  return 'unavailable';
}
export function getClusterReadiness(versionError, auth = { tracked: false }) {
  const reach = getClusterStatus(versionError);
  if (reach !== 'active') return reach;
  if (!auth.tracked) return 'active';
  if (auth.error === undefined) return 'reachable';
  if (auth.error === null) return 'ready';
  if (auth.error.status === 401) return 'auth-error';
  if (auth.error.status === 403) return 'permission-error';
  return 'reachable';
}
const LABEL = {
  ready: 'Ready', reachable: 'Reachable', active: 'Active',
  'auth-error': 'Authentication required', 'permission-error': 'Insufficient permissions',
  unavailable: 'Unavailable', loading: '⋯',
};
export const readinessLabel = s => LABEL[(s || '').replace('-reconnecting', '')] ?? '⋯';

// --- AuthRoute gate outcome (RouteSwitcher.tsx) — BEFORE ---------------------
/**
 * Maps a settled auth-query state to the screen (current code). No memory:
 * any error -> gate. Order matches code: success->page, error->gate, pending->checking.
 * @param {'pending'|null|{status:number}} settled  null = success
 * @param {{authType?:string}} [opts]
 */
export function authRouteBefore(settled, opts = {}) {
  if (settled === 'pending') return 'checking'; // RouteSwitcher.tsx:273
  if (settled === null) return 'cluster'; // :221 isSuccess -> page
  if (opts.authType === 'oidc') return 'login'; // :229 OIDC redirect kept
  const s = settled.status; // :227,244-246
  if (s === 401) return 'expired';
  if (s === 403) return 'forbidden';
  return 'unreachable'; // 408/502/other -> "not responding"
}

// --- AuthRoute gate outcome — AFTER (P0) ------------------------------------
/**
 * Stateful decider: keeps last-good so a single blip after a prior success does
 * NOT show the gate. 401/403 always immediate. Bounded by STATUS_FAIL_THRESHOLD
 * so a truly-down cluster still turns into the gate.
 * @param {object} [cfg]
 * @returns {(settled:'pending'|null|{status:number}, opts?:{authType?:string}) => string}
 */
export function makeAuthRouteAfter(cfg = P0) {
  let hadPriorSuccess = false;
  let errStreak = 0;
  return function step(settled, opts = {}) {
    if (settled === 'pending') {
      // react-query keeps cached data during a background refetch -> page stays;
      // only a cold (gc'd) query has no data -> "checking".
      return hadPriorSuccess ? 'cluster' : 'checking';
    }
    if (settled === null) {
      hadPriorSuccess = true;
      errStreak = 0;
      return 'cluster';
    }
    // OIDC keeps its redirect on ANY error (RouteSwitcher.tsx:229), before the
    // 401/403 mapping and before keep-last-good — unchanged by P0.
    if (opts.authType === 'oidc') return 'login';
    const s = settled.status;
    if (s === 401) return 'expired'; // immediate (security) — bypass keep-last-good
    if (s === 403) return 'forbidden'; // immediate
    // blip:
    errStreak += 1;
    if (cfg.KEEP_LAST_GOOD && hadPriorSuccess && errStreak < cfg.STATUS_FAIL_THRESHOLD) {
      return 'cluster-reconnecting'; // page stays + chip
    }
    return 'unreachable'; // honest gate (never succeeded, or streak >= threshold)
  };
}

// --- table readiness — AFTER (P0) ------------------------------------------
/**
 * Stateful table readiness with debounce + keep-last-good. 401/403 immediate.
 * @param {object} [cfg]
 * @returns {(versionError:any, auth?:object) => string}
 */
export function makeReadinessAfter(cfg = P0) {
  let failStreak = 0;
  let lastGood = null;
  return function step(versionError, auth = { tracked: true, error: null }) {
    const raw = getClusterReadiness(versionError, auth);
    if (raw === 'auth-error' || raw === 'permission-error') return raw; // immediate
    if (raw === 'unavailable') {
      failStreak += 1;
      if (cfg.KEEP_LAST_GOOD && lastGood && failStreak < cfg.STATUS_FAIL_THRESHOLD) {
        return lastGood + '-reconnecting';
      }
      return 'unavailable';
    }
    failStreak = 0;
    lastGood = raw; // ready / reachable / active
    return raw;
  };
}

export { isBlip };
