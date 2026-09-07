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

// NOTE: this file deliberately does NOT import any shared workload helpers
// (e.g. lib/util.getReadyReplicas / getTotalReplicas). The equivalent
// per-kind field reads are inlined below so the Applications-tab health
// logic can never silently drift when an upstream helper changes shape.
// See tinyPickDesired / tinyPickReady near the bottom.

export type LocalHealthSeverity =
  | 'success'
  | 'warning'
  | 'error'
  | 'progressing'
  | 'info'
  | 'unknown';
export type LocalHealthBadge =
  | LocalHealthSeverity
  | 'empty' // no resources at all
  | 'passive' // resources present but no runnable workload (dormant app)
  | 'unavailable'; // couldn't reach the cluster to know the truth

export interface LocalHealthEvidence {
  severity: 'error' | 'warning' | 'progressing' | 'info' | 'unknown';
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
  label:
    | 'Healthy'
    | 'Degraded'
    | 'Unhealthy'
    | 'Progressing'
    | 'Unknown'
    | 'No Resources'
    | 'No Workloads'
    | 'Unavailable';
  /** 0 = empty/passive/healthy, 1 = unknown, 2 = progressing, 3 = degraded, 4 = unhealthy, 5 = unavailable */
  rank: 0 | 1 | 2 | 3 | 4 | 5;
  icon: string;
  reasons: string[];
  evidence: LocalHealthEvidence[];
  progressing: LocalHealthEvidence[];
  unknownItems: LocalHealthEvidence[];
  /** Breakdown of the observed resource inventory, per kind, in a fixed
   *  reading order. Empty when the badge is 'unavailable' or 'empty'. */
  stats: LocalHealthStat[];
  /** Non-success verdicts from kinds in NON_HEALTH_BEARING_KINDS (e.g. Job).
   *  Never affects `status`/`label`/`rank` — surfaced for visibility only. */
  needsAttention: LocalHealthEvidence[];
}

const REASON_CAP = 10;
const POD_WAIT_ERROR_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'InvalidImageName',
  'CreateContainerError',
  'RunContainerError',
  'ContainerCannotRun',
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

// Kinds whose verdict is surfaced (Needs Attention) but never rolled into the
// Healthy/Degraded/Unhealthy tally. Job is one-shot/run-to-completion; a
// failed Helm test-hook Job (e.g. wnv7a0vbgw0013c-sbc-healthcheck-job, a
// helm.sh/hook: test Job) shouldn't drag down an otherwise-healthy app.
// CronJob is scheduled orchestration, not application health itself. It may
// still be visible in the popover/Needs Attention, but it must not affect the
// app badge or rank.
const NON_HEALTH_BEARING_KINDS = new Set(['Job', 'CronJob', 'HorizontalPodAutoscaler']);

export interface ItemVerdict {
  severity: LocalHealthSeverity;
  message?: string;
}

function get(o: KubeObject, path: string): any {
  return path.split('.').reduce<any>((v, k) => (v == null ? v : v[k]), o as any);
}

function isDeploymentOwnedReplicaSet(o: KubeObject): boolean {
  if (o.kind !== 'ReplicaSet') return false;
  const refs = (o as any).metadata?.ownerReferences;
  return Array.isArray(refs) && refs.some((r: any) => r?.kind === 'Deployment');
}

/**
 * A Pod created by a Job (Helm post-upgrade/test hooks, one-shot migrations).
 * Job is already NON_HEALTH_BEARING; its Pod carries the same one-shot
 * semantics and must not drive the badge either — live case: a Failed
 * `helm.sh/hook: post-upgrade` Pod turned an app Unhealthy while every
 * Deployment/StatefulSet/DaemonSet was fully Ready. Only 'Job' ownership
 * counts: ReplicaSet/StatefulSet/DaemonSet-owned and bare Pods stay
 * health-bearing.
 */
function isJobOwnedPod(o: KubeObject): boolean {
  if (o.kind !== 'Pod') return false;
  const refs = (o as any).metadata?.ownerReferences;
  return Array.isArray(refs) && refs.some((r: any) => r?.kind === 'Job');
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
  const matchesSelector = (labels: Record<string, string> | undefined): boolean =>
    !!labels && entries.every(([k, v]) => labels[k] === v);

  // A matching template alone does not mean workload is active: scaled-zero
  // controllers intentionally leave Services without backing Pods.
  // A Succeeded/Failed/terminating Pod is not a live backend even if its
  // labels still match the selector.
  const isLivePod = (p: KubeObject): boolean => {
    const phase = get(p, 'status.phase');
    if (phase === 'Succeeded' || phase === 'Failed') return false;
    if (get(p, 'metadata.deletionTimestamp')) return false;
    return true;
  };
  const hasMatchingPod = items.some(p => {
    if (p.kind !== 'Pod') return false;
    if (get(p, 'metadata.namespace') !== svcNs) return false;
    if ((p as any).cluster !== svcCluster) return false;
    if (!isLivePod(p)) return false;
    return matchesSelector(get(p, 'metadata.labels') as Record<string, string> | undefined);
  });

  for (const w of items) {
    if (!['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(w.kind)) continue;
    if (get(w, 'metadata.namespace') !== svcNs) continue;
    if ((w as any).cluster !== svcCluster) continue;
    const tmplLabels = (get(w, 'spec.template.metadata.labels') ??
      get(w, 'spec.selector.matchLabels') ??
      {}) as Record<string, string>;
    if (!matchesSelector(tmplLabels)) continue;

    const replicas = get(w, 'spec.replicas');
    if ((typeof replicas === 'number' && replicas > 0) || hasMatchingPod) return true;
  }
  return hasMatchingPod;
}

/**
 * Find the first container (in array order) reporting a *current* fatal
 * state. Only `state.waiting` (known bad reasons) and `state.terminated`
 * with a non-zero exit code count — `lastState` is deliberately never
 * inspected here: history (past OOMKilled, past restarts) must not
 * override a container that is currently fine. Deterministic: first match
 * wins, so a failing 2nd container is still caught even if container 1 is
 * healthy, and a failing 3rd init container is still caught even if the
 * first two already completed successfully.
 */
function findFatalContainerReason(containerStatuses: any[]): string | undefined {
  for (const c of containerStatuses) {
    const waiting = c?.state?.waiting;
    if (waiting && POD_WAIT_ERROR_REASONS.has(waiting.reason)) return waiting.reason;

    const terminated = c?.state?.terminated;
    if (terminated && terminated.exitCode !== 0) {
      return terminated.reason || `Exit Code: ${terminated.exitCode}`;
    }
  }
  return undefined;
}

function findCondition(conditions: any[], type: string): any {
  return conditions.find(c => c?.type === type);
}

/**
 * Exported only as a test seam for the Pod-verdict contract (see
 * localHealth.test.ts "Pod verdict contract" describe block). Not used by
 * any other module — application code always goes through getLocalHealth().
 */
export function localGetItemStatus(o: KubeObject, allItems: KubeObject[]): ItemVerdict {
  const kind = o.kind;
  const meta = (o as any).metadata ?? {};
  const anyObj = o as any;

  if (kind === 'Pod') {
    const status = anyObj.status;

    // No status payload at all — can't say anything about this Pod.
    if (!status || Object.keys(status).length === 0) {
      return { severity: 'unknown', message: 'Pod status unavailable' };
    }

    const phase: string | undefined = status.phase;
    const conds: any[] = status.conditions ?? [];
    const initContainerStatuses: any[] = status.initContainerStatuses ?? [];
    const containerStatuses: any[] = status.containerStatuses ?? [];

    const readyCond = findCondition(conds, 'Ready');
    const podScheduledCond = findCondition(conds, 'PodScheduled');
    const containersReadyCond = findCondition(conds, 'ContainersReady');
    const initializedCond = findCondition(conds, 'Initialized');

    // Current fatal container state beats everything except the terminal
    // Failed phase message assembly below — a CrashLoopBackOff/OOMKilled
    // container is the most useful reason regardless of what phase/ready
    // says, and it must not be masked by a generic "Pending"/"Not Ready".
    const fatalInit = findFatalContainerReason(initContainerStatuses);
    const fatalMain = findFatalContainerReason(containerStatuses);

    if (phase === 'Failed') {
      return {
        severity: 'error',
        message: status.reason || status.message || fatalMain || fatalInit || 'Failed',
      };
    }

    if (fatalInit) return { severity: 'error', message: fatalInit };
    if (fatalMain) return { severity: 'error', message: fatalMain };

    if (phase === undefined || phase === null) {
      return { severity: 'unknown', message: status.reason || 'Pod status unavailable' };
    }

    if (phase === 'Unknown') {
      return {
        severity: 'unknown',
        message: status.reason || readyCond?.reason || 'Pod phase Unknown',
      };
    }

    // Pod is being deleted — real terminal signals above (Failed phase,
    // fatal container reasons) still win; otherwise this is a normal,
    // age-independent transition, not a fresh failure.
    if (meta.deletionTimestamp) {
      return { severity: 'progressing', message: 'Terminating' };
    }

    if (podScheduledCond?.status === 'False') {
      if (podScheduledCond.reason === 'SchedulingGated') {
        return { severity: 'progressing', message: 'SchedulingGated' };
      }
      return { severity: 'error', message: podScheduledCond.reason || 'Unschedulable' };
    }

    if (phase === 'Running') {
      // No Ready condition reported at all — can't confirm health, and a
      // missing condition must never be read as Healthy.
      if (!readyCond) return { severity: 'unknown', message: 'Pod status unavailable' };
      if (readyCond.status === 'True') return { severity: 'success' };
      // Running but not confirmed Ready, with no fatal container reason
      // found above — partial/degraded operation, not a hard failure.
      return {
        severity: 'warning',
        message: readyCond.reason || containersReadyCond?.reason || 'Not Ready',
      };
    }

    if (phase === 'Pending') {
      const runningInit = initContainerStatuses.some(c => c?.state?.running);
      const waitingMain = containerStatuses.find(c => c?.state?.waiting)?.state?.waiting;
      const waitingInit = initContainerStatuses.find(c => c?.state?.waiting)?.state?.waiting;
      const message =
        waitingMain?.reason ||
        waitingInit?.reason ||
        (runningInit && 'PodInitializing') ||
        (initializedCond?.status === 'False' && initializedCond.reason) ||
        containersReadyCond?.reason ||
        'Pending';
      return { severity: 'progressing', message };
    }

    if (phase === 'Succeeded') {
      return { severity: 'success', message: 'Completed' };
    }

    // Any other phase value is not one Kubernetes documents — don't guess.
    return { severity: 'unknown', message: `Unknown Pod phase: ${phase}` };
  }

  // Deployment — dedicated branch. Replica counts alone can't tell "still
  // rolling out" apart from "died after rollout finished" (both can show
  // "3/5 ready"); status.updatedReplicas + status.conditions disambiguate.
  if (kind === 'Deployment') {
    const spec = anyObj.spec ?? {};
    const status = anyObj.status;
    const desired: number = typeof spec.replicas === 'number' ? spec.replicas : 0;

    const hasStatus = !!status && Object.keys(status).length > 0;
    const observedGeneration = status?.observedGeneration;
    const generation = meta.generation;
    const isStale =
      typeof observedGeneration === 'number' &&
      typeof generation === 'number' &&
      observedGeneration < generation;

    // Controller hasn't reported on the latest spec yet (or hasn't reported
    // at all) — the rest of `status` would be stale/absent truth.
    if (!hasStatus || isStale) {
      return { severity: 'unknown', message: 'Status updating' };
    }

    // Intentionally scaled down — not broken.
    if (desired === 0) return { severity: 'success' };

    const conditions: any[] = status.conditions ?? [];
    const progressingCond = findCondition(conditions, 'Progressing');
    const availableCond = findCondition(conditions, 'Available');

    // Real failure signal — the Deployment equivalent of CrashLoopBackOff.
    if (
      progressingCond?.status === 'False' &&
      progressingCond.reason === 'ProgressDeadlineExceeded'
    ) {
      return { severity: 'error', message: 'ProgressDeadlineExceeded' };
    }

    const statusReplicas: number = status.replicas ?? 0;
    const ready: number = status.readyReplicas ?? 0;
    const updated: number | undefined =
      typeof status.updatedReplicas === 'number' ? status.updatedReplicas : undefined;

    // A rollout can be transiently unavailable before its new pods become
    // Ready. Progressing must win over Available=False in that normal state.
    // Do not use Progressing=True alone: settled Deployments also report it
    // with reason NewReplicaSetAvailable.
    const isProgressing =
      (typeof updated === 'number' && updated < desired) ||
      progressingCond?.reason === 'ReplicaSetUpdated';
    if (isProgressing) {
      return { severity: 'progressing', message: `Rolling out ${updated ?? ready}/${desired}` };
    }

    if (availableCond?.status === 'False') {
      return { severity: 'error', message: availableCond.reason || 'Not Available' };
    }

    if (statusReplicas === 0 && desired > 0) {
      return { severity: 'error', message: `0/${desired} pods created` };
    }

    // Rollout finished (updatedReplicas === desired) but pods still dropped
    // out afterwards — a real regression, not a normal transition.
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };

    return { severity: 'success' };
  }

  // ReplicaSet — unchanged: classic `spec.replicas` + `status.replicas` /
  // `status.readyReplicas` shape. Deployment and StatefulSet each split out
  // above/below into their own richer branches; ReplicaSet keeps today's
  // behavior. Fields read inline; no shared helper called.
  if (kind === 'ReplicaSet') {
    const spec = anyObj.spec ?? {};
    const status = anyObj.status ?? {};
    const desired: number = typeof spec.replicas === 'number' ? spec.replicas : 0;
    const ready: number = status.readyReplicas ?? 0;
    const statusReplicas: number = status.replicas ?? 0;

    if (desired === 0) return { severity: 'success' };
    if (statusReplicas === 0 && desired > 0)
      return { severity: 'error', message: `0/${desired} pods created` };
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };
    return { severity: 'success' };
  }

  // StatefulSet — dedicated branch. Unlike Deployment, StatefulSet does NOT
  // populate status.conditions (no Available/Progressing/
  // ProgressDeadlineExceeded here — confirmed empty on every live sample).
  // Rollout is detected via revisions instead: status.currentRevision !==
  // status.updateRevision means pods are still being migrated to the new
  // revision, even if replica counts already look fully ready. There is no
  // StatefulSet equivalent of ProgressDeadlineExceeded — a stuck rollout
  // just stays 'progressing' forever; the real failure signal (e.g.
  // CrashLoopBackOff) surfaces on the Pod itself via the Pod branch.
  if (kind === 'StatefulSet') {
    const spec = anyObj.spec ?? {};
    const status = anyObj.status;
    const desired: number = typeof spec.replicas === 'number' ? spec.replicas : 0;

    const hasStatus = !!status && Object.keys(status).length > 0;
    const observedGeneration = status?.observedGeneration;
    const generation = meta.generation;
    const isStale =
      typeof observedGeneration === 'number' &&
      typeof generation === 'number' &&
      observedGeneration < generation;

    if (!hasStatus || isStale) {
      return { severity: 'unknown', message: 'Status updating' };
    }

    if (desired === 0) return { severity: 'success' };

    if (typeof status.collisionCount === 'number' && status.collisionCount > 0) {
      return { severity: 'error', message: 'Revision collision' };
    }

    const statusReplicas: number = status.replicas ?? 0;
    if (statusReplicas === 0 && desired > 0) {
      return { severity: 'error', message: `0/${desired} pods created` };
    }

    const ready: number = status.readyReplicas ?? 0;
    const updated: number | undefined =
      typeof status.updatedReplicas === 'number' ? status.updatedReplicas : undefined;
    const revisionsDiffer =
      !!status.currentRevision &&
      !!status.updateRevision &&
      status.currentRevision !== status.updateRevision;

    // Rollout in progress — revisions disagree, or the new-revision count
    // hasn't caught up to desired, even though readyReplicas may already
    // equal desired (old-revision pods can still be Ready).
    if (revisionsDiffer || (typeof updated === 'number' && updated < desired)) {
      return { severity: 'progressing', message: `Updating ${updated ?? ready}/${desired}` };
    }

    // Rollout settled (revisions match, updated === desired) but pods
    // dropped out afterwards — a real regression, not a normal transition.
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };

    return { severity: 'success' };
  }

  // DaemonSet — completely different shape from Deployment/StatefulSet.
  // It has NO `spec.replicas` and NO `status.replicas`. Instead the Kubernetes
  // DaemonSetStatus schema (apps/v1) exposes:
  //   status.desiredNumberScheduled  – nodes the controller wants a pod on
  //   status.currentNumberScheduled  – nodes that actually got a pod scheduled
  //   status.numberReady             – how many of those pods are Ready
  //   status.updatedNumberScheduled  – nodes running the NEW pod version (rollout counter)
  //   status.numberMisscheduled      – pods sitting on nodes that no longer match
  // Ref: https://kubernetes.io/docs/reference/generated/kubernetes-api/v1/#daemonsetstatus-v1-apps
  //
  // Using status.replicas here (as the combined branch used to) is a bug:
  // for a perfectly healthy DaemonSet that field is undefined → 0, and the
  // "0/N pods created" branch would fire falsely. Kept out of the shared
  // branch above so this rule can evolve independently.
  if (kind === 'DaemonSet') {
    const spec = anyObj.spec ?? {};
    const status = anyObj.status;

    const hasStatus = !!status && Object.keys(status).length > 0;
    const observedGeneration = status?.observedGeneration;
    const generation = meta.generation;
    const isStale =
      typeof observedGeneration === 'number' &&
      typeof generation === 'number' &&
      observedGeneration < generation;

    if (!hasStatus || isStale) {
      return { severity: 'unknown', message: 'Status updating' };
    }

    const desired: number = status.desiredNumberScheduled ?? 0;

    // nodeSelector / affinity / taints matched zero nodes — deliberate,
    // not a failure. (E.g. a DaemonSet gated to GPU nodes on a CPU cluster.)
    if (desired === 0) return { severity: 'success' };

    const scheduled: number = status.currentNumberScheduled ?? 0;

    // Nothing scheduled anywhere but the controller wants pods → real error
    // (image pull loop, priority preemption, scheduler stuck, etc.). Checked
    // before misscheduled so a badly broken DaemonSet (0 scheduled + some
    // misscheduled) can't get downgraded to a mild warning.
    if (scheduled === 0 && desired > 0) {
      return { severity: 'error', message: `0/${desired} pods scheduled` };
    }

    // Rollout in progress — only meaningful for RollingUpdate. Compared
    // against `scheduled`, not `desired`: updatedNumberScheduled < scheduled
    // means pods already exist on those nodes but some are still the OLD
    // version (a true rollout). Comparing against `desired` instead would
    // wrongly flag a plain scheduling gap (nodes with NO pod yet, all
    // placed pods already current) as "rolling out" — that's Degraded via
    // the ready check below, not Progressing. OnDelete intentionally leaves
    // old pods running until a human deletes them, so it's excluded here.
    const strategy = spec.updateStrategy?.type ?? 'RollingUpdate';
    const updated: number | undefined =
      typeof status.updatedNumberScheduled === 'number' ? status.updatedNumberScheduled : undefined;
    if (strategy !== 'OnDelete' && typeof updated === 'number' && updated < scheduled) {
      return { severity: 'progressing', message: `Updating ${updated}/${scheduled}` };
    }

    // Some nodes got a pod but not all are Ready.
    const ready: number = status.numberReady ?? 0;
    if (ready < desired) return { severity: 'warning', message: `${ready}/${desired} ready` };

    // Kubelet has pods sitting on nodes that no longer match. Mild signal —
    // controller will clean them up. Checked last: real errors/rollout above
    // always win over this cosmetic cleanup-pending state.
    const misscheduled: number = status.numberMisscheduled ?? 0;
    if (misscheduled > 0) return { severity: 'warning', message: `${misscheduled} misscheduled` };

    return { severity: 'success' };
  }

  // Job — NON_HEALTH_BEARING: verdict below still computed (for the Needs
  // Attention popover section) but excluded from the health tally by the
  // getLocalHealth loop. status.conditions (Failed/Complete) is the
  // authoritative K8s signal — matches real cluster data: a failed Job
  // carries conditions: [{ type: 'Failed', status: 'True', reason:
  // 'BackoffLimitExceeded' }]. `status.failed` is a raw retry counter, not
  // a verdict — a Job with backoffLimit=100 that failed once (failed=1,
  // no Failed condition yet) is completely normal, not Degraded. There is
  // no real Kubernetes field for "how many failures is too many before the
  // Failed condition fires" other than the Failed condition itself, so the
  // old raw-counter fallback is removed rather than replaced with a
  // fabricated threshold.
  if (kind === 'Job') {
    const status = anyObj.status;

    if (!status || Object.keys(status).length === 0) {
      return { severity: 'unknown', message: 'Job status unavailable' };
    }

    // Same staleness rule as Deployment/StatefulSet/DaemonSet, kept
    // defensive: observedGeneration was not present on any live Job status
    // sampled from this cluster, so this only fires where the field exists.
    const observedGeneration = status.observedGeneration;
    const generation = meta.generation;
    const isStale =
      typeof observedGeneration === 'number' &&
      typeof generation === 'number' &&
      observedGeneration < generation;
    if (isStale) {
      return { severity: 'unknown', message: 'Status updating' };
    }

    const conditions: any[] = status.conditions ?? [];
    const failedCondition = conditions.find(c => c.type === 'Failed' && c.status === 'True');
    // SuccessCriteriaMet not observed live (only 'Complete' seen) — accepted
    // defensively since it's a documented alternate completion condition.
    const isComplete = conditions.some(
      c => (c.type === 'Complete' || c.type === 'SuccessCriteriaMet') && c.status === 'True'
    );

    if (failedCondition) {
      return { severity: 'error', message: failedCondition.reason ?? 'Job Failed' };
    }
    if (isComplete) {
      return { severity: 'success', message: 'Complete' };
    }

    const active: number = status.active ?? 0;
    if (active > 0) {
      return { severity: 'progressing', message: 'Running' };
    }

    // Multi-completion Job still short of its target with no Failed
    // condition — real fields (spec.completions/status.succeeded), but a
    // live Job actually mid-multi-completion was not observed in the
    // current sample (fixture-verified only).
    const completions = anyObj.spec?.completions;
    const succeeded: number = status.succeeded ?? 0;
    if (typeof completions === 'number' && succeeded < completions) {
      return { severity: 'progressing', message: `${succeeded}/${completions} completions` };
    }

    // No conditions yet, not active — accepted but not started/reported.
    // A known transient state, not an unreadable one.
    return { severity: 'progressing', message: 'Pending' };
  }

  // CronJob — NON_HEALTH_BEARING (same as Job, unchanged here). Real
  // CronJobStatus (batch/v1) has NO `status.conditions` and NO
  // `status.observedGeneration` (confirmed absent on every live sample) —
  // staleness is genuinely not applicable to this kind, not merely unread.
  if (kind === 'CronJob') {
    const status = anyObj.status ?? {};
    const spec = anyObj.spec ?? {};
    const meta = (o as any).metadata ?? {};
    const cronUid = meta.uid;
    const childJobs = allItems.filter(job => {
      if (job.kind !== 'Job') return false;
      const refs = Array.isArray((job as any).metadata?.ownerReferences)
        ? (job as any).metadata.ownerReferences
        : [];
      return (
        typeof cronUid === 'string' &&
        refs.some((ref: any) => ref?.kind === 'CronJob' && ref?.uid === cronUid)
      );
    });

    const activeRuns = Array.isArray(status.active) ? status.active.length : 0;
    const completedJobs = childJobs.filter(job => {
      const jobStatus = (job as any).status ?? {};
      const conditions: any[] = jobStatus.conditions ?? [];
      return conditions.some(
        (condition: any) =>
          (condition.type === 'Complete' || condition.type === 'Failed') &&
          condition.status === 'True'
      );
    });
    // Sort by status.completionTime — the real field marking when a Job
    // FINISHED. Falls back to startTime, then creationTimestamp, only when
    // completionTime is absent (e.g. a Failed job with no completionTime).
    // Sorting by startTime instead would pick the run that started most
    // recently, not the one that finished most recently — wrong when runs
    // overlap.
    const latestCompletedJob = completedJobs
      .map(job => {
        const endTime =
          get(job, 'status.completionTime') ??
          get(job, 'status.startTime') ??
          get(job, 'metadata.creationTimestamp') ??
          '';
        const ts = endTime ? new Date(endTime).getTime() : Number.NEGATIVE_INFINITY;
        return { job, ts };
      })
      .filter(item => Number.isFinite(item.ts))
      .sort((a, b) => b.ts - a.ts)[0]?.job;

    // Not observed live — no suspended CronJob exists in the current
    // sample. Fixture-verified only.
    if (spec.suspend === true) return { severity: 'info', message: 'Suspended' };

    // Real Kubernetes semantics per concurrencyPolicy — no invented cap.
    // Forbid: at most 1 concurrent run is ever expected; Replace: the
    // controller kills the old run before starting a new one, so it also
    // never expects more than 1 running at once. Allow has NO concurrency
    // limit by design — Kubernetes permits unlimited simultaneous runs, so
    // activeRuns must never be treated as a warning signal for Allow.
    if (spec.concurrencyPolicy === 'Forbid' || spec.concurrencyPolicy === 'Replace') {
      if (activeRuns > 1) return { severity: 'warning', message: `${activeRuns} active runs` };
    }
    // A run happening now outranks any retained history: reporting a past
    // result while a run is in flight would show a stale message.
    if (activeRuns > 0) return { severity: 'progressing', message: 'Running' };

    if (latestCompletedJob) {
      const latestStatus = (latestCompletedJob as any).status ?? {};
      const failedCondition = (latestStatus.conditions ?? []).find(
        (c: any) => c.type === 'Failed' && c.status === 'True'
      );
      if (failedCondition) {
        return {
          severity: 'warning',
          message: `Recent run failed: ${failedCondition.reason ?? 'Job Failed'}`,
        };
      }
      if ((latestStatus.failed ?? 0) > 0) {
        return { severity: 'warning', message: 'Recent run failed: Job Failed' };
      }
      if ((latestStatus.succeeded ?? 0) > 0) {
        return { severity: 'success', message: 'Last run succeeded' };
      }
    }

    if (status.lastScheduleTime && !status.lastSuccessfulTime) {
      return { severity: 'warning', message: 'Scheduled but never succeeded' };
    }
    // No child Jobs found above (e.g. successfulJobsHistoryLimit=0 /
    // failedJobsHistoryLimit=0 — confirmed live: Kubernetes garbage-collects
    // every child Job immediately, so childJobs can legitimately be empty
    // even after months of successful runs) — fall back to the CronJob's
    // own status fields, which the controller keeps updating regardless of
    // whether any Job object still exists.
    if (
      status.lastSuccessfulTime ||
      (latestCompletedJob && (latestCompletedJob as any).status?.succeeded)
    ) {
      return { severity: 'success', message: 'Last run succeeded' };
    }
    return { severity: 'unknown', message: 'No run recorded yet' };
  }

  // PersistentVolumeClaim — only three real phases exist: Pending, Bound,
  // Lost. The old "Pending > 2m → error" timer is removed entirely (same
  // disease already removed from Pod/CronJob): a PVC using a
  // WaitForFirstConsumer StorageClass legitimately stays Pending — often
  // for a long time — until a Pod actually consumes it. A genuinely broken
  // PVC either goes Lost, or its consuming Pod surfaces the real problem
  // (stuck ContainerCreating), already handled by the Pod branch. Pending
  // is 'progressing', not 'warning': it is a normal, expected wait state
  // for WaitForFirstConsumer, not a degraded one.
  if (kind === 'PersistentVolumeClaim') {
    const status = anyObj.status;
    const phase: string | undefined = status?.phase;
    const RECOGNIZED_PHASES = new Set(['Pending', 'Bound', 'Lost']);

    if (!status || Object.keys(status).length === 0 || !phase || !RECOGNIZED_PHASES.has(phase)) {
      return {
        severity: 'unknown',
        message: phase ? `Unknown phase: ${phase}` : 'Status unavailable',
      };
    }

    // Lost checked before Terminating: a Lost PVC being deleted is still a
    // real failure (the underlying PV is gone), not a normal transition —
    // that signal must not be masked by "it's just terminating".
    if (phase === 'Lost') return { severity: 'error', message: 'Lost' };

    if (meta.deletionTimestamp) return { severity: 'progressing', message: 'Terminating' };

    if (phase === 'Pending') return { severity: 'progressing', message: 'Pending' };

    // Resize in progress — real condition types per the VolumeResizing
    // feature. Not observed on any live PVC in the current sample
    // (fixture-verified only), but a real, documented condition shape.
    const conditions: any[] = status.conditions ?? [];
    const resizingCond = conditions.find(
      c => (c?.type === 'Resizing' || c?.type === 'FileSystemResizePending') && c?.status === 'True'
    );
    if (resizingCond) return { severity: 'progressing', message: resizingCond.type };

    return { severity: 'success' };
  }

  if (kind === 'Endpoints') {
    const subsets: any[] = anyObj.subsets ?? [];
    const ready = subsets.reduce((total, subset) => total + (subset.addresses?.length ?? 0), 0);
    const notReady = subsets.reduce(
      (total, subset) => total + (subset.notReadyAddresses?.length ?? 0),
      0
    );

    if (ready > 0 && notReady === 0) return { severity: 'success' };

    // Benign filters apply only when no ready addresses exist. A ready
    // address plus notReadyAddresses is a real partial-readiness signal.
    if (ready === 0) {
      // Find the paired Service. If none, this is an orphan; not our problem.
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
      if (!workloadTargetsService(svc, allItems)) return { severity: 'success' };

      if (notReady > 0) {
        return {
          severity: 'warning',
          message: `no ready pods yet (0/${notReady}) behind this Service`,
        };
      }
      return { severity: 'warning', message: 'no pods behind this Service' };
    }

    return {
      severity: 'warning',
      message: `${ready}/${ready + notReady} pods ready behind this Service`,
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
    const backendNames = new Set<string>();
    const defaultBackendName = get(o, 'spec.defaultBackend.service.name');
    if (defaultBackendName) backendNames.add(defaultBackendName);

    const rules: any[] = get(o, 'spec.rules') ?? [];
    for (const rule of rules) {
      const paths: any[] = rule?.http?.paths ?? [];
      for (const path of paths) {
        const name = path?.backend?.service?.name;
        if (name) backendNames.add(name);
      }
    }

    const ingressCluster = (o as any).cluster;
    const missing = [...backendNames].filter(
      name =>
        !allItems.some(service => {
          if (service.kind !== 'Service') return false;
          const serviceMeta = (service as any).metadata ?? {};
          return (
            serviceMeta.name === name &&
            serviceMeta.namespace === meta.namespace &&
            (service as any).cluster === ingressCluster
          );
        })
    );
    if (missing.length > 0) {
      return { severity: 'warning', message: `backend Service not found: ${missing.join(', ')}` };
    }
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

/**
 * Sum desired/ready replicas across every object of `kind` in the app,
 * reading the correct fields per kind. Splits DaemonSet from the
 * Deployment/ReplicaSet/StatefulSet family because DaemonSet's status has
 * a completely different shape (desiredNumberScheduled / numberReady) and
 * no spec.replicas / status.replicas at all — using the generic fields on
 * a DaemonSet with partial scheduling silently shows "3/3 ready" instead
 * of the true "3/5 ready", contradicting the badge.
 *
 * All field reads are inline; no shared helper is called.
 */
function sumWorkload(items: KubeObject[], kind: string): LocalHealthStat | undefined {
  const list = items.filter(i => i.kind === kind);
  if (list.length === 0) return undefined;
  let ready = 0;
  let desired = 0;
  for (const w of list) {
    const spec = get(w, 'spec') ?? {};
    const status = get(w, 'status') ?? {};
    if (kind === 'DaemonSet') {
      desired += status.desiredNumberScheduled ?? 0;
      ready += status.numberReady ?? 0;
    } else {
      // Deployment / ReplicaSet / StatefulSet
      desired += typeof spec.replicas === 'number' ? spec.replicas : 0;
      ready += status.readyReplicas ?? 0;
    }
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
  // Neutral tone always — Job is NON_HEALTH_BEARING, real failures already
  // surfaced in the Needs Attention section, this row is inventory-only.
  return { kind: 'Job', total: jobs.length, state: parts.join(', ') || '—', tone: 'neutral' };
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
  rank: 5;
  icon: string;
  reasons: string[];
  evidence: [];
  stats: [];
  needsAttention: [];
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
    rank: 5,
    icon: 'mdi:cloud-off-outline',
    reasons: [],
    evidence: [],
    progressing: [],
    unknownItems: [],
    stats: [],
    needsAttention: [],
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
      progressing: [],
      unknownItems: [],
      stats: [],
      needsAttention: [],
    };
  }

  const evidence: LocalHealthEvidence[] = [];
  const progressing: LocalHealthEvidence[] = [];
  const unknownItems: LocalHealthEvidence[] = [];
  const needsAttention: LocalHealthEvidence[] = [];
  const perSeverity: LocalHealthSeverity[] = [];
  let hasWorkload = false;

  for (const item of items) {
    if (WORKLOAD_KINDS.has(item.kind)) hasWorkload = true;
    if (isDeploymentOwnedReplicaSet(item)) continue;
    const verdict = localGetItemStatus(item, items);
    const meta = (item as any).metadata ?? {};

    if (NON_HEALTH_BEARING_KINDS.has(item.kind) || isJobOwnedPod(item)) {
      // Surfaced for visibility only — never enters perSeverity/tally, so it
      // can't move the Healthy/Degraded/Unhealthy badge. CronJobs are allowed
      // to report their state in the popover, including active/suspended
      // progress messages, without affecting the app designation. Job-owned
      // Pods ride the same path so a failed hook stays visible without
      // reddening an app whose real workloads are all Ready.
      if (
        (verdict.severity === 'error' ||
          verdict.severity === 'warning' ||
          verdict.severity === 'progressing' ||
          verdict.severity === 'info' ||
          verdict.severity === 'unknown') &&
        verdict.message
      ) {
        needsAttention.push({
          severity: verdict.severity,
          kind: item.kind,
          namespace: meta.namespace ?? '',
          name: meta.name ?? '',
          message: verdict.message,
          object: item,
        });
      }
      continue;
    }

    perSeverity.push(verdict.severity);
    if ((verdict.severity === 'error' || verdict.severity === 'warning') && verdict.message) {
      evidence.push({
        severity: verdict.severity,
        kind: item.kind,
        namespace: meta.namespace ?? '',
        name: meta.name ?? '',
        message: verdict.message,
        object: item,
      });
    }
    if (verdict.severity === 'progressing' && verdict.message) {
      progressing.push({
        severity: verdict.severity,
        kind: item.kind,
        namespace: meta.namespace ?? '',
        name: meta.name ?? '',
        message: verdict.message,
        object: item,
      });
    }
    if (verdict.severity === 'unknown' && verdict.message) {
      unknownItems.push({
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
  if (
    !hasWorkload &&
    (tally.error ?? 0) === 0 &&
    (tally.warning ?? 0) === 0 &&
    (tally.progressing ?? 0) === 0 &&
    (tally.unknown ?? 0) === 0
  ) {
    return {
      status: 'passive',
      label: 'No Workloads',
      rank: 0,
      icon: 'mdi:pause-circle-outline',
      reasons: [],
      evidence: [],
      progressing: [],
      unknownItems: [],
      stats,
      needsAttention,
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
      rank: 4,
      icon: 'mdi:alert-circle',
      reasons: cappedReasons,
      evidence,
      progressing,
      unknownItems,
      stats,
      needsAttention,
    };
  }
  if ((tally.warning ?? 0) > 0) {
    return {
      status: 'warning',
      label: 'Degraded',
      rank: 3,
      icon: 'mdi:alert',
      reasons: cappedReasons,
      evidence,
      progressing,
      unknownItems,
      stats,
      needsAttention,
    };
  }
  if ((tally.progressing ?? 0) > 0) {
    return {
      status: 'progressing',
      label: 'Progressing',
      rank: 2,
      icon: 'mdi:progress-clock',
      reasons: [],
      evidence: [],
      progressing,
      unknownItems,
      stats,
      needsAttention,
    };
  }
  if ((tally.unknown ?? 0) > 0) {
    return {
      status: 'unknown',
      label: 'Unknown',
      rank: 1,
      icon: 'mdi:help-circle-outline',
      reasons: [],
      evidence: [],
      progressing,
      unknownItems,
      stats,
      needsAttention,
    };
  }
  return {
    status: 'success',
    label: 'Healthy',
    rank: 0,
    icon: 'mdi:check-circle',
    reasons: [],
    evidence: [],
    progressing,
    unknownItems,
    stats,
    needsAttention,
  };
}
