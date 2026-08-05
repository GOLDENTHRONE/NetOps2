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

/**
 * Application health, judged the way a Kubernetes operator would.
 *
 * The generic per-object status treats a ConfigMap or a Secret as "success",
 * so an application that is only config (no workloads, no running pods) used
 * to read as "Healthy" — which is misleading. Here health is derived from the
 * things that actually run: Deployments, StatefulSets, DaemonSets and Jobs.
 * We compare each workload's ready replicas against its desired replicas and
 * read the controller conditions, then roll them up into one honest verdict
 * with a per-workload breakdown so the UI can explain *why*.
 *
 * Pure logic (no Headlamp imports) so it is unit tested in isolation. Input is
 * the raw resource JSON (kind + spec + status), which every KubeObject exposes
 * via `.jsonData`.
 */

/** The kinds that actually run pods and therefore define an app's health. */
const WORKLOAD_KINDS = new Set([
  'Deployment',
  'DeploymentConfig',
  'StatefulSet',
  'DaemonSet',
  'Job',
]);

/** Kinds treated as Deployment-shaped (same conditions and rollout model). */
const DEPLOYMENT_SHAPED = new Set(['Deployment', 'DeploymentConfig']);

/**
 * Kinds shown as scheduling context in the popover but never counted toward
 * app health. A CronJob's health is really the health of the Jobs it spawns
 * (already in WORKLOAD_KINDS); the CronJob itself is orchestration, not a
 * long-running app, so treating it as a workload would double-count and
 * misclassify schedules-with-active-jobs as "progressing" forever.
 */
const INFO_KINDS = new Set(['CronJob']);

/** Loose shape of a resource; only the fields we read are named. */
export interface ResourceLike {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
  /** EndpointSlice puts `endpoints` at the top level, not under `status`. */
  endpoints?: Array<{ addresses?: string[]; conditions?: { ready?: boolean } }>;
}

/** The health of one workload within an application. */
export type WorkloadState = 'ready' | 'progressing' | 'degraded' | 'down' | 'scaledZero' | 'paused';

export interface WorkloadHealth {
  kind: string;
  name: string;
  namespace?: string;
  /** Desired replicas (or scheduled nodes for a DaemonSet). */
  desired: number;
  /** Ready replicas. */
  ready: number;
  /** Replicas already on the latest revision. */
  updated: number;
  state: WorkloadState;
  /** Plain-language reason, present when the workload is not simply ready. */
  reason?: string;
  /** Controller owner (e.g. CronJob for a scheduled Job), when present. */
  ownerKind?: string;
  ownerName?: string;
  /** HPA context, when an HPA targets this workload — so a scale-up reads as
   *  autoscaler behavior, not a mystery flap. */
  hpa?: {
    name: string;
    min: number;
    max: number;
    current?: number;
  };
}

/** Scheduling context (CronJobs). Not counted toward app health. */
export type ScheduleState = 'onSchedule' | 'running' | 'suspended' | 'behind' | 'never';

export interface ScheduleInfo {
  kind: string;
  name: string;
  namespace?: string;
  state: ScheduleState;
  reason: string;
  schedule?: string;
  activeJobs: number;
  /**
   * A schedule that has been failing so long its silence is itself the fault
   * (e.g. a nightly backup with no success in >24h). True lets the app-level
   * rollup degrade the whole app on it, while a merely "behind" schedule
   * stays informational.
   */
  chronic?: boolean;
}

/**
 * Per-pod problems the workload-level replica count hides. A Deployment can
 * report 3/3 ready while one of its pods is CrashLoopBackOff — the ready
 * count is the previous good pod, and the new one is thrashing. Surfacing
 * pod problems makes that impossible to miss.
 */
export type PodProblemState = 'crashLoop' | 'imagePull' | 'oomKilled' | 'unschedulable';

export interface PodHealth {
  kind: 'Pod';
  name: string;
  namespace?: string;
  state: PodProblemState;
  reason: string;
  ownerKind?: string;
  ownerName?: string;
  restartCount?: number;
}

/** PVC problems that block pods without the workload ever showing degraded. */
export type PvcProblemState = 'pending' | 'lost';

export interface PvcHealth {
  kind: 'PersistentVolumeClaim';
  name: string;
  namespace?: string;
  state: PvcProblemState;
  reason: string;
}

/**
 * ResourceQuota pressure. In OpenShift multi-tenant clusters an app can look
 * perfectly healthy right up until the next pod fails admission because CPU
 * or memory quota is exhausted; surfacing usage lets an operator act ahead
 * of the outage.
 */
export type QuotaState = 'nearLimit' | 'exhausted';

export interface QuotaHealth {
  kind: 'ResourceQuota';
  name: string;
  namespace?: string;
  state: QuotaState;
  /** The single tightest resource in the quota, for the short summary. */
  worstResource: string;
  /** 0–100+; can exceed 100 when a quota was tightened after the fact. */
  worstUsagePct: number;
  reason: string;
}

/** Service with no ready backend endpoints — a silent outage for callers. */
export interface ServiceHealth {
  kind: 'Service';
  name: string;
  namespace?: string;
  state: 'noEndpoints';
  reason: string;
}

export type IngressProblemState = 'missingBackend' | 'noAddress';

export interface IngressHealth {
  kind: 'Ingress';
  name: string;
  namespace?: string;
  state: IngressProblemState;
  reason: string;
}

/**
 * A PDB with `disruptionsAllowed=0` blocks node drains and rolling upgrades,
 * even when every workload is happily ready. Purely informational for app
 * health (not an outage), but critical context an operator wants to see.
 */
export interface PdbHealth {
  kind: 'PodDisruptionBudget';
  name: string;
  namespace?: string;
  state: 'blocked';
  reason: string;
}

/** The application-level verdict. */
export type AppHealthStatus =
  | 'healthy'
  | 'progressing'
  | 'degraded'
  | 'unhealthy'
  | 'idle'
  | 'noWorkloads'
  | 'empty';

export interface AppHealth {
  status: AppHealthStatus;
  /** Short label for the chip, e.g. "Healthy". */
  label: string;
  /** One-line meaning an operator can act on. */
  summary: string;
  /** Per-workload detail, worst first, for the "why" popover. */
  workloads: WorkloadHealth[];
  /** Scheduling context (CronJobs). Shown in the popover, never counted. */
  schedules: ScheduleInfo[];
  /** Workloads that are fully ready / total workloads (scaled-to-zero excluded). */
  readyWorkloads: number;
  totalWorkloads: number;
  /** Total resources the app owns (all kinds), for context. */
  totalResources: number;
  /** Per-kind resource count for tooltip breakdown on the list view. */
  resourceCountsByKind: Record<string, number>;
  /** Pod-level problems (crashLoop, imagePull, oomKilled, unschedulable). */
  podProblems: PodHealth[];
  /** PVCs that are Pending or Lost. */
  pvcProblems: PvcHealth[];
  /** ResourceQuota entries at ≥90% (nearLimit) or ≥100% (exhausted). */
  quotaProblems: QuotaHealth[];
  /** Services with no ready backend endpoints. */
  serviceProblems: ServiceHealth[];
  /** Subset of serviceProblems used for app status (ingress-exposed only). */
  criticalServiceProblems: ServiceHealth[];
  /** Ingresses whose backend service is absent or that have no LB address. */
  ingressProblems: IngressHealth[];
  /** PDBs with disruptionsAllowed=0. */
  pdbProblems: PdbHealth[];
}

function conditionStatus(
  status: Record<string, any> | undefined,
  type: string
): string | undefined {
  const conditions = status?.conditions;
  if (!Array.isArray(conditions)) {
    return undefined;
  }
  return conditions.find((c: any) => c?.type === type)?.status;
}

function conditionMessage(
  status: Record<string, any> | undefined,
  type: string
): string | undefined {
  const conditions = status?.conditions;
  if (!Array.isArray(conditions)) {
    return undefined;
  }
  return conditions.find((c: any) => c?.type === type)?.message;
}

function conditionReason(
  status: Record<string, any> | undefined,
  type: string
): string | undefined {
  const conditions = status?.conditions;
  if (!Array.isArray(conditions)) {
    return undefined;
  }
  return conditions.find((c: any) => c?.type === type)?.reason;
}

/** Formats a duration into a short human string, e.g. "14m", "3h", "2d". */
function formatDurationShort(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Trims a Kubernetes condition message down to something a chip popover can
 * show without wrapping across a dozen lines. Keeps the first sentence-like
 * clause and a hard character cap.
 */
function shortenConditionMessage(message: string | undefined, max = 140): string {
  if (!message) return '';
  const clean = message.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

/**
 * Returns the parent-controller reference on a resource, if any. Used to
 * label a Job that was created by a CronJob, so an operator sees the parent
 * without opening the object.
 */
function ownerRef(resource: ResourceLike): { kind: string; name: string } | undefined {
  const refs = resource.metadata?.ownerReferences;
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const controller = refs.find(r => r?.controller === true) ?? refs[0];
  if (!controller?.kind || !controller?.name) return undefined;
  return { kind: controller.kind, name: controller.name };
}

/** Reads desired/ready/updated replica counts for a workload, per kind. */
function replicaCounts(resource: ResourceLike): {
  desired: number;
  ready: number;
  updated: number;
} {
  const spec: any = resource.spec ?? {};
  const status: any = resource.status ?? {};
  if (resource.kind === 'DaemonSet') {
    return {
      desired: status.desiredNumberScheduled ?? 0,
      ready: status.numberReady ?? 0,
      updated: status.updatedNumberScheduled ?? 0,
    };
  }
  if (resource.kind === 'Job') {
    // Jobs have completions rather than replicas; model them the same way so
    // the rollup is uniform.
    const desired = spec.completions ?? 1;
    return {
      desired,
      ready: status.succeeded ?? 0,
      updated: (status.succeeded ?? 0) + (status.active ?? 0),
    };
  }
  // Deployment / DeploymentConfig / StatefulSet / ReplicaSet all expose
  // spec.replicas + status.readyReplicas + status.updatedReplicas. Kinds
  // that don't report a rollout-progress count (ReplicaSets have no
  // updatedReplicas) must not read as "rolling out" forever, so fall back
  // to the ready count.
  const ready = status.readyReplicas ?? 0;
  return {
    desired: spec.replicas ?? 1,
    ready,
    updated: status.updatedReplicas ?? status.currentReplicas ?? ready,
  };
}

/** Evaluates one workload into a state plus a human reason. */
export function evaluateWorkload(resource: ResourceLike): WorkloadHealth {
  const { desired, ready, updated } = replicaCounts(resource);
  const kind = resource.kind ?? '';
  const name = resource.metadata?.name ?? '';
  const namespace = resource.metadata?.namespace;
  const owner = ownerRef(resource);
  const base: WorkloadHealth = {
    kind,
    name,
    namespace,
    desired,
    ready,
    updated,
    state: 'ready',
    ownerKind: owner?.kind,
    ownerName: owner?.name,
  };

  // Jobs are run-to-completion, so replica logic does not apply: a Job that
  // is still running is progressing (not "down"), and only the Failed
  // condition means failure.
  if (kind === 'Job') {
    const status: any = resource.status ?? {};
    const spec: any = resource.spec ?? {};
    const active = status.active ?? 0;
    const succeeded = status.succeeded ?? 0;
    const failed = status.failed ?? 0;
    const backoffLimit = spec.backoffLimit ?? 6;
    if (conditionStatus(resource.status, 'Failed') === 'True') {
      const failReason = conditionReason(resource.status, 'Failed');
      return {
        ...base,
        state: 'down',
        reason: failReason ? `Failed: ${failReason}` : 'Job failed',
      };
    }
    if (conditionStatus(resource.status, 'Complete') === 'True' || ready >= desired) {
      return { ...base, state: 'ready', reason: `${ready}/${desired} completions` };
    }
    if (spec.suspend === true) {
      return { ...base, state: 'scaledZero', reason: 'Suspended' };
    }
    // backoffLimit exhausted-but-not-yet-Failed: k8s only flips the Failed
    // condition once the controller reconciles again; the truthful state
    // in between is already "down".
    if (failed >= backoffLimit) {
      return {
        ...base,
        state: 'down',
        reason: `BackoffLimit exhausted (${failed} failures, limit ${backoffLimit})`,
      };
    }
    // A Job whose controller can't create pods (quota / SCC / RBAC blocking)
    // sits with active=0, succeeded=0 and no Failed condition — Kubernetes
    // never flips the condition until backoffLimit is exhausted. Reading it
    // as "Waiting to run" is misleading after even a minute: it is stuck.
    // Use startTime age as the honest signal. 60s is enough on any healthy
    // cluster: a Job pod is scheduled in seconds.
    const startTime = status.startTime ? new Date(status.startTime).getTime() : null;
    const ageMs = startTime ? Date.now() - startTime : 0;
    const stalled = startTime !== null && ageMs > 60 * 1000 && active === 0 && succeeded === 0;
    if (stalled) {
      const failNote = failed > 0 ? `, ${failed} failed` : '';
      return {
        ...base,
        state: 'down',
        reason: `Blocked — no pods running for ${formatDurationShort(ageMs)}${failNote}`,
      };
    }
    // Otherwise it's progressing. Keep the "Running"/"Waiting" prefix an
    // operator scans for, and surface active/failed/succeeded in parens so
    // retry loops are visible even when the Job has not given up.
    const detailParts: string[] = [];
    if (active > 0) detailParts.push(`${active} active`);
    if (failed > 0) detailParts.push(`${failed} failed`);
    detailParts.push(`${succeeded}/${desired} succeeded`);
    const prefix = active > 0 ? 'Running' : 'Waiting to run';
    return { ...base, state: 'progressing', reason: `${prefix} (${detailParts.join(', ')})` };
  }

  // Deployment / DeploymentConfig: paused is intentional and independent of
  // readiness — surface separately so an operator sees "changes will not
  // roll out" while it still shows N/N ready.
  const spec: any = resource.spec ?? {};
  if (DEPLOYMENT_SHAPED.has(kind) && spec.paused === true) {
    return {
      ...base,
      state: 'paused',
      reason: `Paused (${ready}/${desired} ready)`,
    };
  }

  // Intentionally scaled to zero: a valid, not-unhealthy state.
  if (desired === 0) {
    return { ...base, state: 'scaledZero', reason: 'Scaled to zero' };
  }

  // Deployment / DeploymentConfig: read the controller's own conditions
  // before falling back to replica-count heuristics.
  if (DEPLOYMENT_SHAPED.has(kind)) {
    if (conditionReason(resource.status, 'Progressing') === 'ProgressDeadlineExceeded') {
      return {
        ...base,
        state: 'down',
        reason: `Rollout stuck (deadline exceeded), ${ready}/${desired} ready`,
      };
    }
    // ReplicaFailure surfaces admission-time blockers (quota, SCC, RBAC, PSA)
    // that stop the ReplicaSet from ever creating pods. Comes before the
    // Available check so the popover shows the actual cause ("Pods forbidden
    // by SCC") instead of a generic "Not available".
    if (conditionStatus(resource.status, 'ReplicaFailure') === 'True') {
      const rfReason = conditionReason(resource.status, 'ReplicaFailure') ?? 'ReplicaFailure';
      const rfMessage = shortenConditionMessage(
        conditionMessage(resource.status, 'ReplicaFailure')
      );
      return {
        ...base,
        state: 'down',
        reason: rfMessage
          ? `${rfReason} — ${rfMessage}`
          : `${rfReason} (${ready}/${desired} ready)`,
      };
    }
    // Active rollout: reason ReplicaSetUpdated (in progress) or
    // NewReplicaSetCreated (fresh rollout, pods coming up). While a rollout
    // is in flight, a temporarily low ready count is expected — it's
    // progressing, not degraded (prevents HPA scale-up false-degraded).
    const progReason = conditionReason(resource.status, 'Progressing');
    const rolloutInFlight =
      conditionStatus(resource.status, 'Progressing') === 'True' &&
      (progReason === 'ReplicaSetUpdated' || progReason === 'NewReplicaSetCreated');
    if (rolloutInFlight && ready < desired) {
      return {
        ...base,
        state: 'progressing',
        reason: `Rolling out (${ready}/${desired} ready)`,
      };
    }
    // Trust the controller: Available=False means the Deployment's own
    // minAvailability threshold is not met, regardless of ready count.
    // Previous "ready === 0" gate missed the common case of a partially
    // available Deployment with maxUnavailable violations.
    if (conditionStatus(resource.status, 'Available') === 'False') {
      return {
        ...base,
        state: 'down',
        reason: `Not available (${ready}/${desired} ready)`,
      };
    }
  }

  // StatefulSet: partitioned rolling update intentionally freezes pods below
  // the partition index on the old revision, so updated < desired forever is
  // by design. Report as ready with a note instead of a fake "rolling out".
  if (kind === 'StatefulSet') {
    const partition = spec.updateStrategy?.rollingUpdate?.partition;
    if (typeof partition === 'number' && partition > 0 && ready >= desired) {
      return {
        ...base,
        state: 'ready',
        reason: `${ready}/${desired} ready (partitioned rollout, partition=${partition})`,
      };
    }
  }

  // DaemonSet: use the DaemonSet-specific status fields for real drift
  // signals, not just replica count. numberMisscheduled catches taint/label
  // drift; numberUnavailable is the canonical readiness field.
  if (kind === 'DaemonSet') {
    const status: any = resource.status ?? {};
    const misscheduled = status.numberMisscheduled ?? 0;
    const unavailable = status.numberUnavailable ?? 0;
    if (misscheduled > 0) {
      return {
        ...base,
        state: 'degraded',
        reason: `${misscheduled} pod(s) misscheduled, ${ready}/${desired} ready`,
      };
    }
    if (unavailable > 0 && ready < desired) {
      return {
        ...base,
        state: 'degraded',
        reason: `${unavailable} pod(s) unavailable, ${ready}/${desired} ready`,
      };
    }
  }

  if (ready === 0) {
    return { ...base, state: 'down', reason: `No replicas ready (0/${desired})` };
  }
  if (ready < desired) {
    return { ...base, state: 'degraded', reason: `Only ${ready}/${desired} replicas ready` };
  }
  if (updated < desired) {
    return { ...base, state: 'progressing', reason: `Rolling out (${updated}/${desired} updated)` };
  }
  return { ...base, state: 'ready', reason: `${ready}/${desired} replicas ready` };
}

/** Evaluates a CronJob into a scheduling-context state. */
export function evaluateSchedule(resource: ResourceLike): ScheduleInfo {
  const spec: any = resource.spec ?? {};
  const status: any = resource.status ?? {};
  const kind = resource.kind ?? '';
  const name = resource.metadata?.name ?? '';
  const namespace = resource.metadata?.namespace;
  const schedule = spec.schedule;
  const activeJobs = Array.isArray(status.active) ? status.active.length : 0;
  const base: Omit<ScheduleInfo, 'state' | 'reason'> = {
    kind,
    name,
    namespace,
    schedule,
    activeJobs,
  };

  if (spec.suspend === true) {
    return { ...base, state: 'suspended', reason: 'Suspended' };
  }
  if (activeJobs > 0) {
    return {
      ...base,
      state: 'running',
      reason: `Running (${activeJobs} active job${activeJobs === 1 ? '' : 's'})`,
    };
  }
  const lastSchedule = status.lastScheduleTime ? new Date(status.lastScheduleTime).getTime() : null;
  const lastSuccess = status.lastSuccessfulTime
    ? new Date(status.lastSuccessfulTime).getTime()
    : null;
  if (!lastSchedule) {
    // A CronJob just created (age < 24h) that has never scheduled is
    // informational — it may simply not have hit its cron cadence yet. A
    // CronJob older than 24h that has still never scheduled is a real
    // problem (bad cron expression, controller stuck, or admission block).
    const created = resource.metadata?.creationTimestamp
      ? new Date(resource.metadata.creationTimestamp).getTime()
      : null;
    const ageMs = created ? Date.now() - created : 0;
    const chronic = created !== null && ageMs > 24 * 60 * 60 * 1000;
    return {
      ...base,
      state: 'never',
      chronic,
      reason: chronic ? `Never scheduled in ${formatDurationShort(ageMs)}` : 'Never scheduled',
    };
  }
  if (!lastSuccess || lastSchedule > lastSuccess) {
    const sinceScheduleMs = Date.now() - lastSchedule;
    const sinceSuccessMs = lastSuccess ? Date.now() - lastSuccess : sinceScheduleMs;
    // A schedule with no success in >24h is not merely "behind" any more —
    // its silence is the fault. Mark chronic so the app rollup treats it as
    // a degradation signal, not just context.
    const chronic = sinceSuccessMs > 24 * 60 * 60 * 1000;
    return {
      ...base,
      state: 'behind',
      chronic,
      reason: chronic
        ? `No successful run in ${formatDurationShort(sinceSuccessMs)}`
        : `Last run has not succeeded (${formatDurationShort(sinceScheduleMs)} ago)`,
    };
  }
  return {
    ...base,
    state: 'onSchedule',
    reason: `Last success ${formatDurationShort(Date.now() - lastSuccess)} ago`,
  };
}

const STATE_RANK: Record<WorkloadState, number> = {
  down: 0,
  degraded: 1,
  progressing: 2,
  ready: 3,
  paused: 4,
  scaledZero: 5,
};

const SCHEDULE_RANK: Record<ScheduleState, number> = {
  never: 0,
  behind: 1,
  suspended: 2,
  running: 3,
  onSchedule: 4,
};

const PRESENTATION: Record<AppHealthStatus, { label: string; summary: string }> = {
  unhealthy: {
    label: 'Unhealthy',
    summary: 'One or more workloads have no ready replicas or a failed rollout.',
  },
  degraded: {
    label: 'Degraded',
    summary: 'Some workloads are running fewer ready replicas than desired.',
  },
  progressing: {
    label: 'Progressing',
    summary: 'A rollout is in progress; new replicas are still coming up.',
  },
  healthy: {
    label: 'Healthy',
    summary: 'Every workload has all of its desired replicas ready.',
  },
  idle: {
    label: 'Idle',
    summary: 'All workloads are scaled to zero, so nothing is running right now.',
  },
  noWorkloads: {
    label: 'No workloads',
    summary:
      'This application has resources (config, services, etc.) but no workloads that run pods.',
  },
  empty: {
    label: 'No resources',
    summary: 'No resources were found for this application.',
  },
};

/**
 * The actual technical reason behind a problem verdict — the real per-workload
 * failures ("Deployment web: 0/3 replicas ready · Job migrate: Job failed")
 * instead of a generic sentence. Falls back to the static summary for states
 * that have nothing specific to say (idle, no workloads, empty, healthy).
 */
function buildSummary(status: AppHealthStatus, workloads: WorkloadHealth[]): string {
  const problemStates: Record<string, WorkloadState[]> = {
    unhealthy: ['down'],
    degraded: ['degraded'],
    progressing: ['progressing'],
  };
  const states = problemStates[status];
  if (!states) {
    return PRESENTATION[status].summary;
  }
  const problems = workloads.filter(w => states.includes(w.state));
  const shown = problems.slice(0, 3).map(w => `${w.kind} ${w.name}: ${w.reason}`);
  const more = problems.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` · +${more} more` : '');
}

/**
 * Parses a Kubernetes resource quantity ("100m", "1Gi", "500Mi", "1", "2k")
 * into a Number using the standard SI / binary suffix table. Returns 0 for
 * missing values and NaN for unparseable strings.
 */
function parseQuantity(q: string | number | undefined): number {
  if (q === undefined || q === null || q === '') return 0;
  if (typeof q === 'number') return q;
  const s = String(q).trim();
  const m = s.match(/^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)([a-zA-Z]*)$/);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  const suffix = m[2];
  const multipliers: Record<string, number> = {
    '': 1,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 2 ** 10,
    Mi: 2 ** 20,
    Gi: 2 ** 30,
    Ti: 2 ** 40,
    Pi: 2 ** 50,
    Ei: 2 ** 60,
  };
  const mult = multipliers[suffix];
  return mult === undefined ? NaN : num * mult;
}

/**
 * Evaluates a Pod for real, actionable trouble. Returns null for pods that
 * are healthy, terminating, or successfully completed; the goal is to
 * surface only the problems a workload's ready count could otherwise mask
 * (crash loop on a rolled-back replica, image pull on a broken tag, etc.).
 */
export function evaluatePod(resource: ResourceLike): PodHealth | null {
  const status: any = resource.status ?? {};
  const phase = status.phase;
  if (phase === 'Succeeded') return null;
  if (resource.metadata?.deletionTimestamp) return null;

  const owner = ownerRef(resource);
  const base = {
    kind: 'Pod' as const,
    name: resource.metadata?.name ?? '',
    namespace: resource.metadata?.namespace,
    ownerKind: owner?.kind,
    ownerName: owner?.name,
  };

  // PodScheduled=False + reason Unschedulable is the honest signal for a pod
  // the scheduler cannot place (taint mismatch, no node has enough capacity,
  // topology spread violated). Surfacing it lets the operator fix the pod,
  // not stare at a Deployment that just says "0/1 ready".
  const conditions: any[] = status.conditions ?? [];
  const scheduled = conditions.find(c => c?.type === 'PodScheduled');
  if (scheduled && scheduled.status === 'False' && scheduled.reason === 'Unschedulable') {
    return {
      ...base,
      state: 'unschedulable',
      reason: shortenConditionMessage(scheduled.message, 120) || 'Unschedulable',
    };
  }

  const container: any[] = [
    ...(status.initContainerStatuses ?? []),
    ...(status.containerStatuses ?? []),
  ];
  for (const cs of container) {
    const waiting = cs?.state?.waiting;
    if (waiting?.reason === 'CrashLoopBackOff') {
      return {
        ...base,
        state: 'crashLoop',
        restartCount: cs.restartCount,
        reason: `CrashLoopBackOff (${cs.restartCount ?? 0} restarts)`,
      };
    }
    // ImagePullBackOff or ErrImagePull — both mean the container image can
    // not be pulled and the pod will never start.
    if (waiting?.reason && /ImagePull|ErrImage/i.test(waiting.reason)) {
      return { ...base, state: 'imagePull', reason: waiting.reason };
    }
    const terminated = cs?.lastState?.terminated;
    if (terminated?.reason === 'OOMKilled') {
      return {
        ...base,
        state: 'oomKilled',
        restartCount: cs.restartCount,
        reason: `OOMKilled (${cs.restartCount ?? 0} restarts)`,
      };
    }
  }

  return null;
}

/** Evaluates a PVC. Only Pending / Lost are returned as problems. */
export function evaluatePvc(resource: ResourceLike): PvcHealth | null {
  const status: any = resource.status ?? {};
  const phase = status.phase;
  const base = {
    kind: 'PersistentVolumeClaim' as const,
    name: resource.metadata?.name ?? '',
    namespace: resource.metadata?.namespace,
  };
  if (phase === 'Lost') return { ...base, state: 'lost', reason: 'Volume lost' };
  if (phase === 'Pending')
    return { ...base, state: 'pending', reason: 'Waiting for volume to bind' };
  return null;
}

/**
 * Evaluates a ResourceQuota. Returns the single tightest resource with its
 * usage percentage; anything ≥90% is surfaced (nearLimit or exhausted).
 * Below 90% is fine and returns null.
 */
export function evaluateQuota(resource: ResourceLike): QuotaHealth | null {
  const status: any = resource.status ?? {};
  const hard: Record<string, any> = status.hard ?? {};
  const used: Record<string, any> = status.used ?? {};
  let worstPct = 0;
  let worstResource = '';
  for (const key of Object.keys(hard)) {
    const h = parseQuantity(hard[key]);
    if (!Number.isFinite(h) || h <= 0) continue;
    const u = parseQuantity(used[key] ?? 0);
    if (!Number.isFinite(u)) continue;
    const pct = (u / h) * 100;
    if (pct > worstPct) {
      worstPct = pct;
      worstResource = key;
    }
  }
  if (worstPct < 90) return null;
  const base = {
    kind: 'ResourceQuota' as const,
    name: resource.metadata?.name ?? '',
    namespace: resource.metadata?.namespace,
    worstResource,
    worstUsagePct: worstPct,
  };
  const rounded = Math.round(worstPct);
  if (worstPct >= 100) {
    return { ...base, state: 'exhausted', reason: `${worstResource} at ${rounded}% (exhausted)` };
  }
  return { ...base, state: 'nearLimit', reason: `${worstResource} at ${rounded}% of quota` };
}

/**
 * Evaluates a Service by joining it against the app's EndpointSlices. A
 * headless (no selector) or ExternalName service is skipped — nothing wrong
 * with those having no EndpointSlices with ready addresses.
 */
export function evaluateService(
  resource: ResourceLike,
  endpointSlices: ResourceLike[]
): ServiceHealth | null {
  const spec: any = resource.spec ?? {};
  if (spec.type === 'ExternalName') return null;
  if (!spec.selector || Object.keys(spec.selector).length === 0) return null;
  const name = resource.metadata?.name;
  const ns = resource.metadata?.namespace;
  const matching = endpointSlices.filter(
    es =>
      es.metadata?.namespace === ns && es.metadata?.labels?.['kubernetes.io/service-name'] === name
  );
  const hasReady = matching.some(es =>
    (es.endpoints ?? []).some(
      ep => ep.conditions?.ready === true && (ep.addresses?.length ?? 0) > 0
    )
  );
  if (hasReady) return null;
  return {
    kind: 'Service',
    name: name ?? '',
    namespace: ns,
    state: 'noEndpoints',
    reason: 'No ready backend endpoints',
  };
}

/**
 * Evaluates an Ingress against the app's Services: any backend service the
 * rules point at must exist. Additionally, an Ingress with rules but no
 * loadBalancer address in status is noAddress (controller has not admitted).
 */
export function evaluateIngress(
  resource: ResourceLike,
  services: ResourceLike[]
): IngressHealth | null {
  const spec: any = resource.spec ?? {};
  const status: any = resource.status ?? {};
  const ns = resource.metadata?.namespace;
  const rules: any[] = spec.rules ?? [];
  const missing = new Set<string>();
  const svcExists = (svcName: string) =>
    services.some(s => s.metadata?.namespace === ns && s.metadata?.name === svcName);
  const defaultBackend = spec.defaultBackend?.service?.name;
  if (defaultBackend && !svcExists(defaultBackend)) missing.add(defaultBackend);
  for (const rule of rules) {
    const paths: any[] = rule?.http?.paths ?? [];
    for (const p of paths) {
      const svcName: string | undefined = p?.backend?.service?.name;
      if (svcName && !svcExists(svcName)) missing.add(svcName);
    }
  }
  if (missing.size > 0) {
    const list = Array.from(missing).slice(0, 3).join(', ');
    return {
      kind: 'Ingress',
      name: resource.metadata?.name ?? '',
      namespace: ns,
      state: 'missingBackend',
      reason: `Backend service(s) not found: ${list}`,
    };
  }
  const addrs: any[] = status.loadBalancer?.ingress ?? [];
  if (rules.length > 0 && addrs.length === 0) {
    return {
      kind: 'Ingress',
      name: resource.metadata?.name ?? '',
      namespace: ns,
      state: 'noAddress',
      reason: 'No external address assigned',
    };
  }
  return null;
}

/**
 * Returns service names referenced by Ingress backends in this namespace.
 * Those services are user-facing entrypoints, so "no endpoints" on them is
 * app degradation; private/internal services are surfaced as context only.
 */
function ingressBackendServiceNames(ingresses: ResourceLike[]): Set<string> {
  const names = new Set<string>();
  for (const ing of ingresses) {
    const spec: any = ing.spec ?? {};
    const defaultBackend = spec.defaultBackend?.service?.name;
    if (defaultBackend) names.add(defaultBackend);
    const rules: any[] = spec.rules ?? [];
    for (const rule of rules) {
      const paths: any[] = rule?.http?.paths ?? [];
      for (const p of paths) {
        const svcName: string | undefined = p?.backend?.service?.name;
        if (svcName) names.add(svcName);
      }
    }
  }
  return names;
}

/** Evaluates a PDB. Blocked = disruptionsAllowed is 0 AND it actually
 *  guards pods (desiredHealthy > 0). A PDB with 0/0 healthy means its
 *  selector matches nothing — a stale object, not a real block. */
export function evaluatePdb(resource: ResourceLike): PdbHealth | null {
  const status: any = resource.status ?? {};
  const disruptionsAllowed = status.disruptionsAllowed;
  if (disruptionsAllowed !== 0) return null;
  const desired = status.desiredHealthy ?? 0;
  const current = status.currentHealthy ?? 0;
  if (desired === 0 && current === 0) return null;
  return {
    kind: 'PodDisruptionBudget',
    name: resource.metadata?.name ?? '',
    namespace: resource.metadata?.namespace,
    state: 'blocked',
    reason: `disruptionsAllowed=0 (${current}/${desired} healthy)`,
  };
}

/**
 * Attaches HPA context to the workloads its scaleTargetRef points at. The
 * chip stays honest ("2/5 ready during scale-up") while the popover row
 * shows `HPA: 2–10, current 5` so an operator does not read the scale-up
 * as a flap.
 */
function annotateWorkloadsWithHpa(workloads: WorkloadHealth[], hpas: ResourceLike[]): void {
  for (const hpa of hpas) {
    const spec: any = hpa.spec ?? {};
    const status: any = hpa.status ?? {};
    const target = spec.scaleTargetRef;
    if (!target?.kind || !target?.name) continue;
    const ns = hpa.metadata?.namespace;
    const found = workloads.find(
      w => w.kind === target.kind && w.name === target.name && w.namespace === ns
    );
    if (!found) continue;
    found.hpa = {
      name: hpa.metadata?.name ?? '',
      min: spec.minReplicas ?? 1,
      max: spec.maxReplicas ?? found.desired,
      current: status.currentReplicas,
    };
  }
}

const POD_PROBLEM_RANK: Record<PodProblemState, number> = {
  crashLoop: 0,
  imagePull: 1,
  oomKilled: 2,
  unschedulable: 3,
};

/**
 * Rolls an application's resources into one health verdict. Only workloads
 * count toward the verdict; config, services and RBAC are context, not health.
 * CronJobs are surfaced separately as scheduling context so an operator can
 * see the schedule health without it distorting the "N of X not ready" count.
 */
export function evaluateApplicationHealth(resources: ResourceLike[]): AppHealth {
  const totalResources = resources.length;
  const resourceCountsByKind: Record<string, number> = {};
  for (const r of resources) {
    const k = r.kind ?? 'Unknown';
    resourceCountsByKind[k] = (resourceCountsByKind[k] ?? 0) + 1;
  }
  const workloads = resources
    .filter(r => WORKLOAD_KINDS.has(r.kind ?? ''))
    .map(evaluateWorkload)
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);

  const schedules = resources
    .filter(r => INFO_KINDS.has(r.kind ?? ''))
    .map(evaluateSchedule)
    .sort((a, b) => SCHEDULE_RANK[a.state] - SCHEDULE_RANK[b.state]);

  // HPA lookup: annotate workloads before status classification so the
  // popover can display the min–max range.
  annotateWorkloadsWithHpa(
    workloads,
    resources.filter(r => r.kind === 'HorizontalPodAutoscaler')
  );

  const podProblems = resources
    .filter(r => r.kind === 'Pod')
    .map(evaluatePod)
    .filter((p): p is PodHealth => p !== null)
    .sort((a, b) => POD_PROBLEM_RANK[a.state] - POD_PROBLEM_RANK[b.state]);

  const pvcProblems = resources
    .filter(r => r.kind === 'PersistentVolumeClaim')
    .map(evaluatePvc)
    .filter((p): p is PvcHealth => p !== null)
    // Lost first (data-loss) then Pending.
    .sort((a, b) => (a.state === 'lost' ? -1 : 0) - (b.state === 'lost' ? -1 : 0));

  const quotaProblems = resources
    .filter(r => r.kind === 'ResourceQuota')
    .map(evaluateQuota)
    .filter((q): q is QuotaHealth => q !== null)
    .sort((a, b) => b.worstUsagePct - a.worstUsagePct);

  const services = resources.filter(r => r.kind === 'Service');
  const endpointSlices = resources.filter(r => r.kind === 'EndpointSlice');
  const serviceProblems = services
    .map(s => evaluateService(s, endpointSlices))
    .filter((s): s is ServiceHealth => s !== null);
  const ingresses = resources.filter(r => r.kind === 'Ingress');
  const ingressBackendServices = ingressBackendServiceNames(ingresses);
  const criticalServiceProblems = serviceProblems.filter(s => ingressBackendServices.has(s.name));

  const ingressProblems = resources
    .filter(r => r.kind === 'Ingress')
    .map(i => evaluateIngress(i, services))
    .filter((i): i is IngressHealth => i !== null);

  const pdbProblems = resources
    .filter(r => r.kind === 'PodDisruptionBudget')
    .map(evaluatePdb)
    .filter((p): p is PdbHealth => p !== null);

  // Anything that means "something is actively broken and callers will see
  // errors" bumps to unhealthy. crashLoop / imagePull / oomKilled hide
  // behind a healthy ready count because the ready pod is the previous
  // revision. Lost PVCs mean data is gone.
  const hasHardFault =
    workloads.some(w => w.state === 'down') ||
    podProblems.some(
      p => p.state === 'crashLoop' || p.state === 'imagePull' || p.state === 'oomKilled'
    ) ||
    pvcProblems.some(p => p.state === 'lost');

  // Anything that means "the app is running but under pressure / partially
  // available" bumps to degraded.
  const hasSoftFault =
    workloads.some(w => w.state === 'degraded') ||
    podProblems.some(p => p.state === 'unschedulable') ||
    pvcProblems.some(p => p.state === 'pending') ||
    quotaProblems.some(q => q.state === 'exhausted') ||
    criticalServiceProblems.length > 0 ||
    ingressProblems.some(i => i.state === 'missingBackend');

  let status: AppHealthStatus;
  if (totalResources === 0) {
    status = 'empty';
  } else if (workloads.length === 0 && podProblems.length === 0) {
    status = 'noWorkloads';
  } else if (hasHardFault) {
    status = 'unhealthy';
  } else if (hasSoftFault) {
    status = 'degraded';
  } else if (workloads.some(w => w.state === 'progressing')) {
    status = 'progressing';
  } else if (schedules.some(s => s.chronic)) {
    // A chronically failing scheduled job (no success in >24h) degrades an
    // otherwise-healthy app: silence is the fault when a schedule is meant
    // to run daily but hasn't succeeded in days.
    status = 'degraded';
  } else if (workloads.length > 0 && workloads.every(w => w.state === 'scaledZero')) {
    status = 'idle';
  } else {
    status = 'healthy';
  }

  // scaledZero (intentionally off) and paused (intentionally frozen) are
  // both "not-a-fault" states, so they must not drag down the "N of X ready"
  // denominator the popover displays.
  const counted = workloads.filter(w => w.state !== 'scaledZero' && w.state !== 'paused');
  const readyWorkloads = counted.filter(w => w.state === 'ready').length;

  return {
    status,
    label: PRESENTATION[status].label,
    summary: buildSummary(status, workloads),
    workloads,
    schedules,
    readyWorkloads,
    totalWorkloads: counted.length,
    totalResources,
    resourceCountsByKind,
    podProblems,
    pvcProblems,
    quotaProblems,
    serviceProblems,
    criticalServiceProblems,
    ingressProblems,
    pdbProblems,
  };
}

/**
 * Sort rank for the Health column: worst first when sorting ascending, so
 * "sort by health" surfaces the problems. Also the value the memoized table
 * cell keys on, so it re-renders when an app's health changes.
 */
const STATUS_RANK: Record<AppHealthStatus, number> = {
  unhealthy: 0,
  degraded: 1,
  progressing: 2,
  healthy: 3,
  idle: 4,
  noWorkloads: 5,
  empty: 6,
};

export function healthSortRank(health: AppHealth | undefined, loading: boolean): number {
  if (!health) {
    return loading ? -1 : STATUS_RANK.empty;
  }
  return STATUS_RANK[health.status];
}
