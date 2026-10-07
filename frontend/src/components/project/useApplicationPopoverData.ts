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

// On-demand (popover-only) data path for the Applications List.
//
// Frozen design: supporting / diagnostic kinds are NOT watched at the page level.
// They are fetched for ONE application's namespace only when its popover opens
// (this hook is rendered inside the popover body, which is mounted only while
// open, so the watches it opens are torn down when the popover closes — never a
// permanent, page-wide Pod watch). Pods provide the exact runtime diagnosis
// (CrashLoop/ImagePull/OOMKilled/…) and resolve controller-less "Unknown" apps.
//
// Truncation-safe: Pods are fetched with a server-side `limit`; a `continue` token
// marks the kind truncated so the popover can show "1000+ Pods · Partial" instead
// of silently dropping them. No shared infrastructure is modified.

import { useMemo } from 'react';
import ConfigMap from '../../lib/k8s/configMap';
import CronJob from '../../lib/k8s/cronJob';
import HPA from '../../lib/k8s/hpa';
import Ingress from '../../lib/k8s/ingress';
import Job from '../../lib/k8s/job';
import { KubeObject, KubeObjectClass } from '../../lib/k8s/KubeObject';
import { LimitRange } from '../../lib/k8s/limitRange';
import NetworkPolicy from '../../lib/k8s/networkpolicy';
import Pod from '../../lib/k8s/pod';
import ReplicaSet from '../../lib/k8s/replicaSet';
import ResourceQuota from '../../lib/k8s/resourceQuota';
import Role from '../../lib/k8s/role';
import RoleBinding from '../../lib/k8s/roleBinding';
import Secret from '../../lib/k8s/secret';
import { ProjectDefinition } from '../../redux/projectsSlice';

// Pod first: it carries the diagnosis + bare-Pod resolution. Order is stable.
const ON_DEMAND_CLASSES: KubeObjectClass[] = [
  Pod,
  ReplicaSet,
  Ingress,
  HPA,
  Job,
  CronJob,
  ConfigMap,
  Secret,
  Role,
  RoleBinding,
  NetworkPolicy,
  LimitRange,
  ResourceQuota,
];

const ON_DEMAND_KIND_NAMES = [
  'Pod',
  'ReplicaSet',
  'Ingress',
  'HorizontalPodAutoscaler',
  'Job',
  'CronJob',
  'ConfigMap',
  'Secret',
  'Role',
  'RoleBinding',
  'NetworkPolicy',
  'LimitRange',
  'ResourceQuota',
];

const ON_DEMAND_LIMIT = 1000;

export interface ApplicationPopoverData {
  /** On-demand items for this one namespace (Pods + supporting kinds). */
  items: KubeObject[];
  /** On-demand kinds whose list was truncated (≥limit) → surface Partial / "N+". */
  truncatedKinds: string[];
  isLoading: boolean;
  /** True if any on-demand kind errored (shown as a per-kind note, never the badge). */
  hasErrors: boolean;
}

/**
 * Fetch the on-demand (popover) kinds for ONE application. Call this only from a
 * component that is mounted while the popover is open.
 */
export function useApplicationPopoverData(project: ProjectDefinition): ApplicationPopoverData {
  const cluster = project.clusters?.[0] ?? '';
  const namespace = project.namespaces?.[0] ?? '';
  const clusters = cluster ? [cluster] : [];
  const namespaces = namespace ? [namespace] : [];

  const results = ON_DEMAND_CLASSES.map(Cls =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    Cls.useList({ clusters, namespace: namespaces, limit: ON_DEMAND_LIMIT })
  );

  const depKey = results
    .map(r => `${r.items?.length ?? -1}:${r.isLoading ? 1 : 0}:${r.isError ? 1 : 0}`)
    .join('|');

  return useMemo(() => {
    const items: KubeObject[] = [];
    const truncatedKinds: string[] = [];
    let hasErrors = false;
    results.forEach((r, i) => {
      for (const it of r.items ?? []) items.push(it);
      if (r.isError) hasErrors = true;
      const cont = (r.clusterResults?.[cluster] as any)?.data?.list?.metadata?.continue;
      if (cont) truncatedKinds.push(ON_DEMAND_KIND_NAMES[i]);
    });
    const isLoading = results.some(r => r.isLoading);
    return { items, truncatedKinds, isLoading, hasErrors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, cluster]);
}
