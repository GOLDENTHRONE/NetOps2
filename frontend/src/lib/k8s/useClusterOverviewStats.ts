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

import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { clusterRequest } from './api/v1/clusterRequests';

/** A used/capacity pair for a resource. Units are backend-defined (see fields below). */
export interface ResourceUsage {
  /** Amount currently in use. CPU: nanocores. Memory: bytes. */
  used: number;
  /** Total capacity. CPU: nanocores. Memory: bytes. */
  capacity: number;
}

/**
 * Authoritative cluster-wide aggregate served by the backend `overviewstats`
 * watcher. Both the cluster Overview page and the Home cluster-status popover
 * read this single snapshot so their numbers always agree.
 */
export interface ClusterOverviewStats {
  pods: { ready: number; total: number };
  nodes: { ready: number; total: number };
  deployments: { available: number; desired: number };
  /** CPU usage in nanocores. */
  cpu: ResourceUsage;
  /** Memory usage in bytes. */
  memory: ResourceUsage;
  /** Whether metrics-server data (cpu/memory `used`) is available. */
  metricsAvailable: boolean;
  /** Whether the backend watcher has completed its initial sync. */
  synced: boolean;
  lastUpdated: string;
}

/** Shared polling interval for the cluster overview aggregate (large clusters). */
export const OVERVIEW_STATS_REFETCH_INTERVAL_MS = 30_000;

/**
 * Fetches the backend cluster-overview aggregate for a single cluster.
 *
 * The endpoint lazily starts an in-memory watcher and may return HTTP 202
 * (still syncing) or 503 (unavailable); in those cases the request rejects and
 * callers should treat the data as not-yet-synced rather than as a hard error.
 *
 * @param clusterName Cluster to fetch stats for. When falsy the query is disabled.
 */
/** Faster polling interval used while the backend watcher is still syncing
 *  or has not yet completed its first metrics poll. */
const OVERVIEW_STATS_FAST_REFETCH_MS = 3_000;

export function useClusterOverviewStats(
  clusterName?: string | null
): UseQueryResult<ClusterOverviewStats, Error> {
  return useQuery<ClusterOverviewStats, Error>({
    enabled: !!clusterName,
    queryKey: ['cluster-overview-stats', clusterName],
    retry: false,
    staleTime: 5_000,
    // Poll aggressively only while the backend watcher is still warming up
    // (initial sync not complete). Once `synced=true`, back off to the normal
    // 30 s interval regardless of `metricsAvailable`: a persistently missing
    // metrics-server is a stable state, not a transient one, and hammering the
    // endpoint every 3 s wastes bandwidth without changing the outcome.
    refetchInterval: query => {
      const data = query.state.data;
      if (!data?.synced) {
        return OVERVIEW_STATS_FAST_REFETCH_MS;
      }
      return OVERVIEW_STATS_REFETCH_INTERVAL_MS;
    },
    queryFn: () =>
      clusterRequest('/overview-stats', {
        cluster: clusterName || undefined,
        autoLogoutOnAuthError: false,
      }),
  });
}
