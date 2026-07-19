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
});

describe('healthSortRank', () => {
  it('is -1 while loading and orders worst-first otherwise', () => {
    expect(healthSortRank(undefined, true)).toBe(-1);
    const unhealthy = evaluateApplicationHealth([deploy('a', 1, 0)]);
    const healthy = evaluateApplicationHealth([deploy('a', 1, 1)]);
    expect(healthSortRank(unhealthy, false)).toBeLessThan(healthSortRank(healthy, false));
  });
});
