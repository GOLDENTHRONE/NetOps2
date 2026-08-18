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

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { clusterRequest } from '../../../lib/k8s/api/v1/clusterRequests';

/**
 * Path of the OpenShift ClusterVersion resource that holds the OCP version a
 * cluster is running. It only exists on OpenShift clusters.
 */
export const OCP_CLUSTER_VERSION_PATH = '/apis/config.openshift.io/v1/clusterversions/version';

/**
 * How long an OCP version lookup is considered fresh. Cluster upgrades are
 * rare, so there is no need to ask every cluster over and over.
 */
const OCP_VERSION_STALE_TIME = 5 * 60 * 1000; // ms

/**
 * Kubernetes minor version to OpenShift Container Platform minor version.
 *
 * Used as a fallback for clusters that look like OpenShift but whose
 * ClusterVersion resource cannot be read (for example when the user is not
 * allowed to get cluster scoped config resources).
 */
const KUBERNETES_MINOR_TO_OCP: { [minor: number]: string } = {
  16: '4.3',
  17: '4.4',
  18: '4.5',
  19: '4.6',
  20: '4.7',
  21: '4.8',
  22: '4.9',
  23: '4.10',
  24: '4.11',
  25: '4.12',
  26: '4.13',
  27: '4.14',
  28: '4.15',
  29: '4.16',
  30: '4.17',
  31: '4.18',
  32: '4.19',
  33: '4.20',
};

/**
 * OpenShift reports the Kubernetes version with the OpenShift build commit
 * appended, e.g. "v1.29.14+29b5494". Other distributions use the same build
 * metadata separator (k3s uses "+k3s1"), so only a commit-like suffix is
 * treated as OpenShift.
 */
const OPENSHIFT_GIT_VERSION_REGEX = /^v?(\d+)\.(\d+)(?:\.\d+)?\+[0-9a-f]{6,}$/;

/**
 * The state of an OCP version lookup for a single cluster.
 *
 * - `undefined`: the lookup has not finished yet.
 * - `null`: the lookup finished and the cluster has no OCP version (it is not
 *   an OpenShift cluster, or the resource cannot be read).
 * - `string`: the OCP version the cluster runs.
 */
export type OcpVersion = string | null | undefined;

/** OCP version lookup results, keyed by cluster name. */
export interface ClusterOcpVersions {
  [cluster: string]: OcpVersion;
}

/**
 * Reads the OCP version out of an OpenShift ClusterVersion resource.
 *
 * The completed entry of the update history is what the cluster is actually
 * running; `status.desired` is used as a fallback since it is what the cluster
 * is (or has been) moving to.
 *
 * @param clusterVersion - the ClusterVersion resource, as returned by the API.
 * @returns the OCP version, or null when the resource does not carry one.
 */
export function getOcpVersionFromClusterVersion(clusterVersion: any): string | null {
  const history = clusterVersion?.status?.history;
  if (Array.isArray(history)) {
    const completed = history.find(entry => entry?.state === 'Completed' && !!entry?.version);
    if (completed) {
      return completed.version as string;
    }
  }

  return clusterVersion?.status?.desired?.version ?? null;
}

/**
 * Derives the OCP minor version from the Kubernetes version an OpenShift
 * cluster reports. Returns null for versions that do not look like OpenShift,
 * and for Kubernetes versions with no known OCP counterpart.
 *
 * @param gitVersion - the gitVersion reported by the Kubernetes API server.
 * @returns the matching OCP minor version, or null.
 */
export function getOcpVersionFromKubernetesVersion(gitVersion?: string | null): string | null {
  const match = gitVersion?.match(OPENSHIFT_GIT_VERSION_REGEX);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 1) {
    return null;
  }

  return KUBERNETES_MINOR_TO_OCP[minor] ?? null;
}

/**
 * Hook that looks up the OpenShift version of the given clusters.
 *
 * Clusters that are not running OpenShift simply answer with an error, which is
 * reported as "no OCP version" instead of failing the whole table.
 *
 * @param clusterNames - names of the clusters to look up. Should be a stable
 * (memoized) array, so lookups are not restarted on every render.
 * @returns a map of cluster name to its OCP version state.
 */
export function useClustersOcpVersion(clusterNames: string[]): ClusterOcpVersions {
  const results = useQueries({
    queries: clusterNames.map(clusterName => ({
      queryKey: ['ocp-version', clusterName],
      queryFn: () =>
        clusterRequest(OCP_CLUSTER_VERSION_PATH, {
          cluster: clusterName,
          // A cluster without the OpenShift APIs (or without permissions for
          // them) must not sign the user out of Headlamp.
          autoLogoutOnAuthError: false,
        })
          .then(getOcpVersionFromClusterVersion)
          // Not an OpenShift cluster, unreachable, or not allowed to read it.
          .catch(() => null),
      staleTime: OCP_VERSION_STALE_TIME,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  // Keyed on the lookup states, so the returned map keeps its identity while
  // nothing changed and consumers do not re-render for free. Pending (undefined)
  // and "no version" (null) have to be told apart here.
  const versionsKey = results
    .map(result => (result.data === undefined ? '?' : result.data ?? '-'))
    .join('|');

  return useMemo(() => {
    const ocpVersions: ClusterOcpVersions = {};
    clusterNames.forEach((clusterName, index) => {
      ocpVersions[clusterName] = results[index]?.data;
    });
    return ocpVersions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterNames, versionsKey]);
}
