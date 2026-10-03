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

/**
 * P0 resilience knobs for the "All Clusters" status + cluster-open flow.
 *
 * Goal: one slow/blipped probe must never destroy a healthy view. These values
 * make the UI tolerant of a single blip (retry once, keep last-known-good,
 * debounce) while keeping genuine auth failures (401/403) immediate. Everything
 * is env-configurable so it can be tuned or fully rolled back without a code
 * change. See p7.txt for the full spec.
 *
 * Env keys are read via literal member access so Vite can inline them at build.
 */

function intEnvOrDefault(raw: unknown, fallback: number, min = 1): number {
  const parsed = raw !== undefined && raw !== '' ? Number.parseInt(String(raw), 10) : NaN;
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function boolEnvOrDefault(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return String(raw).toLowerCase() === 'true';
}

function fractionEnvOrDefault(raw: unknown, fallback: number): number {
  const parsed = raw !== undefined && raw !== '' ? Number.parseFloat(String(raw)) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1 ? parsed : fallback;
}

/**
 * Client-side timeout for the authorization probe (`testAuth` →
 * selfsubjectrulesreviews). Raised from the original 5s so a slow-but-OK check
 * isn't aborted into a false "not responding". Override with
 * `REACT_APP_AUTH_TIMEOUT_MS`.
 */
export const AUTH_TIMEOUT_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_AUTH_TIMEOUT_MS,
  15 * 1000
);

/**
 * How many times the one-shot cluster-open auth check (AuthRoute) retries a
 * transient failure before it counts as failed. Applies ONLY to the open gate;
 * the background polls keep `retry:false` (their cadence + debounce already
 * absorb a blip, and a within-cycle retry there would double-count the failure
 * counter). Override with `REACT_APP_OPEN_GATE_RETRY` (0 disables).
 */
export const OPEN_GATE_RETRY = intEnvOrDefault(import.meta.env.REACT_APP_OPEN_GATE_RETRY, 1, 0);

/** Base delay before the open-gate retry (grows per attempt, jittered). */
export const RETRY_BASE_DELAY_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_RETRY_BASE_DELAY_MS,
  1000
);

/**
 * Consecutive settled failures required before a blip (408/timeout/502/network)
 * turns a healthy view into "Unavailable"/the gate. 1 = old behaviour (no
 * debounce). Override with `REACT_APP_STATUS_FAIL_THRESHOLD`.
 */
export const STATUS_FAIL_THRESHOLD = intEnvOrDefault(
  import.meta.env.REACT_APP_STATUS_FAIL_THRESHOLD,
  2
);

/**
 * When true, a blip after a prior success keeps the last-known-good view (with a
 * "reconnecting…" hint) until STATUS_FAIL_THRESHOLD is reached, instead of
 * flipping to an error immediately. Never applies to 401/403. Override with
 * `REACT_APP_KEEP_LAST_GOOD`.
 */
export const KEEP_LAST_GOOD = boolEnvOrDefault(import.meta.env.REACT_APP_KEEP_LAST_GOOD, true);

/**
 * Random spread applied to poll intervals so many clusters/queries don't fire on
 * the same instant (thundering herd). 0.15 = +/-15%. Override with
 * `REACT_APP_POLL_JITTER_PCT`.
 */
export const POLL_JITTER_PCT = fractionEnvOrDefault(
  import.meta.env.REACT_APP_POLL_JITTER_PCT,
  0.15
);

/**
 * P1 — watch (WebSocket) auto-reconnect. When a live watch connection drops
 * unexpectedly, redial with exponential backoff + jitter instead of leaving the
 * view silently stale. WATCH_RECONNECT=false restores the old (no-reconnect)
 * behaviour. Overrides: REACT_APP_WATCH_RECONNECT / _BASE_MS / _CAP_MS.
 */
export const WATCH_RECONNECT = boolEnvOrDefault(import.meta.env.REACT_APP_WATCH_RECONNECT, true);
export const WATCH_RECONNECT_BASE_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_RECONNECT_BASE_MS,
  1000
);
export const WATCH_RECONNECT_CAP_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_RECONNECT_CAP_MS,
  30000
);

/**
 * P1 — low-frequency safety-net refetch for watched lists, so a silently-dead
 * socket (or a large/paginated list that never watches at all) still refreshes
 * on its own. 0 disables. Override: REACT_APP_WATCH_FALLBACK_REFETCH_MS.
 */
export const WATCH_FALLBACK_REFETCH_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_FALLBACK_REFETCH_MS,
  90000,
  0
);

/**
 * P1 (#17) — navigation grace for shared watches. When the LAST listener of a
 * watch connection (keyed by cluster+url) unsubscribes, delay the socket teardown
 * by this window instead of closing immediately. A shared watch (namespaces, CRDs,
 * …) whose consumer re-mounts on the next page re-subscribes to the SAME
 * cluster+url within the window and REUSES the still-live socket, so navigation no
 * longer closes+reopens shared watches on every route change (needless apiserver
 * watch churn). If nobody re-subscribes within the window, the normal teardown runs
 * exactly once, just deferred. The window only DELAYS teardown; it never skips it.
 *
 * Sized above the measured worst-case unmount→remount gap (~1.1s on fast loopback
 * with cached lists; larger on remote/slow/heavy). 0 restores the previous
 * immediate-close behaviour (and is the one-switch rollback).
 * Override: REACT_APP_WATCH_UNSUBSCRIBE_GRACE_MS.
 */
export const WATCH_UNSUBSCRIBE_GRACE_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_UNSUBSCRIBE_GRACE_MS,
  // Default OFF under test so the existing immediate-teardown suites stay deterministic
  // (mirrors `kubeRequestRetry` being disabled under test); the dedicated grace test sets
  // a positive value explicitly. Production default is 3000 ms.
  import.meta.env.UNDER_TEST === 'true' ? 0 : 3000,
  0
);

/**
 * P1 (#16) — silent-death liveness timeout. A watch socket can die with no
 * `close`/`error` event (half-open behind an idle L7 load balancer, OS sleep,
 * NAT timeout, …); it then "looks open" while no frames arrive, which is
 * indistinguishable from a healthy-but-quiet watch. With
 * `allowWatchBookmarks=true` the API server emits periodic BOOKMARK frames
 * (observed cadence ~60s while the cluster is quiet — this is server behaviour,
 * NOT a Kubernetes timing guarantee), so a healthy watch is never truly silent.
 * Kubernetes does NOT guarantee periodic BOOKMARKs (best-effort; etcd progress
 * interval is cluster-config-dependent — see WS_BOOKMARK_PRODUCTION_DEPENDENCY_REVIEW.md),
 * so silence alone is NOT treated as death. When NO frame (data OR bookmark)
 * arrives on an open socket for this long, the watch layer runs ONE authoritative
 * LIST refetch (confirm-before-reconnect): if it succeeds the watch is healthy
 * (quiet, or resynced by the existing list→watch machinery) and is kept; only if
 * the LIST fails is the socket closed so the EXISTING reconnect path recovers it.
 * Default 180000 (~3x the observed ~60s cadence) tolerates a missed bookmark plus
 * background-tab timer throttling. 0 disables the whole mechanism. Override:
 * `REACT_APP_WATCH_LIVENESS_TIMEOUT_MS`.
 */
export const WATCH_LIVENESS_TIMEOUT_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_LIVENESS_TIMEOUT_MS,
  180000,
  0
);

/**
 * MEASUREMENT ONLY (no gating) — enable the observational watch accountant
 * (watchAccounting.ts), which records per-watch event rate, exact wire bytes,
 * parse cost, reconnects and lifetime so a future fallback/gating decision can
 * be grounded in real evidence. Default false: when off, the watch hot path pays
 * only a single cached boolean read. This flag NEVER changes watch behaviour
 * (#15/#16/multiplexer are untouched). Override: `REACT_APP_WATCH_ACCOUNTING`.
 * For ad-hoc measurement without a rebuild, set
 * `window.__HEADLAMP_WATCH_ACCOUNTING__ = true` before the app bundle loads.
 */
export const WATCH_ACCOUNTING = boolEnvOrDefault(import.meta.env.REACT_APP_WATCH_ACCOUNTING, false);

/**
 * P1 (#14 C4) — Adaptive LIVE ⇄ POLL freshness controller (see
 * WS_PODS_LIVE_RESILIENCE_FINAL_RESEARCH.md). MASTER SWITCH, default **false**:
 * when off, a live-subset (Pods) list behaves exactly as A1 today (always LIVE while
 * partially paginated). When on, the controller may degrade a live-subset list to a
 * bounded prefix-POLL when the *measured* stream cost or main-thread jank exceeds
 * budget, returning to LIVE via a trial watch. It NEVER changes correctness (#15/#16,
 * gap-free baseline, keep-last-good, O(loaded) all hold in both modes) and applies
 * ONLY when `liveSubsetWatch` is active. Override: `REACT_APP_WATCH_ADAPTIVE`.
 */
export const WATCH_ADAPTIVE = boolEnvOrDefault(import.meta.env.REACT_APP_WATCH_ADAPTIVE, false);

/**
 * Whether the adaptive controller is enabled. Read LAZILY (not as an eager const) so a
 * runtime opt-in — `window.__HEADLAMP_WATCH_ADAPTIVE__ = true` set before the bundle
 * loads (same escape hatch as the accountant) — is observed even though the flag is
 * checked at module-eval time elsewhere. Default (env false + global unset) keeps exact
 * A1 behavior.
 */
export function isWatchAdaptiveEnabled(): boolean {
  return (
    WATCH_ADAPTIVE ||
    (typeof globalThis !== 'undefined' && (globalThis as any).__HEADLAMP_WATCH_ADAPTIVE__ === true)
  );
}

/** Prefix-poll interval (ms) and the `T` in the LIVE→POLL cost projection. */
export const WATCH_ADAPTIVE_POLL_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_POLL_MS,
  10000,
  1000
);

/**
 * LIVE→POLL when measured live bytes/s > COST_MARGIN × projected prefix-poll bytes/s
 * (loaded × bytesPerEvent / poll interval). This is a DERIVED comparison, not a fixed
 * event-rate threshold. `×100` (parsed as int then /100) so it is env-tunable as a
 * percentage-like value; default 150 = 1.5×.
 */
export const WATCH_ADAPTIVE_COST_MARGIN =
  intEnvOrDefault(import.meta.env.REACT_APP_WATCH_ADAPTIVE_COST_MARGIN_PCT, 150, 100) / 100;

/**
 * TRIAL→LIVE keep threshold as a fraction of projected poll cost (`/100`, default 100 =
 * 1.0×). Must be ≤ COST_MARGIN; the gap between them is the hysteresis band that stops
 * flapping at the crossover. Return to LIVE only when the trial's measured cost is at or
 * below the plain poll cost (LIVE genuinely no more expensive than polling).
 */
export const WATCH_ADAPTIVE_TRIAL_KEEP_MARGIN =
  intEnvOrDefault(import.meta.env.REACT_APP_WATCH_ADAPTIVE_TRIAL_KEEP_MARGIN_PCT, 100, 1) / 100;

/** A LIVE→POLL trigger must hold continuously this long before it commits (anti-flap). */
export const WATCH_ADAPTIVE_DWELL_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_DWELL_MS,
  15000,
  1000
);

/** LIVE→POLL when the main-thread long-task ratio exceeds this fraction. `/100`. */
export const WATCH_ADAPTIVE_JANK_BUDGET =
  intEnvOrDefault(import.meta.env.REACT_APP_WATCH_ADAPTIVE_JANK_BUDGET_PCT, 20, 0) / 100;

/** How long a POLL→LIVE trial watch runs before its measured cost is judged. */
export const WATCH_ADAPTIVE_TRIAL_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_TRIAL_MS,
  8000,
  1000
);

/** After a LIVE→POLL switch or a failed trial, stay in POLL at least this long. */
export const WATCH_ADAPTIVE_COOLDOWN_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_COOLDOWN_MS,
  60000,
  1000
);

/** How often the controller re-evaluates signals. */
export const WATCH_ADAPTIVE_EVAL_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_EVAL_MS,
  2000,
  500
);

/**
 * Sustained near-zero live-event window (ms) that counts as chronic staleness (only
 * when the collection is independently observed to be progressing). 0 = disabled
 * (default) — cost + jank are the primary flap-safe triggers and #16 confirm-LIST
 * already gives periodic freshness at the delivery ceiling. Override:
 * `REACT_APP_WATCH_ADAPTIVE_STALENESS_MS`.
 */
export const WATCH_ADAPTIVE_STALENESS_MS = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_STALENESS_MS,
  0,
  0
);

/** Fallback bytes/event used for the poll-cost projection until the accountant measures. */
export const WATCH_ADAPTIVE_FALLBACK_BYTES_PER_EVENT = intEnvOrDefault(
  import.meta.env.REACT_APP_WATCH_ADAPTIVE_FALLBACK_BYTES_PER_EVENT,
  1800,
  1
);

/** Returns `ms` spread by +/-POLL_JITTER_PCT. Used for poll intervals and retry delay. */
export function withJitter(ms: number, pct: number = POLL_JITTER_PCT): number {
  if (pct <= 0) {
    return ms;
  }
  const j = ms * pct;
  return Math.round(ms - j + Math.random() * 2 * j);
}

export function withStableJitter(ms: number, key: string, pct: number = POLL_JITTER_PCT): number {
  if (pct <= 0) return ms;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const frac = (hash >>> 0) / 4294967295;
  const j = ms * pct;
  return Math.round(ms - j + frac * 2 * j);
}

/**
 * Is this auth error a transient "blip" (timeout/5xx/network) as opposed to a
 * genuine auth failure (401/403)? Blips are eligible for keep-last-good/debounce;
 * 401/403 are always surfaced immediately.
 */
export function isBlipStatus(status: number | undefined): boolean {
  return status !== 401 && status !== 403;
}

/**
 * P1 safety-net refetch interval (ms) for a watched list, so a silently-dead
 * socket — or a large list that never watches while paginating (#14) — still
 * refreshes on its own. Returns `false` (no auto-refetch) when the feature is off,
 * or when `paused` is true. `paused` is passed by the caller when this query holds
 * accumulated pagination pages (`metadata.paginated`) or a "Load more" is in flight:
 * a periodic page-1 refetch would be wasted (the queryFn commit guard keeps the
 * accumulated list anyway), so we skip scheduling it. This is an efficiency gate;
 * correctness is enforced at the queryFn commit boundary, not here. Otherwise a
 * jittered interval.
 */
export function watchFallbackRefetchInterval(paused: boolean): number | false {
  if (WATCH_FALLBACK_REFETCH_MS <= 0) {
    return false;
  }
  if (paused) {
    return false;
  }
  return withJitter(WATCH_FALLBACK_REFETCH_MS);
}
