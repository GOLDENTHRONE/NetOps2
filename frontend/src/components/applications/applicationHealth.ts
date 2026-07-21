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
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job']);

/** Loose shape of a resource; only the fields we read are named. */
export interface ResourceLike {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

/** The health of one workload within an application. */
export type WorkloadState = 'ready' | 'progressing' | 'degraded' | 'down' | 'scaledZero';

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
  /** Workloads that are fully ready / total workloads (scaled-to-zero excluded). */
  readyWorkloads: number;
  totalWorkloads: number;
  /** Total resources the app owns (all kinds), for context. */
  totalResources: number;
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
  // Deployment / StatefulSet / ReplicaSet. Kinds that don't report a
  // rollout-progress count (ReplicaSets have no updatedReplicas) must not
  // read as "rolling out" forever, so fall back to the ready count.
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
  const base: WorkloadHealth = { kind, name, namespace, desired, ready, updated, state: 'ready' };

  // Jobs are run-to-completion, so replica logic does not apply: a Job that
  // is still running is progressing (not "down"), and only the Failed
  // condition means failure.
  if (kind === 'Job') {
    const status: any = resource.status ?? {};
    if (conditionStatus(resource.status, 'Failed') === 'True') {
      return { ...base, state: 'down', reason: 'Job failed' };
    }
    if (conditionStatus(resource.status, 'Complete') === 'True' || ready >= desired) {
      return { ...base, state: 'ready', reason: `${ready}/${desired} completions` };
    }
    if ((resource.spec as any)?.suspend === true) {
      return { ...base, state: 'scaledZero', reason: 'Suspended' };
    }
    return {
      ...base,
      state: 'progressing',
      reason:
        (status.active ?? 0) > 0
          ? `Running (${status.active} active)`
          : `Waiting to run (${ready}/${desired} completions)`,
    };
  }

  // Intentionally scaled to zero: a valid, not-unhealthy state.
  if (desired === 0) {
    return { ...base, state: 'scaledZero', reason: 'Scaled to zero' };
  }

  // A Deployment whose rollout blew its deadline is stuck.
  if (kind === 'Deployment') {
    if (conditionReason(resource.status, 'Progressing') === 'ProgressDeadlineExceeded') {
      return {
        ...base,
        state: 'down',
        reason: `Rollout stuck (deadline exceeded), ${ready}/${desired} ready`,
      };
    }
    if (conditionStatus(resource.status, 'Available') === 'False' && ready === 0) {
      return { ...base, state: 'down', reason: `Not available, 0/${desired} ready` };
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

const STATE_RANK: Record<WorkloadState, number> = {
  down: 0,
  degraded: 1,
  progressing: 2,
  ready: 3,
  scaledZero: 4,
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
 * Rolls an application's resources into one health verdict. Only workloads
 * count toward the verdict; config, services and RBAC are context, not health.
 */
export function evaluateApplicationHealth(resources: ResourceLike[]): AppHealth {
  const totalResources = resources.length;
  const workloads = resources
    .filter(r => WORKLOAD_KINDS.has(r.kind ?? ''))
    .map(evaluateWorkload)
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);

  let status: AppHealthStatus;
  if (totalResources === 0) {
    status = 'empty';
  } else if (workloads.length === 0) {
    status = 'noWorkloads';
  } else if (workloads.some(w => w.state === 'down')) {
    status = 'unhealthy';
  } else if (workloads.some(w => w.state === 'degraded')) {
    status = 'degraded';
  } else if (workloads.some(w => w.state === 'progressing')) {
    status = 'progressing';
  } else if (workloads.every(w => w.state === 'scaledZero')) {
    status = 'idle';
  } else {
    status = 'healthy';
  }

  const counted = workloads.filter(w => w.state !== 'scaledZero');
  const readyWorkloads = counted.filter(w => w.state === 'ready').length;

  return {
    status,
    label: PRESENTATION[status].label,
    summary: buildSummary(status, workloads),
    workloads,
    readyWorkloads,
    totalWorkloads: counted.length,
    totalResources,
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
