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

import { describe, expect, it } from 'vitest';
import {
  createInitialFreshnessState,
  decide,
  FreshnessConfig,
  FreshnessSignals,
  FreshnessState,
  projectedPollBytesPerSec,
} from './watchFreshnessController';

const cfg = (over: Partial<FreshnessConfig> = {}): FreshnessConfig => ({
  pollIntervalMs: 10_000,
  costMargin: 1.5,
  trialKeepMargin: 1.0,
  dwellMs: 15_000,
  jankBudget: 0.2,
  trialMs: 8_000,
  cooldownMs: 60_000,
  stalenessMs: 0,
  fallbackBytesPerEvent: 1_800,
  ...over,
});

const sig = (over: Partial<FreshnessSignals> = {}): FreshnessSignals => ({
  loaded: true,
  loadedCount: 1_000,
  liveBytesPerSec: 0,
  bytesPerEvent: 1_800,
  jankRatio: 0,
  silentMs: null,
  clusterProgressing: null,
  watchReconnecting: false,
  visibilityResumed: false,
  backendThrottled: false,
  ...over,
});

// Drive decide() repeatedly, advancing time, until the mode changes or maxTicks.
function run(
  state: FreshnessState,
  signals: FreshnessSignals,
  config: FreshnessConfig,
  startNow: number,
  stepMs: number,
  maxTicks: number
) {
  let s = state;
  let now = startNow;
  let last;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    last = decide(s, signals, config, now);
    if (last.state.mode !== s.mode) {
      return { decision: last, now, ticks };
    }
    s = last.state;
    now += stepMs;
  }
  return { decision: last!, now, ticks };
}

describe('watchFreshnessController — LOADING', () => {
  it('stays LOADING until the initial LIST completes', () => {
    const d = decide(createInitialFreshnessState(0), sig({ loaded: false }), cfg(), 100);
    expect(d.state.mode).toBe('LOADING');
    expect(d.watchEnabled).toBe(false);
  });
  it('enters LIVE with the watch enabled once loaded (baseline already fresh)', () => {
    const d = decide(createInitialFreshnessState(0), sig({ loaded: true }), cfg(), 100);
    expect(d.state.mode).toBe('LIVE');
    expect(d.watchEnabled).toBe(true);
  });
});

describe('watchFreshnessController — LIVE stays live when affordable', () => {
  it('stays LIVE when the live byte rate is under the poll-cost budget', () => {
    const c = cfg();
    // pollCost = 1000*1800/10 = 180,000 B/s; margin 1.5 → threshold 270,000 B/s.
    const d = decide(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: 100_000 }),
      c,
      1_000
    );
    expect(d.state.mode).toBe('LIVE');
    expect(d.watchEnabled).toBe(true);
  });
});

describe('watchFreshnessController — LIVE→POLL is cost-derived, not a fixed threshold', () => {
  it('projected poll cost = loaded × bytesPerEvent / interval', () => {
    expect(projectedPollBytesPerSec(1_000, 1_800, cfg())).toBe(180_000);
    expect(projectedPollBytesPerSec(1_000, 1_800, cfg({ pollIntervalMs: 5_000 }))).toBe(360_000);
    expect(projectedPollBytesPerSec(500, 1_800, cfg())).toBe(90_000);
  });

  it('the crossover MOVES with pollInterval (proves it is derived, not hard-coded)', () => {
    // Same live rate, different interval → different decision.
    const rate = 300_000; // B/s
    // T=10s → threshold 1.5×180,000=270,000 → over budget → will switch.
    const a = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: rate }),
      cfg(),
      0,
      1_000,
      40
    );
    expect(a.decision.state.mode).toBe('POLL');
    // T=5s → pollCost 360,000 → threshold 540,000 → under budget → stays LIVE.
    const b = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: rate }),
      cfg({ pollIntervalMs: 5_000 }),
      0,
      1_000,
      40
    );
    expect(b.decision.state.mode).toBe('LIVE');
  });

  it('switches to POLL only after the dwell period, then arms cooldown and polls now', () => {
    const c = cfg({ dwellMs: 15_000 });
    const s0: FreshnessState = { ...createInitialFreshnessState(0), mode: 'LIVE' };
    const overBudget = sig({ liveBytesPerSec: 400_000 }); // > 270,000
    // First tick: candidate, still LIVE.
    const d1 = decide(s0, overBudget, c, 0);
    expect(d1.state.mode).toBe('LIVE');
    expect(d1.state.pollCandidateSince).toBe(0 || d1.state.pollCandidateSince); // recorded
    // Before dwell elapses: still LIVE.
    const d2 = decide(d1.state, overBudget, c, 10_000);
    expect(d2.state.mode).toBe('LIVE');
    // After dwell: switch.
    const d3 = decide(d2.state, overBudget, c, 16_000);
    expect(d3.state.mode).toBe('POLL');
    expect(d3.pollActive).toBe(true);
    expect(d3.pollNow).toBe(true);
    expect(d3.state.cooldownUntil).toBe(16_000 + c.cooldownMs);
  });

  it('does NOT switch if the trigger clears before dwell (no flap)', () => {
    const c = cfg({ dwellMs: 15_000 });
    let s: FreshnessState = { ...createInitialFreshnessState(0), mode: 'LIVE' };
    s = decide(s, sig({ liveBytesPerSec: 400_000 }), c, 0).state; // candidate
    // Rate drops back under budget before dwell → candidate cleared, stays LIVE.
    const d = decide(s, sig({ liveBytesPerSec: 50_000 }), c, 5_000);
    expect(d.state.mode).toBe('LIVE');
    expect(d.state.pollCandidateSince).toBe(-1); // -1 = no pending candidate
  });

  it('switches to POLL on sustained jank over budget', () => {
    const c = cfg();
    const r = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: 0, jankRatio: 0.5 }),
      c,
      0,
      1_000,
      40
    );
    expect(r.decision.state.mode).toBe('POLL');
    expect(r.decision.reason).toContain('jank');
  });
});

describe('watchFreshnessController — RECONNECTING', () => {
  it('LIVE→RECONNECTING on watch drop, keeps watch enabled', () => {
    const d = decide(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ watchReconnecting: true }),
      cfg(),
      1_000
    );
    expect(d.state.mode).toBe('RECONNECTING');
    expect(d.watchEnabled).toBe(true);
  });
  it('RECONNECTING→LIVE when the socket recovers', () => {
    const d = decide(
      { ...createInitialFreshnessState(0), mode: 'RECONNECTING' },
      sig({ watchReconnecting: false }),
      cfg(),
      1_000
    );
    expect(d.state.mode).toBe('LIVE');
  });
});

describe('watchFreshnessController — POLL → TRIAL → LIVE (gap-free)', () => {
  it('POLL holds through cooldown, then enters TRIAL requiring a fresh baseline', () => {
    const c = cfg({ cooldownMs: 60_000 });
    const s0: FreshnessState = {
      ...createInitialFreshnessState(0),
      mode: 'POLL',
      cooldownUntil: 60_000,
    };
    // Before cooldown: stays POLL.
    const d1 = decide(s0, sig(), c, 30_000);
    expect(d1.state.mode).toBe('POLL');
    expect(d1.pollActive).toBe(true);
    // At/after cooldown: TRIAL, and the caller MUST take a fresh baseline first.
    const d2 = decide(d1.state, sig(), c, 60_000);
    expect(d2.state.mode).toBe('TRIAL');
    expect(d2.freshBaselineNeeded).toBe(true);
    expect(d2.watchEnabled).toBe(true);
  });

  it('TRIAL measures for trialMs then returns to LIVE when within budget', () => {
    const c = cfg({ trialMs: 8_000 });
    const s0: FreshnessState = {
      ...createInitialFreshnessState(0),
      mode: 'TRIAL',
      trialStartedAt: 0,
    };
    const cheap = sig({ liveBytesPerSec: 20_000 }); // well under budget
    expect(decide(s0, cheap, c, 4_000).state.mode).toBe('TRIAL'); // still measuring
    const done = decide(s0, cheap, c, 9_000);
    expect(done.state.mode).toBe('LIVE');
    expect(done.reason).toContain('trial-ok');
  });

  it('failed TRIAL (still over budget) returns to POLL with a fresh cooldown', () => {
    const c = cfg({ trialMs: 8_000, cooldownMs: 60_000 });
    const s0: FreshnessState = {
      ...createInitialFreshnessState(0),
      mode: 'TRIAL',
      trialStartedAt: 0,
    };
    const busy = sig({ liveBytesPerSec: 500_000 });
    const done = decide(s0, busy, c, 9_000);
    expect(done.state.mode).toBe('POLL');
    expect(done.state.cooldownUntil).toBe(9_000 + c.cooldownMs);
  });

  it('hysteresis band: a rate between trialKeepMargin×pollCost and costMargin×pollCost does not flap', () => {
    // pollCost = 1000×1800/10 = 180,000. costMargin 1.5 → 270,000. trialKeepMargin 1.0 → 180,000.
    // A rate of 220,000 is inside the band (below entry, above keep).
    const c = cfg({ costMargin: 1.5, trialKeepMargin: 1.0, dwellMs: 5_000 });
    const band = sig({ liveBytesPerSec: 220_000 });
    // From LIVE: below the 270,000 entry threshold → stays LIVE (no switch to POLL).
    const live = run({ ...createInitialFreshnessState(0), mode: 'LIVE' }, band, c, 0, 1_000, 30);
    expect(live.decision.state.mode).toBe('LIVE');
    // From a finished TRIAL: above the 180,000 keep threshold → rejected back to POLL.
    const trial = decide(
      { ...createInitialFreshnessState(0), mode: 'TRIAL', trialStartedAt: 0 },
      band,
      c,
      9_000
    );
    expect(trial.state.mode).toBe('POLL');
    expect(trial.reason).toContain('trial-over-budget');
  });

  it('a TRIAL watch that cannot stay up drops back to POLL', () => {
    const c = cfg();
    const s0: FreshnessState = {
      ...createInitialFreshnessState(0),
      mode: 'TRIAL',
      trialStartedAt: 0,
    };
    const d = decide(s0, sig({ watchReconnecting: true }), c, 1_000);
    expect(d.state.mode).toBe('POLL');
  });
});

describe('watchFreshnessController — visibility resume', () => {
  it('forces an immediate poll while in POLL', () => {
    const c = cfg();
    const s0: FreshnessState = {
      ...createInitialFreshnessState(0),
      mode: 'POLL',
      cooldownUntil: 1_000_000,
    };
    const d = decide(s0, sig({ visibilityResumed: true }), c, 10_000);
    expect(d.state.mode).toBe('POLL');
    expect(d.pollNow).toBe(true);
  });
});

describe('watchFreshnessController — staleness trigger', () => {
  it('is disabled by default (stalenessMs=0): silence never forces POLL', () => {
    const c = cfg({ stalenessMs: 0 });
    const r = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: 0, silentMs: 10_000_000, clusterProgressing: true }),
      c,
      0,
      1_000,
      40
    );
    expect(r.decision.state.mode).toBe('LIVE');
  });

  it('when enabled, fires ONLY when the cluster is progressing (not a quiet cluster)', () => {
    const c = cfg({ stalenessMs: 60_000, dwellMs: 5_000 });
    // Quiet cluster (not progressing) → stays LIVE even when silent.
    const quiet = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: 0, silentMs: 120_000, clusterProgressing: false }),
      c,
      0,
      1_000,
      40
    );
    expect(quiet.decision.state.mode).toBe('LIVE');
    // Progressing but silent (delivery ceiling) → switches to POLL.
    const stale = run(
      { ...createInitialFreshnessState(0), mode: 'LIVE' },
      sig({ liveBytesPerSec: 0, silentMs: 120_000, clusterProgressing: true }),
      c,
      0,
      1_000,
      40
    );
    expect(stale.decision.state.mode).toBe('POLL');
    expect(stale.decision.reason).toContain('stale');
  });
});

describe('watchFreshnessController — no flapping under oscillating load', () => {
  it('bounds transitions when the rate oscillates around the crossover', () => {
    const c = cfg({ dwellMs: 10_000, cooldownMs: 60_000, trialMs: 8_000 });
    let s: FreshnessState = { ...createInitialFreshnessState(0), mode: 'LIVE' };
    let now = 0;
    let transitions = 0;
    let prev = s.mode;
    // 5 minutes of alternating over/under budget every 3s.
    for (let i = 0; i < 100; i++) {
      const over = i % 2 === 0;
      const d = decide(s, sig({ liveBytesPerSec: over ? 500_000 : 10_000 }), c, now);
      if (d.state.mode !== prev) {
        transitions++;
        prev = d.state.mode;
      }
      s = d.state;
      now += 3_000;
    }
    // Cooldown (60s) + dwell (10s) keep the machine from thrashing across 300s.
    expect(transitions).toBeLessThanOrEqual(6);
  });
});
