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
 * Pure helpers for interpreting Flux resources. Kept free of Headlamp
 * imports so they can be unit tested in isolation.
 */

export interface KubeCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

/** The JSON of a Flux custom resource; kept loose on purpose. */
export interface FluxObject {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    /** Set by the API server once a delete has been requested; a live deletion. */
    deletionTimestamp?: string;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export type FluxHealth = 'Ready' | 'NotReady' | 'Suspended' | 'Reconciling' | 'Unknown';

export interface FluxStatusInfo {
  health: FluxHealth;
  /** Human readable message from the Ready (or Reconciling/Stalled) condition. */
  message?: string;
  reason?: string;
  lastTransitionTime?: string;
}

export function getConditions(obj: FluxObject): KubeCondition[] {
  return (obj?.status?.conditions as KubeCondition[]) ?? [];
}

export function getCondition(obj: FluxObject, type: string): KubeCondition | undefined {
  return getConditions(obj).find(c => c.type === type);
}

export function isSuspended(obj: FluxObject): boolean {
  return obj?.spec?.suspend === true;
}

/** Summarizes the resource state the way `flux get` does. */
export function getStatusInfo(obj: FluxObject): FluxStatusInfo {
  if (isSuspended(obj)) {
    const ready = getCondition(obj, 'Ready');
    return {
      health: 'Suspended',
      message: 'Reconciliation is suspended (spec.suspend=true)',
      reason: 'Suspended',
      lastTransitionTime: ready?.lastTransitionTime,
    };
  }

  // OCI Helm repositories are static references: the source-controller does
  // not reconcile them, so they never report conditions. That is normal and
  // healthy; not "Unknown".
  if (obj?.kind === 'HelmRepository' && obj?.spec?.type === 'oci') {
    return {
      health: 'Ready',
      reason: 'OCIReference',
      message:
        'OCI Helm repositories are static references; HelmReleases pull charts from them ' +
        'directly, so there is nothing to reconcile and no status is reported.',
    };
  }

  const reconciling = getCondition(obj, 'Reconciling');
  const stalled = getCondition(obj, 'Stalled');
  const ready = getCondition(obj, 'Ready');

  if (stalled?.status === 'True') {
    return {
      health: 'NotReady',
      message: stalled.message,
      reason: stalled.reason,
      lastTransitionTime: stalled.lastTransitionTime,
    };
  }

  if (ready) {
    if (ready.status === 'True') {
      return {
        health: 'Ready',
        message: ready.message,
        reason: ready.reason,
        lastTransitionTime: ready.lastTransitionTime,
      };
    }
    if (ready.status === 'Unknown' || reconciling?.status === 'True') {
      return {
        health: 'Reconciling',
        message: reconciling?.message || ready.message,
        reason: reconciling?.reason || ready.reason,
        lastTransitionTime: ready.lastTransitionTime,
      };
    }
    return {
      health: 'NotReady',
      message: ready.message,
      reason: ready.reason,
      lastTransitionTime: ready.lastTransitionTime,
    };
  }

  return {
    health: 'Unknown',
    message:
      'This resource has not reported any status yet. Its controller may not have observed ' +
      'it, or the controller responsible for it may not be running.',
  };
}

/**
 * Parses a Go duration string like "1h30m", "10m0s" or "90s" into milliseconds.
 * Returns null for missing or unparsable values.
 */
export function parseDuration(duration?: string): number | null {
  if (!duration || typeof duration !== 'string') {
    return null;
  }
  const pattern = /(\d+(?:\.\d+)?)(h|ms|s|m)/g;
  let ms = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(duration)) !== null) {
    matched = true;
    const value = parseFloat(match[1]);
    switch (match[2]) {
      case 'h':
        ms += value * 60 * 60 * 1000;
        break;
      case 'm':
        ms += value * 60 * 1000;
        break;
      case 's':
        ms += value * 1000;
        break;
      case 'ms':
        ms += value;
        break;
    }
  }
  return matched ? ms : null;
}

/**
 * The best known time of the last successful sync:
 * - sources: when the artifact was last updated;
 * - HelmRelease: when the latest release in the history was deployed;
 * - otherwise: when the Ready condition last transitioned.
 */
export function getLastSyncTime(obj: FluxObject): string | undefined {
  const artifactTime = obj?.status?.artifact?.lastUpdateTime;
  if (artifactTime) {
    return artifactTime;
  }
  const history = obj?.status?.history;
  if (Array.isArray(history) && history[0]?.lastDeployed) {
    return history[0].lastDeployed;
  }
  return getCondition(obj, 'Ready')?.lastTransitionTime;
}

/**
 * Approximates the next scheduled reconciliation: last sync + spec.interval.
 * Returns null when suspended or when there is not enough information.
 */
export function getNextSyncTime(obj: FluxObject): Date | null {
  if (isSuspended(obj)) {
    return null;
  }
  const interval = parseDuration(obj?.spec?.interval);
  const last = getLastSyncTime(obj);
  if (!interval || !last) {
    return null;
  }
  const lastMs = new Date(last).getTime();
  if (Number.isNaN(lastMs)) {
    return null;
  }
  const now = Date.now();
  let next = lastMs + interval;
  // If the computed time is already in the past, project it forward so we
  // show the upcoming tick instead of a stale timestamp.
  if (next < now) {
    const missed = Math.ceil((now - next) / interval);
    next += missed * interval;
  }
  return new Date(next);
}

export interface ParsedRevision {
  /** Branch, tag or named pointer, when present (e.g. "main"). */
  ref?: string;
  /** Full hash/digest without the algorithm prefix. */
  hash?: string;
  /** Shortened hash for display. */
  shortHash?: string;
  /** The original revision string. */
  original: string;
}

/**
 * Parses Flux artifact revisions in their known formats:
 * - "main@sha1:76d0e..." (source-controller >= v1)
 * - "v1.2.3@sha256:abc..." (OCI)
 * - "sha256:abc..." (digest only)
 * - "main/76d0e..." (legacy v1beta formats)
 */
export function parseRevision(revision?: string): ParsedRevision {
  if (!revision) {
    return { original: '' };
  }
  const atIndex = revision.indexOf('@');
  if (atIndex !== -1) {
    const ref = revision.slice(0, atIndex);
    const digest = revision.slice(atIndex + 1);
    const hash = digest.includes(':') ? digest.split(':')[1] : digest;
    return { ref, hash, shortHash: shortenHash(hash), original: revision };
  }
  if (/^sha\d+:/.test(revision)) {
    const hash = revision.split(':')[1];
    return { hash, shortHash: shortenHash(hash), original: revision };
  }
  const slashIndex = revision.lastIndexOf('/');
  if (slashIndex !== -1) {
    const ref = revision.slice(0, slashIndex);
    const hash = revision.slice(slashIndex + 1);
    return { ref, hash, shortHash: shortenHash(hash), original: revision };
  }
  return { original: revision, ref: revision };
}

function shortenHash(hash?: string): string | undefined {
  if (!hash) {
    return undefined;
  }
  return hash.length > 10 ? hash.slice(0, 10) : hash;
}

/**
 * Best-effort web URL of a commit, for linking out to the Git host
 * (works for GitHub/GitLab/Gitea-style hosts). Returns undefined when the
 * repository URL cannot be translated to a web URL.
 */
export function getCommitWebUrl(repoUrl?: string, hash?: string): string | undefined {
  if (!repoUrl || !hash) {
    return undefined;
  }
  let base: string | undefined;
  if (repoUrl.startsWith('http://') || repoUrl.startsWith('https://')) {
    base = repoUrl;
  } else if (repoUrl.startsWith('ssh://')) {
    // ssh://git@host[:port]/org/repo
    const m = repoUrl.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
    if (m) {
      base = `https://${m[1]}/${m[2]}`;
    }
  } else {
    // git@host:org/repo(.git)
    const m = repoUrl.match(/^(?:[^@]+@)([^:]+):(.+)$/);
    if (m) {
      base = `https://${m[1]}/${m[2]}`;
    }
  }
  if (!base) {
    return undefined;
  }
  base = base.replace(/\.git$/, '').replace(/\/$/, '');
  const isGitLab = base.includes('gitlab');
  return isGitLab ? `${base}/-/commit/${hash}` : `${base}/commit/${hash}`;
}

/**
 * Normalizes a git/oci/helm/bucket source URL into a browsable https URL so
 * it can be opened directly. SSH and scp-style git URLs are rewritten to
 * their https equivalent; oci:// becomes https://. Returns undefined for
 * things that are not meaningfully browsable.
 */
export function getSourceWebUrl(url?: string): string | undefined {
  if (!url || typeof url !== 'string') {
    return undefined;
  }
  if (url.startsWith('https://')) {
    return url.replace(/\.git$/, '');
  }
  if (url.startsWith('http://')) {
    return url.replace(/\.git$/, '');
  }
  if (url.startsWith('oci://')) {
    return 'https://' + url.slice('oci://'.length);
  }
  if (url.startsWith('ssh://')) {
    const m = url.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
    if (m) {
      return `https://${m[1]}/${m[2]}`.replace(/\.git$/, '');
    }
    return undefined;
  }
  // scp-like: git@host:org/repo(.git)
  const scp = url.match(/^(?:[^@]+@)([^:]+):(.+)$/);
  if (scp) {
    return `https://${scp[1]}/${scp[2]}`.replace(/\.git$/, '');
  }
  // s3://, gcs://, etc. are not browsable.
  return undefined;
}

export interface CommitInfo {
  /** Commit author name (and email when available). */
  author?: string;
  /** First line of the commit message. */
  message?: string;
  /** ISO timestamp of when the source last produced an artifact. */
  time?: string;
}

/**
 * Extracts the commit author / message that Flux records for a source, when
 * present. source-controller >= v1 exposes these under
 * `status.artifact.metadata` with the OCI-style annotation keys.
 */
export function getCommitInfo(obj: FluxObject): CommitInfo {
  const meta = obj?.status?.artifact?.metadata ?? {};
  const author =
    meta['org.opencontainers.image.authors'] ??
    meta['org.opencontainers.image.author'] ??
    meta['author'];
  const message =
    meta['org.opencontainers.image.title'] ?? meta['message'] ?? meta['commit.message'];
  const firstLine = typeof message === 'string' ? message.split('\n')[0] : undefined;
  return {
    author: typeof author === 'string' ? author : undefined,
    message: firstLine,
    time: obj?.status?.artifact?.lastUpdateTime,
  };
}

/** A reference to the source object a Kustomization/HelmRelease pulls from. */
export interface SourceRef {
  kind: string;
  name: string;
  namespace?: string;
}

/** Source reference for Kustomizations and HelmReleases (chartRef or chart.spec.sourceRef). */
export function getSourceRef(obj: FluxObject): SourceRef | undefined {
  const spec = obj?.spec ?? {};
  const ref = spec.sourceRef ?? spec.chartRef ?? spec.chart?.spec?.sourceRef;
  if (!ref?.kind || !ref?.name) {
    return undefined;
  }
  return {
    kind: ref.kind,
    name: ref.name,
    namespace: ref.namespace || obj?.metadata?.namespace,
  };
}

export interface DependencyNode {
  /** "namespace/name" id. */
  id: string;
  name: string;
  namespace: string;
  /** Ids of the dependencies (spec.dependsOn) that exist in the listed set. */
  dependsOn: string[];
  /** Names from spec.dependsOn that are not part of the listed set. */
  missingDependencies: string[];
}

export function makeDependencyNodes(
  objects: FluxObject[],
  defaultNamespace = 'default'
): DependencyNode[] {
  const ids = new Set(
    objects.map(o => `${o.metadata?.namespace || defaultNamespace}/${o.metadata?.name}`)
  );
  return objects.map(o => {
    const namespace = o.metadata?.namespace || defaultNamespace;
    const deps: string[] = [];
    const missing: string[] = [];
    const dependsOn = Array.isArray(o.spec?.dependsOn) ? o.spec!.dependsOn : [];
    for (const dep of dependsOn) {
      if (!dep?.name) {
        continue;
      }
      const depId = `${dep.namespace || namespace}/${dep.name}`;
      if (ids.has(depId)) {
        deps.push(depId);
      } else {
        missing.push(depId);
      }
    }
    return {
      id: `${namespace}/${o.metadata?.name}`,
      name: o.metadata?.name || '',
      namespace,
      dependsOn: deps,
      missingDependencies: missing,
    };
  });
}

export interface DependencyWaves {
  /**
   * Deployment order: wave 0 holds items without dependencies, wave N holds
   * items whose deepest dependency chain has length N. Items in the same
   * wave reconcile in parallel.
   */
  waves: DependencyNode[][];
  /** Nodes that are part of a dependency cycle and can never reconcile. */
  cycles: DependencyNode[];
}

/**
 * Arranges resources into "waves" by their dependsOn relations, i.e. the
 * order in which Flux will apply them.
 */
export function computeDependencyWaves(nodes: DependencyNode[]): DependencyWaves {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const level = new Map<string, number>();

  const remaining = new Set(nodes.map(n => n.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(remaining)) {
      const node = byId.get(id)!;
      const deps = node.dependsOn;
      if (deps.every(d => level.has(d) || !byId.has(d))) {
        const depLevels = deps.filter(d => level.has(d)).map(d => level.get(d)!);
        level.set(id, deps.length === 0 ? 0 : Math.max(-1, ...depLevels) + 1);
        remaining.delete(id);
        changed = true;
      }
    }
  }

  const waves: DependencyNode[][] = [];
  for (const [id, lvl] of level.entries()) {
    waves[lvl] ??= [];
    waves[lvl].push(byId.get(id)!);
  }
  for (const wave of waves) {
    wave?.sort((a, b) => a.id.localeCompare(b.id));
  }

  const cycles = Array.from(remaining)
    .map(id => byId.get(id)!)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { waves: waves.filter(Boolean), cycles };
}

/** Annotation used by Flux to trigger a reconciliation. */
export const RECONCILE_ANNOTATION = 'reconcile.fluxcd.io/requestedAt';
/** Annotation (with requestedAt) used to force a Helm release upgrade. */
export const FORCE_ANNOTATION = 'reconcile.fluxcd.io/forceAt';
