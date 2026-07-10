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
 * An "application" is a business-application namespace: every namespace
 * deployed in a cluster represents one application and the application name
 * is the namespace name. A cluster's namespaces fall into three categories,
 * and only the third is shown as an application:
 *
 *  1. System namespaces (`kube-*`, `openshift-*`, `*-system`, `default`) —
 *     owned by Kubernetes/OpenShift itself.
 *  2. Shared platform/service namespaces (e.g. `cert-manager`,
 *     `quay-registry`, `vault-secrets-operator`) — cluster-wide platform
 *     tooling shared by every business application, not a business
 *     application itself. See {@link PLATFORM_NAMESPACES}.
 *  3. Business application namespaces — everything else. This is what the
 *     Applications tab lists.
 *
 * Extra application metadata (display name, version, deployment type) is read
 * from `uspe.dev/*` labels or annotations on the namespace — the same pattern
 * the Projects feature uses with its `headlamp.dev/project-id` label. Until
 * clusters carry those labels the values are simply not available and are
 * shown as {@link NOT_AVAILABLE}.
 */

/** Label/annotation key carrying the application display name. */
export const APP_NAME_KEY = 'uspe.dev/application-name';
/** Label/annotation key carrying the application version. */
export const APP_VERSION_KEY = 'uspe.dev/application-version';
/** Label/annotation key carrying how the application is deployed. */
export const APP_DEPLOYMENT_TYPE_KEY = 'uspe.dev/deployment-type';

/** Placeholder shown when a piece of application information is not available. */
export const NOT_AVAILABLE = 'NA';

/** One row of the applications table: a namespace in a specific cluster. */
export interface ApplicationInfo {
  /** Unique row id: `<cluster>/<namespace>`. */
  id: string;
  /** Application name: the namespace name (or the uspe.dev name label if set). */
  name: string;
  /** The namespace this application lives in. */
  namespace: string;
  /** The cluster the namespace was found in. */
  cluster: string;
  /** Application version, from the uspe.dev version key; NA when unknown. */
  version: string;
  /** How the application is deployed, from the uspe.dev key; NA when unknown. */
  deploymentType: string;
  /** Namespace phase (Active/Terminating); NA when unknown. */
  status: string;
}

/**
 * The minimal namespace shape needed to build application rows. Both the
 * Namespace KubeObject class and plain fixtures in tests satisfy it.
 */
export interface NamespaceLike {
  metadata: {
    name: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  status?: {
    phase?: string;
  };
  cluster: string;
}

const SYSTEM_NAMESPACE_PREFIXES = ['kube-', 'openshift-'];
const SYSTEM_NAMESPACE_SUFFIXES = ['-system'];
const SYSTEM_NAMESPACES = new Set(['default', 'openshift']);

/**
 * Whether a namespace is a well-known Kubernetes/OpenShift system namespace
 * that should not be listed as an application: `kube-*`, `openshift-*`,
 * `*-system`, and `default`.
 */
export function isSystemNamespace(name: string): boolean {
  return (
    SYSTEM_NAMESPACES.has(name) ||
    SYSTEM_NAMESPACE_PREFIXES.some(p => name.startsWith(p)) ||
    SYSTEM_NAMESPACE_SUFFIXES.some(s => name.endsWith(s))
  );
}

/**
 * Shared platform/service namespaces: cluster-wide tooling used by every
 * business application, not a business application itself. This list is
 * necessarily incomplete — extend it as new shared platform namespaces are
 * added to the clusters.
 */
export const PLATFORM_NAMESPACES = new Set([
  'cert-manager',
  'cert-manager-operator',
  'quay-registry',
  'vault-secrets-operator',
  'ldap-group-sync',
  'cluster-backup',
  'assisted-installer',
]);

/** Suffixes that reliably indicate a shared platform/operator namespace. */
const PLATFORM_NAMESPACE_SUFFIXES = ['-operator'];

/**
 * Whether a namespace is a shared platform/service namespace (see
 * {@link PLATFORM_NAMESPACES}) rather than a business application.
 */
export function isPlatformNamespace(name: string): boolean {
  return PLATFORM_NAMESPACES.has(name) || PLATFORM_NAMESPACE_SUFFIXES.some(s => name.endsWith(s));
}

/**
 * Whether a namespace represents a business application that should be
 * listed in the Applications tab, i.e. neither a system nor a shared
 * platform/service namespace.
 */
export function isBusinessApplicationNamespace(name: string): boolean {
  return !isSystemNamespace(name) && !isPlatformNamespace(name);
}

/**
 * Read an application metadata value from a namespace, checking labels first
 * and then annotations. Returns {@link NOT_AVAILABLE} when the key is absent
 * or empty.
 */
export function getAppMetadataValue(namespace: NamespaceLike, key: string): string {
  return namespace.metadata.labels?.[key] || namespace.metadata.annotations?.[key] || NOT_AVAILABLE;
}

/**
 * Turn the namespaces fetched from all clusters into application rows: one
 * row per (namespace, cluster) pair, system and shared platform namespaces
 * excluded, sorted by name and then cluster so the list is stable.
 */
export function buildApplications(namespaces: ReadonlyArray<NamespaceLike>): ApplicationInfo[] {
  return namespaces
    .filter(ns => !!ns?.metadata?.name && isBusinessApplicationNamespace(ns.metadata.name))
    .map(ns => {
      const nameFromLabel = getAppMetadataValue(ns, APP_NAME_KEY);
      return {
        id: `${ns.cluster}/${ns.metadata.name}`,
        name: nameFromLabel !== NOT_AVAILABLE ? nameFromLabel : ns.metadata.name,
        namespace: ns.metadata.name,
        cluster: ns.cluster,
        version: getAppMetadataValue(ns, APP_VERSION_KEY),
        deploymentType: getAppMetadataValue(ns, APP_DEPLOYMENT_TYPE_KEY),
        status: ns.status?.phase || NOT_AVAILABLE,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.cluster.localeCompare(b.cluster));
}
