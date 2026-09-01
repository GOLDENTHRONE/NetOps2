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

export interface LocalHealthResult {
  status: LocalHealthBadge;
  label: 'Healthy' | 'Degraded' | 'Unhealthy' | 'No Resources' | 'Passive' | 'Unavailable';
  /** 0 = empty/passive, 1 = healthy, 2 = degraded, 3 = unhealthy, 4 = unavailable */
  rank: 0 | 1 | 2 | 3 | 4;
  icon: string;
  reasons: string[];
  evidence: LocalHealthEvidence[];
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

  if (
    kind === 'Deployment' ||
    kind === 'ReplicaSet' ||
    kind === 'StatefulSet' ||
    kind === 'DaemonSet'
  ) {
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
    // Only warn when the paired Service (a) exists in the fetched items,
    // (b) is a "real" selector-based ClusterIP/LoadBalancer/NodePort service —
    // NOT headless, NOT ExternalName, NOT selector-less (manual endpoints).
    // This is the "don't punish supporting/unused services" rule.
    const subsets: any[] = anyObj.subsets ?? [];
    const hasAddr = subsets.some(sub => (sub.addresses?.length ?? 0) > 0);
    if (subsets.length > 0 && hasAddr) return { severity: 'success' };

    const svc = findPairedService(o, allItems);
    if (!svc) return { severity: 'success' }; // orphan Endpoints — supporting only
    const svcSpec = (svc as any).spec ?? {};
    if (svcSpec.type === 'ExternalName') return { severity: 'success' };
    if (svcSpec.clusterIP === 'None') return { severity: 'success' }; // headless
    const selector = svcSpec.selector ?? {};
    if (Object.keys(selector).length === 0) return { severity: 'success' }; // manual endpoints
    return { severity: 'warning', message: 'no endpoints' };
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

/** Details attached to an 'unavailable' result — used by the popover to
 *  render an API-server-not-reachable message like ClusterStatusPopover. */
export interface LocalHealthUnavailability {
  status: 'unavailable';
  label: 'Unavailable';
  rank: 4;
  icon: string;
  reasons: string[];
  evidence: [];
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

  // Passive: resources exist but nothing runnable. "Healthy" would be a lie
  // because there is nothing whose health we can vouch for.
  if (!hasWorkload && (tally.error ?? 0) === 0 && (tally.warning ?? 0) === 0) {
    return {
      status: 'passive',
      label: 'Passive',
      rank: 0,
      icon: 'mdi:pause-circle-outline',
      reasons: [],
      evidence: [],
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
    };
  }
  return {
    status: 'success',
    label: 'Healthy',
    rank: 1,
    icon: 'mdi:check-circle',
    reasons: [],
    evidence: [],
  };
}
