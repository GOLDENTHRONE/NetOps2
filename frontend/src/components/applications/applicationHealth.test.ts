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
import { evaluateApplicationHealth, healthSortRank, ResourceLike } from './applicationHealth';

const deploy = (name: string, replicas: number, ready: number, extra: Partial<ResourceLike> = {}) =>
  ({
    kind: 'Deployment',
    metadata: { name, namespace: 'shop' },
    spec: { replicas },
    status: { readyReplicas: ready, updatedReplicas: ready, availableReplicas: ready },
    ...extra,
  } as ResourceLike);

const configMap = (name: string): ResourceLike => ({
  kind: 'ConfigMap',
  metadata: { name, namespace: 'shop' },
});

describe('evaluateApplicationHealth', () => {
  it('is empty when there are no resources', () => {
    const h = evaluateApplicationHealth([]);
    expect(h.status).toBe('empty');
    expect(h.label).toBe('No resources');
  });

  it('reads config-only apps as No workloads, not Healthy', () => {
    const h = evaluateApplicationHealth([configMap('a'), configMap('b')]);
    expect(h.status).toBe('noWorkloads');
    expect(h.totalResources).toBe(2);
    expect(h.totalWorkloads).toBe(0);
  });

  it('is healthy when every workload is fully ready', () => {
    const h = evaluateApplicationHealth([deploy('web', 3, 3), deploy('api', 2, 2), configMap('c')]);
    expect(h.status).toBe('healthy');
    expect(h.readyWorkloads).toBe(2);
    expect(h.totalWorkloads).toBe(2);
  });

  it('is degraded when a workload is partially ready', () => {
    const h = evaluateApplicationHealth([deploy('web', 3, 3), deploy('api', 4, 2)]);
    expect(h.status).toBe('degraded');
    const api = h.workloads.find(w => w.name === 'api')!;
    expect(api.state).toBe('degraded');
    expect(api.reason).toContain('2/4');
  });

  it('is unhealthy when a workload has zero ready replicas', () => {
    const h = evaluateApplicationHealth([deploy('web', 3, 3), deploy('api', 2, 0)]);
    expect(h.status).toBe('unhealthy');
    expect(h.workloads[0].state).toBe('down'); // worst first
  });

  it('flags a stuck rollout (ProgressDeadlineExceeded) as unhealthy', () => {
    const stuck = deploy('web', 3, 1, {
      status: {
        readyReplicas: 1,
        conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' }],
      },
    });
    const h = evaluateApplicationHealth([stuck]);
    expect(h.status).toBe('unhealthy');
    expect(h.workloads[0].reason).toMatch(/deadline exceeded/i);
  });

  it('reports a rolling update as progressing', () => {
    const rolling = deploy('web', 4, 4, {
      status: { readyReplicas: 4, updatedReplicas: 2, availableReplicas: 4 },
    });
    const h = evaluateApplicationHealth([rolling]);
    expect(h.status).toBe('progressing');
    expect(h.workloads[0].state).toBe('progressing');
  });

  it('treats all-scaled-to-zero workloads as idle, not unhealthy', () => {
    const h = evaluateApplicationHealth([deploy('web', 0, 0), deploy('api', 0, 0)]);
    expect(h.status).toBe('idle');
    expect(h.totalWorkloads).toBe(0); // scaled-zero excluded from the ready/total count
  });

  it('handles DaemonSets via scheduled/ready counts', () => {
    const ds: ResourceLike = {
      kind: 'DaemonSet',
      metadata: { name: 'agent', namespace: 'shop' },
      status: { desiredNumberScheduled: 5, numberReady: 3, updatedNumberScheduled: 5 },
    };
    const h = evaluateApplicationHealth([ds]);
    expect(h.status).toBe('degraded');
    expect(h.workloads[0].reason).toContain('3/5');
  });

  it('marks a failed Job as down', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'migrate', namespace: 'shop' },
      spec: { completions: 1 },
      status: { failed: 1, conditions: [{ type: 'Failed', status: 'True' }] },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.status).toBe('unhealthy');
    expect(h.workloads[0].reason).toMatch(/failed/i);
  });

  it('summarizes with the actual failing workloads, not a generic sentence', () => {
    const h = evaluateApplicationHealth([
      deploy('web', 3, 0),
      {
        kind: 'Job',
        metadata: { name: 'migrate', namespace: 'shop' },
        spec: { completions: 1 },
        status: { failed: 1, conditions: [{ type: 'Failed', status: 'True' }] },
      },
    ]);
    expect(h.summary).toContain('Deployment web');
    expect(h.summary).toContain('Job migrate');
    expect(h.summary).toContain('Job failed');
  });

  it('treats a running Job as progressing, not down', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'migrate', namespace: 'shop' },
      spec: { completions: 1 },
      status: { active: 1 },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.status).toBe('progressing');
    expect(h.workloads[0].reason).toMatch(/running/i);
  });

  it('treats a completed Job as ready', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'migrate', namespace: 'shop' },
      spec: { completions: 1 },
      status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.status).toBe('healthy');
    expect(h.workloads[0].state).toBe('ready');
  });

  it('treats a suspended Job as scaled to zero, not unhealthy', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'migrate', namespace: 'shop' },
      spec: { completions: 1, suspend: true },
      status: {},
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.status).toBe('idle');
    expect(h.workloads[0].state).toBe('scaledZero');
  });

  it('flags a Job that has not created a pod for minutes as blocked (down)', () => {
    // A Job that Kubernetes accepted but whose controller can't create pods
    // (ResourceQuota, SCC, admission webhook) sits with active=0, succeeded=0
    // and no Failed condition until backoffLimit is exhausted. Reporting it
    // as "Waiting to run" for hours is misleading.
    const startedLongAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'blocked-job', namespace: 'shop' },
      spec: { completions: 1 },
      status: { active: 0, succeeded: 0, startTime: startedLongAgo },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.workloads[0].state).toBe('down');
    expect(h.workloads[0].reason).toMatch(/Blocked/i);
    expect(h.status).toBe('unhealthy');
  });

  it('still calls a freshly started Job progressing, not blocked', () => {
    // Grace period: within 5 minutes of startTime we do not label as blocked.
    const startedRecently = new Date(Date.now() - 30 * 1000).toISOString();
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'fresh-job', namespace: 'shop' },
      spec: { completions: 1 },
      status: { active: 0, succeeded: 0, startTime: startedRecently },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.workloads[0].state).toBe('progressing');
  });

  it('surfaces Deployment ReplicaFailure (SCC/quota) as the actual cause, not "Not available"', () => {
    // Real bug this fixes: an OpenShift Deployment blocked by SCC used to
    // show "Not available, 0/2 ready", hiding the SCC admission message
    // that tells the operator what to fix.
    const dep: ResourceLike = {
      kind: 'Deployment',
      metadata: { name: 'citm-ingress', namespace: 'shop' },
      spec: { replicas: 2 },
      status: {
        readyReplicas: 0,
        updatedReplicas: 0,
        availableReplicas: 0,
        conditions: [
          { type: 'Available', status: 'False' },
          {
            type: 'ReplicaFailure',
            status: 'True',
            reason: 'FailedCreate',
            message:
              'pods "citm-ingress-556b9d7455-" is forbidden: unable to validate against any security context constraint',
          },
        ],
      },
    };
    const h = evaluateApplicationHealth([dep]);
    expect(h.workloads[0].state).toBe('down');
    expect(h.workloads[0].reason).toMatch(/FailedCreate/);
    expect(h.workloads[0].reason).toMatch(/security context constraint/i);
  });

  it('reports an HPA scale-up as progressing, not degraded', () => {
    // With Progressing=True + reason ReplicaSetUpdated, ready<desired is an
    // in-flight rollout, not a degradation.
    const dep: ResourceLike = {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: 'shop' },
      spec: { replicas: 5 },
      status: {
        readyReplicas: 2,
        updatedReplicas: 2,
        availableReplicas: 2,
        conditions: [
          { type: 'Available', status: 'True' },
          { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' },
        ],
      },
    };
    const h = evaluateApplicationHealth([dep]);
    expect(h.workloads[0].state).toBe('progressing');
    expect(h.status).toBe('progressing');
  });

  it('tags a Job with its parent controller (CronJob)', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: {
        name: 'nightly-28912345',
        namespace: 'shop',
        ownerReferences: [{ kind: 'CronJob', name: 'nightly', controller: true }],
      },
      spec: { completions: 1 },
      status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.workloads[0].ownerKind).toBe('CronJob');
    expect(h.workloads[0].ownerName).toBe('nightly');
  });

  it('treats CronJobs as scheduling context, not workloads', () => {
    // A healthy CronJob with a passing Job must not turn a config-only app
    // into "progressing" and must not appear in workloads[].
    const cron: ResourceLike = {
      kind: 'CronJob',
      metadata: { name: 'nightly', namespace: 'shop' },
      spec: { schedule: '0 3 * * *', suspend: false },
      status: {
        lastScheduleTime: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        lastSuccessfulTime: new Date(Date.now() - 3 * 60 * 60 * 1000 + 60_000).toISOString(),
      },
    };
    const dep = deploy('web', 1, 1);
    const h = evaluateApplicationHealth([cron, dep]);
    expect(h.status).toBe('healthy');
    expect(h.workloads).toHaveLength(1);
    expect(h.workloads[0].kind).toBe('Deployment');
    expect(h.schedules).toHaveLength(1);
    expect(h.schedules[0].kind).toBe('CronJob');
    expect(h.schedules[0].state).toBe('onSchedule');
  });

  it('shows a suspended CronJob in schedules without affecting app health', () => {
    const cron: ResourceLike = {
      kind: 'CronJob',
      metadata: { name: 'paused', namespace: 'shop' },
      spec: { schedule: '0 3 * * *', suspend: true },
      status: {},
    };
    const h = evaluateApplicationHealth([cron, deploy('web', 1, 1)]);
    expect(h.status).toBe('healthy');
    expect(h.schedules[0].state).toBe('suspended');
  });

  it('degrades an otherwise-healthy app when a CronJob has not succeeded in >24h', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const cron: ResourceLike = {
      kind: 'CronJob',
      metadata: { name: 'nightly-backup', namespace: 'shop' },
      spec: { schedule: '0 3 * * *' },
      status: {
        lastScheduleTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        lastSuccessfulTime: twoDaysAgo,
      },
    };
    const h = evaluateApplicationHealth([cron, deploy('web', 1, 1)]);
    expect(h.status).toBe('degraded');
    expect(h.schedules[0].state).toBe('behind');
    expect(h.schedules[0].chronic).toBe(true);
  });

  it('evaluates a DeploymentConfig (OpenShift) the same way as a Deployment', () => {
    const dc: ResourceLike = {
      kind: 'DeploymentConfig',
      metadata: { name: 'legacy-app', namespace: 'shop' },
      spec: { replicas: 3 },
      status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
    };
    const h = evaluateApplicationHealth([dc]);
    expect(h.status).toBe('healthy');
    expect(h.workloads[0].kind).toBe('DeploymentConfig');
    expect(h.workloads[0].state).toBe('ready');
  });

  it('reports a DeploymentConfig with Available=False as down', () => {
    const dc: ResourceLike = {
      kind: 'DeploymentConfig',
      metadata: { name: 'legacy-app', namespace: 'shop' },
      spec: { replicas: 3 },
      status: {
        readyReplicas: 1,
        updatedReplicas: 1,
        availableReplicas: 1,
        conditions: [{ type: 'Available', status: 'False' }],
      },
    };
    const h = evaluateApplicationHealth([dc]);
    expect(h.status).toBe('unhealthy');
    expect(h.workloads[0].state).toBe('down');
    expect(h.workloads[0].reason).toMatch(/Not available/);
  });

  it('reports a paused Deployment as paused, not degraded', () => {
    const dep: ResourceLike = {
      kind: 'Deployment',
      metadata: { name: 'frozen', namespace: 'shop' },
      spec: { replicas: 3, paused: true },
      status: { readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 },
    };
    const h = evaluateApplicationHealth([dep]);
    expect(h.workloads[0].state).toBe('paused');
    expect(h.workloads[0].reason).toMatch(/Paused/i);
    expect(h.status).toBe('healthy');
    expect(h.totalWorkloads).toBe(0);
  });

  it('reports Available=False on a partially-ready Deployment as down (not degraded)', () => {
    // Previously "ready===0" was required; this missed a Deployment that has
    // some pods up but is under its minAvailability threshold.
    const dep: ResourceLike = {
      kind: 'Deployment',
      metadata: { name: 'shaky', namespace: 'shop' },
      spec: { replicas: 5 },
      status: {
        readyReplicas: 1,
        updatedReplicas: 1,
        availableReplicas: 1,
        conditions: [{ type: 'Available', status: 'False' }],
      },
    };
    const h = evaluateApplicationHealth([dep]);
    expect(h.workloads[0].state).toBe('down');
    expect(h.status).toBe('unhealthy');
  });

  it('reads a partitioned StatefulSet rollout as ready-with-note, not progressing', () => {
    const ss: ResourceLike = {
      kind: 'StatefulSet',
      metadata: { name: 'db', namespace: 'shop' },
      spec: { replicas: 5, updateStrategy: { rollingUpdate: { partition: 3 } } },
      status: { readyReplicas: 5, updatedReplicas: 2, currentReplicas: 3 },
    };
    const h = evaluateApplicationHealth([ss]);
    expect(h.workloads[0].state).toBe('ready');
    expect(h.workloads[0].reason).toMatch(/partition/i);
    expect(h.status).toBe('healthy');
  });

  it('flags a DaemonSet with misscheduled pods as degraded even when readyCount matches', () => {
    const ds: ResourceLike = {
      kind: 'DaemonSet',
      metadata: { name: 'log-collector', namespace: 'shop' },
      spec: {},
      status: {
        desiredNumberScheduled: 4,
        numberReady: 4,
        updatedNumberScheduled: 4,
        numberMisscheduled: 2,
      },
    };
    const h = evaluateApplicationHealth([ds]);
    expect(h.workloads[0].state).toBe('degraded');
    expect(h.workloads[0].reason).toMatch(/misscheduled/i);
  });

  it('flags a DaemonSet with unavailable pods as degraded', () => {
    const ds: ResourceLike = {
      kind: 'DaemonSet',
      metadata: { name: 'log-collector', namespace: 'shop' },
      spec: {},
      status: {
        desiredNumberScheduled: 4,
        numberReady: 2,
        updatedNumberScheduled: 4,
        numberUnavailable: 2,
      },
    };
    const h = evaluateApplicationHealth([ds]);
    expect(h.workloads[0].state).toBe('degraded');
    expect(h.workloads[0].reason).toMatch(/unavailable/i);
  });

  it('flags a Job with failures at or above backoffLimit as down', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'migrate', namespace: 'shop' },
      spec: { completions: 1, backoffLimit: 3 },
      status: {
        active: 0,
        succeeded: 0,
        failed: 3,
        startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.workloads[0].state).toBe('down');
    expect(h.workloads[0].reason).toMatch(/BackoffLimit/);
  });

  it('surfaces active/failed/succeeded triple for a progressing Job', () => {
    const job: ResourceLike = {
      kind: 'Job',
      metadata: { name: 'batch', namespace: 'shop' },
      spec: { completions: 10, parallelism: 3, backoffLimit: 6 },
      status: {
        active: 3,
        succeeded: 4,
        failed: 2,
        startTime: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    };
    const h = evaluateApplicationHealth([job]);
    expect(h.workloads[0].state).toBe('progressing');
    expect(h.workloads[0].reason).toMatch(/3 active/);
    expect(h.workloads[0].reason).toMatch(/2 failed/);
    expect(h.workloads[0].reason).toMatch(/4\/10 succeeded/);
  });

  it('surfaces a CrashLoopBackOff pod as unhealthy even when the workload counts look fine', () => {
    // The classic evaluator lie: Deployment 3/3 ready (all previous-rev
    // pods) while the newly-rolled-out replica pod thrashes on CrashLoop.
    const dep = deploy('web', 3, 3);
    const pod: ResourceLike = {
      kind: 'Pod',
      metadata: { name: 'web-abc123', namespace: 'shop' },
      status: {
        containerStatuses: [
          { name: 'app', restartCount: 12, state: { waiting: { reason: 'CrashLoopBackOff' } } },
        ],
      },
    };
    const h = evaluateApplicationHealth([dep, pod]);
    expect(h.status).toBe('unhealthy');
    expect(h.podProblems[0].state).toBe('crashLoop');
    expect(h.podProblems[0].reason).toMatch(/12 restarts/);
  });

  it('surfaces an ImagePullBackOff pod as unhealthy', () => {
    const pod: ResourceLike = {
      kind: 'Pod',
      metadata: { name: 'web-abc123', namespace: 'shop' },
      status: {
        containerStatuses: [{ name: 'app', state: { waiting: { reason: 'ImagePullBackOff' } } }],
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 0), pod]);
    expect(h.status).toBe('unhealthy');
    expect(h.podProblems[0].state).toBe('imagePull');
  });

  it('surfaces an Unschedulable pod as degraded', () => {
    const pod: ResourceLike = {
      kind: 'Pod',
      metadata: { name: 'web-abc123', namespace: 'shop' },
      status: {
        conditions: [
          {
            type: 'PodScheduled',
            status: 'False',
            reason: 'Unschedulable',
            message: '0/5 nodes are available: 5 Insufficient cpu.',
          },
        ],
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), pod]);
    expect(h.status).toBe('degraded');
    expect(h.podProblems[0].state).toBe('unschedulable');
    expect(h.podProblems[0].reason).toMatch(/Insufficient cpu/);
  });

  it('surfaces an OOMKilled pod', () => {
    const pod: ResourceLike = {
      kind: 'Pod',
      metadata: { name: 'web-abc123', namespace: 'shop' },
      status: {
        containerStatuses: [
          {
            name: 'app',
            restartCount: 3,
            state: { running: {} },
            lastState: { terminated: { reason: 'OOMKilled' } },
          },
        ],
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), pod]);
    expect(h.status).toBe('unhealthy');
    expect(h.podProblems[0].state).toBe('oomKilled');
  });

  it('ignores a terminating or Succeeded pod', () => {
    const succeeded: ResourceLike = {
      kind: 'Pod',
      metadata: { name: 'batch-1', namespace: 'shop' },
      status: { phase: 'Succeeded' },
    };
    const terminating: ResourceLike = {
      kind: 'Pod',
      metadata: {
        name: 'web-old',
        namespace: 'shop',
        deletionTimestamp: new Date().toISOString(),
      },
      status: {
        containerStatuses: [{ name: 'app', state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), succeeded, terminating]);
    expect(h.status).toBe('healthy');
    expect(h.podProblems).toHaveLength(0);
  });

  it('surfaces a Pending PVC as degraded', () => {
    const pvc: ResourceLike = {
      kind: 'PersistentVolumeClaim',
      metadata: { name: 'data', namespace: 'shop' },
      status: { phase: 'Pending' },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), pvc]);
    expect(h.status).toBe('degraded');
    expect(h.pvcProblems[0].state).toBe('pending');
  });

  it('surfaces a Lost PVC as unhealthy (data-loss)', () => {
    const pvc: ResourceLike = {
      kind: 'PersistentVolumeClaim',
      metadata: { name: 'data', namespace: 'shop' },
      status: { phase: 'Lost' },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), pvc]);
    expect(h.status).toBe('unhealthy');
    expect(h.pvcProblems[0].state).toBe('lost');
  });

  it('surfaces an exhausted ResourceQuota as degraded', () => {
    const rq: ResourceLike = {
      kind: 'ResourceQuota',
      metadata: { name: 'ns-quota', namespace: 'shop' },
      status: {
        hard: { 'limits.cpu': '10', 'limits.memory': '20Gi' },
        used: { 'limits.cpu': '10', 'limits.memory': '10Gi' },
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), rq]);
    expect(h.status).toBe('degraded');
    expect(h.quotaProblems[0].state).toBe('exhausted');
    expect(h.quotaProblems[0].worstResource).toBe('limits.cpu');
  });

  it('surfaces a near-limit ResourceQuota informationally (no status change)', () => {
    const rq: ResourceLike = {
      kind: 'ResourceQuota',
      metadata: { name: 'ns-quota', namespace: 'shop' },
      status: {
        hard: { 'limits.cpu': '10' },
        used: { 'limits.cpu': '9.2' },
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), rq]);
    expect(h.status).toBe('healthy');
    expect(h.quotaProblems[0].state).toBe('nearLimit');
    expect(h.quotaProblems[0].worstUsagePct).toBeGreaterThanOrEqual(90);
  });

  it('does not flag a comfortably-used ResourceQuota', () => {
    const rq: ResourceLike = {
      kind: 'ResourceQuota',
      metadata: { name: 'ns-quota', namespace: 'shop' },
      status: {
        hard: { 'limits.cpu': '10' },
        used: { 'limits.cpu': '3' },
      },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), rq]);
    expect(h.quotaProblems).toHaveLength(0);
  });

  it('surfaces a Service with no ready endpoints as degraded', () => {
    const svc: ResourceLike = {
      kind: 'Service',
      metadata: { name: 'web-svc', namespace: 'shop' },
      spec: { selector: { app: 'web' } },
    };
    const slice: ResourceLike = {
      kind: 'EndpointSlice',
      metadata: {
        name: 'web-svc-abc',
        namespace: 'shop',
        labels: { 'kubernetes.io/service-name': 'web-svc' },
      },
      endpoints: [{ addresses: ['10.0.0.1'], conditions: { ready: false } }],
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), svc, slice]);
    expect(h.status).toBe('healthy');
    expect(h.serviceProblems[0].state).toBe('noEndpoints');
  });

  it('degrades app when ingress-exposed service has no ready endpoints', () => {
    const svc: ResourceLike = {
      kind: 'Service',
      metadata: { name: 'web-svc', namespace: 'shop' },
      spec: { selector: { app: 'web' } },
    };
    const slice: ResourceLike = {
      kind: 'EndpointSlice',
      metadata: {
        name: 'web-svc-abc',
        namespace: 'shop',
        labels: { 'kubernetes.io/service-name': 'web-svc' },
      },
      endpoints: [{ addresses: ['10.0.0.1'], conditions: { ready: false } }],
    };
    const ing: ResourceLike = {
      kind: 'Ingress',
      metadata: { name: 'web-ing', namespace: 'shop' },
      spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'web-svc' } } }] } }] },
      status: { loadBalancer: { ingress: [{ hostname: 'lb.example.com' }] } },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), svc, slice, ing]);
    expect(h.status).toBe('degraded');
    expect(h.criticalServiceProblems).toHaveLength(1);
    expect(h.criticalServiceProblems[0].name).toBe('web-svc');
  });

  it('does not flag a headless (no-selector) Service or ExternalName', () => {
    const headless: ResourceLike = {
      kind: 'Service',
      metadata: { name: 'headless', namespace: 'shop' },
      spec: {},
    };
    const external: ResourceLike = {
      kind: 'Service',
      metadata: { name: 'ext', namespace: 'shop' },
      spec: { type: 'ExternalName', externalName: 'foo.example.com' },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), headless, external]);
    expect(h.serviceProblems).toHaveLength(0);
  });

  it('surfaces an Ingress with a missing backend service as degraded', () => {
    const ing: ResourceLike = {
      kind: 'Ingress',
      metadata: { name: 'web-ing', namespace: 'shop' },
      spec: {
        rules: [
          {
            http: {
              paths: [{ backend: { service: { name: 'nonexistent', port: { number: 80 } } } }],
            },
          },
        ],
      },
      status: { loadBalancer: { ingress: [{ hostname: 'lb.example.com' }] } },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), ing]);
    expect(h.status).toBe('degraded');
    expect(h.ingressProblems[0].state).toBe('missingBackend');
    expect(h.ingressProblems[0].reason).toMatch(/nonexistent/);
  });

  it('surfaces an Ingress without a load-balancer address informationally', () => {
    const svc: ResourceLike = {
      kind: 'Service',
      metadata: { name: 'web-svc', namespace: 'shop' },
      spec: { selector: { app: 'web' } },
    };
    const slice: ResourceLike = {
      kind: 'EndpointSlice',
      metadata: {
        name: 'web-svc-abc',
        namespace: 'shop',
        labels: { 'kubernetes.io/service-name': 'web-svc' },
      },
      endpoints: [{ addresses: ['10.0.0.1'], conditions: { ready: true } }],
    };
    const ing: ResourceLike = {
      kind: 'Ingress',
      metadata: { name: 'web-ing', namespace: 'shop' },
      spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'web-svc' } } }] } }] },
      status: {},
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), svc, slice, ing]);
    expect(h.status).toBe('healthy');
    expect(h.ingressProblems[0].state).toBe('noAddress');
  });

  it('surfaces a blocked PDB informationally (chip stays healthy)', () => {
    const pdb: ResourceLike = {
      kind: 'PodDisruptionBudget',
      metadata: { name: 'web-pdb', namespace: 'shop' },
      status: { disruptionsAllowed: 0, currentHealthy: 1, desiredHealthy: 1 },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), pdb]);
    expect(h.status).toBe('healthy');
    expect(h.pdbProblems).toHaveLength(1);
    expect(h.pdbProblems[0].reason).toMatch(/disruptionsAllowed=0/);
  });

  it('ignores a PDB whose selector matches nothing (0/0 healthy is stale, not blocked)', () => {
    const stale: ResourceLike = {
      kind: 'PodDisruptionBudget',
      metadata: { name: 'orphan-pdb', namespace: 'shop' },
      status: { disruptionsAllowed: 0, currentHealthy: 0, desiredHealthy: 0 },
    };
    const h = evaluateApplicationHealth([deploy('web', 1, 1), stale]);
    expect(h.pdbProblems).toHaveLength(0);
  });

  it('annotates a workload with the HPA that targets it', () => {
    const hpa: ResourceLike = {
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: 'web-hpa', namespace: 'shop' },
      spec: {
        scaleTargetRef: { kind: 'Deployment', name: 'web' },
        minReplicas: 2,
        maxReplicas: 10,
      },
      status: { currentReplicas: 5 },
    };
    const h = evaluateApplicationHealth([deploy('web', 5, 5), hpa]);
    expect(h.workloads[0].hpa).toEqual({ name: 'web-hpa', min: 2, max: 10, current: 5 });
  });

  it('escalates a CronJob that has never scheduled AND is older than 24h to chronic', () => {
    const cron: ResourceLike = {
      kind: 'CronJob',
      metadata: {
        name: 'nightly',
        namespace: 'shop',
        creationTimestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      spec: { schedule: '0 3 * * *' },
      status: {},
    };
    const h = evaluateApplicationHealth([cron, deploy('web', 1, 1)]);
    expect(h.schedules[0].state).toBe('never');
    expect(h.schedules[0].chronic).toBe(true);
    expect(h.status).toBe('degraded');
  });

  it('does not escalate a just-created never-scheduled CronJob', () => {
    const cron: ResourceLike = {
      kind: 'CronJob',
      metadata: {
        name: 'brand-new',
        namespace: 'shop',
        creationTimestamp: new Date(Date.now() - 60 * 1000).toISOString(),
      },
      spec: { schedule: '0 3 * * *' },
      status: {},
    };
    const h = evaluateApplicationHealth([cron, deploy('web', 1, 1)]);
    expect(h.schedules[0].state).toBe('never');
    expect(h.schedules[0].chronic).toBeFalsy();
    expect(h.status).toBe('healthy');
  });

  it('reports resourceCountsByKind for tooltip breakdown', () => {
    const h = evaluateApplicationHealth([
      deploy('web', 1, 1),
      deploy('api', 1, 1),
      configMap('c1'),
      configMap('c2'),
      configMap('c3'),
    ]);
    expect(h.resourceCountsByKind).toEqual({ Deployment: 2, ConfigMap: 3 });
  });
});

describe('healthSortRank', () => {
  it('is -1 while loading and orders worst-first otherwise', () => {
    expect(healthSortRank(undefined, true)).toBe(-1);
    const unhealthy = evaluateApplicationHealth([deploy('a', 1, 0)]);
    const healthy = evaluateApplicationHealth([deploy('a', 1, 1)]);
    expect(healthSortRank(unhealthy, false)).toBeLessThan(healthSortRank(healthy, false));
  });
});
