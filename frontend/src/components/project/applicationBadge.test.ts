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

/* eslint-disable @typescript-eslint/no-explicit-any */
// Frozen page-level Applications-List badge logic: getApplicationBadge (Checking /
// Unavailable / Unknown(controller-less) / Partial), countApplicationResources, and
// EndpointSlice reachability. Pure logic — no network, no React.

import { describe, expect, it } from 'vitest';
import {
  countApplicationResources,
  getApplicationBadge,
  LiveObservation,
  localGetItemStatus,
} from './localHealth';

const OK: LiveObservation = {
  loading: false,
  allLiveFailed: false,
  someLiveFailed: false,
  failed: [],
  truncatedKinds: [],
  cluster: 'c1',
};

const healthyDeploy = (name = 'web', ns = 'app') => ({
  kind: 'Deployment',
  cluster: 'c1',
  metadata: { name, namespace: ns, generation: 1 },
  spec: { replicas: 3, selector: { matchLabels: { app: name } } },
  status: {
    observedGeneration: 1,
    replicas: 3,
    readyReplicas: 3,
    updatedReplicas: 3,
    availableReplicas: 3,
    conditions: [
      { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable' },
      { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' },
    ],
  },
});

const service = (name = 'web', ns = 'app') => ({
  kind: 'Service',
  cluster: 'c1',
  metadata: { name, namespace: ns },
  spec: { selector: { app: name }, clusterIP: '10.0.0.1', type: 'ClusterIP' },
});

describe('getApplicationBadge — frozen state model', () => {
  it('loading → Checking (never No Resources)', () => {
    const h = getApplicationBadge([], { ...OK, loading: true });
    expect(h.status).toBe('checking');
    expect(h.label).toBe('Checking');
  });

  it('all live kinds failed → Unavailable with the first failure code', () => {
    const h = getApplicationBadge([], {
      ...OK,
      allLiveFailed: true,
      failed: [{ kind: 'Deployment', status: 403, message: 'Forbidden' }],
    });
    expect(h.status).toBe('unavailable');
    expect((h as any).httpCode).toBe(403);
  });

  it('healthy app with a controller → Healthy', () => {
    const h = getApplicationBadge([healthyDeploy()] as any, OK);
    expect(h.status).toBe('success');
    expect(h.label).toBe('Healthy');
    expect(h.partial).toBeFalsy();
  });

  it('controller-less live set → Unknown (never Healthy / No Workloads / No Resources)', () => {
    // Only a Service observed → no workload controller → bare Pods may exist.
    const h = getApplicationBadge([service()] as any, OK);
    expect(h.status).toBe('unknown');
    expect(h.label).toBe('Unknown');
  });

  it('empty live set → Unknown (not No Resources)', () => {
    const h = getApplicationBadge([], OK);
    expect(h.label).toBe('Unknown');
    expect(h.label).not.toBe('No Resources');
  });

  it('one live kind failed but others healthy → Partial, never Healthy', () => {
    const h = getApplicationBadge([healthyDeploy()] as any, {
      ...OK,
      someLiveFailed: true,
      failed: [{ kind: 'Service', status: 403 }],
    });
    expect(h.label).toBe('Partial');
    expect(h.partial).toBe(true);
    expect(h.status).not.toBe('success');
  });

  it('truncated live kind but healthy → Partial, never Healthy', () => {
    const h = getApplicationBadge([healthyDeploy()] as any, {
      ...OK,
      someLiveFailed: true,
      truncatedKinds: ['Service'],
    });
    expect(h.partial).toBe(true);
    expect(h.status).not.toBe('success');
  });

  it('a real problem keeps its severity and only gains the Partial qualifier', () => {
    const degraded = {
      ...healthyDeploy(),
      status: { ...healthyDeploy().status, readyReplicas: 1 },
    };
    const h = getApplicationBadge([degraded] as any, { ...OK, someLiveFailed: true });
    expect(h.status).toBe('warning'); // Degraded
    expect(h.partial).toBe(true);
  });

  it('Unavailable outranks Unhealthy outranks Degraded in sort rank', () => {
    const unavail = getApplicationBadge([], {
      ...OK,
      allLiveFailed: true,
      failed: [{ kind: 'x' }],
    });
    const degraded = {
      ...healthyDeploy(),
      status: { ...healthyDeploy().status, readyReplicas: 1 },
    };
    const deg = getApplicationBadge([degraded] as any, OK);
    const healthy = getApplicationBadge([healthyDeploy()] as any, OK);
    expect(unavail.rank).toBeGreaterThan(deg.rank);
    expect(deg.rank).toBeGreaterThan(healthy.rank);
  });
});

describe('countApplicationResources — frozen count semantics', () => {
  it('counts author kinds, excludes Pods / owned ReplicaSets / endpoint plumbing', () => {
    const items = [
      healthyDeploy('web'),
      service('web'),
      {
        kind: 'PersistentVolumeClaim',
        cluster: 'c1',
        metadata: { name: 'data', namespace: 'app' },
      },
      // excluded:
      { kind: 'Pod', cluster: 'c1', metadata: { name: 'web-1', namespace: 'app' } },
      {
        kind: 'ReplicaSet',
        cluster: 'c1',
        metadata: {
          name: 'web-abc',
          namespace: 'app',
          ownerReferences: [{ kind: 'Deployment', name: 'web' }],
        },
      },
      { kind: 'EndpointSlice', cluster: 'c1', metadata: { name: 'web-xyz', namespace: 'app' } },
    ];
    // Deployment + Service + PVC = 3 (Pod, owned RS, EndpointSlice excluded)
    expect(countApplicationResources(items as any)).toBe(3);
  });

  it('empty → 0', () => {
    expect(countApplicationResources([])).toBe(0);
    expect(countApplicationResources(undefined)).toBe(0);
  });
});

describe('localGetItemStatus — EndpointSlice reachability (Service-level)', () => {
  const deployTargeting = {
    kind: 'Deployment',
    cluster: 'c1',
    metadata: { name: 'web', namespace: 'app', generation: 1 },
    spec: { replicas: 1, template: { metadata: { labels: { app: 'web' } } } },
    status: { observedGeneration: 1, replicas: 1, readyReplicas: 1, updatedReplicas: 1 },
  };
  const svc = service('web');
  const slice = (ready: boolean) => ({
    kind: 'EndpointSlice',
    cluster: 'c1',
    metadata: {
      name: 'web-xyz',
      namespace: 'app',
      labels: { 'kubernetes.io/service-name': 'web' },
    },
    endpoints: [{ addresses: ['10.1.1.1'], conditions: { ready } }],
  });

  it('warns when a targeted Service has EndpointSlices with no ready endpoints', () => {
    const v = localGetItemStatus(svc as any, [svc, slice(false), deployTargeting] as any);
    expect(v.severity).toBe('warning');
    expect(v.message).toMatch(/no ready endpoints/i);
  });

  it('success when the Service has a ready endpoint', () => {
    const v = localGetItemStatus(svc as any, [svc, slice(true), deployTargeting] as any);
    expect(v.severity).toBe('success');
  });

  it('success when no EndpointSlices exist (defers to Endpoints v1 fallback)', () => {
    const v = localGetItemStatus(svc as any, [svc, deployTargeting] as any);
    expect(v.severity).toBe('success');
  });

  it('an EndpointSlice is never scored on its own', () => {
    expect(localGetItemStatus(slice(false) as any, [slice(false)] as any)).toEqual({
      severity: 'success',
    });
  });
});
