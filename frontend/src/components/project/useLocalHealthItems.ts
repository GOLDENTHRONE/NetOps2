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

// Local, fork-only React hook used by the p17 Status column.
// Composes:
//   (1) the shared `useProjectItems` result (the standard 19 default kinds
//       fetched for every Application row), AND
//   (2) a Pod list fetched LOCALLY via `useKubeLists` — scoped to this
//       project's clusters + namespaces, and never written to Redux state,
//       so no other consumer of shared project data sees these Pods.
//
// See p17.txt on branch GT_D_V1 for the full contract.

import { useMemo } from 'react';
import { ApiResource } from '../../lib/k8s/api/v2/ApiResource';
import { KubeObject } from '../../lib/k8s/cluster';
import { ProjectDefinition } from '../../redux/projectsSlice';
import { useKubeLists } from '../advancedSearch/utils/useKubeLists';
import { useProjectItems } from './useProjectResources';

const POD_RESOURCE: ApiResource = {
  apiVersion: 'v1',
  version: 'v1',
  pluralName: 'pods',
  singularName: 'pod',
  kind: 'Pod',
  isNamespaced: true,
};

// Match the caps used by useProjectItems so behaviour is consistent between
// the shared 19-kind fetch and this extra Pod fetch.
const MAX_ITEMS = 1000;
const REFETCH_INTERVAL_MS = 60_000;

export function useLocalHealthItems(project: ProjectDefinition) {
  // Shared 19-kind list — same call the "Resources" column already makes,
  // so no duplicate network traffic is added for that data set.
  const shared = useProjectItems(project, { disableWatch: true });

  // Local Pod fetch. Scoped to this project only; return value stays local
  // to this hook — not dispatched to any Redux slice, so no other component
  // sees these Pods.
  const podList = useKubeLists(
    [POD_RESOURCE],
    project.clusters,
    MAX_ITEMS,
    REFETCH_INTERVAL_MS,
    project.namespaces
  );

  const items: KubeObject[] = useMemo(
    () => [...(shared.items ?? []), ...(podList.items ?? [])],
    [shared.items, podList.items]
  );

  const isLoading = shared.isLoading || podList.isLoading;
  const errors = useMemo(
    () => [...(shared.errors ?? []), ...(podList.errors ?? [])],
    [shared.errors, podList.errors]
  );

  return { items, isLoading, errors };
}
