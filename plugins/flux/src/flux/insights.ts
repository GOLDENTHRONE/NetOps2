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
 * Turns raw Flux conditions into plain-language operational answers:
 * what is happening, why, what it is waiting for and what to do next.
 * Pure logic, free of Headlamp imports, so it can be unit tested.
 */

import { DependencyNode, FluxHealth, FluxObject, getStatusInfo, isSuspended } from './utils';

/** Broad cause categories, used for grouping, filtering and icon/color choice. */
export type DiagnosisCategory =
  | 'ok'
  | 'progressing'
  | 'suspended'
  | 'dependency'
  | 'source'
  | 'auth'
  | 'build'
  | 'rollout'
  | 'helm'
  | 'image'
  | 'cluster'
  | 'network'
  | 'unknown';

export interface Diagnosis {
  category: DiagnosisCategory;
  /** One plain sentence: what is going on. */
  headline: string;
  /** The likely cause, in plain language (when it can be inferred). */
  explanation?: string;
  /** A concrete next step the operator can take. */
  action?: string;
  /** "namespace/name" ids of the dependencies this resource is waiting for. */
  blockedOn?: string[];
}

/** Extracts "namespace/name" from messages like "dependency 'ns/name' is not ready". */
function parseBlockedDependencies(message: string, ownNamespace: string): string[] {
  const out: string[] = [];
  const pattern = /dependency ['"]?([\w.-]+(?:\/[\w.-]+)?)['"]?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const id = match[1].includes('/') ? match[1] : `${ownNamespace}/${match[1]}`;
    out.push(id);
  }
  return out;
}

interface MessageRule {
  test: RegExp;
  category: DiagnosisCategory;
  explanation: string;
  action: string;
}

/**
 * Ordered heuristics over the condition message. The first match wins, so
 * more specific causes come before generic ones.
 */
const MESSAGE_RULES: MessageRule[] = [
  {
    test: /imagepullbackoff|errimagepull|failed to pull image|pull access denied/i,
    category: 'image',
    explanation: 'A container image could not be pulled from its registry.',
    action:
      'Check that the image name and tag exist and that the cluster has pull access to the registry.',
  },
  {
    test: /crashloopbackoff/i,
    category: 'rollout',
    explanation: 'Pods are starting and then crashing repeatedly.',
    action: 'Open the pod logs to see why the container exits.',
  },
  {
    test: /no matches for kind|could not find the requested resource|apiVersion.*not available/i,
    category: 'cluster',
    explanation:
      'A manifest uses an API kind the cluster does not have — usually a missing CRD or operator.',
    action: 'Install the component that provides this CRD, or order it before this with dependsOn.',
  },
  {
    test: /storageclass/i,
    category: 'cluster',
    explanation: 'A PersistentVolumeClaim references a StorageClass the cluster does not provide.',
    action: 'Create the StorageClass or change the claim to one that exists in this cluster.',
  },
  {
    test: /unauthorized|authentication|invalid credentials|permission denied|forbidden|access denied|401|403/i,
    category: 'auth',
    explanation: 'The credentials for this operation were rejected.',
    action:
      'Check the referenced Secret: the token or key may be wrong, expired or lacking access.',
  },
  {
    test: /exceeded its progress deadline/i,
    category: 'rollout',
    explanation: 'A workload was applied but its pods never became ready in time.',
    action: 'Inspect the workload’s pods and events to see what keeps them from starting.',
  },
  {
    test: /health check.*(failed|timed out)|timeout waiting for/i,
    category: 'rollout',
    explanation: 'The manifests were applied, but the workloads did not become healthy in time.',
    action: 'Check the pods and events of the deployed workloads for the underlying problem.',
  },
  {
    test: /context deadline exceeded|timed out|timeout/i,
    category: 'network',
    explanation: 'The operation ran out of time before completing.',
    action:
      'Check that the target (repository, registry or cluster) is reachable, then sync again.',
  },
  {
    test: /couldn't find remote ref|reference not found|revision.*not found/i,
    category: 'source',
    explanation: 'The configured branch, tag or revision does not exist in the repository.',
    action: 'Fix spec.ref to point at an existing branch or tag.',
  },
  {
    test: /dial tcp|connection refused|no such host|tls|certificate/i,
    category: 'network',
    explanation: 'Flux could not connect to the remote endpoint.',
    action: 'Verify the URL, network access from the cluster and any TLS/certificate settings.',
  },
  {
    test: /kustomization\.yaml|kustomize build|accumulat/i,
    category: 'build',
    explanation: 'The kustomize build of the manifests failed before anything was applied.',
    action: 'Fix the kustomization at the configured path in Git — nothing changed in the cluster.',
  },
  {
    test: /values|template|parse error|yaml|json/i,
    category: 'build',
    explanation: 'The manifests or chart values could not be rendered.',
    action: 'Fix the invalid configuration in Git — nothing was applied to the cluster.',
  },
];

/** Reasons that map straight to a cause, regardless of the message text. */
const REASON_CATEGORY: Record<string, { category: DiagnosisCategory; headline: string }> = {
  DependencyNotReady: { category: 'dependency', headline: 'Waiting for a dependency' },
  ArtifactFailed: { category: 'source', headline: 'The source has no usable artifact' },
  GitOperationFailed: { category: 'source', headline: 'Fetching from Git failed' },
  AuthenticationFailed: { category: 'auth', headline: 'Authentication to the source failed' },
  StorageOperationFailed: {
    category: 'cluster',
    headline: 'The source controller could not store the artifact',
  },
  BuildFailed: { category: 'build', headline: 'Building the manifests failed' },
  HealthCheckFailed: { category: 'rollout', headline: 'Deployed workloads are not healthy' },
  PruneFailed: { category: 'cluster', headline: 'Removing old objects failed' },
  InstallFailed: { category: 'helm', headline: 'The Helm install failed' },
  UpgradeFailed: { category: 'helm', headline: 'The Helm upgrade failed' },
  TestFailed: { category: 'helm', headline: 'The Helm tests failed' },
  RollbackFailed: { category: 'helm', headline: 'Rolling back the Helm release failed' },
  UninstallFailed: { category: 'helm', headline: 'Uninstalling the Helm release failed' },
  RetriesExceeded: { category: 'helm', headline: 'Gave up after too many failed attempts' },
};

const HELM_HOOK_RULE: MessageRule = {
  test: /hook|(pre|post)-(install|upgrade|delete|rollback)/i,
  category: 'helm',
  explanation: 'A Helm lifecycle hook (a Job the chart runs during install/upgrade) failed.',
  action: 'Check the logs of the hook Job in the target namespace.',
};

/**
 * Explains the state of a Flux resource in plain language: what is happening,
 * the likely cause, and what to do about it.
 */
export function diagnose(obj: FluxObject): Diagnosis {
  const info = getStatusInfo(obj);
  const namespace = obj?.metadata?.namespace ?? 'default';
  const message = info.message ?? '';
  const reason = info.reason ?? '';

  if (info.health === 'Suspended') {
    return {
      category: 'suspended',
      headline: 'Paused — changes are not being applied',
      explanation: 'Reconciliation is suspended, so updates in the source are ignored.',
      action: 'Resume the resource when you want Flux to apply changes again.',
    };
  }

  if (info.health === 'Ready') {
    return { category: 'ok', headline: 'Up to date' };
  }

  if (info.health === 'Reconciling' || info.health === 'Unknown') {
    const blockedOn = parseBlockedDependencies(message, namespace);
    if (reason === 'DependencyNotReady' || blockedOn.length > 0) {
      return {
        category: 'dependency',
        headline: 'Waiting for a dependency',
        explanation:
          'This resource is queued behind the resources it depends on. It will start on its own.',
        blockedOn,
      };
    }
    return {
      category: 'progressing',
      headline: 'Deploying now',
      explanation: message || 'Flux is applying the latest changes.',
    };
  }

  // NotReady: find the most specific cause.
  const blockedOn = parseBlockedDependencies(message, namespace);
  const known = REASON_CATEGORY[reason];

  if (known?.category === 'dependency' || (!known && blockedOn.length > 0)) {
    return {
      category: 'dependency',
      headline: 'Blocked by a dependency that is not ready',
      explanation:
        'This resource cannot proceed until its dependency reconciles successfully. Fixing the dependency usually fixes this too.',
      action: 'Follow the dependency below and fix the failure there first.',
      blockedOn,
    };
  }

  const rules = known?.category === 'helm' ? [HELM_HOOK_RULE, ...MESSAGE_RULES] : MESSAGE_RULES;
  const match = rules.find(r => r.test.test(message));

  if (known) {
    return {
      // A message rule pinpoints the concrete cause (e.g. an image pull
      // failure behind a generic HealthCheckFailed), so it wins the category.
      category: match?.category ?? known.category,
      headline: known.headline,
      explanation: match?.explanation ?? (message || undefined),
      action: match?.action,
      blockedOn: blockedOn.length > 0 ? blockedOn : undefined,
    };
  }

  if (match) {
    return {
      category: match.category,
      headline: 'Failing to reconcile',
      explanation: match.explanation,
      action: match.action,
    };
  }

  return {
    category: 'unknown',
    headline: 'Failing to reconcile',
    explanation: message || 'The controller reported a failure without details.',
    action: 'Check the events and conditions below for the underlying error.',
  };
}

/** Retry/failure counters a HelmRelease exposes; empty object for other kinds. */
export interface FailureCounts {
  total?: number;
  install?: number;
  upgrade?: number;
}

export function getFailureCounts(obj: FluxObject): FailureCounts {
  const status = obj?.status ?? {};
  const out: FailureCounts = {};
  if (typeof status.failures === 'number' && status.failures > 0) {
    out.total = status.failures;
  }
  if (typeof status.installFailures === 'number' && status.installFailures > 0) {
    out.install = status.installFailures;
  }
  if (typeof status.upgradeFailures === 'number' && status.upgradeFailures > 0) {
    out.upgrade = status.upgradeFailures;
  }
  return out;
}

/**
 * The namespaces a Kustomization or HelmRelease actually deploys into,
 * derived from the live inventory and the spec — the "where did my
 * deployment land" answer, independent of where the Flux object lives.
 */
export function getTargetNamespaces(obj: FluxObject): string[] {
  const namespaces = new Set<string>();
  const entries = obj?.status?.inventory?.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const namespace = String(entry?.id ?? '').split('_')[0];
      if (namespace) {
        namespaces.add(namespace);
      }
    }
  }
  if (obj?.spec?.targetNamespace) {
    namespaces.add(obj.spec.targetNamespace);
  }
  if (obj?.kind === 'HelmRelease' && namespaces.size === 0 && obj?.metadata?.namespace) {
    // Without an explicit target, Helm installs into the release's namespace.
    namespaces.add(obj.metadata.namespace);
  }
  return Array.from(namespaces).sort((a, b) => a.localeCompare(b));
}

/** All ids (transitively) that `id` depends on — its upstream chain. */
export function collectUpstream(nodes: DependencyNode[], id: string): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependsOn ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    queue.push(...(byId.get(next)?.dependsOn ?? []));
  }
  return seen;
}

/** All ids that (transitively) depend on `id` — its downstream consumers. */
export function collectDownstream(nodes: DependencyNode[], id: string): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), node.id]);
    }
  }
  const seen = new Set<string>();
  const queue = [...(dependents.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    queue.push(...(dependents.get(next) ?? []));
  }
  return seen;
}

export type WaveState = 'complete' | 'active' | 'blocked' | 'waiting';

/**
 * The live state of one deployment wave, from the health of its members:
 * every member ready → complete; anything failing → blocked; anything
 * reconciling → active; otherwise (queued behind an earlier wave) → waiting.
 */
export function summarizeWave(healths: FluxHealth[]): WaveState {
  if (healths.length > 0 && healths.every(h => h === 'Ready' || h === 'Suspended')) {
    return 'complete';
  }
  if (healths.some(h => h === 'NotReady')) {
    return 'blocked';
  }
  if (healths.some(h => h === 'Reconciling')) {
    return 'active';
  }
  return 'waiting';
}

/** True when the resource is failing because of a dependency, not itself. */
export function isBlockedOnDependency(obj: FluxObject): boolean {
  if (isSuspended(obj)) {
    return false;
  }
  return diagnose(obj).category === 'dependency';
}
