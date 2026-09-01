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

// Fabricated KubeObject fixtures for every health scenario covered by
// p17 rules and p18 tests. Pure data — no React, no I/O.
// Each export is `{ name, items, expected }` and is discoverable by the
// test file via Object.values(fixtures).filter(...).

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LocalHealthBadge } from '../localHealth';

// Type-loose helper so tests read like data.
type ItemPlan = any;
type Scenario = {
  name: string;
  items: ItemPlan[];
  expected: {
    status: LocalHealthBadge;
    label: 'Healthy' | 'Degraded' | 'Unhealthy' | 'No Resources';
    rank: 0 | 1 | 2 | 3;
    reasonsIncludes?: string[];
  };
};

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const OLD = iso(60 * 60_000); // 1 hour ago
const YOUNG_1MIN = iso(60_000); // 1 minute ago
const YOUNG_30S = iso(30_000);
const OLD_10MIN = iso(10 * 60_000);

const svc = (name = 'demo-svc'): ItemPlan => ({
  kind: 'Service',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { type: 'ClusterIP', selector: { app: name } },
});
const cm = (name = 'demo-cm'): ItemPlan => ({
  kind: 'ConfigMap',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
});
const secret = (name = 'demo-secret'): ItemPlan => ({
  kind: 'Secret',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
});

const deployment = (
  name: string,
  desired: number,
  ready: number,
  statusReplicas?: number
): ItemPlan => ({
  kind: 'Deployment',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { replicas: desired },
  status: {
    replicas: statusReplicas ?? Math.max(ready, 0),
    readyReplicas: ready,
  },
});

const statefulSet = (name: string, desired: number, ready: number): ItemPlan => ({
  kind: 'StatefulSet',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { replicas: desired },
  status: { replicas: desired, readyReplicas: ready },
});

const daemonSet = (name: string, desired: number, ready: number): ItemPlan => ({
  kind: 'DaemonSet',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: {},
  status: {
    desiredNumberScheduled: desired,
    currentNumberScheduled: desired,
    numberReady: ready,
    replicas: desired,
  },
});

const replicaSet = (name: string, desired: number, ready: number): ItemPlan => ({
  kind: 'ReplicaSet',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { replicas: desired },
  status: { replicas: desired, readyReplicas: ready },
});

const pod = (
  name: string,
  overrides: {
    phase?: string;
    ready?: boolean;
    waitingReason?: string;
    createdMsAgo?: number;
  } = {}
): ItemPlan => {
  const { phase = 'Running', ready = true, waitingReason, createdMsAgo = 60 * 60_000 } = overrides;
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'demo', creationTimestamp: iso(createdMsAgo) },
    status: {
      phase,
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      containerStatuses: waitingReason
        ? [
            {
              name: 'main',
              state: { waiting: { reason: waitingReason } },
            },
          ]
        : [{ name: 'main', state: { running: {} } }],
    },
  };
};

const job = (
  name: string,
  overrides: { failed?: number; succeeded?: number; backoffLimit?: number } = {}
): ItemPlan => ({
  kind: 'Job',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { backoffLimit: overrides.backoffLimit ?? 6 },
  status: {
    failed: overrides.failed ?? 0,
    succeeded: overrides.succeeded ?? 0,
  },
});

const cronJob = (
  name: string,
  activeCount: number,
  concurrencyPolicy?: 'Allow' | 'Forbid' | 'Replace'
): ItemPlan => ({
  kind: 'CronJob',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  spec: { concurrencyPolicy },
  status: {
    active: Array.from({ length: activeCount }, (_v, i) => ({
      name: `${name}-${i}`,
    })),
  },
});

const pvc = (name: string, phase: string, createdMsAgo = 60 * 60_000): ItemPlan => ({
  kind: 'PersistentVolumeClaim',
  metadata: { name, namespace: 'demo', creationTimestamp: iso(createdMsAgo) },
  status: { phase },
});

const endpoints = (name: string, addressCount: number): ItemPlan => ({
  kind: 'Endpoints',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  subsets:
    addressCount > 0
      ? [
          {
            addresses: Array.from({ length: addressCount }, (_v, i) => ({
              ip: `10.0.0.${i + 1}`,
            })),
          },
        ]
      : [],
});

const hpa = (name: string, active: boolean, reason?: string): ItemPlan => ({
  kind: 'HorizontalPodAutoscaler',
  metadata: { name, namespace: 'demo', creationTimestamp: OLD },
  status: {
    conditions: [
      {
        type: 'ScalingActive',
        status: active ? 'True' : 'False',
        reason: reason ?? (active ? 'ValidMetricFound' : 'FailedGetMetrics'),
      },
    ],
  },
});

const ingress = (name: string, hasLb: boolean, createdMsAgo = 60 * 60_000): ItemPlan => ({
  kind: 'Ingress',
  metadata: { name, namespace: 'demo', creationTimestamp: iso(createdMsAgo) },
  status: {
    loadBalancer: hasLb ? { ingress: [{ hostname: 'lb.example.com' }] } : { ingress: [] },
  },
});

// ─── 01: baseline / boundary ────────────────────────────────────────────
export const empty: Scenario = {
  name: 'empty',
  items: [],
  expected: { status: 'empty', label: 'No Resources', rank: 0 },
};

export const allHealthySingleCluster: Scenario = {
  name: 'allHealthySingleCluster',
  items: [
    deployment('web', 3, 3),
    svc('web'),
    cm('cfg'),
    job('one-shot', { failed: 0, succeeded: 1 }),
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// health.txt example non-regression: wnv7a0vbgw0013c-shape
export const wnv7a0vbgw0013cStyle: Scenario = {
  name: 'wnv7a0vbgw0013cStyle',
  items: [
    deployment('svc-a', 2, 2),
    deployment('svc-b', 1, 1),
    replicaSet('svc-a-abc', 2, 2),
    replicaSet('svc-b-def', 1, 1),
    svc('svc-a'),
    svc('svc-b'),
    secret('creds'),
    cm('config'),
    job('backup-ok', { failed: 0, succeeded: 1 }),
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const allHealthyMultiCluster: Scenario = {
  name: 'allHealthyMultiCluster',
  items: [
    // Cluster A
    deployment('web', 3, 3),
    svc('web'),
    // Cluster B — same shapes, different names to mirror multi-cluster fetch
    { ...deployment('web-2', 3, 3) },
    { ...svc('web-2') },
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 10-15: workload breakage ───────────────────────────────────────────
export const deployment2Of3Ready: Scenario = {
  name: 'deployment2Of3Ready',
  items: [deployment('web', 3, 2)],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['Deployment/demo/web: 2/3 ready'],
  },
};

export const deployment0Of3Created: Scenario = {
  name: 'deployment0Of3Created',
  items: [deployment('web', 3, 0, 0)],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['Deployment/demo/web: 0/3 pods created'],
  },
};

export const deploymentScaledToZero: Scenario = {
  name: 'deploymentScaledToZero',
  items: [deployment('web', 0, 0, 0), svc('web')],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const statefulSet0Of2Ready: Scenario = {
  name: 'statefulSet0Of2Ready',
  items: [statefulSet('db', 2, 0)],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

export const daemonSetPartial: Scenario = {
  name: 'daemonSetPartial',
  items: [daemonSet('node-agent', 5, 3)],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

export const replicaSetPartial: Scenario = {
  name: 'replicaSetPartial',
  items: [replicaSet('web-abc', 3, 1)],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

// ─── 20-30: Pod-only scenarios (payoff of p17's local Pod fetch) ────────
export const podFailed: Scenario = {
  name: 'podFailed',
  items: [pod('bare-1', { phase: 'Failed' })],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['Pod/demo/bare-1: Failed'],
  },
};

export const podCrashLoopBackOff: Scenario = {
  name: 'podCrashLoopBackOff',
  items: [
    pod('crasher', {
      phase: 'Running',
      ready: false,
      waitingReason: 'CrashLoopBackOff',
    }),
  ],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['CrashLoopBackOff'],
  },
};

export const podImagePullBackOff: Scenario = {
  name: 'podImagePullBackOff',
  items: [
    pod('missing-img', {
      phase: 'Pending',
      ready: false,
      waitingReason: 'ImagePullBackOff',
    }),
  ],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['ImagePullBackOff'],
  },
};

export const podErrImagePull: Scenario = {
  name: 'podErrImagePull',
  items: [
    pod('bad-img', {
      phase: 'Pending',
      ready: false,
      waitingReason: 'ErrImagePull',
    }),
  ],
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

export const podCreateContainerConfigError: Scenario = {
  name: 'podCreateContainerConfigError',
  items: [
    pod('cfg-err', {
      phase: 'Pending',
      ready: false,
      waitingReason: 'CreateContainerConfigError',
    }),
  ],
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

export const podInvalidImageName: Scenario = {
  name: 'podInvalidImageName',
  items: [
    pod('bad-name', {
      phase: 'Pending',
      ready: false,
      waitingReason: 'InvalidImageName',
    }),
  ],
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

export const podRunningNotReady: Scenario = {
  name: 'podRunningNotReady',
  items: [pod('starting', { phase: 'Running', ready: false })],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['Running but NotReady'],
  },
};

export const podPendingOld: Scenario = {
  name: 'podPendingOld',
  items: [pod('stuck', { phase: 'Pending', ready: false, createdMsAgo: 10 * 60_000 })],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['Pending > 5m'],
  },
};

export const podPendingYoung: Scenario = {
  name: 'podPendingYoung',
  items: [pod('warming', { phase: 'Pending', ready: false, createdMsAgo: 30_000 })],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['Pending'],
  },
};

export const podSucceeded: Scenario = {
  name: 'podSucceeded',
  items: [pod('done', { phase: 'Succeeded', ready: false })],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const podRunningReady: Scenario = {
  name: 'podRunningReady',
  items: [pod('happy', { phase: 'Running', ready: true })],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 40-52: batch (Job / CronJob) ───────────────────────────────────────
export const jobAllRetriesFailed: Scenario = {
  name: 'jobAllRetriesFailed',
  items: [job('backup', { failed: 7, succeeded: 0, backoffLimit: 6 })],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['failed (7/7)'],
  },
};

export const jobFailedRetriesLeft: Scenario = {
  name: 'jobFailedRetriesLeft',
  items: [job('backup', { failed: 3, succeeded: 0, backoffLimit: 6 })],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const jobSucceeded: Scenario = {
  name: 'jobSucceeded',
  items: [job('one-shot', { failed: 0, succeeded: 1 })],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const cronJobPileup: Scenario = {
  name: 'cronJobPileup',
  items: [cronJob('report', 6)],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['6 active runs'],
  },
};

export const cronJobForbidPileup: Scenario = {
  name: 'cronJobForbidPileup',
  items: [cronJob('report', 2, 'Forbid')],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

export const cronJobActiveOne: Scenario = {
  name: 'cronJobActiveOne',
  items: [cronJob('report', 1)],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 60-63: PVC ─────────────────────────────────────────────────────────
export const pvcLost: Scenario = {
  name: 'pvcLost',
  items: [pvc('data', 'Lost')],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['PersistentVolumeClaim/demo/data: Lost'],
  },
};

export const pvcPendingOld: Scenario = {
  name: 'pvcPendingOld',
  items: [pvc('data', 'Pending', 10 * 60_000)],
  expected: {
    status: 'error',
    label: 'Unhealthy',
    rank: 3,
    reasonsIncludes: ['Pending > 2m'],
  },
};

export const pvcPendingYoung: Scenario = {
  name: 'pvcPendingYoung',
  items: [pvc('data', 'Pending', 30_000)],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['Pending'],
  },
};

export const pvcBound: Scenario = {
  name: 'pvcBound',
  items: [pvc('data', 'Bound')],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 70-72: Endpoints ───────────────────────────────────────────────────
export const endpointsEmpty: Scenario = {
  name: 'endpointsEmpty',
  items: [endpoints('demo-svc', 0)],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['no endpoints'],
  },
};

export const endpointsWithAddresses: Scenario = {
  name: 'endpointsWithAddresses',
  items: [endpoints('demo-svc', 2)],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 80-82: HPA ─────────────────────────────────────────────────────────
export const hpaFailedGetMetrics: Scenario = {
  name: 'hpaFailedGetMetrics',
  items: [hpa('web-hpa', false, 'FailedGetMetrics')],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['FailedGetMetrics'],
  },
};

export const hpaScalingDisabled: Scenario = {
  name: 'hpaScalingDisabled',
  items: [hpa('web-hpa', false, 'ScalingDisabled')],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const hpaScalingActive: Scenario = {
  name: 'hpaScalingActive',
  items: [hpa('web-hpa', true)],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── 90-92: Ingress ─────────────────────────────────────────────────────
export const ingressNoLbOld: Scenario = {
  name: 'ingressNoLbOld',
  items: [ingress('web', false, 10 * 60_000)],
  expected: {
    status: 'warning',
    label: 'Degraded',
    rank: 2,
    reasonsIncludes: ['no address'],
  },
};

export const ingressNoLbYoung: Scenario = {
  name: 'ingressNoLbYoung',
  items: [ingress('web', false, 60_000)],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const ingressWithLb: Scenario = {
  name: 'ingressWithLb',
  items: [ingress('web', true)],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── Silent-success kinds ───────────────────────────────────────────────
export const serviceHealthy: Scenario = {
  name: 'serviceHealthy',
  items: [svc('web')],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const passiveKindsOnly: Scenario = {
  name: 'passiveKindsOnly',
  items: [
    cm('c1'),
    secret('s1'),
    svc('web'),
    {
      kind: 'NetworkPolicy',
      metadata: { name: 'np', namespace: 'demo', creationTimestamp: OLD },
    },
    { kind: 'Role', metadata: { name: 'r', namespace: 'demo', creationTimestamp: OLD } },
    { kind: 'RoleBinding', metadata: { name: 'rb', namespace: 'demo', creationTimestamp: OLD } },
    { kind: 'LimitRange', metadata: { name: 'lr', namespace: 'demo', creationTimestamp: OLD } },
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── Aggregation (worst-of) ─────────────────────────────────────────────
export const mixOneErrorTwoWarn: Scenario = {
  name: 'mixOneErrorTwoWarn',
  items: [
    pod('crash', { phase: 'Running', ready: false, waitingReason: 'CrashLoopBackOff' }),
    deployment('web', 3, 2),
    endpoints('web-svc', 0),
    svc('web'),
    cm('cfg'),
    secret('sec'),
  ],
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

export const mixWarningOnly: Scenario = {
  name: 'mixWarningOnly',
  items: [
    deployment('web', 3, 2),
    endpoints('web-svc', 0),
    hpa('web-hpa', false, 'FailedGetMetrics'),
    svc('web'),
    cm('cfg'),
  ],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

export const mixAllHealthy: Scenario = {
  name: 'mixAllHealthy',
  items: [
    deployment('web', 3, 3),
    endpoints('web-svc', 2),
    hpa('web-hpa', true),
    svc('web'),
    cm('cfg'),
    secret('sec'),
    pod('happy', { phase: 'Running', ready: true }),
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

// ─── Reason cap ─────────────────────────────────────────────────────────
export const reasonCap15FailingPods: Scenario = {
  name: 'reasonCap15FailingPods',
  items: Array.from({ length: 15 }, (_v, i) =>
    pod(`crash-${i}`, {
      phase: 'Running',
      ready: false,
      waitingReason: 'CrashLoopBackOff',
    })
  ),
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

// ─── Multi-cluster collapse (worst-of across clusters) ──────────────────
// The Applications tab merges same-named namespaces across clusters into a
// single row whose items[] carries every cluster's objects. That's the shape
// we simulate here — one items[] with the combined objects.
export const multiClusterAllHealthy: Scenario = {
  name: 'multiClusterAllHealthy',
  items: [
    // cluster A
    deployment('web-a', 2, 2),
    svc('web-a'),
    // cluster B
    deployment('web-b', 1, 1),
    svc('web-b'),
  ],
  expected: { status: 'success', label: 'Healthy', rank: 1 },
};

export const multiClusterOneDegraded: Scenario = {
  name: 'multiClusterOneDegraded',
  items: [deployment('web-a', 3, 3), deployment('web-b', 3, 1)],
  expected: { status: 'warning', label: 'Degraded', rank: 2 },
};

export const multiClusterOneUnhealthy: Scenario = {
  name: 'multiClusterOneUnhealthy',
  items: [
    deployment('web-a', 3, 3),
    pod('cluster-b-crash', {
      phase: 'Running',
      ready: false,
      waitingReason: 'CrashLoopBackOff',
    }),
  ],
  expected: { status: 'error', label: 'Unhealthy', rank: 3 },
};

// Suppress unused var complaints on helpers reserved for future scenarios.
export const _unusedTimestamps = { YOUNG_1MIN, YOUNG_30S, OLD_10MIN };
