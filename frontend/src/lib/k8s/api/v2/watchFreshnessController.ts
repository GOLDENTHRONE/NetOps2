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
 * P1 (#14 C4) — Adaptive LIVE ⇄ POLL freshness controller (PURE state machine).
 *
 * Implements exactly the architecture in WS_PODS_LIVE_RESILIENCE_FINAL_RESEARCH.md §3:
 * a large partially-paginated Pod list stays LIVE (A1 whole-collection watch + UID
 * membership filter) while that is affordable, and degrades to POLL (periodic re-LIST
 * of the loaded prefix at a fresh resourceVersion) when the *measured* stream cost or
 * main-thread jank exceeds budget, returning to LIVE via a bounded TRIAL watch.
 *
 * DESIGN CONSTRAINTS honored here:
 *  - NO hard-coded event-rate threshold. The LIVE→POLL cost trigger is a *computed*
 *    comparison of the measured live byte rate against the projected prefix-poll cost
 *    (loaded × bytesPerEvent / pollInterval), scaled by a config margin. The research
 *    doc's "~100 ev/s" is only an illustration of this formula, never a constant.
 *  - Hysteresis + dwell to prevent flapping (enter POLL only when over budget for a
 *    sustained dwell; return to LIVE only when the TRIAL is comfortably cheaper).
 *  - NO dependency on BOOKMARK / WatchList / object-count thresholds for correctness.
 *  - The controller is PURE and deterministic: `decide()` takes `now` and a signal
 *    snapshot and returns the next state + an action. It performs NO I/O, reads no
 *    clock, and applies no jitter (the caller applies jitter when scheduling). This
 *    makes every transition unit-testable.
 *
 * The caller (useKubeObjectList) maps the returned mode to A1 primitives:
 *   LIVE/TRIAL → watch enabled (opened from the current listResourceVersion);
 *   POLL       → watch disabled + periodic re-baseline LIST of the prefix;
 * and performs the gap-free baseline (LIST-at-fresh-RV → replace → watch-from-RV)
 * whenever `action.freshBaselineNeeded` is set.
 */

export type FreshnessMode = 'LOADING' | 'LIVE' | 'RECONNECTING' | 'POLL' | 'TRIAL';

/** Tunable knobs (all env-configurable via resilience.ts; conservative defaults). */
export interface FreshnessConfig {
  /** Poll interval (ms) used for POLL ticks AND as the T in the cost projection. */
  pollIntervalMs: number;
  /** LIVE→POLL when liveBytesPerSec > costMargin × projectedPollBytesPerSec. >1. */
  costMargin: number;
  /**
   * TRIAL→LIVE only when liveBytesPerSec ≤ trialKeepMargin × projectedPollBytesPerSec.
   * Must be ≤ costMargin so there is a real hysteresis band between "enter POLL" and
   * "stay LIVE after a trial" (default 1.0 = keep LIVE only when it is genuinely no more
   * expensive than polling). Prevents boundary flapping independent of dwell/cooldown.
   */
  trialKeepMargin: number;
  /** A trigger must hold continuously for this long before the switch commits. */
  dwellMs: number;
  /** LIVE→POLL when the main-thread long-task ratio exceeds this fraction (0..1). */
  jankBudget: number;
  /** How long a POLL→LIVE trial watch runs before its cost is judged. */
  trialMs: number;
  /** After a failed trial (or LIVE→POLL), stay in POLL at least this long. */
  cooldownMs: number;
  /**
   * Sustained near-zero live event window (ms) that counts as chronic staleness.
   * 0 disables the staleness trigger (default) — cost + jank remain the primary,
   * flap-safe triggers, and #16 confirm-LIST already gives periodic freshness at the
   * delivery ceiling. See research §2.D and the deviation note in the impl report.
   */
  stalenessMs: number;
  /** Fallback bytes/event used only until the accountant has measured a real value. */
  fallbackBytesPerEvent: number;
}

/** Signal snapshot for one evaluation. Any field may be null when not yet known. */
export interface FreshnessSignals {
  /** Initial prefix LIST has completed at least once (leaves LOADING). */
  loaded: boolean;
  /** Currently loaded row count (the prefix size); drives the poll-cost projection. */
  loadedCount: number;
  /** Measured live watch byte rate (UTF-8 bytes/s) over the last window, or null. */
  liveBytesPerSec: number | null;
  /** Measured mean bytes per data event from the accountant, or null (→ fallback). */
  bytesPerEvent: number | null;
  /** Main-thread long-task ratio over the last window (0..1), or null. */
  jankRatio: number | null;
  /** Time since the last data event was applied while LIVE (ms), or null. */
  silentMs: number | null;
  /**
   * Independent evidence the collection is advancing while the watch is silent
   * (e.g. a confirm/poll LIST returned a newer listResourceVersion with no watch
   * events). Only then does silence imply staleness rather than a quiet cluster.
   * null/false ⇒ silence is NOT treated as staleness (prevents quiet-cluster flap).
   */
  clusterProgressing: boolean | null;
  /** The live watch is currently reconnecting (from the existing #16/backoff path). */
  watchReconnecting: boolean;
  /** The tab just became visible again (forces a confirm/immediate poll). */
  visibilityResumed: boolean;
  /** Backend asked us to back off (HTTP 429 / Retry-After seen). */
  backendThrottled: boolean;
}

export interface FreshnessState {
  mode: FreshnessMode;
  /** When the current mode was entered (ms). */
  since: number;
  /** Earliest time we may leave POLL for a TRIAL (cooldown/backoff). */
  cooldownUntil: number;
  /** When a pending LIVE→POLL trigger first became true (for dwell), or 0. */
  pollCandidateSince: number;
  /** When the current TRIAL started (ms), or 0. */
  trialStartedAt: number;
}

export interface FreshnessDecision {
  state: FreshnessState;
  /** Whether the caller should keep the live watch open this tick. */
  watchEnabled: boolean;
  /** Whether the caller should run the periodic prefix re-baseline poll this tick. */
  pollActive: boolean;
  /**
   * The caller must establish a fresh prefix LIST baseline BEFORE (re)opening the
   * watch this tick — set on POLL/LOADING → LIVE/TRIAL so the watch always opens
   * from a fresh resourceVersion (gap-free invariant I1). Never open a watch without
   * a fresh baseline.
   */
  freshBaselineNeeded: boolean;
  /** Run a poll immediately (e.g. on visibility resume in POLL). */
  pollNow: boolean;
  /** Human-readable reason for the last transition (telemetry/tests). */
  reason: string;
}

export function createInitialFreshnessState(now: number): FreshnessState {
  return {
    mode: 'LOADING',
    since: now,
    cooldownUntil: 0,
    pollCandidateSince: -1,
    trialStartedAt: 0,
  };
}

/** Projected steady-state cost of polling the loaded prefix, in bytes/s. */
export function projectedPollBytesPerSec(
  loadedCount: number,
  bytesPerEvent: number | null,
  config: FreshnessConfig
): number {
  const b = bytesPerEvent && bytesPerEvent > 0 ? bytesPerEvent : config.fallbackBytesPerEvent;
  const seconds = config.pollIntervalMs / 1000;
  if (seconds <= 0 || loadedCount <= 0) return 0;
  return (loadedCount * b) / seconds;
}

/**
 * True when the measured live byte rate is over the poll-cost budget scaled by `margin`
 * (the LIVE→POLL entry uses `costMargin`; the TRIAL→LIVE keep-decision uses the smaller
 * `trialKeepMargin`, forming a hysteresis band).
 */
function costOverBudget(
  signals: FreshnessSignals,
  config: FreshnessConfig,
  margin: number
): boolean {
  if (signals.liveBytesPerSec == null) return false;
  const pollCost = projectedPollBytesPerSec(signals.loadedCount, signals.bytesPerEvent, config);
  if (pollCost <= 0) return false;
  return signals.liveBytesPerSec > margin * pollCost;
}

function jankOverBudget(signals: FreshnessSignals, config: FreshnessConfig): boolean {
  return signals.jankRatio != null && signals.jankRatio > config.jankBudget;
}

function staleOverBudget(signals: FreshnessSignals, config: FreshnessConfig): boolean {
  if (config.stalenessMs <= 0) return false; // disabled by default
  return (
    signals.silentMs != null &&
    signals.silentMs >= config.stalenessMs &&
    signals.clusterProgressing === true // only stale if the world is actually moving
  );
}

/**
 * The reason a POLL is warranted this tick, or null. `margin` scales the cost threshold
 * (entry uses `costMargin`; the trial keep-decision uses `trialKeepMargin`). Jank and
 * staleness are margin-independent.
 */
function pollTrigger(
  signals: FreshnessSignals,
  config: FreshnessConfig,
  margin: number = config.costMargin
): string | null {
  if (costOverBudget(signals, config, margin)) return 'cost>budget';
  if (jankOverBudget(signals, config)) return 'jank>budget';
  if (staleOverBudget(signals, config)) return 'chronic-stale';
  return null;
}

/**
 * Pure transition. Given the current state, a signal snapshot and the current time,
 * return the next state and what the caller should do. Deterministic: no clock reads,
 * no jitter, no I/O.
 */
export function decide(
  state: FreshnessState,
  signals: FreshnessSignals,
  config: FreshnessConfig,
  now: number
): FreshnessDecision {
  const mk = (
    next: Partial<FreshnessState>,
    flags: Partial<Omit<FreshnessDecision, 'state'>>
  ): FreshnessDecision => {
    const mode = next.mode ?? state.mode;
    const changed = mode !== state.mode;
    const merged: FreshnessState = {
      mode,
      since: changed ? now : state.since,
      cooldownUntil: next.cooldownUntil ?? state.cooldownUntil,
      pollCandidateSince: next.pollCandidateSince ?? state.pollCandidateSince,
      trialStartedAt: next.trialStartedAt ?? state.trialStartedAt,
    };
    return {
      state: merged,
      watchEnabled: flags.watchEnabled ?? false,
      pollActive: flags.pollActive ?? false,
      freshBaselineNeeded: flags.freshBaselineNeeded ?? false,
      pollNow: flags.pollNow ?? false,
      reason: flags.reason ?? '',
    };
  };

  switch (state.mode) {
    case 'LOADING': {
      if (!signals.loaded) {
        return mk({}, { reason: 'loading' });
      }
      // Initial LIST done → enter LIVE from the fresh baseline just loaded.
      return mk(
        { mode: 'LIVE', pollCandidateSince: -1 },
        { watchEnabled: true, reason: 'loaded→live' }
      );
    }

    case 'LIVE': {
      // A dropped/reconnecting watch is handled by the existing #16/backoff path.
      if (signals.watchReconnecting) {
        return mk({ mode: 'RECONNECTING' }, { watchEnabled: true, reason: 'watch-drop' });
      }
      const trigger = pollTrigger(signals, config);
      if (trigger) {
        const candSince = state.pollCandidateSince >= 0 ? state.pollCandidateSince : now;
        if (now - candSince >= config.dwellMs) {
          // Dwell satisfied → switch to POLL, arm cooldown before any trial back.
          return mk(
            {
              mode: 'POLL',
              cooldownUntil: now + config.cooldownMs,
              pollCandidateSince: -1,
            },
            { pollActive: true, pollNow: true, reason: `live→poll:${trigger}` }
          );
        }
        // Trigger true but dwell not yet satisfied → stay LIVE, remember since when.
        return mk(
          { pollCandidateSince: candSince },
          { watchEnabled: true, reason: 'poll-candidate' }
        );
      }
      // Healthy/affordable → stay LIVE, clear any pending candidate.
      return mk({ pollCandidateSince: -1 }, { watchEnabled: true, reason: 'live' });
    }

    case 'RECONNECTING': {
      // Purely observational: the existing reconnect machinery drives the socket.
      if (!signals.watchReconnecting) {
        return mk(
          { mode: 'LIVE', pollCandidateSince: -1 },
          { watchEnabled: true, reason: 'reconnected' }
        );
      }
      return mk({}, { watchEnabled: true, reason: 'reconnecting' });
    }

    case 'POLL': {
      // Visibility resume forces an immediate poll for freshness (I: tab suspend).
      const pollNow = signals.visibilityResumed;
      // Respect cooldown/backoff before attempting to return to LIVE.
      if (now >= state.cooldownUntil) {
        return mk(
          { mode: 'TRIAL', trialStartedAt: now },
          { watchEnabled: true, freshBaselineNeeded: true, reason: 'poll→trial' }
        );
      }
      return mk({}, { pollActive: true, pollNow, reason: 'poll' });
    }

    case 'TRIAL': {
      if (signals.watchReconnecting) {
        // Trial watch could not stay up → back to POLL with a fresh cooldown.
        return mk(
          { mode: 'POLL', cooldownUntil: now + config.cooldownMs, trialStartedAt: 0 },
          { pollActive: true, reason: 'trial-drop→poll' }
        );
      }
      const elapsed = now - state.trialStartedAt;
      if (elapsed < config.trialMs) {
        // Still measuring the trial watch.
        return mk({}, { watchEnabled: true, reason: 'trial' });
      }
      // Judge the trial: keep LIVE only if it is comfortably within budget — the cost
      // check uses the smaller `trialKeepMargin` (default 1.0), so LIVE is kept only when
      // it is genuinely no more expensive than polling. The gap between costMargin (enter
      // POLL) and trialKeepMargin (stay LIVE) is the hysteresis band that stops boundary
      // flapping regardless of dwell/cooldown.
      const overBudget = pollTrigger(signals, config, config.trialKeepMargin) !== null;
      if (overBudget) {
        return mk(
          { mode: 'POLL', cooldownUntil: now + config.cooldownMs, trialStartedAt: 0 },
          { pollActive: true, reason: 'trial-over-budget→poll' }
        );
      }
      return mk(
        { mode: 'LIVE', trialStartedAt: 0, pollCandidateSince: -1 },
        { watchEnabled: true, reason: 'trial-ok→live' }
      );
    }

    default:
      return mk({ mode: 'LIVE' }, { watchEnabled: true, reason: 'default' });
  }
}
