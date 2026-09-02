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

// Fake-simulator tests for the local Applications tab health calculator.
// Every scenario in __fixtures__/healthScenarios.ts is driven directly
// against getLocalHealth() — no cluster, no network, no React.
// See p18.txt on branch GT_D_V1.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from 'vitest';
import * as F from './__fixtures__/healthScenarios';
import { getLocalHealth } from './localHealth';

type Scenario = {
  name: string;
  items: any[];
  expected: {
    status: string;
    label: string;
    rank: number;
    reasonsIncludes?: string[];
  };
};

const ALL_SCENARIOS: Scenario[] = Object.values(F).filter(
  (v: any): v is Scenario => v && typeof v === 'object' && Array.isArray(v.items) && v.expected
);

describe('getLocalHealth — fake cluster simulator', () => {
  for (const scenario of ALL_SCENARIOS) {
    it(`${scenario.name} → ${scenario.expected.label}`, () => {
      const h = getLocalHealth(scenario.items);
      expect(h.status).toBe(scenario.expected.status);
      expect(h.label).toBe(scenario.expected.label);
      expect(h.rank).toBe(scenario.expected.rank);
      for (const needle of scenario.expected.reasonsIncludes ?? []) {
        expect(
          h.reasons.some(r => r.includes(needle)),
          `expected a reason containing "${needle}", got: ${JSON.stringify(h.reasons)}`
        ).toBe(true);
      }
    });
  }

  it('caps reasons at 10 with "…and N more" suffix', () => {
    const h = getLocalHealth(F.reasonCap15FailingPods.items);
    expect(h.reasons.length).toBe(11);
    expect(h.reasons[10]).toMatch(/…and 5 more/);
  });

  it('populates evidence[] with severity, kind, namespace, name and message', () => {
    const h = getLocalHealth(F.podCrashLoopBackOff.items);
    expect(h.evidence.length).toBeGreaterThan(0);
    const e = h.evidence[0];
    expect(e.severity).toBe('error');
    expect(e.kind).toBe('Pod');
    expect(e.namespace).toBe('demo');
    expect(e.name).toBe('crasher');
    expect(e.message).toBe('CrashLoopBackOff');
  });

  it('worst-of aggregation across mixed items (error > warning > success)', () => {
    const mix = [
      ...F.deployment2Of3Ready.items, // warning
      ...F.podCrashLoopBackOff.items, // error
      ...F.serviceHealthy.items, // success
    ];
    const h = getLocalHealth(mix);
    expect(h.status).toBe('error');
    expect(h.label).toBe('Unhealthy');
    expect(h.rank).toBe(3);
  });

  it('sorts evidence with errors before warnings', () => {
    const mix = [
      ...F.deployment2Of3Ready.items, // warning
      ...F.podFailed.items, // error
    ];
    const h = getLocalHealth(mix);
    expect(h.evidence[0].severity).toBe('error');
    expect(h.evidence[h.evidence.length - 1].severity).toBe('warning');
  });

  it('non-regression: wnv7a0vbgw0013c-style still reports Healthy', () => {
    const h = getLocalHealth(F.wnv7a0vbgw0013cStyle.items);
    expect(h.status).toBe('success');
    expect(h.label).toBe('Healthy');
    expect(h.evidence).toEqual([]);
  });

  it('empty items → No Resources / rank 0', () => {
    const h = getLocalHealth([]);
    expect(h.status).toBe('empty');
    expect(h.label).toBe('No Resources');
    expect(h.rank).toBe(0);
  });

  it('handles undefined items defensively', () => {
    const h = getLocalHealth(undefined as any);
    expect(h.status).toBe('empty');
  });

  // ─── Inventory / stats non-regression for DaemonSet ────────────────────
  // Before the A2 inline fix, sumWorkload() called the shared
  // getTotalReplicas() helper which falls back to currentNumberScheduled
  // for DaemonSet — so a DaemonSet with desired=5 / scheduled=3 / ready=3
  // rendered as "3/3 ready" in the popover Inventory row, contradicting
  // the badge that (correctly) said "3/5 ready" and confusing operators.
  // This test freezes the corrected behaviour: the DaemonSet stat row
  // must report the true desiredNumberScheduled (5), not the currently
  // scheduled count (3).
  it('DaemonSet inventory row reports desiredNumberScheduled, not scheduled', () => {
    const h = getLocalHealth(F.daemonSetPartialScheduling.items);
    const dsStat = h.stats.find(s => s.kind === 'DaemonSet');
    expect(dsStat).toBeDefined();
    expect(dsStat!.state).toBe('3/5 ready');
    expect(dsStat!.tone).toBe('warning');
  });

  it('healthy DaemonSet inventory row reports N/N ready with success tone', () => {
    const h = getLocalHealth(F.daemonSetAllReadyRealShape.items);
    const dsStat = h.stats.find(s => s.kind === 'DaemonSet');
    expect(dsStat).toBeDefined();
    expect(dsStat!.state).toBe('5/5 ready');
    expect(dsStat!.tone).toBe('success');
  });

  it('CronJob status respects suspension, child-job history, and active runs', () => {
    const suspended = [
      {
        kind: 'CronJob',
        metadata: { uid: 'cron-1', name: 'nightly', namespace: 'demo' },
        spec: { suspend: true, concurrencyPolicy: 'Forbid' },
        status: { active: [], lastScheduleTime: '2025-01-01T00:00:00Z' },
      },
    ];
    expect(getLocalHealth(suspended).needsAttention[0]?.message).toBe('Suspended');

    const recentFailure = [
      {
        kind: 'CronJob',
        metadata: { uid: 'cron-2', name: 'nightly', namespace: 'demo' },
        spec: { concurrencyPolicy: 'Forbid' },
        status: { active: [], lastScheduleTime: '2025-01-01T00:00:00Z' },
      },
      {
        kind: 'Job',
        metadata: {
          name: 'nightly-1',
          namespace: 'demo',
          creationTimestamp: '2025-01-01T00:02:00Z',
          ownerReferences: [{ kind: 'CronJob', uid: 'cron-2' }],
        },
        status: {
          active: 0,
          failed: 1,
          succeeded: 0,
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        },
      },
    ];
    expect(getLocalHealth(recentFailure).needsAttention[0]?.message).toBe(
      'Recent run failed: BackoffLimitExceeded'
    );

    const active = [
      {
        kind: 'CronJob',
        metadata: { uid: 'cron-3', name: 'nightly', namespace: 'demo' },
        spec: { concurrencyPolicy: 'Forbid' },
        status: { active: [{ name: 'nightly-1' }], lastScheduleTime: '2025-01-01T00:00:00Z' },
      },
    ];
    expect(getLocalHealth(active).needsAttention[0]?.message).toBe('Running');

    const noHistory = [
      {
        kind: 'CronJob',
        metadata: { uid: 'cron-4', name: 'nightly', namespace: 'demo' },
        spec: { concurrencyPolicy: 'Forbid' },
        status: { active: [] },
      },
    ];
    expect(getLocalHealth(noHistory).needsAttention[0]?.message).toBe('No run recorded yet');

    const terminalConditionOnly = [
      {
        kind: 'CronJob',
        metadata: { uid: 'cron-5', name: 'nightly', namespace: 'demo' },
        spec: { concurrencyPolicy: 'Forbid' },
        status: { active: [], lastScheduleTime: '2025-01-01T00:00:00Z' },
      },
      {
        kind: 'Job',
        metadata: {
          name: 'nightly-2',
          namespace: 'demo',
          creationTimestamp: '2025-01-01T00:03:00Z',
          ownerReferences: [{ kind: 'CronJob', uid: 'cron-5' }],
        },
        status: {
          active: 0,
          failed: 0,
          succeeded: 0,
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        },
      },
    ];
    expect(getLocalHealth(terminalConditionOnly).needsAttention[0]?.message).toBe(
      'Recent run failed: BackoffLimitExceeded'
    );
  });
});
