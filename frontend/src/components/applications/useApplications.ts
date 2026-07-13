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

import { useMemo } from 'react';
import { useClustersConf } from '../../lib/k8s';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import Namespace from '../../lib/k8s/namespace';
import {
  ApplicationDefinition,
  ApplicationInfo,
  buildApplications,
  groupApplications,
} from './applicationUtils';

/**
 * Fetch applications (namespaces) across every configured cluster.
 *
 * This issues a single namespace list request per cluster; unreachable
 * clusters surface in `errors` (each error carries the cluster it came from)
 * without blocking the results from healthy clusters.
 */
export function useApplications(): {
  applications: ApplicationInfo[];
  errors: ApiError[];
  isLoading: boolean;
} {
  const clusterConf = useClustersConf();
  const clusters = useMemo(() => Object.keys(clusterConf ?? {}), [clusterConf]);

  const { items: namespaces, errors, isLoading } = Namespace.useList({ clusters });

  const applications = useMemo(() => buildApplications(namespaces ?? []), [namespaces]);

  return {
    applications,
    errors: errors ?? [],
    isLoading: isLoading && applications.length === 0,
  };
}

/**
 * Applications grouped one-per-namespace-name across all clusters, ready for
 * the Applications table and details page.
 */
export function useApplicationDefinitions(): {
  applications: ApplicationDefinition[];
  errors: ApiError[];
  isLoading: boolean;
} {
  const { applications: rows, errors, isLoading } = useApplications();
  const applications = useMemo(() => groupApplications(rows), [rows]);
  return { applications, errors, isLoading };
}

/** Look up a single application (namespace) by name across all clusters. */
export function useApplication(name: string): {
  application?: ApplicationDefinition;
  errors: ApiError[];
  isLoading: boolean;
} {
  const { applications, errors, isLoading } = useApplicationDefinitions();
  const application = useMemo(
    () => applications.find(app => app.id === name),
    [applications, name]
  );
  return { application, errors, isLoading };
}
