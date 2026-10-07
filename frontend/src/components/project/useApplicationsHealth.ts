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

// Page-level, fork-only hook for the Applications List (/projects).
//
// Frozen design (APPLICATIONS_LIST_IMPLEMENTATION_DESIGN.md):
//   Observe the 6 LIVE health-bearing kinds CLUSTER-WIDE (one watched LIST per
//   cluster per kind) via the standard, hardened legacy watch path, then group the
//   results by (cluster, namespace) in memory so EVERY application's badge is
//   computed from one shared dataset. This replaces the previous per-row × per-kind
//   60-second polling (the N×M explosion). Pods, ReplicaSets and all supporting /
//   inventory kinds stay ON-DEMAND (useApplicationPopoverData), never watched here.
//
// Cost is O(clusters × 6) — independent of the number of applications.
// No shared infrastructure is modified: this only CONSUMES KubeObject.useList.

import { useMemo } from 'react';
import DaemonSet from '../../lib/k8s/daemonSet';
import Deployment from '../../lib/k8s/deployment';
import EndpointSlice from '../../lib/k8s/endpointSlices';
import { KubeObject, KubeObjectClass } from '../../lib/k8s/KubeObject';
import PersistentVolumeClaim from '../../lib/k8s/persistentVolumeClaim';
import Service from '../../lib/k8s/service';
import StatefulSet from '../../lib/k8s/statefulSet';
import { LiveObservation } from './localHealth';

/** The 6 LIVE kinds (frozen). Watched cluster-wide. Order is stable (Rules of Hooks). */
const LIVE_CLASSES: KubeObjectClass[] = [
  Deployment,
  StatefulSet,
  DaemonSet,
  PersistentVolumeClaim,
  Service,
  EndpointSlice,
];

const LIVE_KIND_NAMES = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'PersistentVolumeClaim',
  'Service',
  'EndpointSlice',
];

/** Server-side page cap so a huge cluster-wide list is bounded (→ Partial), never
 *  silently dropped. Matches DEFAULT_LIST_LIMIT. */
const LIVE_LIMIT = 1000;

function appId(cluster: string, namespace: string | undefined): string {
  return `${cluster}/${namespace ?? ''}`;
}

export interface ApplicationsHealth {
  /** Page-level: nothing has resolved for any cluster yet. */
  isLoading: boolean;
  /** LIVE items for one application (cluster/namespace), grouped in memory. */
  getItems: (cluster: string, namespace: string) => KubeObject[];
  /** The observation context for an application's cluster (Checking / Unavailable /
   *  Partial inputs for getApplicationBadge). Per-cluster (not per-namespace). */
  getObservation: (cluster: string) => LiveObservation;
}

export function useApplicationsHealth(clusters: string[]): ApplicationsHealth {
  // Fixed number of hook calls (array is constant length) → Rules of Hooks safe.
  // Each is a cluster-wide, watched LIST (no namespace, no refetchInterval → the
  // default legacy watch path with #15/#16/#17/#18/#19). `limit` bounds memory.
  const results = LIVE_CLASSES.map(Cls =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    Cls.useList({ clusters, limit: LIVE_LIMIT })
  );

  // Depend on the ITEM ARRAY REFERENCES, not on item COUNT: React Query returns a
  // NEW items array whenever the data changes — including a watch MODIFIED event
  // that changes an object's status but not the list length. Keying on length would
  // miss status-only changes and leave health stale (the badge would never update
  // from a watch). `results` is a fixed-length (6) array so these deps are stable.
  const itemArrays = results.map(r => r.items);
  const errorArrays = results.map(r => r.errors);

  const byApp = useMemo(() => {
    const map = new Map<string, KubeObject[]>();
    for (const r of results) {
      for (const item of r.items ?? []) {
        const cluster = (item as any).cluster ?? '';
        const ns = (item as any).metadata?.namespace;
        const key = appId(cluster, ns);
        const arr = map.get(key);
        if (arr) arr.push(item);
        else map.set(key, [item]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, itemArrays);

  // Per-cluster observation (error tier + truncation + loading), computed once.
  const clusterCtx = useMemo(() => {
    const ctx = new Map<string, LiveObservation>();
    for (const cluster of clusters) {
      let succeeded = 0;
      let resolved = 0;
      const failed: Array<{ kind: string; status?: number; message?: string }> = [];
      const truncatedKinds: string[] = [];

      results.forEach((r, k) => {
        const cr = r.clusterResults?.[cluster] as any;
        // A failed LIST never appears in clusterResults (its data is null), so the
        // per-cluster failure is read from r.errors (ApiError carries `.cluster`).
        const kindErrs = (r.errors ?? []).filter((e: any) => e?.cluster === cluster);
        if (cr?.isSuccess) {
          succeeded += 1;
          resolved += 1;
          // truncation: a `continue` token means "there is more" → Partial.
          const cont = cr.data?.list?.metadata?.continue;
          if (cont) truncatedKinds.push(LIVE_KIND_NAMES[k]);
        } else if (kindErrs.length > 0) {
          resolved += 1;
          failed.push({
            kind: LIVE_KIND_NAMES[k],
            status: kindErrs[0]?.status,
            message: kindErrs[0]?.message,
          });
        }
        // else: this kind has not reported for this cluster yet → still loading.
      });

      const total = LIVE_CLASSES.length;
      // Checking: wait until EVERY live kind has reported (success or error) for this
      // cluster. This avoids a transient "Partial" from an incomplete mid-load
      // observation (which would otherwise stick on cells whose sort rank doesn't
      // change) and guarantees we never show Healthy before all kinds are in.
      const loading = resolved < total;
      // Unavailable: all kinds reported and none succeeded (unreachable / auth / all 403).
      const allLiveFailed = !loading && succeeded === 0 && failed.length > 0;
      // Partial: all kinds reported, some succeeded, but a kind failed or was truncated.
      const someLiveFailed =
        !loading && succeeded > 0 && (failed.length > 0 || truncatedKinds.length > 0);

      ctx.set(cluster, {
        loading,
        allLiveFailed,
        someLiveFailed,
        failed,
        truncatedKinds,
        cluster,
      });
    }
    return ctx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...itemArrays, ...errorArrays, clusters.join(',')]);

  const isLoading = results.length > 0 && results.every(r => r.isLoading);

  return useMemo(
    () => ({
      isLoading,
      getItems: (cluster: string, namespace: string) => byApp.get(appId(cluster, namespace)) ?? [],
      getObservation: (cluster: string) =>
        clusterCtx.get(cluster) ?? {
          loading: true,
          allLiveFailed: false,
          someLiveFailed: false,
          failed: [],
          truncatedKinds: [],
          cluster,
        },
    }),
    [isLoading, byApp, clusterCtx]
  );
}
