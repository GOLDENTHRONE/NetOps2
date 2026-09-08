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
import {
  childJobRaw,
  cronJobRaw,
  daemonSetRaw,
  deploymentRaw,
  endpointsRaw,
  jobRaw,
  podRaw,
  pvcRaw,
  statefulSetRaw,
} from './__fixtures__/healthScenarios';
import { getLocalHealth, localGetItemStatus } from './localHealth';

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
    expect(h.rank).toBe(4);
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

  it('merges details worst-first and tags workload versus reachability', () => {
    const h = getLocalHealth([
      podRaw('error-pod', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False', reason: 'NotReady' }],
        containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      }),
      deploymentRaw(
        'warning-deployment',
        { replicas: 2 },
        { replicas: 2, readyReplicas: 1, updatedReplicas: 2 }
      ),
      {
        kind: 'Service',
        metadata: { name: 'api', namespace: 'demo' },
        spec: { selector: { app: 'api' } },
      },
      deploymentRaw(
        'api',
        { replicas: 1, template: { metadata: { labels: { app: 'api' } } } },
        { replicas: 1, readyReplicas: 1, updatedReplicas: 1 }
      ),
      endpointsRaw('api', [{ notReadyAddresses: [{ ip: '10.0.0.1' }] }]),
      deploymentRaw(
        'progressing-deployment',
        { replicas: 2 },
        { replicas: 2, readyReplicas: 1, updatedReplicas: 1 }
      ),
      podRaw('unknown-pod', { phase: 'Unknown' }),
    ]);

    expect(h.details).toHaveLength(5);
    expect(h.details.map(item => item.severity)).toEqual([
      'error',
      'warning',
      'warning',
      'progressing',
      'unknown',
    ]);
    expect(h.details[0]).toMatchObject({ kind: 'Pod', category: 'workload' });
    expect(h.details[1]).toMatchObject({ kind: 'Deployment', category: 'workload' });
    expect(h.details[2]).toMatchObject({ kind: 'Endpoints', category: 'reachability' });
    expect(h.details[3]).toMatchObject({ kind: 'Deployment', category: 'workload' });
    expect(h.details[4]).toMatchObject({ kind: 'Pod', category: 'workload' });
  });

  it('healthy app has no details', () => {
    const h = getLocalHealth(F.allHealthySingleCluster.items);
    expect(h.details).toEqual([]);
  });

  it('needs-attention-only Job stays outside details with no category', () => {
    const h = getLocalHealth([
      jobRaw(
        'failed-job',
        { backoffLimit: 1 },
        { conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }] }
      ),
    ]);

    expect(h.details).toEqual([]);
    expect(h.needsAttention).toHaveLength(1);
    expect(h.needsAttention[0]).toMatchObject({ kind: 'Job', severity: 'error' });
    expect(h.needsAttention[0]?.category).toBeUndefined();
  });

  it('keeps evidence, progressing, and unknownItems additive and unchanged', () => {
    const h = getLocalHealth([
      podRaw('error-pod', {
        phase: 'Failed',
        reason: 'Evicted',
      }),
      deploymentRaw(
        'warning-deployment',
        { replicas: 2 },
        { replicas: 2, readyReplicas: 1, updatedReplicas: 2 }
      ),
      deploymentRaw(
        'progressing-deployment',
        { replicas: 2 },
        { replicas: 2, readyReplicas: 1, updatedReplicas: 1 }
      ),
      podRaw('unknown-pod', { phase: 'Unknown' }),
    ]);

    expect(
      h.evidence.map(({ severity, kind, name, message }) => ({ severity, kind, name, message }))
    ).toEqual([
      { severity: 'error', kind: 'Pod', name: 'error-pod', message: 'Evicted' },
      { severity: 'warning', kind: 'Deployment', name: 'warning-deployment', message: '1/2 ready' },
    ]);
    expect(
      h.progressing.map(({ severity, kind, name, message }) => ({ severity, kind, name, message }))
    ).toEqual([
      {
        severity: 'progressing',
        kind: 'Deployment',
        name: 'progressing-deployment',
        message: 'Rolling out 1/2',
      },
    ]);
    expect(
      h.unknownItems.map(({ severity, kind, name, message }) => ({ severity, kind, name, message }))
    ).toEqual([
      { severity: 'unknown', kind: 'Pod', name: 'unknown-pod', message: 'Pod phase Unknown' },
    ]);
  });

  it('non-regression: wnv7a0vbgw0013c-style still reports Healthy', () => {
    const h = getLocalHealth(F.wnv7a0vbgw0013cStyle.items);
    expect(h.status).toBe('success');
    expect(h.label).toBe('Healthy');
    expect(h.evidence).toEqual([]);
  });

  it('jobAllRetriesFailed: app stays Healthy (Job is NON_HEALTH_BEARING) but the real Failed condition surfaces in needsAttention', () => {
    const h = getLocalHealth(F.jobAllRetriesFailed.items);
    expect(h.status).toBe('success');
    expect(h.label).toBe('Healthy');
    expect(h.needsAttention[0]?.severity).toBe('error');
    expect(h.needsAttention[0]?.message).toBe('BackoffLimitExceeded');
  });

  it('pure rollout → Progressing/rank 2', () => {
    const h = getLocalHealth([
      deploymentRaw('web', { replicas: 3 }, { replicas: 3, readyReplicas: 1, updatedReplicas: 1 }),
    ]);
    expect(h).toMatchObject({ status: 'progressing', label: 'Progressing', rank: 2 });
    expect(h.progressing).toHaveLength(1);
  });

  it('rollout plus CrashLoopBackOff → Unhealthy/rank 4', () => {
    const h = getLocalHealth([
      deploymentRaw('web', { replicas: 3 }, { replicas: 3, readyReplicas: 1, updatedReplicas: 1 }),
      podRaw('crash', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      }),
    ]);
    expect(h).toMatchObject({ status: 'error', label: 'Unhealthy', rank: 4 });
  });

  it('rollout plus settled warning → Degraded/rank 3', () => {
    const h = getLocalHealth([
      deploymentRaw(
        'rolling',
        { replicas: 3 },
        { replicas: 3, readyReplicas: 1, updatedReplicas: 1 }
      ),
      deploymentRaw(
        'degraded',
        { replicas: 3 },
        { replicas: 3, readyReplicas: 2, updatedReplicas: 3 }
      ),
    ]);
    expect(h).toMatchObject({ status: 'warning', label: 'Degraded', rank: 3 });
  });

  it('only Unknown Pod plus settled healthy workload → Unknown/rank 1', () => {
    const h = getLocalHealth([
      deploymentRaw('web', { replicas: 1 }, { replicas: 1, readyReplicas: 1, updatedReplicas: 1 }),
      podRaw('mystery', { phase: 'Unknown' }),
    ]);
    expect(h).toMatchObject({ status: 'unknown', label: 'Unknown', rank: 1 });
    expect(h.unknownItems).toHaveLength(1);
  });

  it('Progressing plus Unknown → Progressing/rank 2', () => {
    const h = getLocalHealth([
      deploymentRaw(
        'rolling',
        { replicas: 2 },
        { replicas: 2, readyReplicas: 1, updatedReplicas: 1 }
      ),
      podRaw('mystery', { phase: 'Unknown' }),
    ]);
    expect(h).toMatchObject({ status: 'progressing', label: 'Progressing', rank: 2 });
  });

  it('all settled healthy → Healthy/rank 0', () => {
    const h = getLocalHealth([
      deploymentRaw('web', { replicas: 1 }, { replicas: 1, readyReplicas: 1, updatedReplicas: 1 }),
    ]);
    expect(h).toMatchObject({ status: 'success', label: 'Healthy', rank: 0 });
  });

  it('HPA failure alone → Healthy/rank 0 with HPA in needsAttention', () => {
    const h = getLocalHealth(F.hpaFailedGetMetrics.items);
    expect(h).toMatchObject({ status: 'success', label: 'Healthy', rank: 0 });
    expect(h.needsAttention[0]).toMatchObject({ kind: 'HorizontalPodAutoscaler' });
  });

  it('warning/error ranks use new values 3/4', () => {
    expect(getLocalHealth(F.deployment2Of3Ready.items).rank).toBe(3);
    expect(getLocalHealth(F.podCrashLoopBackOff.items).rank).toBe(4);
  });

  it('HPA FailedGetMetrics: app stays Healthy and failure moves to needsAttention, not evidence', () => {
    const h = getLocalHealth(F.hpaFailedGetMetrics.items);
    expect(h.status).toBe('success');
    expect(h.label).toBe('Healthy');
    expect(h.evidence).toEqual([]);
    expect(h.needsAttention).toHaveLength(1);
    expect(h.needsAttention[0]).toMatchObject({
      kind: 'HorizontalPodAutoscaler',
      namespace: 'demo',
      name: 'web-hpa',
      severity: 'warning',
      message: 'FailedGetMetrics',
    });
  });

  it('HPA ScalingDisabled: app stays Healthy with no needsAttention entry', () => {
    const h = getLocalHealth(F.hpaScalingDisabled.items);
    expect(h.status).toBe('success');
    expect(h.needsAttention).toEqual([]);
  });

  it('healthy HPA: app stays Healthy with no needsAttention entry', () => {
    const h = getLocalHealth(F.hpaScalingActive.items);
    expect(h.status).toBe('success');
    expect(h.needsAttention).toEqual([]);
  });

  it('HPA failure does not mask genuine Deployment Unhealthy state', () => {
    const h = getLocalHealth([
      ...F.deployment0Of3Created.items,
      ...F.hpaFailedGetMetrics.items.filter(item => item.kind === 'HorizontalPodAutoscaler'),
    ]);
    expect(h.status).toBe('error');
    expect(h.label).toBe('Unhealthy');
    expect(h.needsAttention[0]).toMatchObject({
      kind: 'HorizontalPodAutoscaler',
      message: 'FailedGetMetrics',
    });
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

// ─── CronJob active-run vs history precedence ────────────────────────────
// An in-flight run must outrank any retained completed child Job, otherwise
// the popover shows a stale historical result while a run is happening now.
describe('localGetItemStatus — CronJob active-run precedence', () => {
  const cronJob = (uid: string, spec: any, status: any) => ({
    kind: 'CronJob',
    metadata: { uid, name: 'nightly', namespace: 'demo' },
    spec,
    status,
  });
  const childJob = (uid: string, name: string, status: any) => ({
    kind: 'Job',
    metadata: {
      name,
      namespace: 'demo',
      creationTimestamp: '2025-01-01T00:02:00Z',
      ownerReferences: [{ kind: 'CronJob', uid }],
    },
    status,
  });
  const succeededChild = (uid: string) =>
    childJob(uid, 'nightly-ok', {
      active: 0,
      failed: 0,
      succeeded: 1,
      completionTime: '2025-01-01T00:02:00Z',
      conditions: [{ type: 'Complete', status: 'True' }],
    });
  const failedChild = (uid: string) =>
    childJob(uid, 'nightly-bad', {
      active: 0,
      failed: 1,
      succeeded: 0,
      conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
    });

  it('active run + retained SUCCEEDED child Job → progressing "Running" (not stale history)', () => {
    const cron = cronJob(
      'cron-a1',
      { concurrencyPolicy: 'Forbid' },
      {
        active: [{ name: 'nightly-now' }],
        lastScheduleTime: '2025-01-01T01:00:00Z',
        lastSuccessfulTime: '2025-01-01T00:02:00Z',
      }
    );
    expect(localGetItemStatus(cron as any, [cron, succeededChild('cron-a1')] as any)).toEqual({
      severity: 'progressing',
      message: 'Running',
    });
  });

  it('active run + retained FAILED child Job → progressing "Running" (not stale history)', () => {
    const cron = cronJob(
      'cron-a2',
      { concurrencyPolicy: 'Forbid' },
      { active: [{ name: 'nightly-now' }], lastScheduleTime: '2025-01-01T01:00:00Z' }
    );
    expect(localGetItemStatus(cron as any, [cron, failedChild('cron-a2')] as any)).toEqual({
      severity: 'progressing',
      message: 'Running',
    });
  });

  it('regression: no active run + SUCCEEDED history → success "Last run succeeded"', () => {
    const cron = cronJob(
      'cron-a3',
      { concurrencyPolicy: 'Forbid' },
      { active: [], lastScheduleTime: '2025-01-01T00:00:00Z' }
    );
    expect(localGetItemStatus(cron as any, [cron, succeededChild('cron-a3')] as any)).toEqual({
      severity: 'success',
      message: 'Last run succeeded',
    });
  });

  it('regression: no active run + FAILED history → warning "Recent run failed: {reason}"', () => {
    const cron = cronJob(
      'cron-a4',
      { concurrencyPolicy: 'Forbid' },
      { active: [], lastScheduleTime: '2025-01-01T00:00:00Z' }
    );
    expect(localGetItemStatus(cron as any, [cron, failedChild('cron-a4')] as any)).toEqual({
      severity: 'warning',
      message: 'Recent run failed: BackoffLimitExceeded',
    });
  });

  it('regression: suspended with an active run → info "Suspended" (suspend stays first)', () => {
    const cron = cronJob(
      'cron-a5',
      { suspend: true, concurrencyPolicy: 'Forbid' },
      { active: [{ name: 'nightly-now' }], lastScheduleTime: '2025-01-01T01:00:00Z' }
    );
    expect(localGetItemStatus(cron as any, [cron, succeededChild('cron-a5')] as any)).toEqual({
      severity: 'info',
      message: 'Suspended',
    });
  });

  it('regression: Replace policy + 2 active runs → warning "2 active runs" (precedes Running)', () => {
    const cron = cronJob(
      'cron-a6',
      { concurrencyPolicy: 'Replace' },
      {
        active: [{ name: 'nightly-1' }, { name: 'nightly-2' }],
        lastScheduleTime: '2025-01-01T01:00:00Z',
      }
    );
    expect(localGetItemStatus(cron as any, [cron, succeededChild('cron-a6')] as any)).toEqual({
      severity: 'warning',
      message: '2 active runs',
    });
  });

  it('regression (live snapshot case): active run with no retained history → progressing "Running"', () => {
    const cron = cronJob(
      'cron-a7',
      { concurrencyPolicy: 'Replace' },
      { active: [{ name: 'nightly-now' }], lastScheduleTime: '2025-01-01T01:00:00Z' }
    );
    expect(localGetItemStatus(cron as any, [cron] as any)).toEqual({
      severity: 'progressing',
      message: 'Running',
    });
  });
});

describe('localGetItemStatus — Endpoints verdict contract', () => {
  const targetedService = {
    kind: 'Service',
    metadata: { name: 'api', namespace: 'demo' },
    spec: { selector: { app: 'api' }, type: 'ClusterIP', clusterIP: '10.0.0.1' },
  };
  const targetedDeployment = {
    kind: 'Deployment',
    metadata: { name: 'api', namespace: 'demo' },
    spec: { replicas: 1, template: { metadata: { labels: { app: 'api' } } } },
  };

  it('counts addresses across every subset: ready > 0 and notReady=0 → success', () => {
    const endpoint = endpointsRaw('api', [
      { addresses: [{ ip: '10.0.0.1' }] },
      { addresses: [{ ip: '10.0.0.2' }] },
    ]);
    expect(localGetItemStatus(endpoint, [endpoint])).toEqual({ severity: 'success' });
  });

  it('ready > 0 and notReady > 0 → warning with total ready/known pods', () => {
    const endpoint = endpointsRaw('api', [
      { addresses: [{ ip: '10.0.0.1' }], notReadyAddresses: [{ ip: '10.0.0.2' }] },
      { addresses: [{ ip: '10.0.0.3' }], notReadyAddresses: [{ ip: '10.0.0.4' }] },
    ]);
    expect(localGetItemStatus(endpoint, [endpoint])).toEqual({
      severity: 'warning',
      message: '2/4 pods ready behind this Service',
    });
  });

  it('ready=0 and notReady>0 with targeted Service → warning "no ready pods yet (0/N)"', () => {
    const endpoint = endpointsRaw('api', [
      { notReadyAddresses: [{ ip: '10.0.0.2' }, { ip: '10.0.0.3' }] },
    ]);
    expect(localGetItemStatus(endpoint, [endpoint, targetedService, targetedDeployment])).toEqual({
      severity: 'warning',
      message: 'no ready pods yet (0/2) behind this Service',
    });
  });

  it('ready=0 and notReady=0 with targeted Service → warning "no pods"', () => {
    const endpoint = endpointsRaw('api', [{}]);
    expect(localGetItemStatus(endpoint, [endpoint, targetedService, targetedDeployment])).toEqual({
      severity: 'warning',
      message: 'no pods behind this Service',
    });
  });

  it('existing benign zero-ready filters remain success', () => {
    expect(localGetItemStatus(endpointsRaw('orphan', []), [])).toEqual({ severity: 'success' });
    expect(
      localGetItemStatus(endpointsRaw('headless', []), [
        endpointsRaw('headless', []),
        {
          kind: 'Service',
          metadata: { name: 'headless', namespace: 'demo' },
          spec: { clusterIP: 'None' },
        },
      ])
    ).toEqual({ severity: 'success' });
  });

  it('scaled-zero Deployment with no matching Pods is dormant: empty Endpoints → success', () => {
    const endpoint = endpointsRaw('ocs-client-operator-webhook-server', [{}]);
    const service = {
      kind: 'Service',
      metadata: { name: 'ocs-client-operator-webhook-server', namespace: 'demo' },
      spec: { type: 'ClusterIP', selector: { app: 'ocs-client-operator' } },
    };
    const deployment = {
      kind: 'Deployment',
      metadata: { name: 'ocs-client-operator-controller-manager', namespace: 'demo' },
      spec: { replicas: 0, template: { metadata: { labels: { app: 'ocs-client-operator' } } } },
    };
    expect(localGetItemStatus(endpoint, [endpoint, service, deployment])).toEqual({
      severity: 'success',
    });
  });

  it('active Deployment with no matching Pods remains targeted: empty Endpoints → warning', () => {
    const endpoint = endpointsRaw('api', [{}]);
    expect(localGetItemStatus(endpoint, [endpoint, targetedService, targetedDeployment])).toEqual({
      severity: 'warning',
      message: 'no pods behind this Service',
    });
  });

  it('scaled-zero Deployment with a matching live Pod remains targeted: empty Endpoints → warning', () => {
    const endpoint = endpointsRaw('api', [{}]);
    const scaledZeroDeployment = {
      ...targetedDeployment,
      spec: { ...targetedDeployment.spec, replicas: 0 },
    };
    const matchingPod = {
      kind: 'Pod',
      metadata: { name: 'api-0', namespace: 'demo', labels: { app: 'api' } },
    };
    expect(
      localGetItemStatus(endpoint, [endpoint, targetedService, scaledZeroDeployment, matchingPod])
    ).toEqual({
      severity: 'warning',
      message: 'no pods behind this Service',
    });
  });

  it('scaled-zero Deployment + only a Succeeded Pod matching selector: empty Endpoints → success', () => {
    const endpoint = endpointsRaw('api', [{}]);
    const scaledZeroDeployment = {
      ...targetedDeployment,
      spec: { ...targetedDeployment.spec, replicas: 0 },
    };
    const succeededPod = {
      kind: 'Pod',
      metadata: { name: 'api-migrate', namespace: 'demo', labels: { app: 'api' } },
      status: { phase: 'Succeeded' },
    };
    expect(
      localGetItemStatus(endpoint, [endpoint, targetedService, scaledZeroDeployment, succeededPod])
    ).toEqual({ severity: 'success' });
  });

  it('scaled-zero Deployment + only a terminating Pod matching selector: empty Endpoints → success', () => {
    const endpoint = endpointsRaw('api', [{}]);
    const scaledZeroDeployment = {
      ...targetedDeployment,
      spec: { ...targetedDeployment.spec, replicas: 0 },
    };
    const terminatingPod = {
      kind: 'Pod',
      metadata: {
        name: 'api-0',
        namespace: 'demo',
        labels: { app: 'api' },
        deletionTimestamp: '2026-09-07T00:00:00Z',
      },
      status: { phase: 'Running' },
    };
    expect(
      localGetItemStatus(endpoint, [
        endpoint,
        targetedService,
        scaledZeroDeployment,
        terminatingPod,
      ])
    ).toEqual({ severity: 'success' });
  });

  it('regression: scaled-zero Deployment + a genuinely Running Pod matching selector → still warning', () => {
    const endpoint = endpointsRaw('api', [{}]);
    const scaledZeroDeployment = {
      ...targetedDeployment,
      spec: { ...targetedDeployment.spec, replicas: 0 },
    };
    const runningPod = {
      kind: 'Pod',
      metadata: { name: 'api-0', namespace: 'demo', labels: { app: 'api' } },
      status: { phase: 'Running' },
    };
    expect(
      localGetItemStatus(endpoint, [endpoint, targetedService, scaledZeroDeployment, runningPod])
    ).toEqual({ severity: 'warning', message: 'no pods behind this Service' });
  });

  it('regression: scaled-zero Deployment + no matching Pod at all → success', () => {
    const endpoint = endpointsRaw('api', [{}]);
    const scaledZeroDeployment = {
      ...targetedDeployment,
      spec: { ...targetedDeployment.spec, replicas: 0 },
    };
    expect(localGetItemStatus(endpoint, [endpoint, targetedService, scaledZeroDeployment])).toEqual(
      { severity: 'success' }
    );
  });

  it('regression: active Deployment (replicas>0) + empty Endpoints → still warning', () => {
    const endpoint = endpointsRaw('api', [{}]);
    expect(localGetItemStatus(endpoint, [endpoint, targetedService, targetedDeployment])).toEqual({
      severity: 'warning',
      message: 'no pods behind this Service',
    });
  });
});

describe('localGetItemStatus — Ingress backend contract', () => {
  const ingress = (backendNames: string[]) => ({
    kind: 'Ingress',
    cluster: 'cluster-a',
    metadata: { name: 'web', namespace: 'demo' },
    spec: {
      rules: backendNames.map(serviceName => ({
        http: { paths: [{ backend: { service: { name: serviceName, port: { number: 80 } } } }] },
      })),
    },
  });
  const service = (name: string, namespace = 'demo') => ({
    kind: 'Service',
    cluster: 'cluster-a',
    metadata: { name, namespace },
  });

  it('backend exists in same namespace and cluster → success', () => {
    const item = ingress(['web']);
    expect(localGetItemStatus(item as any, [item, service('web')] as any)).toEqual({
      severity: 'success',
    });
  });

  it('backend is missing → warning naming missing Service', () => {
    const item = ingress(['missing']);
    expect(localGetItemStatus(item as any, [item] as any)).toEqual({
      severity: 'warning',
      message: 'backend Service not found: missing',
    });
  });

  it('multi-rule Ingress with one missing backend → warning', () => {
    const item = ingress(['web', 'missing']);
    expect(localGetItemStatus(item as any, [item, service('web')] as any)).toEqual({
      severity: 'warning',
      message: 'backend Service not found: missing',
    });
  });

  it('same-name Service in different namespace → warning', () => {
    const item = ingress(['web']);
    expect(localGetItemStatus(item as any, [item, service('web', 'other')] as any)).toEqual({
      severity: 'warning',
      message: 'backend Service not found: web',
    });
  });

  it('Ingress with no service backends → success', () => {
    const item = ingress([]);
    expect(localGetItemStatus(item as any, [item] as any)).toEqual({ severity: 'success' });
  });
});

// ─── Pod verdict contract (standalone localGetItemStatus) ────────────────
// Drives the Pod branch of localGetItemStatus() directly. getLocalHealth()
// only tallies error/warning into the app-level badge, so 'progressing' and
// 'unknown' Pod verdicts are invisible through the public getLocalHealth()
// API (see podPendingOld/podPendingYoung fixtures) — this seam is the only
// way to assert those verdicts precisely without touching app aggregation.
describe('localGetItemStatus — Pod verdict contract', () => {
  it('Running + Ready=True → success', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [{ name: 'main', state: { running: {} }, ready: true, restartCount: 0 }],
      }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('Running + Ready=True + restartCount=10 → success (history alone never fails)', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [
          { name: 'main', state: { running: {} }, ready: true, restartCount: 10 },
        ],
      }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('Running + Ready=True + lastState.terminated=OOMKilled → success (lastState never overrides current)', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [
          {
            name: 'main',
            state: { running: {} },
            lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
            ready: true,
            restartCount: 5,
          },
        ],
      }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('Running + Ready=False, no fatal reason → warning "Not Ready"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [{ name: 'main', state: { running: {} }, ready: false }],
      }),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('Not Ready');
  });

  it('Running + Ready=Unknown → non-success (warning)', () => {
    const v = localGetItemStatus(
      podRaw('p', { phase: 'Running', conditions: [{ type: 'Ready', status: 'Unknown' }] }),
      []
    );
    expect(v.severity).not.toBe('success');
  });

  it('Running with Ready condition missing → never success', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Running', conditions: [] }), []);
    expect(v.severity).not.toBe('success');
    expect(v.severity).toBe('unknown');
  });

  it('Pending + ContainerCreating → progressing "ContainerCreating"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        containerStatuses: [{ name: 'main', state: { waiting: { reason: 'ContainerCreating' } } }],
      }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('ContainerCreating');
  });

  it('Pending + init container running → progressing "PodInitializing"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        initContainerStatuses: [{ name: 'init', state: { running: {} } }],
      }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('PodInitializing');
  });

  it('Pending, no detailed reason → progressing "Pending"', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Pending', conditions: [] }), []);
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Pending');
  });

  it('age no longer affects Pod verdict: identical status, different creationTimestamp → identical verdict', () => {
    const status = { phase: 'Pending', conditions: [] };
    const young = localGetItemStatus(
      podRaw('young', status, { creationTimestamp: new Date().toISOString() }),
      []
    );
    const old = localGetItemStatus(
      podRaw('old', status, { creationTimestamp: '2020-01-01T00:00:00Z' }),
      []
    );
    expect(young).toEqual(old);
  });

  it('PodScheduled=False + Unschedulable → error "Unschedulable"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Unschedulable');
  });

  it('PodScheduled=False + SchedulingGated → progressing "SchedulingGated"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }],
      }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('SchedulingGated');
  });

  it('init container currently running → progressing', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        initContainerStatuses: [{ name: 'init', state: { running: {} } }],
      }),
      []
    );
    expect(v.severity).toBe('progressing');
  });

  it('init container CrashLoopBackOff → error "CrashLoopBackOff"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        initContainerStatuses: [
          { name: 'init', state: { waiting: { reason: 'CrashLoopBackOff' } } },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('CrashLoopBackOff');
  });

  it('init container ImagePullBackOff → error "ImagePullBackOff"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        initContainerStatuses: [
          { name: 'init', state: { waiting: { reason: 'ImagePullBackOff' } } },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('ImagePullBackOff');
  });

  it('application container CrashLoopBackOff → error "CrashLoopBackOff"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [{ name: 'main', state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('CrashLoopBackOff');
  });

  it('application container ErrImagePull → error "ErrImagePull"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        containerStatuses: [{ name: 'main', state: { waiting: { reason: 'ErrImagePull' } } }],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('ErrImagePull');
  });

  it('application container CreateContainerConfigError → error with exact reason', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        containerStatuses: [
          { name: 'main', state: { waiting: { reason: 'CreateContainerConfigError' } } },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('CreateContainerConfigError');
  });

  it('current CrashLoopBackOff + lastState OOMKilled → error, current reason wins', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [
          {
            name: 'main',
            state: { waiting: { reason: 'CrashLoopBackOff' } },
            lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
          },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('CrashLoopBackOff');
  });

  it('current terminated exitCode=137 reason=OOMKilled → error "OOMKilled"', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [
          { name: 'main', state: { terminated: { reason: 'OOMKilled', exitCode: 137 } } },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('OOMKilled');
  });

  it('current terminated exitCode=0 reason=Completed → not error merely because terminated exists', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [
          { name: 'main', state: { terminated: { reason: 'Completed', exitCode: 0 } } },
        ],
      }),
      []
    );
    expect(v.severity).not.toBe('error');
    expect(v.severity).toBe('success');
  });

  it('phase=Failed + status.reason → error with status.reason', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Failed', reason: 'Evicted' }), []);
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Evicted');
  });

  it('phase=Failed with no reason → error "Failed"', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Failed' }), []);
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Failed');
  });

  it('phase=Unknown → unknown, never success', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Unknown' }), []);
    expect(v.severity).toBe('unknown');
  });

  it('missing status → unknown "Pod status unavailable"', () => {
    const v = localGetItemStatus(
      { kind: 'Pod', metadata: { name: 'p', namespace: 'demo' } } as any,
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Pod status unavailable');
  });

  it('missing phase → unknown', () => {
    const v = localGetItemStatus(podRaw('p', { conditions: [] }), []);
    expect(v.severity).toBe('unknown');
  });

  it('unrecognized phase value → unknown, phase included in message', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Weird' }), []);
    expect(v.severity).toBe('unknown');
    expect(v.message).toContain('Weird');
  });

  it('phase=Succeeded → success "Completed"', () => {
    const v = localGetItemStatus(podRaw('p', { phase: 'Succeeded' }), []);
    expect(v.severity).toBe('success');
    expect(v.message).toBe('Completed');
  });

  it('deletionTimestamp set, no stronger failure → progressing "Terminating"', () => {
    const v = localGetItemStatus(
      podRaw(
        'p',
        { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
        { deletionTimestamp: '2026-01-01T00:00:00Z' }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Terminating');
  });

  it('multiple containers: first healthy, second failing → error from failing container', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [
          { name: 'c1', state: { running: {} }, ready: true },
          { name: 'c2', state: { waiting: { reason: 'ImagePullBackOff' } }, ready: false },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('ImagePullBackOff');
  });

  it('multiple init containers: later one failing → error from failing init container', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Pending',
        conditions: [],
        initContainerStatuses: [
          { name: 'i1', state: { terminated: { reason: 'Completed', exitCode: 0 } } },
          { name: 'i2', state: { waiting: { reason: 'CrashLoopBackOff' } } },
        ],
      }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('CrashLoopBackOff');
  });

  it('normal container Running/Ready + successful init (exitCode=0) → success', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        initContainerStatuses: [
          { name: 'init', state: { terminated: { reason: 'Completed', exitCode: 0 } } },
        ],
        containerStatuses: [{ name: 'main', state: { running: {} }, ready: true }],
      }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('empty containerStatuses on Pending pod → progressing, not error/success', () => {
    const v = localGetItemStatus(
      podRaw('p', { phase: 'Pending', conditions: [], containerStatuses: [] }),
      []
    );
    expect(v.severity).toBe('progressing');
  });

  it('empty containerStatuses on Running/Ready pod → success (Ready=True is authoritative)', () => {
    const v = localGetItemStatus(
      podRaw('p', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [],
      }),
      []
    );
    expect(v.severity).toBe('success');
  });
});

// ─── Deployment verdict contract (standalone localGetItemStatus) ─────────
// Deployment has its own richer branch (split out from the ReplicaSet/
// StatefulSet shared block). Replica counts alone can't tell "still rolling
// out" apart from "died after rollout finished" — both can read "3/5 ready".
// status.updatedReplicas + status.conditions disambiguate; these tests
// exercise that directly.
describe('localGetItemStatus — Deployment verdict contract', () => {
  it('desired=5, ready=5, updated=5, Available=True → success', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        {
          replicas: 5,
          readyReplicas: 5,
          updatedReplicas: 5,
          availableReplicas: 5,
          observedGeneration: 1,
          conditions: [
            { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' },
            { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' },
          ],
        },
        { generation: 1 }
      ),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('desired=0 → success (scaled to zero)', () => {
    const v = localGetItemStatus(
      deploymentRaw('d', { replicas: 0 }, { replicas: 0, readyReplicas: 0 }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('desired=5, ready=3, updated=3 (mid-rollout) → progressing', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        {
          replicas: 5,
          readyReplicas: 3,
          updatedReplicas: 3,
          observedGeneration: 1,
          conditions: [{ type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' }],
        },
        { generation: 1 }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Rolling out 3/5');
  });

  it('desired=5, ready=3, updated=5 (died after deploy) → warning "3/5 ready"', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        { replicas: 5, readyReplicas: 3, updatedReplicas: 5, observedGeneration: 1 },
        { generation: 1 }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('3/5 ready');
  });

  it('Progressing=False, reason=ProgressDeadlineExceeded → error "ProgressDeadlineExceeded"', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        {
          replicas: 5,
          readyReplicas: 3,
          updatedReplicas: 3,
          conditions: [
            { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' },
          ],
        }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('ProgressDeadlineExceeded');
  });

  it('Available=False → error', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        {
          replicas: 5,
          readyReplicas: 3,
          conditions: [
            { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
          ],
        }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('MinimumReplicasUnavailable');
  });

  it('status.replicas=0, desired=5 → error "0/5 pods created"', () => {
    const v = localGetItemStatus(deploymentRaw('d', { replicas: 5 }, { replicas: 0 }), []);
    expect(v.severity).toBe('error');
    expect(v.message).toBe('0/5 pods created');
  });

  it('observedGeneration=4, metadata.generation=5 → unknown "Status updating"', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        { replicas: 5, readyReplicas: 5, observedGeneration: 4 },
        { generation: 5 }
      ),
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Status updating');
  });

  it('missing status → unknown', () => {
    const v = localGetItemStatus(deploymentRaw('d', { replicas: 5 }, undefined), []);
    expect(v.severity).toBe('unknown');
  });

  it('Progressing reason=ReplicaSetUpdated, ready<desired → progressing (even if updated==desired)', () => {
    const v = localGetItemStatus(
      deploymentRaw(
        'd',
        { replicas: 5 },
        {
          replicas: 5,
          readyReplicas: 3,
          updatedReplicas: 5,
          conditions: [{ type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' }],
        }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
  });

  it('desired=5, ready=5, updated=5, no conditions present → success (counts fallback)', () => {
    const v = localGetItemStatus(
      deploymentRaw('d', { replicas: 5 }, { replicas: 5, readyReplicas: 5, updatedReplicas: 5 }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('identical 3/5 replica counts, differing only by updatedReplicas → different verdicts', () => {
    const midRollout = localGetItemStatus(
      deploymentRaw('d', { replicas: 5 }, { replicas: 5, readyReplicas: 3, updatedReplicas: 3 }),
      []
    );
    const diedAfterDeploy = localGetItemStatus(
      deploymentRaw('d', { replicas: 5 }, { replicas: 5, readyReplicas: 3, updatedReplicas: 5 }),
      []
    );
    expect(midRollout.severity).toBe('progressing');
    expect(diedAfterDeploy.severity).toBe('warning');
  });

  it('normal rollout with owned new/old ReplicaSets → app stays Healthy, not Unhealthy or Degraded', () => {
    const deployment = deploymentRaw(
      'web',
      { replicas: 3 },
      {
        replicas: 3,
        readyReplicas: 1,
        updatedReplicas: 1,
        conditions: [
          { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' },
          { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
        ],
      }
    );
    const newReplicaSet = {
      kind: 'ReplicaSet',
      metadata: { name: 'web-new', namespace: 'demo', ownerReferences: [{ kind: 'Deployment' }] },
      spec: { replicas: 3 },
      status: { replicas: 3, readyReplicas: 1 },
    };
    const oldReplicaSet = {
      kind: 'ReplicaSet',
      metadata: { name: 'web-old', namespace: 'demo', ownerReferences: [{ kind: 'Deployment' }] },
      spec: { replicas: 0 },
      status: { replicas: 0, readyReplicas: 0 },
    };
    const h = getLocalHealth([deployment, newReplicaSet, oldReplicaSet]);
    expect(localGetItemStatus(deployment, [])).toEqual({
      severity: 'progressing',
      message: 'Rolling out 1/3',
    });
    expect(h.status).toBe('progressing');
    expect(h.label).toBe('Progressing');
    expect(h.rank).toBe(2);
    expect(h.evidence).toEqual([]);
  });

  it('fresh first deploy with Available=False and Progressing=True → progressing, app Healthy', () => {
    const deployment = deploymentRaw(
      'web',
      { replicas: 2 },
      {
        replicas: 0,
        readyReplicas: 0,
        updatedReplicas: 0,
        conditions: [
          { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' },
          { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
        ],
      }
    );
    expect(localGetItemStatus(deployment, [])).toEqual({
      severity: 'progressing',
      message: 'Rolling out 0/2',
    });
    expect(getLocalHealth([deployment])).toMatchObject({
      status: 'progressing',
      label: 'Progressing',
      rank: 2,
    });
  });

  it('ProgressDeadlineExceeded with Available=False → Unhealthy', () => {
    const deployment = deploymentRaw(
      'web',
      { replicas: 3 },
      {
        replicas: 3,
        readyReplicas: 0,
        updatedReplicas: 3,
        conditions: [
          { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' },
          { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
        ],
      }
    );
    expect(getLocalHealth([deployment]).status).toBe('error');
    expect(getLocalHealth([deployment]).label).toBe('Unhealthy');
  });

  it('settled healthy Deployment with owned ReplicaSet → item success and app Healthy', () => {
    const deployment = deploymentRaw(
      'web',
      { replicas: 3 },
      {
        replicas: 3,
        readyReplicas: 3,
        updatedReplicas: 3,
        conditions: [
          { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' },
          { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' },
        ],
      }
    );
    const replicaSet = {
      kind: 'ReplicaSet',
      metadata: { name: 'web-new', namespace: 'demo', ownerReferences: [{ kind: 'Deployment' }] },
      spec: { replicas: 3 },
      status: { replicas: 3, readyReplicas: 3 },
    };
    expect(localGetItemStatus(deployment, [])).toEqual({ severity: 'success' });
    expect(getLocalHealth([deployment, replicaSet]).status).toBe('success');
  });

  it('bare ReplicaSet with no ownerReferences remains Degraded', () => {
    const replicaSet = {
      kind: 'ReplicaSet',
      metadata: { name: 'bare', namespace: 'demo' },
      spec: { replicas: 3 },
      status: { replicas: 3, readyReplicas: 1 },
    };
    const h = getLocalHealth([replicaSet] as any);
    expect(h.status).toBe('warning');
    expect(h.label).toBe('Degraded');
    expect(h.reasons).toContain('ReplicaSet/demo/bare: 1/3 ready');
  });

  it('post-settle collapse with Available=False and no rollout → Unhealthy', () => {
    const deployment = deploymentRaw(
      'web',
      { replicas: 3 },
      {
        replicas: 3,
        readyReplicas: 0,
        updatedReplicas: 3,
        conditions: [
          { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' },
          { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
        ],
      }
    );
    expect(localGetItemStatus(deployment, [])).toEqual({
      severity: 'error',
      message: 'MinimumReplicasUnavailable',
    });
    expect(getLocalHealth([deployment]).status).toBe('error');
  });
});

// ─── StatefulSet verdict contract (standalone localGetItemStatus) ────────
// StatefulSet does NOT populate status.conditions (confirmed empty on every
// live sample) — rollout is detected via status.currentRevision vs
// status.updateRevision instead, not Available/Progressing conditions.
// Replica counts alone lie here: all pods can already be Ready while still
// running the OLD revision (rollout not finished).
describe('localGetItemStatus — StatefulSet verdict contract', () => {
  it('desired=3, ready=3, updated=3, revisions match → success', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 3,
          currentRevision: 'app-v1',
          updateRevision: 'app-v1',
          collisionCount: 0,
          observedGeneration: 1,
        },
        { generation: 1 }
      ),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('desired=0 → success (scaled to zero)', () => {
    const v = localGetItemStatus(
      statefulSetRaw('s', { replicas: 0 }, { replicas: 0, readyReplicas: 0 }),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('currentRevision="v1", updateRevision="v2", updated=1, ready=3 → progressing "Updating 1/3"', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 1,
          currentRevision: 'v1',
          updateRevision: 'v2',
        }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Updating 1/3');
  });

  it('updatedReplicas=2, desired=3, revisions differ → progressing', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 2,
          currentRevision: 'v1',
          updateRevision: 'v2',
        }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
  });

  it('revisions match, updated=3, ready=2, desired=3 (died after settling) → warning "2/3 ready"', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 2,
          updatedReplicas: 3,
          currentRevision: 'v1',
          updateRevision: 'v1',
        }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('2/3 ready');
  });

  it('status.replicas=0, desired=3 → error "0/3 pods created"', () => {
    const v = localGetItemStatus(statefulSetRaw('s', { replicas: 3 }, { replicas: 0 }), []);
    expect(v.severity).toBe('error');
    expect(v.message).toBe('0/3 pods created');
  });

  it('collisionCount=1 → error "Revision collision"', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        { replicas: 3, readyReplicas: 3, updatedReplicas: 3, collisionCount: 1 }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Revision collision');
  });

  it('observedGeneration=52, metadata.generation=53 → unknown "Status updating"', () => {
    const v = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        { replicas: 3, readyReplicas: 3, observedGeneration: 52 },
        { generation: 53 }
      ),
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Status updating');
  });

  it('missing status → unknown', () => {
    const v = localGetItemStatus(statefulSetRaw('s', { replicas: 3 }, undefined), []);
    expect(v.severity).toBe('unknown');
  });

  it('identical 3/3 ready counts, differing only by revision match/mismatch → different verdicts', () => {
    const settled = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 3,
          currentRevision: 'v1',
          updateRevision: 'v1',
        }
      ),
      []
    );
    const rollingOut = localGetItemStatus(
      statefulSetRaw(
        's',
        { replicas: 3 },
        {
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 3,
          currentRevision: 'v1',
          updateRevision: 'v2',
        }
      ),
      []
    );
    expect(settled.severity).toBe('success');
    expect(rollingOut.severity).toBe('progressing');
  });
});

// ─── DaemonSet verdict contract (standalone localGetItemStatus) ──────────
// DaemonSet has no spec.replicas; rollout is detected via
// status.updatedNumberScheduled vs status.currentNumberScheduled (NOT
// desiredNumberScheduled) — pods must actually exist on a node before
// "some are still the old version" is a meaningful signal. Comparing
// against desired instead would misclassify a plain scheduling gap (nodes
// with no pod at all yet) as a rollout. Gated by spec.updateStrategy.type —
// OnDelete must never read as Progressing since old pods staying put there
// is intentional, not stuck.
describe('localGetItemStatus — DaemonSet verdict contract', () => {
  it('desired=73, ready=73, updated=73 → success', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 73,
          currentNumberScheduled: 73,
          numberReady: 73,
          updatedNumberScheduled: 73,
          numberMisscheduled: 0,
          observedGeneration: 1,
        },
        { generation: 1 }
      ),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('desired=0 → success', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        {},
        { desiredNumberScheduled: 0, currentNumberScheduled: 0, numberReady: 0 }
      ),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('scheduled=0, desired=5 → error "0/5 pods scheduled"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        {},
        { desiredNumberScheduled: 5, currentNumberScheduled: 0, numberReady: 0 }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('0/5 pods scheduled');
  });

  it('scheduled=0, desired=5, misscheduled=2 → error wins, not warning', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        {},
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 0,
          numberReady: 0,
          numberMisscheduled: 2,
        }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('0/5 pods scheduled');
  });

  it('RollingUpdate, updatedNumberScheduled=3, desired=5, ready=5 → progressing "Updating 3/5"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Updating 3/5');
  });

  it('OnDelete, updatedNumberScheduled=3, desired=5, ready=5 → success (NOT progressing)', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'OnDelete' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    expect(v.severity).toBe('success');
  });

  it('regression guard: updated == scheduled < desired (RollingUpdate) → warning, NOT progressing (scheduling gap, not a rollout)', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 3,
          numberReady: 3,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('3/5 ready');
  });

  it('true rollout: updated < scheduled < desired (RollingUpdate) → progressing "Updating X/scheduled"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 6,
          currentNumberScheduled: 4,
          numberReady: 4,
          updatedNumberScheduled: 2,
        }
      ),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Updating 2/4');
  });

  it('scheduling gap with OnDelete → warning, still Degraded (OnDelete only excludes rollout, not scheduling gaps)', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'OnDelete' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 3,
          numberReady: 3,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('3/5 ready');
  });

  it('updated=5, desired=5, ready=3 (settled but degraded) → warning "3/5 ready"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 3,
          updatedNumberScheduled: 5,
        }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('3/5 ready');
  });

  it('ready=5, desired=5, misscheduled=1 → warning "1 misscheduled"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 5,
          numberMisscheduled: 1,
        }
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('1 misscheduled');
  });

  it('observedGeneration=1, metadata.generation=2 → unknown "Status updating"', () => {
    const v = localGetItemStatus(
      daemonSetRaw(
        'd',
        {},
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          observedGeneration: 1,
        },
        { generation: 2 }
      ),
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Status updating');
  });

  it('missing status → unknown', () => {
    const v = localGetItemStatus(daemonSetRaw('d', {}, undefined), []);
    expect(v.severity).toBe('unknown');
  });

  it('identical ready counts, differing only by updatedNumberScheduled (RollingUpdate) → different verdicts', () => {
    const rolling = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    const settled = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'RollingUpdate' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 5,
        }
      ),
      []
    );
    expect(rolling.severity).toBe('progressing');
    expect(settled.severity).toBe('success');
  });

  it('same as above but OnDelete → both success, proving OnDelete is respected', () => {
    const a = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'OnDelete' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 3,
        }
      ),
      []
    );
    const b = localGetItemStatus(
      daemonSetRaw(
        'd',
        { updateStrategy: { type: 'OnDelete' } },
        {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 5,
          updatedNumberScheduled: 5,
        }
      ),
      []
    );
    expect(a.severity).toBe('success');
    expect(b.severity).toBe('success');
  });
});

// ─── Job verdict contract (standalone localGetItemStatus) ────────────────
// Job is NON_HEALTH_BEARING — these assert the item-level verdict directly,
// same seam as Pod/Deployment/StatefulSet/DaemonSet. status.failed is a raw
// retry counter, not a verdict: only the real Failed condition (set by
// Kubernetes once backoffLimit is truly exhausted) makes a Job error.
describe('localGetItemStatus — Job verdict contract', () => {
  it('Failed condition (BackoffLimitExceeded) → error, correct message', () => {
    const v = localGetItemStatus(
      jobRaw(
        'j',
        { backoffLimit: 0 },
        {
          failed: 1,
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        }
      ),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('BackoffLimitExceeded');
  });

  it('Complete condition → success', () => {
    const v = localGetItemStatus(
      jobRaw(
        'j',
        { backoffLimit: 100 },
        { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] }
      ),
      []
    );
    expect(v.severity).toBe('success');
    expect(v.message).toBe('Complete');
  });

  it('active > 0 → progressing "Running"', () => {
    const v = localGetItemStatus(jobRaw('j', { backoffLimit: 6 }, { active: 1 }), []);
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Running');
  });

  it('regression guard (BUG 1): failed=1, backoffLimit=100, no Failed condition → must NOT be warning', () => {
    const v = localGetItemStatus(
      jobRaw('j', { backoffLimit: 100 }, { failed: 1, succeeded: 0 }),
      []
    );
    expect(v.severity).not.toBe('warning');
    expect(v.severity).toBe('progressing');
  });

  it('no conditions, not active → progressing "Pending"', () => {
    const v = localGetItemStatus(jobRaw('j', { backoffLimit: 6 }, { failed: 0, succeeded: 0 }), []);
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Pending');
  });

  it('observedGeneration < generation → unknown (defensive check; not observed on any live Job — field absent live)', () => {
    const v = localGetItemStatus(
      jobRaw('j', { backoffLimit: 6 }, { observedGeneration: 1 }, { generation: 2 }),
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Status updating');
  });

  it('missing status → unknown', () => {
    const v = localGetItemStatus(jobRaw('j', { backoffLimit: 6 }, undefined), []);
    expect(v.severity).toBe('unknown');
  });
});

// ─── CronJob verdict contract (standalone localGetItemStatus) ────────────
// CronJob is NON_HEALTH_BEARING. concurrencyPolicy is real Kubernetes
// truth (Forbid/Replace expect at most 1 concurrent run; Allow permits
// unlimited by design) — no invented numeric cap.
describe('localGetItemStatus — CronJob verdict contract', () => {
  it('Forbid + activeRuns=1 → progressing "Running" (within policy, not warning)', () => {
    const cron = cronJobRaw(
      'c',
      { concurrencyPolicy: 'Forbid' },
      { active: [{ name: 'r1' }] },
      'u1'
    );
    const v = localGetItemStatus(cron, [cron]);
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Running');
  });

  it('Forbid + activeRuns=2 → warning "2 active runs" (unexpected for Forbid)', () => {
    const cron = cronJobRaw(
      'c',
      { concurrencyPolicy: 'Forbid' },
      { active: [{ name: 'r1' }, { name: 'r2' }] },
      'u2'
    );
    const v = localGetItemStatus(cron, [cron]);
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('2 active runs');
  });

  it('Allow + activeRuns=7 → progressing "Running" (unlimited by design — regression guard for removed magic cap=5)', () => {
    const cron = cronJobRaw(
      'c',
      { concurrencyPolicy: 'Allow' },
      { active: Array.from({ length: 7 }, (_v, i) => ({ name: `r${i}` })) },
      'u3'
    );
    const v = localGetItemStatus(cron, [cron]);
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Running');
  });

  it('Replace + activeRuns=2 → warning "2 active runs"', () => {
    const cron = cronJobRaw(
      'c',
      { concurrencyPolicy: 'Replace' },
      { active: [{ name: 'r1' }, { name: 'r2' }] },
      'u4'
    );
    const v = localGetItemStatus(cron, [cron]);
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('2 active runs');
  });

  it('latest completed child Job (by completionTime) FAILED → warning "Recent run failed: <reason>"', () => {
    const cron = cronJobRaw('c', { concurrencyPolicy: 'Forbid' }, { active: [] }, 'u5');
    const failedChild = childJobRaw('c-1', 'u5', {
      completionTime: '2026-01-02T00:00:00Z',
      conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
    });
    const v = localGetItemStatus(cron, [cron, failedChild]);
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('Recent run failed: BackoffLimitExceeded');
  });

  it('two overlapping child Jobs: earlier completionTime FAILED, later completionTime SUCCEEDED → success (proves completionTime sort, not startTime)', () => {
    const cron = cronJobRaw('c', { concurrencyPolicy: 'Forbid' }, { active: [] }, 'u6');
    const earlierFailedButStartedLater = childJobRaw('c-1', 'u6', {
      startTime: '2026-01-02T00:00:00Z', // started AFTER the succeeded one
      completionTime: '2026-01-01T00:00:00Z', // but FINISHED before it
      succeeded: 0,
      conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
    });
    const laterSucceeded = childJobRaw('c-2', 'u6', {
      startTime: '2026-01-01T00:00:00Z', // started BEFORE the failed one
      completionTime: '2026-01-03T00:00:00Z', // but FINISHED after it
      succeeded: 1,
      conditions: [{ type: 'Complete', status: 'True' }],
    });
    const v = localGetItemStatus(cron, [cron, earlierFailedButStartedLater, laterSucceeded]);
    expect(v.severity).toBe('success');
    expect(v.message).toBe('Last run succeeded');
  });

  it('no child Jobs + status.lastSuccessfulTime present → success "Last run succeeded" (explicit fallback; mirrors live history-limit=0 CronJob)', () => {
    const v = localGetItemStatus(
      cronJobRaw(
        'c',
        { concurrencyPolicy: 'Replace', successfulJobsHistoryLimit: 0, failedJobsHistoryLimit: 0 },
        {
          active: [],
          lastScheduleTime: '2026-01-01T00:00:00Z',
          lastSuccessfulTime: '2026-01-01T00:00:24Z',
        },
        'u7'
      ),
      []
    );
    expect(v.severity).toBe('success');
    expect(v.message).toBe('Last run succeeded');
  });

  it('no child Jobs + lastScheduleTime but no lastSuccessfulTime → warning "Scheduled but never succeeded"', () => {
    const v = localGetItemStatus(
      cronJobRaw(
        'c',
        { concurrencyPolicy: 'Forbid' },
        { active: [], lastScheduleTime: '2026-01-01T00:00:00Z' },
        'u8'
      ),
      []
    );
    expect(v.severity).toBe('warning');
    expect(v.message).toBe('Scheduled but never succeeded');
  });

  it('suspend=true → info "Suspended" (fixture-only — no suspended CronJob exists live)', () => {
    const v = localGetItemStatus(
      cronJobRaw('c', { concurrencyPolicy: 'Forbid', suspend: true }, { active: [] }, 'u9'),
      []
    );
    expect(v.severity).toBe('info');
    expect(v.message).toBe('Suspended');
  });

  it('nothing recorded (no active, no schedule, no success) → unknown "No run recorded yet"', () => {
    const v = localGetItemStatus(
      cronJobRaw('c', { concurrencyPolicy: 'Forbid' }, { active: [] }, 'u10'),
      []
    );
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('No run recorded yet');
  });
});

// ─── PVC verdict contract (standalone localGetItemStatus) ────────────────
// Only three real phases exist: Pending, Bound, Lost. The old "Pending >
// 2m → error" timer is gone — Pending is now 'progressing' (a normal,
// expected WaitForFirstConsumer wait state), never age-dependent.
describe('localGetItemStatus — PVC verdict contract', () => {
  it("phase='Bound' → success", () => {
    const v = localGetItemStatus(pvcRaw('p', { phase: 'Bound' }), []);
    expect(v.severity).toBe('success');
  });

  it('phase=\'Pending\' (young) → progressing "Pending"', () => {
    const v = localGetItemStatus(
      pvcRaw('p', { phase: 'Pending' }, { creationTimestamp: new Date().toISOString() }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Pending');
  });

  it('phase=\'Pending\' with an OLD creationTimestamp → still progressing "Pending" (regression guard: 2-minute timer removed)', () => {
    const v = localGetItemStatus(
      pvcRaw('p', { phase: 'Pending' }, { creationTimestamp: '2020-01-01T00:00:00Z' }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Pending');
  });

  it('phase=\'Lost\' → error "Lost"', () => {
    const v = localGetItemStatus(pvcRaw('p', { phase: 'Lost' }), []);
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Lost');
  });

  it('deletionTimestamp set, phase Bound → progressing "Terminating"', () => {
    const v = localGetItemStatus(
      pvcRaw('p', { phase: 'Bound' }, { deletionTimestamp: '2026-01-01T00:00:00Z' }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Terminating');
  });

  it('deletionTimestamp set AND phase Lost → error "Lost" wins over Terminating (a lost PV is a real failure, not a normal transition)', () => {
    const v = localGetItemStatus(
      pvcRaw('p', { phase: 'Lost' }, { deletionTimestamp: '2026-01-01T00:00:00Z' }),
      []
    );
    expect(v.severity).toBe('error');
    expect(v.message).toBe('Lost');
  });

  it('missing status → unknown', () => {
    const v = localGetItemStatus(pvcRaw('p', undefined), []);
    expect(v.severity).toBe('unknown');
  });

  it('phase missing/undefined → unknown', () => {
    const v = localGetItemStatus(pvcRaw('p', {}), []);
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Status unavailable');
  });

  it('unrecognized phase value → unknown with phase in message', () => {
    const v = localGetItemStatus(pvcRaw('p', { phase: 'Weird' }), []);
    expect(v.severity).toBe('unknown');
    expect(v.message).toBe('Unknown phase: Weird');
  });

  it('phase=Bound + Resizing condition → progressing "Resizing" (fixture-only — not observed on any live PVC)', () => {
    const v = localGetItemStatus(
      pvcRaw('p', {
        phase: 'Bound',
        conditions: [{ type: 'Resizing', status: 'True' }],
      }),
      []
    );
    expect(v.severity).toBe('progressing');
    expect(v.message).toBe('Resizing');
  });
});

// Live-verified regression: namespace wnv7a0vbgw0013c showed Unhealthy driven
// solely by a Failed `helm.sh/hook: post-upgrade` Pod (ownerReferences kind
// 'Job', exitCode 1) while every Deployment/StatefulSet/DaemonSet was Ready.
// Job is already NON_HEALTH_BEARING; its Pod must be advisory too. The
// regression cases below are the guard against over-fixing into a false
// negative: only 'Job' ownership is advisory.
describe('Job-owned Pods are advisory (needsAttention), never badge-driving', () => {
  const jobOwned = (name: string, status: any) =>
    podRaw(name, status, { ownerReferences: [{ kind: 'Job', name: 'hook-job' }] });
  const failedStatus = {
    phase: 'Failed',
    reason: 'Error',
    containerStatuses: [{ name: 'main', state: { terminated: { exitCode: 1, reason: 'Error' } } }],
  };
  const healthyDeployment = deploymentRaw(
    'web',
    { replicas: 3 },
    { replicas: 3, readyReplicas: 3, updatedReplicas: 3 }
  );

  it('1. wnv7a0vbgw0013c repro: healthy Deployment + Failed Job-owned Pod + failed Jobs → Healthy', () => {
    const h = getLocalHealth([
      healthyDeployment,
      jobOwned('post-upgrade-hook-8kw2h', failedStatus),
      jobRaw(
        'sbc-healthcheck-job',
        {},
        {
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        }
      ),
      jobRaw(
        'post-upgrade-ztspostquites',
        {},
        {
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        }
      ),
      jobRaw(
        'scm-test-alarm',
        {},
        {
          conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
        }
      ),
    ]);
    expect(h).toMatchObject({ status: 'success', label: 'Healthy', rank: 0 });
    expect(h.evidence).toEqual([]);
    expect(
      h.needsAttention.some(e => e.kind === 'Pod' && e.name === 'post-upgrade-hook-8kw2h')
    ).toBe(true);
  });

  it('2. REGRESSION: ReplicaSet-owned Pod in CrashLoopBackOff → still Unhealthy', () => {
    const h = getLocalHealth([
      healthyDeployment,
      podRaw(
        'app-abc',
        {
          phase: 'Running',
          conditions: [{ type: 'Ready', status: 'False' }],
          containerStatuses: [{ name: 'main', state: { waiting: { reason: 'CrashLoopBackOff' } } }],
        },
        { ownerReferences: [{ kind: 'ReplicaSet', name: 'web-1' }] }
      ),
    ]);
    expect(h).toMatchObject({ status: 'error', label: 'Unhealthy', rank: 4 });
  });

  it('3. REGRESSION: StatefulSet-owned Pod Failed → still Unhealthy', () => {
    const h = getLocalHealth([
      healthyDeployment,
      podRaw('db-0', failedStatus, { ownerReferences: [{ kind: 'StatefulSet', name: 'db' }] }),
    ]);
    expect(h).toMatchObject({ status: 'error', label: 'Unhealthy', rank: 4 });
  });

  it('4. REGRESSION: bare Pod (no ownerReferences) Failed → still Unhealthy', () => {
    const h = getLocalHealth([healthyDeployment, podRaw('standalone', failedStatus)]);
    expect(h).toMatchObject({ status: 'error', label: 'Unhealthy', rank: 4 });
  });

  it('5. Failed Job-owned Pod as the ONLY item → Healthy, advisory only', () => {
    const h = getLocalHealth([jobOwned('hook-only', failedStatus)]);
    expect(h).toMatchObject({ status: 'success', label: 'Healthy', rank: 0 });
    expect(h.evidence).toEqual([]);
    expect(h.needsAttention).toHaveLength(1);
    expect(h.needsAttention[0]).toMatchObject({ kind: 'Pod', severity: 'error' });
  });

  it('6. Degraded Deployment (2/3) + failed Job-owned Pod → Degraded from the Deployment only', () => {
    const h = getLocalHealth([
      deploymentRaw('web', { replicas: 3 }, { replicas: 3, readyReplicas: 2, updatedReplicas: 3 }),
      jobOwned('hook', failedStatus),
    ]);
    expect(h).toMatchObject({ status: 'warning', label: 'Degraded', rank: 3 });
    expect(h.evidence).toHaveLength(1);
    expect(h.evidence[0]).toMatchObject({ kind: 'Deployment', name: 'web' });
  });

  it('7. Running Job-owned Pod + healthy app → Healthy, nothing surfaced', () => {
    const h = getLocalHealth([
      healthyDeployment,
      jobOwned('hook-running', {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [{ name: 'main', state: { running: {} } }],
      }),
    ]);
    expect(h).toMatchObject({ status: 'success', label: 'Healthy', rank: 0 });
    expect(h.needsAttention).toEqual([]);
  });
});
