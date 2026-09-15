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
import _ from 'lodash';
import React, { useMemo } from 'react';
import { ConfigState } from '../../redux/configSlice';
import { useTypedSelector } from '../../redux/hooks';
import { getCluster } from '../cluster';
import { gtDebug } from '../gtDebug';
import { KEEP_LAST_GOOD, STATUS_FAIL_THRESHOLD, withJitter } from '../resilience';
import { testAuth } from './api/v1/clusterApi';
import { clusterRequest } from './api/v1/clusterRequests';
import { ApiError } from './api/v2/ApiError';
import { Cluster, LabelSelector, StringDict } from './cluster';
import ClusterRole from './clusterRole';
import ClusterRoleBinding from './clusterRoleBinding';
import ConfigMap from './configMap';
import ControllerRevision from './controllerRevision';
import CustomResourceDefinition from './crd';
import CronJob from './cronJob';
import DaemonSet from './daemonSet';
import Deployment from './deployment';
import Endpoints from './endpoints';
import EndpointSlice from './endpointSlices';
import Gateway from './gateway';
import GatewayClass from './gatewayClass';
import GRPCRoute from './grpcRoute';
import HPA from './hpa';
import HTTPRoute from './httpRoute';
import Ingress from './ingress';
import IngressClass from './ingressClass';
import Job from './job';
import JobSet from './jobSet';
import LeaderWorkerSet from './leaderWorkerSet';
import { Lease } from './lease';
import { LimitRange } from './limitRange';
import Namespace from './namespace';
import NetworkPolicy from './networkpolicy';
import Node from './node';
import PersistentVolume from './persistentVolume';
import PersistentVolumeClaim from './persistentVolumeClaim';
import Pod from './pod';
import PodDisruptionBudget from './podDisruptionBudget';
import PodGroup from './podGroup';
import PriorityClass from './priorityClass';
import ReplicaSet from './replicaSet';
import ResourceQuota from './resourceQuota';
import Role from './role';
import RoleBinding from './roleBinding';
import { RuntimeClass } from './runtime';
import SchedulingWorkload from './schedulingWorkload';
import Secret from './secret';
import Service from './service';
import ServiceAccount from './serviceAccount';
import StatefulSet from './statefulSet';
import StorageClass from './storageClass';
import TCPRoute from './tcpRoute';
import UDPRoute from './udpRoute';
import VolumeAttributesClass from './volumeAttributesClass';

export const ResourceClasses = {
  ClusterRole,
  ClusterRoleBinding,
  ConfigMap,
  ControllerRevision,
  CustomResourceDefinition,
  CronJob,
  DaemonSet,
  Deployment,
  Endpoint: Endpoints,
  Endpoints,
  EndpointSlice,
  LimitRange,
  Lease,
  ResourceQuota,
  HorizontalPodAutoscaler: HPA,
  PodDisruptionBudget,
  PodGroup,
  PriorityClass,
  Ingress,
  IngressClass,
  Job,
  JobSet,
  LeaderWorkerSet,
  Namespace,
  NetworkPolicy,
  Node,
  PersistentVolume,
  PersistentVolumeClaim,
  Pod,
  ReplicaSet,
  Role,
  RoleBinding,
  RuntimeClass,
  Secret,
  Service,
  ServiceAccount,
  StatefulSet,
  StorageClass,
  VolumeAttributesClass,
  Gateway,
  GatewayClass,
  HTTPRoute,
  GRPCRoute,
  TCPRoute,
  UDPRoute,
  // Keyed by kind, so the scheduling.k8s.io Workload is registered as 'Workload'.
  Workload: SchedulingWorkload,
};

/** Hook for getting or fetching the clusters configuration.
 * This gets the clusters from the redux store. The redux store is updated
 * when the user changes the configuration. The configuration is stored in
 * the local storage. When stateless clusters are present, it combines the
 * stateless clusters with the clusters from the redux store.
 * @returns the clusters configuration.
 * */
export function useClustersConf(): ConfigState['allClusters'] {
  const state = useTypedSelector(state => state.config);
  const clusters = _.cloneDeep(state.clusters || {});
  const allClusters = _.cloneDeep(state.allClusters || {});
  Object.assign(allClusters, clusters);

  if (state.statelessClusters) {
    // Combine statelessClusters with clusters
    const statelessClusters = _.cloneDeep(state.statelessClusters || {});
    Object.assign(allClusters, statelessClusters);
  }

  return useMemo(
    () => (state.clusters === null ? null : allClusters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.clusters === null, Object.keys(allClusters).join(',')]
  );
}

export { useCluster, useConnectApi, useSelectedClusters } from './api/v1/hooks';
export type { CancellablePromise } from './api/v1/hooks';

/**
 * Gets the version of the cluster given by the parameter.
 *
 * @param clusterName - the name of the cluster to query, or the currently selected cluster.
 * @returns a promise that resolves to a dictionary containing version info.
 */
export function getVersion(clusterName: string = ''): Promise<StringDict> {
  return clusterRequest('/version', { cluster: clusterName || getCluster() });
}

/**
 * The relevant subset of the OpenShift ClusterVersion (config.openshift.io/v1) resource.
 */
export interface OcpClusterVersion {
  status?: {
    desired?: {
      version?: string;
    };
  };
}

/**
 * Gets the OpenShift ClusterVersion (config.openshift.io/v1) for the cluster given by the
 * parameter. Only OpenShift (OCP) clusters expose this resource; on plain Kubernetes clusters
 * the request will fail (typically with a 404), which callers should treat as "not OCP".
 *
 * @param clusterName - the name of the cluster to query, or the currently selected cluster.
 * @returns a promise that resolves to the ClusterVersion object.
 */
export function getOcpClusterVersion(clusterName: string = ''): Promise<OcpClusterVersion> {
  return clusterRequest('/apis/config.openshift.io/v1/clusterversions/version', {
    cluster: clusterName || getCluster(),
  });
}

/**
 * See {@link https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#list-and-watch-filtering|Label selector examples},
 * {@link https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#resources-that-support-set-based-requirements|deployment selector example},
 * {@link https://github.com/kubernetes/apimachinery/blob/be3a79b26814a8d7637d70f4d434a4626ee1c1e7/pkg/selection/operator.go#L24|possible operators}, and
 * {@link https://github.com/kubernetes/apimachinery/blob/be3a79b26814a8d7637d70f4d434a4626ee1c1e7/pkg/labels/selector.go#L305|Format rule for expressions}.
 */
export function labelSelectorToQuery(labelSelector: LabelSelector) {
  const segments: string[] = [];

  segments.push(...(matchLabelsSimplifier(labelSelector.matchLabels, true) || []));

  const matchExpressions = labelSelector.matchExpressions ?? [];

  segments.push(...matchExpressionSimplifier(matchExpressions));
  if (segments.length === 0) {
    return '';
  }

  return segments.join(',');
}

/**
 * Simplifies a matchLabels object into an array of string expressions.
 *
 * @param matchLabels - the matchLabels object from a LabelSelector.
 * @param isEqualSeperator - whether to use "=" as the separator instead of ":".
 * @returns an array of simplified label strings, or an empty string.
 */
export function matchLabelsSimplifier(
  matchLabels: LabelSelector['matchLabels'],
  isEqualSeperator = false
): string[] | '' {
  if (!matchLabels) {
    return '';
  }

  const segments: string[] = [];
  for (const k in matchLabels) {
    if (isEqualSeperator) {
      segments.push(`${k}=${matchLabels[k]}`);
      continue;
    }
    segments.push(`${k}: ${matchLabels[k]}`);
  }

  return segments;
}

/**
 * Simplifies a matchExpressions array into an array of string representations.
 *
 * @param matchExpressions - the matchExpressionss array from a LabelSelector.
 * @returns an array of simplified expression strings, or an empty string.
 */
export function matchExpressionSimplifier(
  matchExpressions: LabelSelector['matchExpressions']
): string[] | '' {
  if (!matchExpressions) {
    return '';
  }

  const segments: string[] = [];
  for (const expr of matchExpressions) {
    let segment = '';
    if (expr.operator === 'DoesNotExist') {
      segment += '!';
    }

    let needsParensWrap = false;
    const NoLengthLimits = -1;
    let expectedValuesLength = NoLengthLimits;

    segment += expr.key;
    switch (expr.operator) {
      case 'Equals':
        segment += '=';
        expectedValuesLength = 1;
        break;
      case 'DoubleEquals':
        segment += '==';
        expectedValuesLength = 1;
        break;
      case 'NotEquals':
        segment += '!=';
        expectedValuesLength = 1;
        break;
      case 'In':
        segment += ' in ';
        needsParensWrap = true;
        break;
      case 'NotIn':
        segment += ' notin ';
        needsParensWrap = true;
        break;
      case 'GreaterThan':
        segment += '>';
        expectedValuesLength = 1;
        break;
      case 'LessThan':
        segment += '<';
        expectedValuesLength = 1;
        break;
      case 'Exists':
      case 'DoesNotExist':
        expectedValuesLength = 0;
        break;
    }

    let values = '';

    if (expectedValuesLength === 1) {
      values = expr.values[0] ?? '';
    } else if (expectedValuesLength === NoLengthLimits) {
      values = [...(expr.values ?? [])].sort().join(',');
      if (needsParensWrap) {
        values = '(' + values + ')';
      }
    }

    segment += values;
    segments.push(segment);
  }

  return segments;
}

export const versionFetchInterval = 10000; // ms

// Cap backoff at 6x the base interval (60s): bounds how long it takes to notice a
// cluster came back after a long outage, while still cutting steady-state polling
// against a persistently unreachable cluster roughly 6x versus polling every
// versionFetchInterval forever.
export const maxVersionFetchInterval = versionFetchInterval * 6;

export interface ClusterStatusTiming {
  lastStatusCheckAt?: number;
  nextStatusCheckAt?: number;
  intervalMs: number;
  isFetching: boolean;
}

/**
 * Refetch interval for cluster version queries (K8s and OCP): polls at the normal
 * `versionFetchInterval` while healthy, and backs off exponentially (capped at
 * `maxVersionFetchInterval`) on consecutive failures so a persistently unreachable
 * cluster isn't polled every 10s forever. Resets to the base interval as soon as a
 * fetch succeeds (see the `consecutiveFailures` tracking in the callers below).
 *
 * Note: react-query's own `query.state.fetchFailureCount` resets to 0 every time a
 * new fetch starts (it only counts retries within a single fetch attempt), so with
 * `retry: false` it can never exceed 1 across separate polling cycles and can't
 * drive multi-cycle backoff on its own — hence tracking consecutiveFailures ourselves.
 */
export function versionRefetchInterval(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) {
    return versionFetchInterval;
  }
  return Math.min(versionFetchInterval * 2 ** consecutiveFailures, maxVersionFetchInterval);
}

/**
 * Reads a positive-integer millisecond interval from a Vite `REACT_APP_*` env var,
 * falling back to `fallbackMs` when the var is unset or not a positive number.
 *
 * Note: the key is read via a literal member access (not a dynamic lookup) so Vite
 * can statically inline it at build time.
 */
function readIntervalEnvOrDefault(raw: unknown, fallbackMs: number): number {
  const parsed = raw !== undefined && raw !== '' ? Number.parseInt(String(raw), 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/**
 * How often the OpenShift (OCP) ClusterVersion is polled. The OCP version is
 * effectively static (it only changes on a cluster upgrade), and cluster liveness
 * is already tracked by the Kubernetes `/version` poll, so this defaults to once an
 * hour instead of every `versionFetchInterval`. Override with
 * `REACT_APP_OCP_VERSION_FETCH_INTERVAL` (milliseconds). The first fetch still
 * happens immediately on connect (react-query fetches on mount); this only governs
 * the steady-state refetch cadence.
 */
export const ocpVersionFetchInterval = readIntervalEnvOrDefault(
  import.meta.env.REACT_APP_OCP_VERSION_FETCH_INTERVAL,
  60 * 60 * 1000 // 1 hour
);

/** Cap OCP backoff at 6x its base interval, mirroring the K8s version backoff. */
export const maxOcpVersionFetchInterval = ocpVersionFetchInterval * 6;

/** Backoff-aware refetch interval for the OCP ClusterVersion query. */
export function ocpVersionRefetchInterval(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) {
    return ocpVersionFetchInterval;
  }
  return Math.min(ocpVersionFetchInterval * 2 ** consecutiveFailures, maxOcpVersionFetchInterval);
}

/**
 * How often each connected cluster's authorization ("can I actually use this
 * cluster?") is re-checked in the background so the Home table can show a truthful
 * "Ready" state. Defaults to `versionFetchInterval` (10s) for a fresh status;
 * override with `REACT_APP_AUTH_CHECK_INTERVAL` (milliseconds). Bump it up if a
 * user typically has many clusters connected at once.
 */
export const authCheckInterval = readIntervalEnvOrDefault(
  import.meta.env.REACT_APP_AUTH_CHECK_INTERVAL,
  versionFetchInterval // 10s
);

/** Cap the auth-check backoff at 6x its base interval. */
export const maxAuthCheckInterval = authCheckInterval * 6;

/** Backoff-aware refetch interval for the per-cluster authorization check. */
export function authRefetchInterval(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) {
    return authCheckInterval;
  }
  return Math.min(authCheckInterval * 2 ** consecutiveFailures, maxAuthCheckInterval);
}

/** Hook to get the version of the clusters given by the parameter.
 *
 * @param clusters
 * @returns a map with cluster -> version-info, and a map with cluster -> error.
 */
export function useClustersVersion(clusters: Cluster[]) {
  type VersionInfo = {
    version: StringDict | null;
    error: ApiError | null;
  };

  const [clusterNames, setClusterNames] = React.useState<string[]>(() =>
    Object.values(clusters)
      .map(c => c.name)
      .sort()
  );

  // clusters gets a new array reference on every render; only update clusterNames when
  // the actual set of names changes to avoid unnecessary query resets.
  React.useEffect(() => {
    const nextClusterNames = Object.values(clusters)
      .map(c => c.name)
      .sort();
    setClusterNames(prev => (_.isEqual(prev, nextClusterNames) ? prev : nextClusterNames));
  }, [clusters]);

  // Tracks consecutive failures per cluster across separate polling cycles (see
  // versionRefetchInterval's doc comment for why react-query's own failure count
  // can't be used for this). Updated synchronously by queryFn itself, so the next
  // refetchInterval computation always sees the latest count.
  const consecutiveFailuresRef = React.useRef<{ [clusterName: string]: number }>({});
  // A refetch after a failed query temporarily has no current error. Keep the last
  // settled result so its status and completion time remain available while fetching.
  const lastStatusErrorsRef = React.useRef<{ [clusterName: string]: ApiError | null }>({});

  const queries = React.useMemo(
    () =>
      clusterNames.map(clusterName => ({
        queryKey: ['clusterVersion', clusterName],
        queryFn: async () => {
          try {
            const data = await getVersion(clusterName);
            consecutiveFailuresRef.current[clusterName] = 0;
            return data;
          } catch (err) {
            consecutiveFailuresRef.current[clusterName] =
              (consecutiveFailuresRef.current[clusterName] ?? 0) + 1;
            throw err;
          }
        },
        refetchInterval: () =>
          // P0: +/- jitter so many clusters don't poll on the same instant.
          withJitter(versionRefetchInterval(consecutiveFailuresRef.current[clusterName] ?? 0)),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always' as const,
        retry: false, // surface errors immediately rather than hammering unreachable clusters
      })),
    [clusterNames]
  );

  const results = useQueries({ queries });
  const timingSignature = results
    .map(r => `${r.dataUpdatedAt}:${r.errorUpdatedAt}:${r.fetchStatus}`)
    .join('|');

  return React.useMemo<
    [
      { [clusterName: string]: StringDict },
      { [clusterName: string]: VersionInfo['error'] },
      { [clusterName: string]: ClusterStatusTiming }
    ]
  >(() => {
    const versionsInfo: { [clusterName: string]: StringDict } = {};
    const errorsInfo: { [clusterName: string]: VersionInfo['error'] } = {};
    const timingInfo: { [clusterName: string]: ClusterStatusTiming } = {};

    clusterNames.forEach((clusterName, i) => {
      const { data, dataUpdatedAt, error, errorUpdatedAt } = results[i];
      if (data) {
        versionsInfo[clusterName] = data;
      }
      // Only set the error key once the query has resolved. An absent key (undefined)
      // signals "still loading" to getClusterStatus; null means the cluster is active.
      if (!results[i].isPending) {
        lastStatusErrorsRef.current[clusterName] = (error as ApiError | null) ?? null;
      }
      let lastStatusError = lastStatusErrorsRef.current[clusterName];
      // P0 debounce (keep-last-good): a single transient blip (not 401/403) on a
      // cluster that was previously reachable should not flip the row to
      // "Unavailable". react-query keeps the last good `data`, so `data !==
      // undefined` means we had a prior success. Suppress the blip until
      // STATUS_FAIL_THRESHOLD consecutive failures; then surface it honestly.
      const hadPriorSuccess = data !== undefined;
      const blip =
        !!lastStatusError && lastStatusError.status !== 401 && lastStatusError.status !== 403;
      if (
        KEEP_LAST_GOOD &&
        blip &&
        hadPriorSuccess &&
        (consecutiveFailuresRef.current[clusterName] ?? 0) < STATUS_FAIL_THRESHOLD
      ) {
        lastStatusError = null; // keep showing the last-known-good (active) status
      }
      if (lastStatusError !== undefined) {
        errorsInfo[clusterName] = lastStatusError;
      }

      // TEMP diagnostics: what the version poll settled on this cycle, and the
      // error the table will actually see for this cluster.
      gtDebug('useClustersVersion.map', {
        cluster: clusterName,
        isPending: results[i].isPending,
        isFetching: results[i].isFetching,
        rawErrorStatus: (error as ApiError | null)?.status ?? null,
        hasData: data !== undefined,
        shownErrorStatus: lastStatusError?.status ?? null,
        consecutiveFailures: consecutiveFailuresRef.current[clusterName] ?? 0,
      });

      const intervalMs = versionRefetchInterval(consecutiveFailuresRef.current[clusterName] ?? 0);
      const updated = Math.max(dataUpdatedAt, errorUpdatedAt);
      const lastStatusCheckAt = updated > 0 ? updated : undefined;
      timingInfo[clusterName] = {
        lastStatusCheckAt,
        nextStatusCheckAt: lastStatusCheckAt ? lastStatusCheckAt + intervalMs : undefined,
        intervalMs,
        isFetching: results[i].isFetching,
      };
    });

    return [versionsInfo, errorsInfo, timingInfo];
  }, [clusterNames, timingSignature]);
}

/** Hook to get the OpenShift (OCP) ClusterVersion of the clusters given by the parameter.
 *
 * Non-OCP clusters don't expose the `config.openshift.io/v1` ClusterVersion resource, so a
 * failed request is treated as "not applicable" (no version) rather than surfaced as an error.
 *
 * @param clusters
 * @returns a map with cluster -> OCP version string (only set for clusters where it's known).
 */
export function useClustersOcpVersion(clusters: Cluster[]) {
  const [clusterNames, setClusterNames] = React.useState<string[]>(() =>
    Object.values(clusters)
      .map(c => c.name)
      .sort()
  );

  React.useEffect(() => {
    const nextClusterNames = Object.values(clusters)
      .map(c => c.name)
      .sort();
    setClusterNames(prev => (_.isEqual(prev, nextClusterNames) ? prev : nextClusterNames));
  }, [clusters]);

  // See useClustersVersion for why consecutive failures are tracked ourselves rather
  // than via react-query's own (per-fetch-attempt) fetchFailureCount.
  const consecutiveFailuresRef = React.useRef<{ [clusterName: string]: number }>({});

  const queries = React.useMemo(
    () =>
      clusterNames.map(clusterName => ({
        queryKey: ['clusterOcpVersion', clusterName],
        // Let failures reject (instead of swallowing them here) so the result mapping
        // below (which already treats a missing/errored query the same as "no OCP
        // version") and the failure-count tracking above both see them.
        queryFn: async () => {
          try {
            const data = await getOcpClusterVersion(clusterName);
            consecutiveFailuresRef.current[clusterName] = 0;
            return data;
          } catch (err) {
            consecutiveFailuresRef.current[clusterName] =
              (consecutiveFailuresRef.current[clusterName] ?? 0) + 1;
            throw err;
          }
        },
        refetchInterval: () =>
          withJitter(ocpVersionRefetchInterval(consecutiveFailuresRef.current[clusterName] ?? 0)),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always' as const,
        retry: false,
      })),
    [clusterNames]
  );

  const results = useQueries({ queries });

  return React.useMemo<{ [clusterName: string]: string | undefined }>(() => {
    const ocpVersions: { [clusterName: string]: string | undefined } = {};

    clusterNames.forEach((clusterName, i) => {
      const { data } = results[i];
      ocpVersions[clusterName] = data?.status?.desired?.version;
    });

    return ocpVersions;
  }, [clusterNames, results]);
}

/**
 * Hook that checks, in the background, whether the current user is actually
 * authorized on each of the given clusters — the same check the router runs when a
 * cluster is opened (`testAuth` → `selfsubjectrulesreviews`). The Home table uses
 * this to show a truthful "Ready" (reachable AND authorized) versus a plain
 * "Reachable" (answered, authorization not yet confirmed) status.
 *
 * This is intentionally separate from `useClustersVersion`: `/version` can succeed
 * on a cluster where the user's credentials are expired or insufficient, so
 * reachability alone does not prove the cluster can be opened.
 *
 * Behaviour mirrors the version poll: polls at `authCheckInterval`, backs off on
 * consecutive failures, pauses while the tab is backgrounded, refetches on window
 * focus, and never retries within a cycle. The check uses `testAuth`, which sets
 * `autoLogout=false`, so a 401 here never clears the global session.
 *
 * @param clusters - the clusters to check.
 * @returns a map of cluster name -> auth result: `null` when authorized, an
 *   `ApiError` when the check failed (401/403/timeout/…). A cluster whose first
 *   check has not settled yet is absent from the map (treated as "checking").
 */
export function useClustersAuth(clusters: Cluster[]): { [clusterName: string]: ApiError | null } {
  const [clusterNames, setClusterNames] = React.useState<string[]>(() =>
    Object.values(clusters)
      .map(c => c.name)
      .sort()
  );

  React.useEffect(() => {
    const nextClusterNames = Object.values(clusters)
      .map(c => c.name)
      .sort();
    setClusterNames(prev => (_.isEqual(prev, nextClusterNames) ? prev : nextClusterNames));
  }, [clusters]);

  // Tracked ourselves across polling cycles; see useClustersVersion for why
  // react-query's own failure count can't drive multi-cycle backoff.
  const consecutiveFailuresRef = React.useRef<{ [clusterName: string]: number }>({});
  // Keep the last settled result so a refetch (which briefly clears the error)
  // doesn't flip the status back to "checking".
  const lastAuthErrorsRef = React.useRef<{ [clusterName: string]: ApiError | null }>({});

  const queries = React.useMemo(
    () =>
      clusterNames.map(clusterName => ({
        queryKey: ['clusterAuth', clusterName],
        queryFn: async () => {
          try {
            await testAuth(clusterName);
            consecutiveFailuresRef.current[clusterName] = 0;
            // Return null (not the review body) — the caller only needs pass/fail,
            // and null keeps the query out of the "pending" state.
            return null;
          } catch (err) {
            const status = (err as ApiError)?.status;
            consecutiveFailuresRef.current[clusterName] =
              status === 401 || status === 403
                ? 0
                : (consecutiveFailuresRef.current[clusterName] ?? 0) + 1;
            throw err;
          }
        },
        refetchInterval: () =>
          withJitter(authRefetchInterval(consecutiveFailuresRef.current[clusterName] ?? 0)),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always' as const,
        retry: false,
      })),
    [clusterNames]
  );

  const results = useQueries({ queries });
  const signature = results
    .map(r => `${r.dataUpdatedAt}:${r.errorUpdatedAt}:${r.fetchStatus}:${r.isPending}`)
    .join('|');

  return React.useMemo<{ [clusterName: string]: ApiError | null }>(() => {
    const errorsInfo: { [clusterName: string]: ApiError | null } = {};
    clusterNames.forEach((clusterName, i) => {
      if (!results[i].isPending) {
        lastAuthErrorsRef.current[clusterName] = (results[i].error as ApiError | null) ?? null;
      }
      const last = lastAuthErrorsRef.current[clusterName];
      if (last !== undefined) {
        errorsInfo[clusterName] = last;
      }
      // TEMP diagnostics: what the auth poll settled on this cycle, and the auth
      // error the table will see. Compare against useClustersVersion.map above.
      gtDebug('useClustersAuth.map', {
        cluster: clusterName,
        isPending: results[i].isPending,
        isFetching: results[i].isFetching,
        rawErrorStatus: (results[i].error as ApiError | null)?.status ?? null,
        shownErrorStatus: last?.status ?? null,
      });
    });
    return errorsInfo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterNames, signature]);
}

// Other exports that can be used by plugins:
export * as cluster from './cluster';
export * as clusterRole from './clusterRole';
export * as clusterRoleBinding from './clusterRoleBinding';
export * as configMap from './configMap';
export * as crd from './crd';
export * as cronJob from './cronJob';
export * as controllerRevision from './controllerRevision';
export * as daemonSet from './daemonSet';
export * as deployment from './deployment';
export * as event from './event';
export * as ingress from './ingress';
export * as ingressClass from './ingressClass';
export * as job from './job';
export * as jobSet from './jobSet';
export * as leaderWorkerSet from './leaderWorkerSet';
export * as namespace from './namespace';
export * as node from './node';
export * as persistentVolume from './persistentVolume';
export * as persistentVolumeClaim from './persistentVolumeClaim';
export * as pod from './pod';
export * as podGroup from './podGroup';
export * as schedulingWorkload from './schedulingWorkload';
export * as replicaSet from './replicaSet';
export * as role from './role';
export * as roleBinding from './roleBinding';
export * as secret from './secret';
export * as service from './service';
export * as serviceAccount from './serviceAccount';
export * as statefulSet from './statefulSet';
export * as storageClass from './storageClass';
export * as volumeAttributesClass from './volumeAttributesClass';
