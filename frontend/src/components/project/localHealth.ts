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

// Local, fork-only health calculator for the Applications tab "Status" column.
// See p17.txt on branch GT_D_V1 for the full contract. This file is pure
// logic: no React, no I/O. Called by useLocalHealthItems / LocalHealthCell.

import { countBy } from 'lodash';
import { KubeObject } from '../../lib/k8s/cluster';
import { getReadyReplicas, getTotalReplicas } from '../../lib/util';

export type LocalHealthSeverity = 'success' | 'warning' | 'error';
export type LocalHealthBadge =
  | LocalHealthSeverity
  | 'empty' // no resources at all
  | 'passive' // resources present but no runnable workload (dormant app)
  | 'unavailable'; // couldn't reach the cluster to know the truth

export interface LocalHealthEvidence {
  severity: 'error' | 'warning';
  kind: string;
  namespace: string;
  name: string;
  message: string;
  /** The KubeObject itself, kept so the popover row can render a real
   *  Link to the resource's details page. */
  object?: KubeObject;
}

/** Per-kind stats shown in the popover so the user can see the "why"
 *  behind Healthy / Degraded / Unhealthy at a glance. */
export interface LocalHealthStat {
  kind: string;
  /** Total number of objects of this kind in the app. */
  total: number;
  /** Human-readable state summary, e.g. "3/3 Ready", "2 Succeeded, 1 Failed". */
  state: string;
  /** Optional traffic-light tint for the stat row. */
  tone: 'success' | 'warning' | 'error' | 'neutral';
}

export interface LocalHealthResult {
  status: LocalHealthBadge;
  label: 'Healthy' | 'Degraded' | 'Unhealthy' | 'No Resources' | 'No Workloads' | 'Unavailable';
  /** 0 = empty/passive, 1 = healthy, 2 = degraded, 3 = unhealthy, 4 = unavailable */
  rank: 0 | 1 | 2 | 3 | 4;
  icon: string;
  reasons: string[];
  evidence: LocalHealthEvidence[];
  /** Breakdown of the observed resource inventory, per kind, in a fixed
   *  reading order. Empty when the badge is 'unavailable' or 'empty'. */
  stats: LocalHealthStat[];
}

const REASON_CAP = 10;
const POD_WAIT_ERROR_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'InvalidImageName',
]);

const WORKLOAD_KINDS = new Set([
  'Pod',
  'Deployment',
  'ReplicaSet',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob',
]);

interface ItemVerdict {
  severity: LocalHealthSeverity;
  message?: string;
}

function ageMs(ts?: string): number {
  return ts ? Date.now() - new Date(ts).getTime() : 0;
}

function get(o: KubeObject, path: string): any {
  return path.split('.').reduce<any>((v, k) => (v == null ? v : v[k]), o as any);
}

/**
 * Look up the Service that shares the same namespace + name + cluster as an
 * Endpoints object. Endpoints objects are always paired 1:1 with a Service of
 * the same name (Kubernetes convention).
 */
function findPairedService(endpoints: KubeObject, items: KubeObject[]): KubeObject | undefined {
  const em = (endpoints as any).metadata ?? {};
  const cluster = (endpoints as any).cluster;
  return items.find(o => {
    if (o.kind !== 'Service') return false;
    const m = (o as any).metadata ?? {};
    return m.name === em.name && m.namespace === em.namespace && (o as any).cluster === cluster;
  });
}

/**
 * Do any of the fetched workloads in the same namespace target this Service's
 * selector? Used to distinguish a service that's actually meant to serve
 * traffic (has a workload behind it) from an orphan/dormant one.
 *
 * "Target" means: the workload's pod-template labels include every key/value
 * pair of the Service selector — the same rule the endpoints controller uses.
 */
function workloadTargetsService(service: KubeObject, items: KubeObject[]): boolean {
  const selector = get(service, 'spec.selector') as Record<string, string> | undefined;
  if (!selector || Object.keys(selector).length === 0) return false;

  // Well-known StatefulSet per-pod service pattern: the selector pins the
  // service to one specific pod name. These services legitimately have zero
  // endpoints whenever that specific pod isn't running (rolling update,
  // ordinal scaled away, etc.). Not our problem.
  if (selector['statefulset.kubernetes.io/pod-name']) return false;

  const svcNs = get(service, 'metadata.namespace');
  const svcCluster = (service as any).cluster;
  const entries = Object.entries(selector);

  for (const w of items) {
    if (!['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(w.kind)) continue;
    if (get(w, 'metadata.namespace') !== svcNs) continue;
    if ((w as any).cluster !== svcCluster) continue;
    const tmplLabels = (get(w, 'spec.template.metadata.labels') ??
      get(w, 'spec.selector.matchLabels') ??
      {}) as Record<string, string>;
    const matches = entries.every(([k, v]) => tmplLabels[k] === v);
    if (matches) return true;
  }
  // Also consider live Pods in the same namespace as targeting the service.
  for (const p of items) {
    if (p.kind !== 'Pod') continue;
    if (get(p, 'metadata.namespace') !== svcNs) continue;
    if ((p as any).cluster !== svcCluster) continue;
    const podLabels = (get(p, 'metadata.labels') ?? {}) as Record<string, string>;
    const matches = entries.every(([k, v]) => podLabels[k] === v);
    if (matches) return true;
  }
  return false;
}

function localGetItemStatus(o: KubeObject, allItems: KubeObject[]): ItemVerdict {
  const kind = o.kind;
  const meta = (o as any).metadata ?? {};
  const anyObj = o as any;

  if (kind === 'Pod') {
    const status = anyObj.status ?? {};
    const phase: string | undefined = status.phase;
    const conds: any[] = status.conditions ?? [];
    const ready = conds.find(c => c.type === 'Ready')?.status === 'True';
    const cs: any[] = status.containerStatuses ?? [];
    const badContainer = cs.find(c => POD_WAIT_ERROR_REASONS.has(c?.state?.waiting?.reason));

    if (phase === 'Failed') return { severity: 'error', message: 'Failed' };
    if (badContainer) return { severity: 'error', message: badContainer.state.waiting.reason };
    if (phase === 'Running' && !ready)
      return { severity: 'error', message: 'Running but NotReady' };
    if (phase === 'Pending' && ageMs(meta.creationTimestamp) > 5 * 60_000)
      return { severity: 'error', message: 'Pending > 5m' };
    if (phase === 'Pending') return { severity: 'warning', message: 'Pending' };
    return { severity: 'success' };
  }

  // Deployment / ReplicaSet / StatefulSet — all three carry the classic
  // `spec.replicas` + `status.replicas` / `status.readyReplicas` shape.
  if (kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet') {
    const spec = anyObj.spec ?? {};
    const status = anyObj.status ?? {};
    const desiredExplicit: number | undefined = spec.replicas;
    const desired =
      typeof desiredExplicit === 'number' ? desiredExplicit : getTotalReplicas(anyObj);
    const ready = getReadyReplicas(anyObj) ?? 0;
    const statusReplicas: number = status.replicas ?? 0;

    if (desired === 0) return { severity: 'success' };
    if (statusReplicas === 0 && desired > 0)
      return { severity: 'error', message: `0/${desired} pods created` };
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };
    return { severity: 'success' };
  }

  // DaemonSet — completely different shape from Deployment/StatefulSet.
  // It has NO `spec.replicas` and NO `status.replicas`. Instead the Kubernetes
  // DaemonSetStatus schema (apps/v1) exposes:
  //   status.desiredNumberScheduled  – nodes the controller wants a pod on
  //   status.currentNumberScheduled  – nodes that actually got a pod scheduled
  //   status.numberReady             – how many of those pods are Ready
  //   status.numberMisscheduled      – pods sitting on nodes that no longer match
  // Ref: https://kubernetes.io/docs/reference/generated/kubernetes-api/v1/#daemonsetstatus-v1-apps
  //
  // Using status.replicas here (as the combined branch used to) is a bug:
  // for a perfectly healthy DaemonSet that field is undefined → 0, and the
  // "0/N pods created" branch would fire falsely. Kept out of the shared
  // branch above so this rule can evolve independently.
  if (kind === 'DaemonSet') {
    const status = anyObj.status ?? {};
    const desired: number = status.desiredNumberScheduled ?? 0;
    const scheduled: number = status.currentNumberScheduled ?? 0;
    const ready: number = status.numberReady ?? 0;
    const misscheduled: number = status.numberMisscheduled ?? 0;

    // nodeSelector / affinity / taints matched zero nodes — deliberate,
    // not a failure. (E.g. a DaemonSet gated to GPU nodes on a CPU cluster.)
    if (desired === 0) return { severity: 'success' };

    // Kubelet has pods sitting on nodes that no longer match. Mild signal —
    // controller will clean them up, but worth surfacing.
    if (misscheduled > 0) return { severity: 'warning', message: `${misscheduled} misscheduled` };

    // Nothing scheduled anywhere but the controller wants pods → real error
    // (image pull loop, priority preemption, scheduler stuck, etc.).
    if (scheduled === 0 && desired > 0)
      return { severity: 'error', message: `0/${desired} pods scheduled` };

    // Some nodes got a pod but not all are Ready.
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };

    return { severity: 'success' };
  }

  if (kind === 'Job') {
    const status = anyObj.status ?? {};
    const spec = anyObj.spec ?? {};
    const failed: number = status.failed ?? 0;
    const succeeded: number = status.succeeded ?? 0;
    const backoff = (spec.backoffLimit ?? 6) + 1;
    if (failed >= backoff && succeeded === 0)
      return { severity: 'error', message: `failed (${failed}/${backoff})` };
    return { severity: 'success' };
  }

  if (kind === 'CronJob') {
    const status = anyObj.status ?? {};
    const spec = anyObj.spec ?? {};
    const active: number = status.active?.length ?? 0;
    const cap = spec.concurrencyPolicy === 'Forbid' ? 1 : 5;
    if (active > cap) return { severity: 'warning', message: `${active} active runs` };
    return { severity: 'success' };
  }

  if (kind === 'PersistentVolumeClaim') {
    const phase = anyObj.status?.phase;
    if (phase === 'Lost') return { severity: 'error', message: 'Lost' };
    if (phase === 'Pending' && ageMs(meta.creationTimestamp) > 2 * 60_000)
      return { severity: 'error', message: 'Pending > 2m' };
    if (phase === 'Pending') return { severity: 'warning', message: 'Pending' };
    return { severity: 'success' };
  }

  if (kind === 'Endpoints') {
    // 1. If it already has addresses, we're done.
    const subsets: any[] = anyObj.subsets ?? [];
    const hasAddr = subsets.some(sub => (sub.addresses?.length ?? 0) > 0);
    if (subsets.length > 0 && hasAddr) return { severity: 'success' };

    // 2. Find the paired Service. If none, this is an orphan; not our problem.
    const svc = findPairedService(o, allItems);
    if (!svc) return { severity: 'success' };
    const svcSpec = (svc as any).spec ?? {};
    if (svcSpec.type === 'ExternalName') return { severity: 'success' };
    if (svcSpec.clusterIP === 'None') return { severity: 'success' }; // headless
    const selector = svcSpec.selector ?? {};
    if (Object.keys(selector).length === 0) return { severity: 'success' }; // manual endpoints
    // StatefulSet per-pod service — deliberately empty when the ordinal
    // is not running. Not a real "app broken" signal.
    if (selector['statefulset.kubernetes.io/pod-name']) return { severity: 'success' };
    // 3. Only warn if a workload actually targets this Service. Otherwise
    // the Service is an unused/dormant helper and complaining about its
    // empty endpoints would be noise.
    if (!workloadTargetsService(svc, allItems)) return { severity: 'success' };
    return {
      severity: 'warning',
      message: 'no ready pods behind this Service',
    };
  }

  if (kind === 'HorizontalPodAutoscaler') {
    const conds: any[] = anyObj.status?.conditions ?? [];
    const bad = conds.find(
      c => c.type === 'ScalingActive' && c.status === 'False' && c.reason !== 'ScalingDisabled'
    );
    if (bad) return { severity: 'warning', message: bad.reason || 'ScalingActive=False' };
    return { severity: 'success' };
  }

  if (kind === 'Ingress') {
    const lb: any[] = anyObj.status?.loadBalancer?.ingress ?? [];
    if (lb.length === 0 && ageMs(meta.creationTimestamp) > 5 * 60_000)
      return { severity: 'warning', message: 'no address' };
    return { severity: 'success' };
  }

  return { severity: 'success' };
}

// ─── Resource inventory / breakdown ─────────────────────────────────────
// Reading order for the popover stats section. Anything not listed here
// falls into the "Other" bucket at the end.
const STAT_ORDER: string[] = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Pod',
  'Job',
  'CronJob',
  'Service',
  'Ingress',
  'Endpoints',
  'PersistentVolumeClaim',
  'HorizontalPodAutoscaler',
  'ConfigMap',
  'Secret',
];

function sumWorkload(items: KubeObject[], kind: string): LocalHealthStat | undefined {
  const list = items.filter(i => i.kind === kind);
  if (list.length === 0) return undefined;
  let ready = 0;
  let desired = 0;
  for (const w of list) {
    const d = get(w, 'spec.replicas') ?? getTotalReplicas(w as any) ?? 0;
    const r = getReadyReplicas(w as any) ?? 0;
    desired += d;
    ready += r;
  }
  const tone: LocalHealthStat['tone'] =
    ready === desired ? 'success' : ready === 0 && desired > 0 ? 'error' : 'warning';
  return {
    kind,
    total: list.length,
    state: `${ready}/${desired} ready`,
    tone,
  };
}

function sumPods(items: KubeObject[]): LocalHealthStat | undefined {
  const pods = items.filter(p => p.kind === 'Pod');
  if (pods.length === 0) return undefined;
  const buckets = { running: 0, pending: 0, failed: 0, succeeded: 0, other: 0 };
  for (const p of pods) {
    const phase = get(p, 'status.phase');
    if (phase === 'Running') buckets.running++;
    else if (phase === 'Pending') buckets.pending++;
    else if (phase === 'Failed') buckets.failed++;
    else if (phase === 'Succeeded') buckets.succeeded++;
    else buckets.other++;
  }
  const parts: string[] = [];
  if (buckets.running) parts.push(`${buckets.running} Running`);
  if (buckets.pending) parts.push(`${buckets.pending} Pending`);
  if (buckets.failed) parts.push(`${buckets.failed} Failed`);
  if (buckets.succeeded) parts.push(`${buckets.succeeded} Succeeded`);
  if (buckets.other) parts.push(`${buckets.other} Other`);
  const tone: LocalHealthStat['tone'] =
    buckets.failed > 0 ? 'error' : buckets.pending > 0 ? 'warning' : 'success';
  return { kind: 'Pod', total: pods.length, state: parts.join(', '), tone };
}

function sumJobs(items: KubeObject[]): LocalHealthStat | undefined {
  const jobs = items.filter(j => j.kind === 'Job');
  if (jobs.length === 0) return undefined;
  let succeeded = 0;
  let failed = 0;
  let running = 0;
  for (const j of jobs) {
    const s = get(j, 'status') ?? {};
    if ((s.failed ?? 0) > 0 && (s.succeeded ?? 0) === 0) failed++;
    else if ((s.succeeded ?? 0) > 0) succeeded++;
    else running++;
  }
  const parts: string[] = [];
  if (succeeded) parts.push(`${succeeded} Succeeded`);
  if (running) parts.push(`${running} Running`);
  if (failed) parts.push(`${failed} Failed`);
  const tone: LocalHealthStat['tone'] = failed > 0 ? 'error' : 'success';
  return { kind: 'Job', total: jobs.length, state: parts.join(', ') || '—', tone };
}

function sumEndpoints(items: KubeObject[]): LocalHealthStat | undefined {
  const eps = items.filter(e => e.kind === 'Endpoints');
  if (eps.length === 0) return undefined;
  let withAddr = 0;
  for (const e of eps) {
    const subsets: any[] = get(e, 'subsets') ?? [];
    if (subsets.some(sub => (sub.addresses?.length ?? 0) > 0)) withAddr++;
  }
  const empty = eps.length - withAddr;
  const state = empty > 0 ? `${withAddr} populated, ${empty} empty` : `${withAddr} populated`;
  return { kind: 'Endpoints', total: eps.length, state, tone: 'neutral' };
}

function sumSimpleCount(items: KubeObject[], kind: string): LocalHealthStat | undefined {
  const n = items.filter(i => i.kind === kind).length;
  if (n === 0) return undefined;
  return { kind, total: n, state: `${n} present`, tone: 'neutral' };
}

/**
 * Compute the per-kind inventory shown in the popover so the user can see
 * on what basis the badge was decided.
 */
export function getResourceBreakdown(items: KubeObject[] | undefined): LocalHealthStat[] {
  if (!items || items.length === 0) return [];
  const out: LocalHealthStat[] = [];
  for (const kind of STAT_ORDER) {
    let s: LocalHealthStat | undefined;
    if (['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(kind)) {
      s = sumWorkload(items, kind);
    } else if (kind === 'Pod') {
      s = sumPods(items);
    } else if (kind === 'Job') {
      s = sumJobs(items);
    } else if (kind === 'Endpoints') {
      s = sumEndpoints(items);
    } else {
      s = sumSimpleCount(items, kind);
    }
    if (s) out.push(s);
  }
  // "Other" bucket for kinds we don't itemize (e.g. Role, LimitRange, CRDs)
  const known = new Set(STAT_ORDER);
  const otherCount = items.filter(i => !known.has(i.kind)).length;
  if (otherCount > 0) {
    out.push({ kind: 'Other', total: otherCount, state: `${otherCount} present`, tone: 'neutral' });
  }
  return out;
}

/** Details attached to an 'unavailable' result — used by the popover to
 *  render an API-server-not-reachable message like ClusterStatusPopover. */
export interface LocalHealthUnavailability {
  status: 'unavailable';
  label: 'Unavailable';
  rank: 4;
  icon: string;
  reasons: string[];
  evidence: [];
  stats: [];
  /** First cluster whose fetch failed, if known. */
  cluster?: string;
  /** HTTP status code from the failed fetch, if any. */
  httpCode?: number;
  /** Error message reported by the backend / API server. */
  errorMessage?: string;
}

/**
 * Convenience factory for the "cluster couldn't be reached" case. Called by
 * LocalHealthCell when useLocalHealthItems reports errors[] non-empty.
 */
export function getUnavailableHealth(details: {
  cluster?: string;
  httpCode?: number;
  errorMessage?: string;
}): LocalHealthResult & LocalHealthUnavailability {
  return {
    status: 'unavailable',
    label: 'Unavailable',
    rank: 4,
    icon: 'mdi:cloud-off-outline',
    reasons: [],
    evidence: [],
    stats: [],
    cluster: details.cluster,
    httpCode: details.httpCode,
    errorMessage: details.errorMessage,
  };
}

export function getLocalHealth(items: KubeObject[] | undefined): LocalHealthResult {
  if (!items || items.length === 0) {
    return {
      status: 'empty',
      label: 'No Resources',
      rank: 0,
      icon: 'mdi:help-circle',
      reasons: [],
      evidence: [],
      stats: [],
    };
  }

  const evidence: LocalHealthEvidence[] = [];
  const perSeverity: LocalHealthSeverity[] = [];
  let hasWorkload = false;

  for (const item of items) {
    if (WORKLOAD_KINDS.has(item.kind)) hasWorkload = true;
    const verdict = localGetItemStatus(item, items);
    perSeverity.push(verdict.severity);
    if (verdict.severity !== 'success' && verdict.message) {
      const meta = (item as any).metadata ?? {};
      evidence.push({
        severity: verdict.severity,
        kind: item.kind,
        namespace: meta.namespace ?? '',
        name: meta.name ?? '',
        message: verdict.message,
        object: item,
      });
    }
  }

  const tally = countBy(perSeverity) as Record<LocalHealthSeverity, number>;
  const stats = getResourceBreakdown(items);

  // No workloads: don't claim Healthy — nothing is running to be healthy.
  if (!hasWorkload && (tally.error ?? 0) === 0 && (tally.warning ?? 0) === 0) {
    return {
      status: 'passive',
      label: 'No Workloads',
      rank: 0,
      icon: 'mdi:pause-circle-outline',
      reasons: [],
      evidence: [],
      stats,
    };
  }

  // Errors first, warnings after, so the popover and reasons list read
  // worst-first.
  evidence.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'error' ? -1 : 1;
  });

  const reasons = evidence.map(e => `${e.kind}/${e.namespace}/${e.name}: ${e.message}`);
  const cappedReasons = reasons.slice(0, REASON_CAP);
  if (reasons.length > REASON_CAP) {
    cappedReasons.push(`…and ${reasons.length - REASON_CAP} more`);
  }

  if ((tally.error ?? 0) > 0) {
    return {
      status: 'error',
      label: 'Unhealthy',
      rank: 3,
      icon: 'mdi:alert-circle',
      reasons: cappedReasons,
      evidence,
      stats,
    };
  }
  if ((tally.warning ?? 0) > 0) {
    return {
      status: 'warning',
      label: 'Degraded',
      rank: 2,
      icon: 'mdi:alert',
      reasons: cappedReasons,
      evidence,
      stats,
    };
  }
  return {
    status: 'success',
    label: 'Healthy',
    rank: 1,
    icon: 'mdi:check-circle',
    reasons: [],
    evidence: [],
    stats,
  };
}
