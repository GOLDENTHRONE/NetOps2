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

import {
  DependencyNode,
  FluxHealth,
  FluxObject,
  getSourceRef,
  getStatusInfo,
  isSuspended,
} from './utils';

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
      'A manifest uses an API kind the cluster does not have; usually a missing CRD or operator.',
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
    action: 'Fix the kustomization at the configured path in Git; nothing changed in the cluster.',
  },
  {
    test: /values|template|parse error|yaml|json/i,
    category: 'build',
    explanation: 'The manifests or chart values could not be rendered.',
    action: 'Fix the invalid configuration in Git; nothing was applied to the cluster.',
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
      headline: 'Paused: changes are not being applied',
      explanation: 'Reconciliation is suspended, so updates in the source are ignored.',
      action: 'Resume the resource when you want Flux to apply changes again.',
    };
  }

  if (info.health === 'Ready') {
    return { category: 'ok', headline: 'Up to date' };
  }

  if (info.health === 'Unknown') {
    return {
      category: 'unknown',
      headline: 'No status reported yet',
      explanation: message || undefined,
    };
  }

  if (info.health === 'Reconciling') {
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
 * derived from the live inventory and the spec; the "where did my
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

/** All ids (transitively) that `id` depends on; its upstream chain. */
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

/** All ids that (transitively) depend on `id`; its downstream consumers. */
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

/**
 * What each condition type means, in plain language, so nobody has to know
 * the Flux condition contract to read the Conditions table.
 */
export const CONDITION_MEANINGS: Record<string, string> = {
  Ready:
    'The overall verdict: True means the last reconciliation fully succeeded and the desired ' +
    'state is applied. False means it failed; the message says why. Unknown means it is ' +
    'still in progress.',
  Reconciling:
    'True while the controller is actively working on this resource (fetching, building or ' +
    'applying changes). It clears once the work finishes.',
  Stalled:
    'True when the controller gave up retrying; the failure needs a human (or a change in ' +
    'Git) to resolve. Nothing more will happen until then.',
  Healthy:
    'True when all the health checks on the deployed workloads pass; the applied objects ' +
    'are not just created, they are actually running.',
  ArtifactInStorage:
    'True when the source controller has downloaded this source and stored a snapshot ' +
    '(artifact) that Kustomizations and HelmReleases can consume.',
  FetchFailed:
    'True when the latest attempt to fetch from the remote (Git, OCI, Helm repo or bucket) ' +
    'failed; usually credentials, network or a missing ref.',
  SourceVerified:
    'True when the cryptographic verification of the source (e.g. commit signature or ' +
    'artifact signature) succeeded.',
  Released: 'True when the Helm install/upgrade for the current revision completed successfully.',
  TestSuccess: 'True when the Helm tests for the current release passed.',
  Remediated:
    'True when a failed Helm release was remediated (rolled back or uninstalled) after a ' +
    'failure. Look at the history to see what happened.',
};

/**
 * Best-effort plural for building CRD names (e.g. VaultStaticSecret →
 * vaultstaticsecrets). Matches the pluralization Kubernetes code generators
 * use for the overwhelming majority of kinds.
 */
export function pluralizeKind(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') || lower.endsWith('ch')) {
    return `${lower}es`;
  }
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

/** A Kubernetes object mentioned inside a condition/event message. */
export interface MentionedResource {
  kind: string;
  namespace?: string;
  name: string;
}

/** Kinds worth linking when they appear in messages. */
const LINKABLE_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Pod',
  'Job',
  'CronJob',
  'Service',
  'Ingress',
  'ConfigMap',
  'Secret',
  'PersistentVolumeClaim',
  'HelmRelease',
  'Kustomization',
  'GitRepository',
  'HelmChart',
  'OCIRepository',
  'Bucket',
]);

/** Labels Flux's kustomize-controller stamps on everything it applies. */
export const KUSTOMIZE_NAME_LABEL = 'kustomize.toolkit.fluxcd.io/name';
export const KUSTOMIZE_NAMESPACE_LABEL = 'kustomize.toolkit.fluxcd.io/namespace';

/**
 * Labels an operator stamps on every object of an application (via kustomize
 * commonLabels or Helm chart values) so the whole application stays grouped
 * even after its root Kustomization is deleted during a termination. The
 * name label is the application identity; the version label is optional.
 */
export const APP_NAME_LABEL = 'uspe.dev/application-name';
export const APP_VERSION_LABEL = 'uspe.dev/application-version';

/** The namespace Flux itself is installed into; always treated as a control namespace. */
export const FLUX_SYSTEM_NAMESPACE = 'flux-system';

/** A workload name prefix used to attribute pods to an application. */
export interface WorkloadPrefix {
  namespace: string;
  prefix: string;
}

/**
 * One "application" as an operator thinks of it: everything deployed from
 * one source (Git/OCI repository or bucket), no matter how many
 * Kustomizations, HelmReleases or namespaces are involved under the hood.
 * Standalone HelmReleases (not defined by any Kustomization) form their
 * own application.
 */
export interface Application {
  /** "Kind/namespace/name" of the grouping object (source or root applier). */
  id: string;
  name: string;
  namespace: string;
  /**
   * The card title: the uspe.dev/application-name label when present,
   * otherwise the source/root name. Robust to root deletion.
   */
  displayName: string;
  /** The uspe.dev/application-version label, when the operator stamps one. */
  version?: string;
  /** True when grouping is driven by the application-name label. */
  labelGrouped: boolean;
  /** The kind the card represents: GitRepository, OCIRepository, Bucket, Kustomization or HelmRelease. */
  rootKind: string;
  /** All Flux appliers in this application. */
  members: { kind: string; object: FluxObject }[];
  /** Every namespace the application touches, control namespaces included. */
  targetNamespaces: string[];
  /** The namespaces where the application's own workloads live (control namespaces removed). */
  appNamespaces: string[];
  /** True when a Flux/control namespace was hidden from the app namespaces. */
  managedByFlux: boolean;
  /** Workload name prefixes for matching this application's pods. */
  workloadPrefixes: WorkloadPrefix[];
}

/**
 * The label value used to group this applier into an application, or
 * undefined when it carries no application-name label.
 */
function appNameLabel(obj: FluxObject): string | undefined {
  const value = (obj?.metadata as any)?.labels?.[APP_NAME_LABEL];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function definedById(obj: FluxObject): string | undefined {
  const labels = (obj?.metadata as any)?.labels ?? {};
  const name = labels[KUSTOMIZE_NAME_LABEL];
  if (!name) {
    return undefined;
  }
  const namespace = labels[KUSTOMIZE_NAMESPACE_LABEL] ?? obj?.metadata?.namespace ?? '';
  return `${namespace}/${name}`;
}

const APP_WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

/** Source kinds an application groups under: one repository, one card. */
const APP_SOURCE_KINDS = new Set(['GitRepository', 'OCIRepository', 'Bucket']);

/**
 * Groups Kustomizations and HelmReleases into applications. Roots (appliers
 * not created by another Kustomization) collect everything whose defined-by
 * chain leads back to them; roots pulling from the same Git/OCI source are
 * then merged, so one repository reads as one application no matter how
 * many Kustomizations it is split into.
 */
export function buildApplications(objects: { kind: string; object: FluxObject }[]): Application[] {
  const appliers = objects.filter(o => o.kind === 'Kustomization' || o.kind === 'HelmRelease');
  const kustomizationsById = new Map<string, FluxObject>();
  for (const { kind, object } of appliers) {
    if (kind === 'Kustomization') {
      kustomizationsById.set(
        `${object.metadata?.namespace ?? ''}/${object.metadata?.name ?? ''}`,
        object
      );
    }
  }

  /** Follows defined-by labels up to the topmost Kustomization we know of. */
  const rootOf = (obj: FluxObject): FluxObject => {
    let current = obj;
    const seen = new Set<string>();
    for (;;) {
      const id = `${current.metadata?.namespace ?? ''}/${current.metadata?.name ?? ''}`;
      if (seen.has(id)) {
        return current;
      }
      seen.add(id);
      const parentId = definedById(current);
      if (!parentId || parentId === id) {
        return current;
      }
      const parent = kustomizationsById.get(parentId);
      if (!parent) {
        return current;
      }
      current = parent;
    }
  };

  const apps = new Map<string, Application>();
  for (const { kind, object } of appliers) {
    // The application-name label wins: it groups every applier of the
    // application together and keeps the card alive even once the root
    // Kustomization that defined them has been deleted.
    const label = appNameLabel(object);

    let appId: string;
    let groupKind: string;
    let groupNamespace: string;
    let groupName: string;

    if (label) {
      appId = `app/${label}`;
      groupName = label;
      // The Flux objects live in a control namespace (usually flux-system);
      // remember one so navigation and namespace filtering have an anchor.
      groupNamespace = object.metadata?.namespace ?? '';
      groupKind = kind;
    } else {
      const root = rootOf(object);
      const rootKind = root === object ? kind : 'Kustomization';

      // Merge roots that pull from the same repository: the source is the
      // application, its Kustomizations are implementation detail.
      const sourceRef = rootKind === 'Kustomization' ? getSourceRef(root) : undefined;
      const groupsBySource = !!sourceRef && APP_SOURCE_KINDS.has(sourceRef.kind);
      groupKind = groupsBySource ? sourceRef!.kind : rootKind;
      groupNamespace = groupsBySource
        ? sourceRef!.namespace ?? root.metadata?.namespace ?? ''
        : root.metadata?.namespace ?? '';
      groupName = groupsBySource ? sourceRef!.name : root.metadata?.name ?? '';
      appId = `${groupKind}/${groupNamespace}/${groupName}`;
    }

    let app = apps.get(appId);
    if (!app) {
      app = {
        id: appId,
        name: groupName,
        namespace: groupNamespace,
        displayName: label ?? groupName,
        version: undefined,
        labelGrouped: !!label,
        rootKind: groupKind,
        members: [],
        targetNamespaces: [],
        appNamespaces: [],
        managedByFlux: false,
        workloadPrefixes: [],
      };
      apps.set(appId, app);
    }
    // A version label on any member describes the whole application.
    const version = (object?.metadata as any)?.labels?.[APP_VERSION_LABEL];
    if (!app.version && typeof version === 'string' && version.length > 0) {
      app.version = version;
    }
    app.members.push({ kind, object });
  }

  for (const app of apps.values()) {
    const namespaces = new Set<string>();
    const controlNamespaces = new Set<string>([FLUX_SYSTEM_NAMESPACE]);
    const prefixes: WorkloadPrefix[] = [];
    for (const { kind, object } of app.members) {
      // The namespace the Flux applier object lives in is a control namespace,
      // not somewhere the application's own workloads run.
      if (object?.metadata?.namespace) {
        controlNamespaces.add(object.metadata.namespace);
      }
      for (const namespace of getTargetNamespaces(object)) {
        namespaces.add(namespace);
      }
      const entries = object?.status?.inventory?.entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const [namespace, name, , entryKind] = String(entry?.id ?? '').split('_');
          if (namespace && name && APP_WORKLOAD_KINDS.has(entryKind)) {
            prefixes.push({ namespace, prefix: name });
          }
        }
      }
      if (kind === 'HelmRelease') {
        const releaseName = object?.spec?.releaseName ?? object?.metadata?.name;
        const namespace = object?.spec?.targetNamespace ?? object?.metadata?.namespace;
        if (releaseName && namespace) {
          prefixes.push({ namespace, prefix: releaseName });
        }
      }
    }
    app.targetNamespaces = Array.from(namespaces).sort((a, b) => a.localeCompare(b));
    // Show only where the application actually deploys; the control namespace
    // that merely holds the parent Kustomization objects is misleading noise.
    const appNamespaces = app.targetNamespaces.filter(ns => !controlNamespaces.has(ns));
    if (appNamespaces.length > 0) {
      app.appNamespaces = appNamespaces;
      app.managedByFlux = appNamespaces.length < app.targetNamespaces.length;
    } else {
      // The app deploys into (only) a control namespace: keep it rather than
      // showing an empty card, but flag that Flux manages it.
      app.appNamespaces = app.targetNamespaces;
      app.managedByFlux = app.targetNamespaces.some(ns => controlNamespaces.has(ns));
    }
    app.workloadPrefixes = prefixes;
  }

  return Array.from(apps.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** A pod problem worth an operator's attention. */
export interface PodIssue {
  name: string;
  namespace: string;
  reason: string;
}

export interface PodsSummary {
  total: number;
  ready: number;
  issues: PodIssue[];
}

function podMatchesApp(pod: FluxObject, app: Application): boolean {
  const namespace = pod?.metadata?.namespace ?? '';
  const name = pod?.metadata?.name ?? '';
  if (!app.targetNamespaces.includes(namespace)) {
    return false;
  }
  const prefixesInNamespace = app.workloadPrefixes.filter(p => p.namespace === namespace);
  if (prefixesInNamespace.length === 0) {
    // No workload names known for this namespace: attribute by namespace.
    return true;
  }
  return prefixesInNamespace.some(p => name === p.prefix || name.startsWith(`${p.prefix}-`));
}

/**
 * The live pod health of an application: how many pods are ready, and the
 * concrete problems (CrashLoopBackOff, image pull failures, stuck Pending)
 * an operator would otherwise dig for by hand.
 */
export function summarizeAppPods(app: Application, pods: FluxObject[]): PodsSummary {
  const summary: PodsSummary = { total: 0, ready: 0, issues: [] };
  for (const pod of pods) {
    if (!podMatchesApp(pod, app)) {
      continue;
    }
    const status: any = pod?.status ?? {};
    const phase = status.phase;
    if (phase === 'Succeeded') {
      // Finished jobs are not "unready".
      continue;
    }
    summary.total += 1;
    const containerStatuses: any[] = status.containerStatuses ?? [];
    const allReady =
      containerStatuses.length > 0 && containerStatuses.every((c: any) => c?.ready === true);
    if (phase === 'Running' && allReady) {
      summary.ready += 1;
      continue;
    }
    const waitingReason = containerStatuses
      .map((c: any) => c?.state?.waiting?.reason)
      .find(Boolean);
    const reason = waitingReason ?? (phase === 'Failed' ? 'Failed' : phase ?? 'NotReady');
    summary.issues.push({
      name: pod?.metadata?.name ?? '',
      namespace: pod?.metadata?.namespace ?? '',
      reason,
    });
  }
  return summary;
}

export type AppHealth = 'Healthy' | 'Degraded' | 'Failing' | 'Deploying' | 'Terminating' | 'Suspended';

/**
 * One verdict for the whole application, the way an operator would judge
 * it: an in-flight deletion wins (so a deleted app never reads "Deploying"),
 * then Flux failures beat pod problems beat in-flight work beat all-quiet.
 */
export function summarizeApplication(
  app: Application,
  podsSummary?: PodsSummary
): {
  health: AppHealth;
  reconciling: boolean;
  terminating: boolean;
  failingMembers: number;
  readyMembers: number;
} {
  let failingMembers = 0;
  let readyMembers = 0;
  let reconciling = false;
  let suspended = 0;
  let terminatingMembers = 0;
  for (const { object } of app.members) {
    if (object?.metadata?.deletionTimestamp) {
      terminatingMembers += 1;
      continue;
    }
    const health = getStatusInfo(object).health;
    if (health === 'NotReady') {
      failingMembers += 1;
    } else if (health === 'Ready') {
      readyMembers += 1;
    } else if (health === 'Reconciling') {
      reconciling = true;
    } else if (health === 'Suspended') {
      suspended += 1;
    }
  }
  const terminating = terminatingMembers > 0;
  let health: AppHealth;
  if (terminating) {
    health = 'Terminating';
  } else if (failingMembers > 0) {
    health = 'Failing';
  } else if (
    podsSummary &&
    (podsSummary.issues.length > 0 || podsSummary.ready < podsSummary.total)
  ) {
    health = 'Degraded';
  } else if (reconciling) {
    health = 'Deploying';
  } else if (suspended > 0 && readyMembers === 0) {
    health = 'Suspended';
  } else {
    health = 'Healthy';
  }
  return { health, reconciling, terminating, failingMembers, readyMembers };
}

/**
 * The specific lifecycle operation an application is undergoing, read from
 * real controller state (never guessed): a deletion in flight, a Helm
 * install/upgrade/rollback, or a Kustomization first apply/patch.
 */
export type AppOperation =
  | 'installing'
  | 'upgrading'
  | 'patching'
  | 'rollingback'
  | 'terminating'
  | 'deploying'
  | 'idle';

/**
 * The lifecycle operation of one Flux applier, from its live status. Returns
 * 'idle' unless an operation is actually in flight (reconciling or deleting),
 * so a healthy, settled resource never reads as "deploying".
 */
export function memberOperation(obj: FluxObject): AppOperation {
  if (obj?.metadata?.deletionTimestamp) {
    return 'terminating';
  }
  const info = getStatusInfo(obj);
  if (info.health === 'Suspended' || info.health === 'Ready' || info.health === 'NotReady') {
    return 'idle';
  }
  if (info.health !== 'Reconciling') {
    return 'idle';
  }
  const status = obj?.status ?? {};
  const message = (info.message ?? '').toLowerCase();
  const reason = (info.reason ?? '').toLowerCase();

  if (obj?.kind === 'HelmRelease') {
    const action = String(status.lastAttemptedReleaseAction ?? '').toLowerCase();
    const history = Array.isArray(status.history) ? status.history : [];
    const latestStatus = String(history[0]?.status ?? '').toLowerCase();
    if (
      action === 'rollback' ||
      latestStatus.startsWith('pending-rollback') ||
      reason.includes('rollback') ||
      message.includes('rollback') ||
      message.includes('remediat')
    ) {
      return 'rollingback';
    }
    if (
      action === 'upgrade' ||
      latestStatus === 'pending-upgrade' ||
      reason.includes('upgrade') ||
      message.includes('upgrade')
    ) {
      return 'upgrading';
    }
    if (
      action === 'install' ||
      latestStatus === 'pending-install' ||
      history.length === 0 ||
      reason.includes('install') ||
      message.includes('install')
    ) {
      return 'installing';
    }
    return 'deploying';
  }

  if (obj?.kind === 'Kustomization') {
    // No revision has ever been applied: this is a first install. A prior
    // applied revision means we are patching existing objects in place.
    return status.lastAppliedRevision ? 'patching' : 'installing';
  }

  return 'deploying';
}

/** From most to least significant when several members are mid-operation. */
const OPERATION_PRIORITY: AppOperation[] = [
  'terminating',
  'rollingback',
  'installing',
  'upgrading',
  'patching',
  'deploying',
  'idle',
];

/** Live rollout numbers for an application's workloads (real replica counts). */
export interface RolloutProgress {
  /** Desired replicas across the application's workloads. */
  desired: number;
  /** Replicas already on the latest revision. */
  updated: number;
  /** Ready replicas. */
  ready: number;
  /** True while at least one workload has not finished rolling out. */
  rolling: boolean;
}

/** True when a live workload belongs to this application. */
function workloadMatchesApp(workload: FluxObject, app: Application): boolean {
  const namespace = workload?.metadata?.namespace ?? '';
  const name = workload?.metadata?.name ?? '';
  if (!app.targetNamespaces.includes(namespace)) {
    return false;
  }
  const prefixes = app.workloadPrefixes.filter(p => p.namespace === namespace);
  if (prefixes.length === 0) {
    return true;
  }
  return prefixes.some(p => name === p.prefix || name.startsWith(`${p.prefix}-`));
}

/**
 * Sums the live rollout state of an application's Deployments, StatefulSets
 * and DaemonSets. Every number comes straight from the workload status, so
 * "3 of 10 pods updated" reflects what the cluster actually reports.
 */
export function summarizeAppRollout(app: Application, workloads: FluxObject[]): RolloutProgress {
  const out: RolloutProgress = { desired: 0, updated: 0, ready: 0, rolling: false };
  for (const workload of workloads) {
    if (!workloadMatchesApp(workload, app)) {
      continue;
    }
    const spec: any = workload?.spec ?? {};
    const status: any = workload?.status ?? {};
    let desired: number;
    let updated: number;
    let ready: number;
    if (workload?.kind === 'DaemonSet') {
      desired = status.desiredNumberScheduled ?? 0;
      updated = status.updatedNumberScheduled ?? 0;
      ready = status.numberReady ?? 0;
    } else {
      desired = spec.replicas ?? status.replicas ?? 0;
      updated = status.updatedReplicas ?? 0;
      ready = status.readyReplicas ?? 0;
    }
    out.desired += desired;
    out.updated += Math.min(updated, desired);
    out.ready += Math.min(ready, desired);
    if (updated < desired || ready < desired) {
      out.rolling = true;
    }
  }
  return out;
}

/** The whole-application lifecycle verdict shown on the card. */
export interface AppLifecycle {
  operation: AppOperation;
  /** True when an operation is actually in flight. */
  active: boolean;
  /** Real progress toward completing the current operation, when measurable. */
  progress?: { current: number; total: number; unit: string };
}

/**
 * The application's current lifecycle operation and its real progress,
 * combining Flux applier state with live workload rollout numbers. Progress
 * is always measured, never estimated: member reconciliations for
 * install/upgrade, pod rollout for patches, remaining objects for deletions.
 */
export function summarizeAppLifecycle(
  app: Application,
  opts?: { rollout?: RolloutProgress; pods?: PodsSummary }
): AppLifecycle {
  let operation: AppOperation = 'idle';
  let readyMembers = 0;
  for (const { object } of app.members) {
    const memberOp = memberOperation(object);
    if (
      OPERATION_PRIORITY.indexOf(memberOp) < OPERATION_PRIORITY.indexOf(operation)
    ) {
      operation = memberOp;
    }
    if (!object?.metadata?.deletionTimestamp && getStatusInfo(object).health === 'Ready') {
      readyMembers += 1;
    }
  }

  if (operation === 'idle') {
    return { operation, active: false };
  }

  const rollout = opts?.rollout;
  const pods = opts?.pods;
  const totalMembers = app.members.length;

  if (operation === 'terminating') {
    // Progress toward gone: the fewer objects remain, the closer we are.
    const remaining = (pods?.total ?? 0) + app.members.length;
    return {
      operation,
      active: true,
      progress: remaining > 0 ? { current: remaining, total: remaining, unit: 'remaining' } : undefined,
    };
  }

  // Prefer live pod rollout when workloads are actually rolling (the "3/10
  // pods" answer); fall back to member reconciliation (the "5/20 releases"
  // answer) for multi-member apps; finally to pod readiness.
  if (rollout && rollout.desired > 0 && rollout.rolling) {
    return {
      operation,
      active: true,
      progress: { current: rollout.updated, total: rollout.desired, unit: 'pods' },
    };
  }
  if (totalMembers > 1) {
    return {
      operation,
      active: true,
      progress: { current: readyMembers, total: totalMembers, unit: 'resources' },
    };
  }
  if (pods && pods.total > 0) {
    return {
      operation,
      active: true,
      progress: { current: pods.ready, total: pods.total, unit: 'pods' },
    };
  }
  return { operation, active: true };
}

/**
 * Finds Kubernetes objects referenced in a controller message, e.g. the
 * "Deployment/apps/web status: 'Failed'" pieces of a failed health check -
 * so the UI can link straight to the failing workload.
 */
export function extractMentionedResources(message?: string): MentionedResource[] {
  if (!message) {
    return [];
  }
  const seen = new Set<string>();
  const out: MentionedResource[] = [];
  // Kind/namespace/name first (Flux health checks), then Kind/name.
  const pattern = /\b([A-Z][A-Za-z]+)\/([a-z0-9][a-z0-9.-]*)(?:\/([a-z0-9][a-z0-9.-]*))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const [, kind, first, second] = match;
    if (!LINKABLE_KINDS.has(kind)) {
      continue;
    }
    const ref: MentionedResource = second
      ? { kind, namespace: first, name: second }
      : { kind, name: first };
    const key = `${ref.kind}/${ref.namespace ?? ''}/${ref.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}
