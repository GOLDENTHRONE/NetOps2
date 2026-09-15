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

/** Returns `ms` spread by +/-POLL_JITTER_PCT. Used for poll intervals and retry delay. */
export function withJitter(ms: number, pct: number = POLL_JITTER_PCT): number {
  if (pct <= 0) {
    return ms;
  }
  const j = ms * pct;
  return Math.round(ms - j + Math.random() * 2 * j);
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
 * socket still refreshes on its own. Returns `false` (no auto-refetch) when the
 * feature is off, or when the list is paginated — a periodic refetch there would
 * reset the user's loaded pages. Otherwise a jittered interval.
 */
export function watchFallbackRefetchInterval(hasMorePages: boolean): number | false {
  if (WATCH_FALLBACK_REFETCH_MS <= 0) {
    return false;
  }
  if (hasMorePages) {
    return false;
  }
  return withJitter(WATCH_FALLBACK_REFETCH_MS);
}
