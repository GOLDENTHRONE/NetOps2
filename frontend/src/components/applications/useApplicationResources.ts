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

import { uniqBy } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ResourceClasses, useClustersConf } from '../../lib/k8s';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { apiResourceId } from '../../lib/k8s/api/v2/ApiResource';
import { KubeObject, KubeObjectClass } from '../../lib/k8s/cluster';
import { useTypedSelector } from '../../redux/hooks';
import { defaultApiResources } from '../project/projectUtils';
import { isBusinessApplicationNamespace } from './applicationUtils';

/**
 * Kinds that are fetched for the Projects feature but deliberately NOT for
 * Applications: they mirror other fetched kinds (Endpoints/EndpointSlices
 * restate Services) or are rarely-used namespace policy objects, yet their
 * cluster-wide lists are among the largest responses. Dropping them removes
 * requests and megabytes without losing information an operator acts on.
 */
const SKIPPED_KINDS = new Set(['Endpoints', 'EndpointSlice', 'LimitRange', 'ResourceQuota']);

/**
 * Fetch order: the browser only runs a handful of requests to the backend in
 * parallel, so the first slots must go to the kinds the table's Health column
 * is computed from (workloads), then the common app kinds; bulky config data
 * (ConfigMaps/Secrets) loads last since it only affects the resource count.
 */
const KIND_PRIORITY = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
  'Service',
  'Ingress',
  'HorizontalPodAutoscaler',
  'NetworkPolicy',
  'PersistentVolumeClaim',
  'Role',
  'RoleBinding',
  'ConfigMap',
  'Secret',
];

function kindRank(kind: string): number {
  const index = KIND_PRIORITY.indexOf(kind);
  return index === -1 ? KIND_PRIORITY.length : index;
}

/**
 * Fetches the application-relevant resources (the same resource kinds the
 * Projects feature fetches) of ALL business namespaces across every
 * configured cluster, with a single list request (and live watch) per
 * resource kind per cluster.
 *
 * This one shared, progressively-updated result backs both the Applications
 * table (per-application resource counts and health) and the Application
 * details page, which guarantees the two always show the same numbers and
 * that navigating between them is instant: the queries are identical, so the
 * data is served from the same cache and kept fresh by the same watches.
 *
 * Unlike useKubeLists, results are NOT held back until every list has
 * finished: items appear as soon as their list arrives, so the UI fills in
 * right away instead of showing zeros until the slowest request completes.
 */
export function useAllApplicationResources(): {
  /** All fetched resources living in business-application namespaces. */
  items: KubeObject[];
  errors: ApiError[];
  /** True while at least one resource list has not arrived yet. */
  isLoading: boolean;
} {
  const clusterConf = useClustersConf();
  const clusters = useMemo(() => Object.keys(clusterConf ?? {}), [clusterConf]);

  const pluginApiResources = useTypedSelector(state => state.projects.apiResources);

  // Capture the resource list once on mount so its length stays stable across
  // renders: hooks are called per resource in a loop below, so changing the
  // array length mid-lifecycle would violate the Rules of Hooks.
  const [resources] = useState(() =>
    uniqBy([...defaultApiResources, ...pluginApiResources], r => apiResourceId(r))
      .filter(r => !SKIPPED_KINDS.has(r.kind))
      .sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
  );

  const classes = useMemo(
    () =>
      resources.map(
        it =>
          (ResourceClasses as Record<string, KubeObjectClass>)[it.kind] ??
          class extends KubeObject {
            static kind = it.kind;
            static apiVersion = it.apiVersion;
            static apiName = it.pluralName;
            static isNamespaced = it.isNamespaced;
          }
      ) as KubeObjectClass[],
    [resources]
  );

  // One list query per resource kind, cluster-wide (empty namespace list means
  // all allowed namespaces). No refetchInterval: lists are watched, so changes
  // stream in live instead of waiting for a poll.
  const data = classes.map(it => it.useList({ clusters, namespace: [] }));

  const isLoading = data.some(it => !it.items && !it.isError);

  // Recombine only when some list's items actually changed, not on every
  // render. The deps array length is constant (the resource list is fixed on
  // mount), so passing the per-list items arrays directly is safe.
  const combined = useMemo(
    () =>
      data
        .flatMap(it => it.items ?? [])
        .filter(
          it => !!it.metadata?.namespace && isBusinessApplicationNamespace(it.metadata.namespace)
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    data.map(it => it.items)
  );

  // Publish updates in ~300ms batches. During the initial load the many
  // per-kind/per-cluster lists resolve one after another; without batching
  // each arrival re-renders every consumer (and the whole Applications
  // table) once, which is what made the tab feel slow. Batching coalesces
  // that burst into a few renders without delaying steady-state updates
  // noticeably.
  const [items, setItems] = useState<KubeObject[]>([]);
  const latestRef = useRef(combined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestRef.current = combined;
    // Once every list has arrived, publish immediately (flushing any pending
    // batch): nothing else is coming, so waiting would only prolong the
    // window where a row shows 0 for a cluster that in fact has resources.
    if (!isLoading) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setItems(oldItems => (equal(oldItems, latestRef.current) ? oldItems : latestRef.current));
      return;
    }
    if (timerRef.current !== null) {
      return; // A publish is already scheduled; it will pick up this update.
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setItems(oldItems => (equal(oldItems, latestRef.current) ? oldItems : latestRef.current));
    }, 300);
  }, [combined, isLoading]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  const errors = useMemo(
    () => data.flatMap(it => (it.errors ?? []).filter(error => error.status !== 404)) as ApiError[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  return { items, errors, isLoading };
}

/**
 * Group resources by the application (namespace) they belong to. Rows for the
 * Applications table read their resource count and health from this map.
 */
export function groupResourcesByApplication(items: KubeObject[]): Map<string, KubeObject[]> {
  const byApplication = new Map<string, KubeObject[]>();
  for (const item of items) {
    const namespace = item.metadata.namespace!;
    const group = byApplication.get(namespace);
    if (group) {
      group.push(item);
    } else {
      byApplication.set(namespace, [item]);
    }
  }
  return byApplication;
}

const equal = (arr1: unknown[], arr2: unknown[]) => {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((it, i) => it === arr2[i]);
};
