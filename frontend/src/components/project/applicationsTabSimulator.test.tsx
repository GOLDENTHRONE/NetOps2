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

// ===========================================================================
// APPLICATIONS TAB — FAKE HEADLAMP SIMULATOR (generic data only)
// ---------------------------------------------------------------------------
// This file does NOT re-implement any logic. It drives the REAL branch code:
//   - discoverProjectsFromNamespaces / projectDetailsParams / useProject
//       from ./ProjectList            (the commit under review)
//   - getLocalHealth / getUnavailableHealth
//       from ./localHealth            (the per-row health calculator)
//   - isSystemNamespace               from ./projectUtils
// against two generic, fabricated clusters (one OCP-style, one vanilla k8s).
// No real cluster names, namespaces, tokens or hosts appear anywhere.
//
// It (a) prints the whole Applications tab to the console, (b) asserts the
// behaviour the commit intends, and (c) writes the computed rows to
// applicationsTabSimulator.output.json so a visual HTML simulator can render
// exactly what the real code produced.
// ===========================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { renderHook } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import App from '../../App';
import Namespace from '../../lib/k8s/namespace';
import { TestContext } from '../../test';
import { getLocalHealth, getUnavailableHealth, LocalHealthResult } from './localHealth';
import {
  discoverProjectsFromNamespaces,
  filterProjectsByNamespaces,
  projectDetailsParams,
  useProject,
} from './ProjectList';
import { isSystemNamespace } from './projectUtils';

// cyclic imports fix (same workaround ProjectList.test.tsx uses): importing App
// first breaks the lib/k8s/index circular-init that otherwise makes KubeObject
// subclasses extend `undefined`.
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

// ─────────────────────────────────────────────────────────────────────────
// 0. Two generic fake clusters. OCP_CLUSTER simulates an OpenShift cluster,
//    K8S_CLUSTER a vanilla Kubernetes cluster. Names are placeholders only.
// ─────────────────────────────────────────────────────────────────────────
const OCP_CLUSTER = 'ocp-cluster-a';
const K8S_CLUSTER = 'k8s-cluster-b';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const OLD = iso(60 * 60_000);

// ── Generic KubeObject-shaped builders (INPUT data only; shapes copied from
//    the project's own __fixtures__/healthScenarios.ts). namespace is a param
//    so each row's evidence reports the right namespace. ──────────────────
const svc = (name: string, ns: string): any => ({
  kind: 'Service',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  spec: { type: 'ClusterIP', selector: { app: name } },
});
const cm = (name: string, ns: string): any => ({
  kind: 'ConfigMap',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
});
const secret = (name: string, ns: string): any => ({
  kind: 'Secret',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
});
const endpoints = (name: string, ns: string, addressCount: number): any => ({
  kind: 'Endpoints',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  subsets:
    addressCount > 0
      ? [
          {
            addresses: Array.from({ length: addressCount }, (_v, i) => ({ ip: `10.0.0.${i + 1}` })),
          },
        ]
      : [],
});
const deployment = (name: string, ns: string, desired: number, ready: number): any => ({
  kind: 'Deployment',
  metadata: { name, namespace: ns, creationTimestamp: OLD, generation: 1 },
  spec: { replicas: desired },
  status: { observedGeneration: 1, replicas: Math.max(ready, 0), readyReplicas: ready },
});
const statefulSet = (name: string, ns: string, desired: number, ready: number): any => ({
  kind: 'StatefulSet',
  metadata: { name, namespace: ns, creationTimestamp: OLD, generation: 1 },
  spec: { replicas: desired },
  status: { observedGeneration: 1, replicas: desired, readyReplicas: ready },
});
const podReady = (name: string, ns: string): any => ({
  kind: 'Pod',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  status: {
    phase: 'Running',
    conditions: [{ type: 'Ready', status: 'True' }],
    containerStatuses: [{ name: 'main', state: { running: {} } }],
  },
});
const podCrashLoop = (name: string, ns: string): any => ({
  kind: 'Pod',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  status: {
    phase: 'Running',
    conditions: [{ type: 'Ready', status: 'False' }],
    containerStatuses: [
      { name: 'main', state: { waiting: { reason: 'CrashLoopBackOff' } }, restartCount: 7 },
    ],
  },
});
const podRunningNotReady = (name: string, ns: string): any => ({
  kind: 'Pod',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  status: {
    phase: 'Running',
    conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
    containerStatuses: [{ name: 'main', state: { running: {} } }],
  },
});
const podPending = (name: string, ns: string): any => ({
  kind: 'Pod',
  metadata: { name, namespace: ns, creationTimestamp: OLD },
  status: {
    phase: 'Pending',
    conditions: [{ type: 'Ready', status: 'False' }],
    containerStatuses: [{ name: 'main', state: { waiting: { reason: 'ContainerCreating' } } }],
  },
});
// A failed Helm test-hook Job + its Job-owned Pod. Both are NON_HEALTH_BEARING
// / Job-owned, so they must appear under "Needs Attention" and NEVER change the
// row badge — this proves the Job/Helm-hook carve-out still works per row.
const helmHookJobFailed = (name: string, ns: string): any => ({
  kind: 'Job',
  metadata: { name, namespace: ns, creationTimestamp: OLD, uid: `${name}-uid` },
  spec: { backoffLimit: 0 },
  status: { failed: 1, succeeded: 0, conditions: [{ type: 'Failed', status: 'True' }] },
});
const helmHookPodFailed = (name: string, ns: string, jobUid: string): any => ({
  kind: 'Pod',
  metadata: {
    name,
    namespace: ns,
    creationTimestamp: OLD,
    ownerReferences: [{ kind: 'Job', uid: jobUid }],
  },
  status: { phase: 'Failed', reason: 'BackoffLimitExceeded' },
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Namespaces the token can see across BOTH clusters (the raw list that
//    Namespace.useList returns). Includes system namespaces to prove they
//    are filtered out, an empty app namespace, and — crucially — the SAME
//    app namespace name ("payments") in both clusters.
// ─────────────────────────────────────────────────────────────────────────
const ns = (name: string, cluster: string) => ({ metadata: { name }, cluster });

const rawNamespaces = [
  // system / infrastructure — expected to be dropped
  ns('default', OCP_CLUSTER),
  ns('kube-system', OCP_CLUSTER),
  ns('openshift', OCP_CLUSTER),
  ns('openshift-monitoring', OCP_CLUSTER), // matched by the "openshift-" prefix
  ns('kube-system', K8S_CLUSTER),
  ns('cert-manager', K8S_CLUSTER),
  // real applications
  ns('payments', OCP_CLUSTER), // same name …
  ns('payments', K8S_CLUSTER), // … in two clusters → TWO independent rows
  ns('billing', OCP_CLUSTER),
  ns('checkout', OCP_CLUSTER),
  ns('inventory', OCP_CLUSTER),
  ns('sandbox', OCP_CLUSTER),
  ns('web-frontend', K8S_CLUSTER),
  ns('analytics', K8S_CLUSTER),
];

// ─────────────────────────────────────────────────────────────────────────
// 2. The resources that live in each (cluster, namespace). Keyed by the row
//    id the real discovery produces: `${cluster}/${namespace}`.
//    `analytics` has NO entry here — it simulates an unreachable cluster
//    (fetch error), handled separately below.
// ─────────────────────────────────────────────────────────────────────────
const resourcesByRow: Record<string, any[]> = {
  [`${OCP_CLUSTER}/payments`]: [
    deployment('payments-api', 'payments', 3, 3),
    podReady('payments-api-1', 'payments'),
    podReady('payments-api-2', 'payments'),
    podReady('payments-api-3', 'payments'),
    svc('payments-api', 'payments'),
    endpoints('payments-api', 'payments', 3),
    // failed Helm hook → Needs Attention only, badge stays Healthy
    helmHookJobFailed('payments-db-migrate-hook', 'payments'),
    helmHookPodFailed('payments-db-migrate-hook-abcde', 'payments', 'payments-db-migrate-hook-uid'),
  ],
  [`${K8S_CLUSTER}/payments`]: [
    deployment('payments-api', 'payments', 3, 2),
    podReady('payments-api-1', 'payments'),
    podReady('payments-api-2', 'payments'),
    podCrashLoop('payments-api-3', 'payments'),
    svc('payments-api', 'payments'),
  ],
  [`${OCP_CLUSTER}/billing`]: [
    deployment('billing-web', 'billing', 1, 1),
    podRunningNotReady('billing-web-1', 'billing'),
    svc('billing-web', 'billing'),
  ],
  [`${OCP_CLUSTER}/checkout`]: [
    // a rollout in progress: the deployment is up, one new pod still Pending
    deployment('checkout', 'checkout', 1, 1),
    podReady('checkout-0', 'checkout'),
    podPending('checkout-1', 'checkout'),
    svc('checkout', 'checkout'),
  ],
  [`${OCP_CLUSTER}/inventory`]: [
    cm('inventory-config', 'inventory'),
    secret('inventory-creds', 'inventory'),
    svc('inventory', 'inventory'),
  ],
  [`${OCP_CLUSTER}/sandbox`]: [], // discovered, but empty → "No Resources"
  [`${K8S_CLUSTER}/web-frontend`]: [
    statefulSet('web', 'web-frontend', 2, 2),
    podReady('web-0', 'web-frontend'),
    podReady('web-1', 'web-frontend'),
    svc('web', 'web-frontend'),
    endpoints('web', 'web-frontend', 2),
  ],
};

// Rows that simulate an unreachable cluster (LocalHealthCell → getUnavailableHealth).
const unreachableRows: Record<string, { httpCode: number; errorMessage: string }> = {
  [`${K8S_CLUSTER}/analytics`]: {
    httpCode: 503,
    errorMessage: 'dial tcp: connect: connection refused',
  },
};

// How the REAL LocalHealthCell decides health for one row: fetch error →
// getUnavailableHealth, else getLocalHealth(items). Mirrored here (same two
// calls, same order) so each row's verdict comes from the real calculator.
function rowHealth(rowId: string, cluster: string): LocalHealthResult {
  const err = unreachableRows[rowId];
  if (err) {
    return getUnavailableHealth({
      cluster,
      httpCode: err.httpCode,
      errorMessage: err.errorMessage,
    });
  }
  return getLocalHealth(resourcesByRow[rowId] ?? []);
}

describe('Applications tab simulator (real code, generic data)', () => {
  it('renders the full Applications tab and proves per-(cluster,namespace) rows', () => {
    // ---- run the REAL discovery ----
    const projects = discoverProjectsFromNamespaces(rawNamespaces);

    // Build the table the way ProjectList columns do: Name = namespaces[0],
    // Cluster = clusters[0], Namespaces = namespaces.join(', ').
    const rows = projects.map(p => {
      const params = projectDetailsParams(p); // REAL helper → { cluster, name }
      const h = rowHealth(p.id, p.clusters[0]);
      return {
        id: p.id,
        name: p.namespaces[0] ?? '',
        cluster: p.clusters[0] ?? '',
        namespaces: p.namespaces.join(', '),
        url: `/project/${params.cluster}/${params.name}`,
        status: h.label,
        badge: h.status,
        rank: h.rank,
        resourceCount: (resourcesByRow[p.id] ?? []).length,
        reasons: h.reasons,
        evidence: (h.evidence ?? []).map(e => ({
          severity: e.severity,
          ref: `${e.kind}/${e.namespace}/${e.name}`,
          message: e.message,
        })),
        needsAttention: (h.needsAttention ?? []).map(e => ({
          severity: e.severity,
          ref: `${e.kind}/${e.namespace}/${e.name}`,
          message: e.message,
        })),
        unavailable: (h as any).httpCode
          ? { httpCode: (h as any).httpCode, errorMessage: (h as any).errorMessage }
          : undefined,
      };
    });

    // ---- print the whole tab ----
    /* eslint-disable no-console */
    console.log('\n================ APPLICATIONS TAB (simulated, real code) ================');
    console.log(
      'NAME'.padEnd(16) + 'STATUS'.padEnd(14) + 'CLUSTER'.padEnd(16) + 'RES'.padEnd(5) + 'URL'
    );
    console.log('-'.repeat(88));
    for (const r of rows) {
      console.log(
        r.name.padEnd(16) +
          r.status.padEnd(14) +
          r.cluster.padEnd(16) +
          String(r.resourceCount).padEnd(5) +
          r.url
      );
      for (const e of r.evidence) console.log(`      ↳ issue: ${e.ref} — ${e.message}`);
      for (const n of r.needsAttention)
        console.log(`      ⚠ needs-attention: ${n.ref} — ${n.message}`);
      if (r.unavailable)
        console.log(
          `      ✖ unreachable: HTTP ${r.unavailable.httpCode} — ${r.unavailable.errorMessage}`
        );
    }
    console.log('========================================================================\n');
    /* eslint-enable no-console */

    // ---- write JSON for the visual HTML simulator ----
    const outPath = path.join(__dirname, 'applicationsTabSimulator.output.json');
    fs.writeFileSync(
      outPath,
      JSON.stringify({ clusters: [OCP_CLUSTER, K8S_CLUSTER], rows }, null, 2)
    );

    // =====================================================================
    // ASSERTIONS — the behaviour the commit intends
    // =====================================================================

    // (1) System / infrastructure namespaces are excluded on every cluster.
    expect(isSystemNamespace('kube-system')).toBe(true);
    expect(isSystemNamespace('openshift-monitoring')).toBe(true);
    expect(rows.some(r => r.name === 'kube-system')).toBe(false);
    expect(rows.some(r => r.name === 'openshift-monitoring')).toBe(false);
    expect(rows.some(r => r.name === 'default')).toBe(false);
    expect(rows.some(r => r.name === 'cert-manager')).toBe(false);

    // (2) Every row is exactly one cluster and one namespace (the core change).
    projects.forEach(p => {
      expect(p.clusters).toHaveLength(1);
      expect(p.namespaces).toHaveLength(1);
      expect(p.id).toBe(`${p.clusters[0]}/${p.namespaces[0]}`);
    });

    // (3) The same namespace name in two clusters → TWO independent rows with
    //     DIFFERENT health. (Before the commit this collapsed into one row.)
    const ocpPay = rows.find(r => r.id === `${OCP_CLUSTER}/payments`)!;
    const k8sPay = rows.find(r => r.id === `${K8S_CLUSTER}/payments`)!;
    expect(ocpPay).toBeTruthy();
    expect(k8sPay).toBeTruthy();
    expect(ocpPay.status).toBe('Healthy');
    expect(k8sPay.status).toBe('Unhealthy');
    expect(ocpPay.url).toBe(`/project/${OCP_CLUSTER}/payments`);
    expect(k8sPay.url).toBe(`/project/${K8S_CLUSTER}/payments`);
    // the failing resource in k8s names its cluster's namespace, attributable
    expect(k8sPay.evidence.some(e => e.message === 'CrashLoopBackOff')).toBe(true);

    // (3b) The Helm-hook failure on the HEALTHY ocp row is Needs-Attention only.
    expect(ocpPay.needsAttention.length).toBeGreaterThan(0);
    expect(ocpPay.status).toBe('Healthy');

    // (4) PROOF of the masking the commit removes: if you POOL both clusters'
    //     payments resources (the OLD grouped behaviour) and run the SAME real
    //     calculator, you get a single Unhealthy verdict with no way to tell
    //     ocp-cluster-a (healthy) from k8s-cluster-b (crashing).
    const pooledOld = getLocalHealth([
      ...resourcesByRow[`${OCP_CLUSTER}/payments`],
      ...resourcesByRow[`${K8S_CLUSTER}/payments`],
    ]);
    expect(pooledOld.label).toBe('Unhealthy'); // healthy cluster masked away

    // (5) All the distinct health states are reachable, one row each.
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(byId[`${OCP_CLUSTER}/billing`].status).toBe('Degraded');
    expect(byId[`${OCP_CLUSTER}/checkout`].status).toBe('Progressing');
    expect(byId[`${OCP_CLUSTER}/inventory`].status).toBe('No Workloads');
    expect(byId[`${OCP_CLUSTER}/sandbox`].status).toBe('No Resources');
    expect(byId[`${K8S_CLUSTER}/web-frontend`].status).toBe('Healthy');

    // (6) Unreachable cluster is isolated to its own row only.
    const analytics = byId[`${K8S_CLUSTER}/analytics`];
    expect(analytics.status).toBe('Unavailable');
    expect(analytics.unavailable?.httpCode).toBe(503);
    // sibling rows on the SAME k8s cluster keep their real health
    expect(byId[`${K8S_CLUSTER}/web-frontend`].status).toBe('Healthy');
    expect(byId[`${K8S_CLUSTER}/payments`].status).toBe('Unhealthy');

    // (7) Namespace filter returns BOTH cluster instances of a shared namespace.
    const filtered = filterProjectsByNamespaces(projects, ['payments']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(p => p.clusters[0]).sort()).toEqual([OCP_CLUSTER, K8S_CLUSTER].sort());
  });

  it('route params round-trip through the REAL useProject hook to exactly one instance', () => {
    // Same namespace name in two clusters, including a cluster name with a dot.
    vi.spyOn(Namespace, 'useList').mockReturnValue({
      items: [
        { metadata: { name: 'payments' }, cluster: 'ocp.cluster.one' },
        { metadata: { name: 'payments' }, cluster: 'k8s.cluster.two' },
      ],
      isLoading: false,
    } as any);

    const one = renderHook(() => useProject('ocp.cluster.one', 'payments'), {
      wrapper: ({ children }) => <TestContext>{children}</TestContext>,
    });
    expect(one.result.current.project).toEqual({
      id: 'ocp.cluster.one/payments',
      clusters: ['ocp.cluster.one'],
      namespaces: ['payments'],
    });

    const two = renderHook(() => useProject('k8s.cluster.two', 'payments'), {
      wrapper: ({ children }) => <TestContext>{children}</TestContext>,
    });
    expect(two.result.current.project).toEqual({
      id: 'k8s.cluster.two/payments',
      clusters: ['k8s.cluster.two'],
      namespaces: ['payments'],
    });

    // the two resolve to DIFFERENT instances — no collision despite same name
    expect(one.result.current.project!.id).not.toBe(two.result.current.project!.id);
    vi.restoreAllMocks();
  });
});
