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

import type { QueryFunctionContext, QueryObserverOptions } from '@tanstack/react-query';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasAllowedNamespacesRestriction,
  loadClusterSettings,
} from '../../../../helpers/clusterSettings';
import { WATCH_FALLBACK_REFETCH_MS, watchFallbackRefetchInterval } from '../../../resilience';
import type { KubeObject, KubeObjectClass } from '../../KubeObject';
import type { QueryParameters } from '../v1/queryParameters';
import { ApiError } from './ApiError';
import { clusterFetch } from './fetch';
import type { QueryListResponse } from './hooks';
import { useEndpoints } from './hooks';
import type { KubeListUpdateEvent } from './KubeList';
import { KubeList } from './KubeList';
import { KubeObjectEndpoint } from './KubeObjectEndpoint';
import { makeUrl } from './makeUrl';
import { WebSocketManager } from './multiplexer';
import { kubeRequestRetry } from './retry';
import { BASE_WS_URL, useWebSockets } from './webSocket';

/**
 * @returns true if the websocket multiplexer is enabled.
 * defaults to true. This is a feature flag to enable the websocket multiplexer.
 */
export function getWebsocketMultiplexerEnabled(): boolean {
  return import.meta.env.REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER === 'true';
}

/** Default page size for list consumers that opt in to pagination. */
export const DEFAULT_LIST_LIMIT = 1000;

function toPaginationApiError(error: unknown, cluster: string, namespace?: string): ApiError {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(error instanceof Error ? error.message : 'Failed to load more resources');
  apiError.cluster ??= cluster;
  apiError.namespace ??= namespace;
  return apiError;
}

/**
 * Object representing a List of Kube object
 * with information about which cluster and namespace it came from
 */
export interface ListResponse<K extends KubeObject> {
  /** KubeList with items */
  list: KubeList<K>;
  /** Cluster of the list */
  cluster: string;
  /** If the list only has items from one namespace */
  namespace?: string;
  /** Whether this synthesized list must not start a cluster-wide watch */
  skipWatch?: boolean;
}

/**
 * Builds a restricted Namespace query without broadening RBAC requirements.
 * Manually configured namespaces use per-name GET requests, while selector-based
 * restrictions retain LIST requests and intersect any selector from the caller.
 *
 * @param kubeObjectClass - Class used to instantiate Namespace objects.
 * @param cluster - Cluster to query.
 * @param queryParams - Additional Namespace list filters.
 * @param refetchInterval - Optional query refetch interval.
 * @returns Query options for the synthesized restricted Namespace list.
 */
function allowedNamespaceListQuery<K extends KubeObject>(
  kubeObjectClass: KubeObjectClass,
  cluster: string,
  queryParams: QueryParameters,
  refetchInterval?: number | ((query: any) => number | false)
): QueryObserverOptions<ListResponse<K> | undefined | null, ApiError> {
  const settings = loadClusterSettings(cluster);
  const allowedNamespaces = settings.allowedNamespaces ?? [];
  const configuredSelector = settings.allowedNamespacesSelector?.trim();
  const requestedSelector = queryParams.labelSelector?.trim();
  const selector = [configuredSelector, requestedSelector].filter(Boolean).join(',');

  return {
    placeholderData: null,
    refetchInterval,
    retry: kubeRequestRetry,
    queryKey: [
      'kubeObject',
      'list',
      kubeObjectClass.apiVersion,
      kubeObjectClass.apiName,
      cluster,
      '',
      { allowedNamespaces, selector },
    ],
    queryFn: async () => {
      const [manualItems, selectorList] = await Promise.all([
        Promise.all(
          allowedNamespaces.map(async name => {
            try {
              const item = await clusterFetch(makeUrl(['api', 'v1', 'namespaces', name]), {
                cluster,
              }).then(response => response.json());
              if (item.metadata?.managedFields) {
                delete item.metadata.managedFields;
              }
              const kubeObject = new kubeObjectClass(item) as K;
              kubeObject.cluster = cluster;
              return kubeObject;
            } catch (error) {
              if (error instanceof ApiError) {
                error.cluster = cluster;
                error.namespace = name;
              }
              throw error;
            }
          })
        ),
        configuredSelector
          ? clusterFetch(makeUrl(['api', 'v1', 'namespaces'], { labelSelector: selector }), {
              cluster,
            })
              .then(response => response.json())
              .catch(error => {
                if (error instanceof ApiError) {
                  error.cluster = cluster;
                }
                throw error;
              })
          : Promise.resolve(null),
      ]);

      const selectorItems = (selectorList?.items ?? []).map((item: any) => {
        if (item.metadata?.managedFields) {
          delete item.metadata.managedFields;
        }
        item.kind = selectorList.kind.replace(/List$/, '');
        item.apiVersion = selectorList.apiVersion;
        const kubeObject = new kubeObjectClass(item) as K;
        kubeObject.cluster = cluster;
        return kubeObject;
      });
      const items = [...manualItems, ...selectorItems].filter(
        (item, index, allItems) =>
          allItems.findIndex(
            candidate => candidate.jsonData.metadata.name === item.jsonData.metadata.name
          ) === index
      );

      return {
        list: {
          items,
          kind: selectorList?.kind ?? 'NamespaceList',
          apiVersion: selectorList?.apiVersion ?? 'v1',
          metadata: {
            resourceVersion: selectorList?.metadata?.resourceVersion ?? '0',
            // P1 (#15): stamp the LIST-generation RV (this list is skipWatch, so it
            // never drives a watch, but keep it consistent with other fresh LISTs).
            listResourceVersion: selectorList?.metadata?.resourceVersion ?? '0',
          },
        } as KubeList<K>,
        cluster,
        skipWatch: true,
      };
    },
  };
}

/**
 * Query to list Kube objects from a cluster and namespace(optional)
 *
 * @param kubeObjectClass - Class to instantiate the object with
 * @param endpoint - API endpoint
 * @param namespace - namespace to list objects from(optional)
 * @param cluster - cluster name
 * @param queryParams - query parameters
 * @returns query options for getting a single list of kube resources
 */
export function kubeObjectListQuery<K extends KubeObject>(
  kubeObjectClass: KubeObjectClass,
  endpoint: KubeObjectEndpoint,
  namespace: string | undefined = '',
  cluster: string,
  queryParams: QueryParameters,
  refetchInterval?: number | ((query: any) => number | false)
): QueryObserverOptions<ListResponse<K> | undefined | null, ApiError> {
  const configuredSelector =
    loadClusterSettings(cluster).allowedNamespacesSelector?.trim() || undefined;
  const isResolvingAllowedNamespaces =
    configuredSelector !== undefined && queryParams.labelSelector?.trim() === configuredSelector;

  if (
    kubeObjectClass.kind === 'Namespace' &&
    !isResolvingAllowedNamespaces &&
    hasAllowedNamespacesRestriction(cluster)
  ) {
    return allowedNamespaceListQuery<K>(kubeObjectClass, cluster, queryParams, refetchInterval);
  }

  return {
    placeholderData: null,
    refetchInterval,
    retry: kubeRequestRetry,
    queryKey: [
      'kubeObject',
      'list',
      kubeObjectClass.apiVersion,
      kubeObjectClass.apiName,
      cluster,
      namespace,
      queryParams,
    ],
    queryFn: async (context?: QueryFunctionContext) => {
      // If no valid endpoint is passed, don't make the request
      if (!endpoint) return;

      try {
        const list: KubeList<any> = await clusterFetch(
          makeUrl([KubeObjectEndpoint.toUrl(endpoint!, namespace)], queryParams),
          {
            cluster,
            // P1 (#14): forward the query's AbortSignal so a superseded page-1 refetch
            // can abort in flight. This is an optimization only — it is NOT the
            // correctness mechanism (the paginated-marker guard below is). `context`
            // is always provided by React Query in production; it is optional only so
            // unit tests can invoke queryFn directly.
            signal: context?.signal,
          }
        ).then(it => it.json());
        const kind = list.kind.replace(/List$/, '');
        const apiVersion = list.apiVersion;
        list.items = list.items.map(item => {
          // managedFields are not shown in list views and can be several KB per
          // object. Drop them to keep memory proportional to what's rendered.
          if (item.metadata?.managedFields) {
            delete item.metadata.managedFields;
          }
          // Mutate kind/apiVersion in-place to avoid cloning the whole pod JSON.
          item.kind = kind;
          item.apiVersion = apiVersion;
          const itm = new kubeObjectClass(item);
          itm.cluster = cluster;
          return itm;
        });

        // P1 (#15): stamp the LIST-generation RV. This is a freshly committed LIST,
        // so its resourceVersion becomes the watch IDENTITY (listResourceVersion).
        // Applied watch events (applyUpdate) bump `resourceVersion` but leave
        // `listResourceVersion` untouched, so per-event RV changes no longer rebuild
        // the watch socket. Only a fresh LIST (here) advances the identity.
        if (list.metadata) {
          list.metadata.listResourceVersion = list.metadata.resourceVersion;
        }

        const response: ListResponse<K> = {
          list: list as KubeList<K>,
          cluster,
          namespace,
        };

        // P1 (#14): commit-time correctness guard. This page-1 LIST could be a
        // fallback/reconnect/mount/invalidate/refetchQueries refetch OR could have
        // overlapped a "Load more". If, by the time this result is ready to commit,
        // the cache for this exact query key already holds accumulated pagination
        // pages (metadata.paginated === true), replacing it with a bare page 1 would
        // silently destroy pages the user loaded. Re-read the CURRENT cache at the
        // commit boundary (not at query start) and, when paginated, keep the existing
        // accumulated list. The network round-trip still happened, so this doubles as
        // a server-reachability check (#16 confirm-before-reconnect keeps its
        // dataUpdatedAt/success semantics). Fresh page-1 replacement is allowed only
        // when the cache is NOT paginated. See WS_PODS_FALLBACK_RACE_ANALYSIS.md.
        if (context?.client && context.queryKey) {
          const currentCached = context.client.getQueryData<ListResponse<K>>(context.queryKey);
          if (currentCached?.list?.metadata?.paginated) {
            return currentCached;
          }
        }

        return response;
      } catch (e) {
        // Rethrow error with cluster and namespace information
        if (e instanceof ApiError) {
          e.cluster = cluster;
          e.namespace = namespace;
        }
        throw e;
      }
    },
  };
}

/**
 * Accepts a list of lists to watch.
 * Upon receiving update it will modify query data for list query
 */
export function useWatchKubeObjectLists<K extends KubeObject>({
  kubeObjectClass,
  endpoint,
  lists,
  queryParams,
  watchQueryParams,
  liveSubsetWatch = false,
}: {
  /** KubeObject class of the watched resource list */
  kubeObjectClass: (new (...args: any) => K) & typeof KubeObject<any>;
  /** Query parameters for the WebSocket connection URL */
  queryParams?: QueryParameters;
  /** Query parameters for the WebSocket URL. Defaults to queryParams. */
  watchQueryParams?: QueryParameters;
  /** Kube resource API endpoint information */
  endpoint?: KubeObjectEndpoint | null;
  /** Which clusters and namespaces to watch */
  lists: Array<{ cluster: string; namespace?: string; resourceVersion: string }>;
  /**
   * P1 (#14, A1): live-subset mode. When true, the watch is a whole-collection
   * watch but only events for objects CURRENTLY in the cache (the loaded prefix)
   * are applied; ADDED and non-member MODIFIED/DELETED are ignored. This keeps
   * retained state O(loaded) while a large list is only partially paginated. When
   * false (default) the legacy behavior is unchanged. See WS_PODS_LIVE_SUBSET_ARCH.md.
   */
  liveSubsetWatch?: boolean;
}) {
  const multiplexerEnabled = getWebsocketMultiplexerEnabled();

  useWatchKubeObjectListsMultiplexed({
    kubeObjectClass,
    endpoint,
    lists: multiplexerEnabled ? lists : [],
    queryParams: multiplexerEnabled ? queryParams : undefined,
    watchQueryParams: multiplexerEnabled ? watchQueryParams : undefined,
    enabled: multiplexerEnabled,
  });

  useWatchKubeObjectListsLegacy({
    kubeObjectClass,
    endpoint,
    lists: !multiplexerEnabled ? lists : [],
    queryParams: !multiplexerEnabled ? queryParams : undefined,
    watchQueryParams: !multiplexerEnabled ? watchQueryParams : undefined,
    enabled: !multiplexerEnabled,
    liveSubsetWatch,
  });
}

/**
 * Watches Kubernetes resource lists using multiplexed WebSocket connections.
 * Efficiently manages subscriptions and updates to prevent unnecessary re-renders
 * and WebSocket reconnections.
 *
 * @template K - Type extending KubeObject for the resources being watched
 * @param kubeObjectClass - Class constructor for the Kubernetes resource type
 * @param endpoint - API endpoint information for the resource
 * @param lists - Array of cluster, namespace, and resourceVersion combinations to watch
 * @param queryParams - Optional query parameters for the WebSocket URL
 */
function useWatchKubeObjectListsMultiplexed<K extends KubeObject>({
  kubeObjectClass,
  endpoint,
  lists,
  queryParams,
  watchQueryParams,
  enabled = true,
}: {
  kubeObjectClass: (new (...args: any) => K) & typeof KubeObject<any>;
  endpoint?: KubeObjectEndpoint | null;
  lists: Array<{ cluster: string; namespace?: string; resourceVersion: string }>;
  queryParams?: QueryParameters;
  watchQueryParams?: QueryParameters;
  enabled?: boolean;
}): void {
  const client = useQueryClient();

  // Track the latest resource versions to prevent duplicate updates
  const latestResourceVersions = useRef<Record<string, string>>({});

  // Stabilize queryParams to prevent unnecessary effect triggers
  // Only update when the stringified params change
  const stableQueryParamsKey = enabled ? JSON.stringify(queryParams) : '__disabled__';
  const stableWatchQueryParamsKey = enabled
    ? JSON.stringify(watchQueryParams ?? queryParams)
    : '__disabled__';
  /* eslint-disable react-hooks/exhaustive-deps -- Query params are intentionally stabilized by their JSON keys. */
  const stableQueryParams = useMemo(() => queryParams, [stableQueryParamsKey]);
  const stableWatchQueryParams = useMemo(
    () => watchQueryParams ?? queryParams,
    [stableWatchQueryParamsKey]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  // Create stable connection URLs for each list
  // Updates only when endpoint, lists, or stableQueryParams change
  const connections = useMemo(() => {
    if (!enabled || !endpoint) {
      return [];
    }

    return lists.map(list => {
      const key = `${list.cluster}:${list.namespace || ''}`;

      // Always use the latest resource version from the server
      latestResourceVersions.current[key] = list.resourceVersion;

      // Construct WebSocket URL with current parameters
      return {
        url: makeUrl([KubeObjectEndpoint.toUrl(endpoint, list.namespace)], {
          ...stableWatchQueryParams,
          watch: 1,
          resourceVersion: latestResourceVersions.current[key],
        }),
        cluster: list.cluster,
        namespace: list.namespace,
      };
    });
  }, [enabled, endpoint, lists, stableWatchQueryParams]);

  // Create stable update handler to process WebSocket messages
  // Re-create only when dependencies change
  const handleUpdate = useCallback(
    (update: any, cluster: string, namespace: string | undefined) => {
      if (!update || typeof update !== 'object' || !endpoint) {
        return;
      }

      const key = `${cluster}:${namespace || ''}`;

      // Update resource version from incoming message
      if (update.object?.metadata?.resourceVersion) {
        latestResourceVersions.current[key] = update.object.metadata.resourceVersion;
      }

      // Create query key for React Query cache
      const queryKey = kubeObjectListQuery<K>(
        kubeObjectClass,
        endpoint,
        namespace,
        cluster,
        stableQueryParams ?? {}
      ).queryKey;

      // P1: a watch ERROR event (typically 410 Gone — resourceVersion too old to
      // resume) cannot be applied as a resource. Re-list to get a fresh snapshot
      // and resourceVersion (react-query refetches; the watch then restarts from
      // the new version) instead of swallowing it and going permanently stale.
      if (update.type === 'ERROR') {
        client.invalidateQueries({ queryKey });
        return;
      }

      // Update React Query cache with new data
      client.setQueryData(queryKey, (oldResponse: ListResponse<any> | undefined | null) => {
        if (!oldResponse) {
          return oldResponse;
        }

        const newList = KubeList.applyUpdate(oldResponse.list, update, kubeObjectClass, cluster);

        // Only update if the list actually changed
        if (newList === oldResponse.list) {
          return oldResponse;
        }

        return { ...oldResponse, list: newList };
      });
    },
    [client, kubeObjectClass, endpoint, stableQueryParams]
  );

  // Set up WebSocket subscriptions
  useEffect(() => {
    if (!enabled || !endpoint || connections.length === 0) {
      return;
    }

    const cleanups: (() => void)[] = [];

    // Create subscriptions for each connection
    connections.forEach(({ url, cluster, namespace }) => {
      const parsedUrl = new URL(url, BASE_WS_URL);

      // Subscribe to WebSocket updates
      WebSocketManager.subscribe(
        cluster,
        parsedUrl.pathname,
        parsedUrl.search.slice(1),
        update => handleUpdate(update, cluster, namespace),
        error => console.error(`WebSocket subscription error for cluster ${cluster}:`, error)
      ).then(
        cleanup => cleanups.push(cleanup),
        error => {
          // Track retry count in the URL's searchParams
          const retryCount = parseInt(parsedUrl.searchParams.get('retryCount') || '0');
          if (retryCount < 3) {
            // Only log and allow retry if under threshold
            console.error('WebSocket subscription failed:', error);
            parsedUrl.searchParams.set('retryCount', (retryCount + 1).toString());
          }
        }
      );
    });

    // Cleanup subscriptions when effect re-runs or unmounts
    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  }, [connections, enabled, endpoint, handleUpdate]);
}

/**
 * Accepts a list of lists to watch.
 * Upon receiving update it will modify query data for list query
 * @param kubeObjectClass - KubeObject class of the watched resource list
 * @param endpoint - Kube resource API endpoint information
 * @param lists - Which clusters and namespaces to watch
 * @param queryParams - Query parameters for the WebSocket connection URL
 */
function useWatchKubeObjectListsLegacy<K extends KubeObject>({
  kubeObjectClass,
  endpoint,
  lists,
  queryParams,
  watchQueryParams,
  enabled = true,
  liveSubsetWatch = false,
}: {
  /** KubeObject class of the watched resource list */
  kubeObjectClass: (new (...args: any) => K) & typeof KubeObject<any>;
  /** Query parameters for the WebSocket connection URL */
  queryParams?: QueryParameters;
  /** Query parameters for the WebSocket URL. Defaults to queryParams. */
  watchQueryParams?: QueryParameters;
  /** Kube resource API endpoint information */
  endpoint?: KubeObjectEndpoint | null;
  /** Which clusters and namespaces to watch */
  lists: Array<{ cluster: string; namespace?: string; resourceVersion: string }>;
  enabled?: boolean;
  /** P1 (#14, A1): apply only events for currently-loaded UIDs; ignore ADDED and
   *  non-member MODIFIED/DELETED so retained state stays O(loaded). */
  liveSubsetWatch?: boolean;
}) {
  const client = useQueryClient();

  // P1 (#14, A1): per-connection loaded-UID membership index for O(1) filtering.
  // Rebuilt lazily only when the cached items array reference changes (a LIST, a
  // Load-More re-baseline, or an applied member event), so a burst of out-of-page
  // events costs O(1) each and never rebuilds it. Reading the live cache here keeps
  // membership exact (no stale ref). Key = cluster + (namespace || '').
  const membershipRef = useRef<Map<string, { items: unknown; uids: Set<string> }>>(new Map());

  const stableQueryParamsKey = enabled ? JSON.stringify(queryParams) : '__disabled__';
  const stableWatchQueryParamsKey = enabled
    ? JSON.stringify(watchQueryParams ?? queryParams)
    : '__disabled__';
  /* eslint-disable react-hooks/exhaustive-deps -- Query params are intentionally stabilized by their JSON keys. */
  const stableQueryParams = useMemo(() => queryParams, [stableQueryParamsKey]);
  const stableWatchQueryParams = useMemo(
    () => watchQueryParams ?? queryParams,
    [stableWatchQueryParamsKey]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  const connections = useMemo(() => {
    if (!enabled || !endpoint) return [];

    return lists.map(({ cluster, namespace, resourceVersion }) => {
      const connectionMembershipKey = `${cluster}:${namespace || ''}`;
      const url = makeUrl([KubeObjectEndpoint.toUrl(endpoint!, namespace)], {
        ...stableWatchQueryParams,
        watch: 1,
        // P1 (#16): ask the API server for periodic BOOKMARK frames so a healthy
        // watch is never truly silent — this is the heartbeat the silent-death
        // liveness timer (webSocket.ts) relies on. Verified to travel end-to-end
        // to the browser (WS_BOOKMARK_VERIFICATION.md).
        allowWatchBookmarks: true,
        resourceVersion,
      });

      return {
        cluster,
        url,
        onMessage(update: KubeListUpdateEvent<K>) {
          const key = kubeObjectListQuery<K>(
            kubeObjectClass,
            endpoint,
            namespace,
            cluster,
            stableQueryParams ?? {}
          ).queryKey;
          // P1: a watch ERROR (typically 410 Gone) can't be applied as data —
          // re-list for a fresh snapshot + resourceVersion instead of swallowing
          // it and leaving the list permanently stale.
          if ((update as any)?.type === 'ERROR') {
            client.invalidateQueries({ queryKey: key });
            return;
          }
          // P1 (#16): a BOOKMARK is a liveness/transport signal only — it carries
          // no item change. Its socket-level activity was already recorded in
          // webSocket.ts. It must NOT mutate the cache: writing its
          // resourceVersion would change the watched-list identity (the RV feeds
          // the listsToWatch comparison) and rebuild the socket every ~bookmark
          // interval — i.e. re-introduce reconnect churn. Resuming from the newest
          // bookmark RV (listResourceVersion) is the separate #15 optimization and
          // is intentionally out of scope here.
          if ((update as any)?.type === 'BOOKMARK') {
            return;
          }
          // P1 (#14, A1): live-subset membership filter. On a whole-collection watch
          // for a partially-paginated list, apply MODIFIED/DELETED only to objects
          // currently loaded (in the cache), and IGNORE ADDED entirely. This keeps
          // retained state O(loaded): out-of-page events can never grow the cache.
          // New in-range objects surface via the Load-More re-baseline, not the watch.
          if (liveSubsetWatch) {
            const cached = client.getQueryData<ListResponse<any>>(key);
            // Nothing loaded yet (or gc'd) → nothing to update; never create state.
            if (!cached?.list) return;
            let m = membershipRef.current.get(connectionMembershipKey);
            if (!m || m.items !== cached.list.items) {
              m = {
                items: cached.list.items,
                uids: new Set(
                  cached.list.items.map((it: any) => it?.metadata?.uid).filter(Boolean)
                ),
              };
              membershipRef.current.set(connectionMembershipKey, m);
            }
            // ADDED (any) → ignore (bounded state; re-baseline surfaces new in-range pods).
            if ((update as any)?.type === 'ADDED') return;
            // MODIFIED/DELETED for a non-loaded UID → ignore (not displayed, no growth).
            const uid = (update as any)?.object?.metadata?.uid;
            if (!uid || !m.uids.has(uid)) return;
          }
          client.setQueryData(key, (oldResponse: ListResponse<any> | undefined | null) => {
            if (!oldResponse) return oldResponse;

            const newList = KubeList.applyUpdate(
              oldResponse.list,
              update,
              kubeObjectClass,
              cluster
            );
            return { ...oldResponse, list: newList };
          });
        },
        async confirmLiveness() {
          // P1 (#16) confirm-before-reconnect: run ONE authoritative LIST refetch
          // for THIS exact watched list and report whether it succeeded (fresh data
          // arrived). We deliberately do NOT invent a resourceVersion comparison:
          //  - if the refetch returns a NEWER resourceVersion, the existing
          //    `listsToWatch` identity check (RV in the watch URL) rebuilds the
          //    socket on its own → resync;
          //  - if the RV is unchanged, the watch is healthy-but-quiet and stays.
          // Success is defined as "the LIST reached the API and refreshed data"
          // (react-query advances dataUpdatedAt only on a successful fetch;
          // keep-last-good leaves it unchanged on failure).
          const key = kubeObjectListQuery<K>(
            kubeObjectClass,
            endpoint,
            namespace,
            cluster,
            stableQueryParams ?? {}
          ).queryKey;
          const before = client.getQueryState(key)?.dataUpdatedAt ?? 0;
          try {
            await client.refetchQueries({ queryKey: key, exact: true });
          } catch {
            return false;
          }
          const after = client.getQueryState(key)?.dataUpdatedAt ?? 0;
          return after > before;
        },
      };
    });
  }, [
    enabled,
    lists,
    kubeObjectClass,
    endpoint,
    stableQueryParams,
    stableWatchQueryParams,
    client,
  ]);

  useWebSockets<KubeListUpdateEvent<K>>({
    enabled: enabled && !!endpoint,
    connections,
  });
}

/**
 * Creates multiple requests to list Kube objects
 * Handles multiple clusters, namespaces and allowed namespaces
 *
 * @param clusters - list of clusters
 * @param getAllowedNamespaces -  function to get allowed namespaces for a cluster
 * @param isResourceNamespaced - if the resource is namespaced
 * @param requestedNamespaces - requested namespaces(optional)
 * @param hasAllowedNamespacesRestriction - checks whether each cluster has an active restriction
 *
 * @returns list of requests for clusters and appropriate namespaces
 */
export function makeListRequests(
  clusters: string[],
  getAllowedNamespaces: (cluster: string | null) => string[],
  isResourceNamespaced: boolean,
  requestedNamespaces: string[] = [],
  hasAllowedNamespacesRestriction: (cluster: string) => boolean = () => false
): Array<{ cluster: string; namespaces?: string[] }> {
  return clusters.flatMap(cluster => {
    const allowedNamespaces = getAllowedNamespaces(cluster);

    if (
      isResourceNamespaced &&
      allowedNamespaces.length === 0 &&
      hasAllowedNamespacesRestriction(cluster)
    ) {
      return [];
    }

    let namespaces = requestedNamespaces.length > 0 ? requestedNamespaces : allowedNamespaces;

    if (allowedNamespaces.length) {
      namespaces = namespaces.filter(ns => allowedNamespaces.includes(ns));
      if (isResourceNamespaced && namespaces.length === 0) {
        return [];
      }
    }

    return { cluster, namespaces: isResourceNamespaced ? namespaces : undefined };
  });
}

function withoutPaginationParams(queryParams: QueryParameters): QueryParameters {
  const params = { ...queryParams };
  delete params.continue;
  delete params.limit;
  return params;
}

function getListRequestCount(requests: Array<{ cluster: string; namespaces?: string[] }>) {
  return requests.reduce(
    (count, request) => count + Math.max(request.namespaces?.length ?? 1, 1),
    0
  );
}

type ListRequest = { cluster: string; namespace?: string };

function flattenListRequests(
  requests: Array<{ cluster: string; namespaces?: string[] }>
): ListRequest[] {
  return requests.flatMap<ListRequest>(({ cluster, namespaces }) =>
    namespaces && namespaces.length > 0
      ? namespaces.map(namespace => ({ cluster, namespace }))
      : [{ cluster }]
  );
}

function getPositiveLimit(queryParams: QueryParameters): number | undefined {
  const limit = Number(queryParams.limit);

  if (!queryParams.limit || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }

  return Math.floor(limit);
}

function getPerRequestQueryParams(
  queryParams: QueryParameters,
  requests: Array<{ cluster: string; namespaces?: string[] }>
): QueryParameters {
  const requestCount = getListRequestCount(requests);
  const limit = getPositiveLimit(queryParams);

  if (!limit || requestCount <= 1) {
    return queryParams;
  }

  return {
    ...queryParams,
    limit: requestCount > limit ? 1 : Math.floor(limit / requestCount),
  };
}

/**
 * Returns a combined list of Kubernetes objects and watches for changes from the clusters given.
 *
 * @param param - request paramaters
 * @returns Combined list of Kubernetes resources
 */
export function useKubeObjectList<K extends KubeObject>({
  requests,
  kubeObjectClass,
  queryParams,
  watch = true,
  refetchInterval,
  emptyWhenNoRequests = false,
  liveSubsetWatch = false,
}: {
  requests: Array<{ cluster: string; namespaces?: string[] }>;
  /** Class to instantiate the object with */
  kubeObjectClass: (new (...args: any) => K) & typeof KubeObject<any>;
  queryParams?: QueryParameters;
  /** Watch for updates @default true */
  watch?: boolean;
  /** How often to refetch the list. Won't refetch by default. Disables watching if set. */
  refetchInterval?: number;
  /** Return an empty list instead of a loading state when requests were intentionally suppressed. */
  emptyWhenNoRequests?: boolean;
  /**
   * P1 (#14, A1): opt-in live-subset mode for large client-paginated lists. When
   * true AND a client `limit` is set, the watch stays open WHILE the list is only
   * partially paginated, but applies only events for currently-loaded objects
   * (whole-collection watch + UID membership filter), and each "Load more"
   * re-baselines the loaded prefix from a fresh LIST snapshot (fresh
   * listResourceVersion → exactly one intentional watch restart). Retained state
   * stays O(loaded). Default false = unchanged legacy behavior. Pods-only for now.
   * See WS_PODS_LIVE_SUBSET_ARCH.md.
   */
  liveSubsetWatch?: boolean;
}): [Array<K> | null, ApiError | null] &
  QueryListResponse<Array<ListResponse<K> | undefined | null>, K, ApiError> {
  const maybeNamespace = requests.find(it => it.namespaces)?.namespaces?.[0];

  // Get working endpoint from the first cluster
  // Now if clusters have different apiVersions for the same resource for example, this will not work
  const { endpoint, error: endpointError } = useEndpoints(
    requests.length === 0 ? [] : kubeObjectClass.apiEndpoint.apiInfo,
    requests[0]?.cluster,
    maybeNamespace
  );

  const cleanedUpQueryParams = Object.fromEntries(
    Object.entries(queryParams ?? {}).filter(([, value]) => value !== undefined && value !== '')
  );
  const listRequests = useMemo(() => flattenListRequests(requests), [requests]);
  const limit = getPositiveLimit(cleanedUpQueryParams);
  const initialListRequestCount =
    limit && listRequests.length > limit ? limit : listRequests.length;
  const [activeListRequestCount, setActiveListRequestCount] = useState(initialListRequestCount);
  const listRequestInputKey = JSON.stringify([listRequests, cleanedUpQueryParams]);

  useEffect(() => {
    setActiveListRequestCount(initialListRequestCount);
  }, [initialListRequestCount, listRequestInputKey]);

  const activeListRequests = useMemo(
    () => listRequests.slice(0, activeListRequestCount),
    [activeListRequestCount, listRequests]
  );
  const hasPendingListRequests = activeListRequests.length < listRequests.length;
  const perRequestQueryParams = getPerRequestQueryParams(cleanedUpQueryParams, requests);

  // P1 (#14, A1): live-subset mode is active only when the caller opted in AND a
  // client `limit` is set (a paginated list). It enables watch-while-paginating +
  // membership filtering + Load-More re-baseline, and turns OFF the Option C page-1
  // fallback below (the live watch — not the fallback — provides freshness, and a
  // fallback page-1 refetch would needlessly restart the watch).
  //
  // SAFETY (multiplexer): the A1 membership filter lives ONLY in the legacy watch
  // path. If the multiplexer is enabled, a watch-while-paginating would route through
  // the UNFILTERED multiplexed path and grow state unboundedly. So live-subset is hard
  // OFF whenever the multiplexer is enabled — the list then falls back to the safe
  // legacy behavior (no watch until fully paginated + page-1 fallback). Never the
  // unfiltered path.
  const liveSubsetActive = liveSubsetWatch && !!limit && !getWebsocketMultiplexerEnabled();

  // Declared here (before effectiveRefetchInterval) so the fallback interval can read
  // the in-flight "load more" state. Assigned/consumed by loadMore below.
  const loadMorePromiseRef = useRef<Promise<void> | null>(null);

  // P1 safety-net refetch: when watching a list with no explicit poll interval, run a
  // low-frequency background refetch so a silently-dead socket — OR a large list that
  // never watches at all while paginating (#14) — still refreshes.
  //
  // P1 (#14): this now applies to client-`limit`ed lists too (previously excluded).
  // It is PAUSED per-query when that query has accumulated pagination pages
  // (metadata.paginated) or a "Load more" is in flight for this hook — a page-1
  // refetch there would re-fetch only page 1. This is an EFFICIENCY gate only: even if
  // a refetch does fire, the queryFn commit-time guard (see kubeObjectListQuery) keeps
  // the accumulated list, so correctness never depends on this pause. react-query also
  // pauses the interval while the tab is hidden.
  const effectiveRefetchInterval =
    refetchInterval ??
    (watch && !liveSubsetActive && WATCH_FALLBACK_REFETCH_MS > 0
      ? (query: any) =>
          watchFallbackRefetchInterval(
            !!query?.state?.data?.list?.metadata?.paginated || !!loadMorePromiseRef.current
          )
      : undefined);

  const queries = useMemo(
    () =>
      endpoint
        ? activeListRequests.map(({ cluster, namespace }) =>
            kubeObjectListQuery<K>(
              kubeObjectClass,
              endpoint,
              namespace,
              cluster,
              perRequestQueryParams,
              effectiveRefetchInterval
            )
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeListRequests, kubeObjectClass, endpoint, perRequestQueryParams]
  );

  const query = useQueries({
    queries,
    combine(results) {
      const hasMore =
        hasPendingListRequests || results.some(result => !!result.data?.list?.metadata?.continue);
      const hasUnknownRemainingItemCount = results.some(
        result =>
          !!result.data?.list?.metadata?.continue &&
          result.data.list.metadata.remainingItemCount === undefined
      );

      return {
        data: results.map(result => result.data),
        clusterResults: results.reduce((acc, result) => {
          if (result.data && result.data.cluster) {
            acc[result.data.cluster] = {
              data: result.data,
              error: result.error,
              errors: result.error ? [result.error] : null,
              isError: result.isError,
              isFetching: result.isFetching,
              isLoading: result.isLoading,
              isSuccess: result.isSuccess,
              items: result?.data?.list?.items ?? null,
              status: result.status,
            };
          }
          return acc;
        }, {} as Record<string, QueryListResponse<any, K, ApiError>>),
        items:
          emptyWhenNoRequests && results.length === 0
            ? []
            : results.every(result => result.data === null)
            ? null
            : results.flatMap(result => result?.data?.list?.items ?? []),
        errors: results.map(result => result.error).filter(Boolean),
        isError: results.some(result => result.isError),
        isLoading: results.some(result => result.isLoading),
        isFetching: results.some(result => result.isFetching),
        isSuccess: results.every(result => result.isSuccess),
        // Whether any result set has more items available via pagination.
        hasMore,
        remainingItemCount:
          hasPendingListRequests || hasUnknownRemainingItemCount
            ? undefined
            : results.reduce(
                (sum, result) => sum + (result.data?.list?.metadata?.remainingItemCount ?? 0),
                0
              ),
      };
    },
  });

  // Don't watch when results are paginated — the watch stream would deliver events
  // for resources outside our fetched page, causing the list to grow unboundedly.
  // P1 (#14, A1): a client-paginated list normally does NOT watch until fully loaded
  // (a whole-collection watch would grow the list past the fetched page). In
  // live-subset mode we DO watch while partially paginated, because the membership
  // filter (useWatchKubeObjectListsLegacy) applies only events for loaded objects and
  // ignores ADDED — so the list can never grow past what was loaded.
  const shouldWatch =
    watch && !refetchInterval && !query.isLoading && (liveSubsetActive || !query.hasMore);

  const [listsToWatch, setListsToWatch] = useState<
    { cluster: string; namespace?: string; resourceVersion: string }[]
  >([]);

  useEffect(() => {
    setListsToWatch(currentListsToWatch => {
      const keptListsToWatch = currentListsToWatch.filter(
        watching =>
          requests.find(request => {
            if (watching.cluster !== request?.cluster) return false;
            return !request.namespaces?.length
              ? !watching.namespace
              : !!watching.namespace && request.namespaces.includes(watching.namespace);
          }) !== undefined
      );

      if (!shouldWatch) {
        return keptListsToWatch.length === currentListsToWatch.length
          ? currentListsToWatch
          : keptListsToWatch;
      }

      const nextListsToWatch = query.data
        .filter(data => data && !data.skipWatch)
        .map(data => ({
          cluster: data!.cluster,
          namespace: data!.namespace,
          // P1 (#15): use the LIST-generation RV (listResourceVersion) as the watch
          // identity, NOT the per-event live resourceVersion. applyUpdate bumps
          // resourceVersion on every ADDED/MODIFIED/DELETED but leaves
          // listResourceVersion unchanged, so the identity (and thus the watch URL
          // and the connections array reference) stays stable across events — the
          // WebSocket is no longer torn down and recreated per event (churn). Only a
          // fresh LIST advances listResourceVersion → an intentional resync.
          // Fallback to resourceVersion keeps older/synthetic lists behaving as before.
          resourceVersion:
            data!.list.metadata.listResourceVersion ?? data!.list.metadata.resourceVersion,
        }));

      if (
        nextListsToWatch.length === currentListsToWatch.length &&
        nextListsToWatch.every((nextList, index) => {
          const currentList = currentListsToWatch[index];
          return (
            currentList.cluster === nextList.cluster &&
            currentList.namespace === nextList.namespace &&
            currentList.resourceVersion === nextList.resourceVersion
          );
        })
      ) {
        return currentListsToWatch;
      }

      return nextListsToWatch;
    });
  }, [query.data, requests, shouldWatch]);

  useWatchKubeObjectLists({
    lists: shouldWatch ? listsToWatch : [],
    endpoint,
    kubeObjectClass,
    queryParams: perRequestQueryParams,
    watchQueryParams: withoutPaginationParams(perRequestQueryParams),
    liveSubsetWatch: liveSubsetActive,
  });

  const [paginationError, setPaginationError] = useState<ApiError | null>(null);
  const paginationInputKey = JSON.stringify(queries.map(q => q.queryKey));
  useEffect(() => {
    setPaginationError(null);
  }, [paginationInputKey]);

  const errors = [...query.errors.filter(it => it !== null), paginationError].filter(
    it => it !== null
  );

  const queryClient = useQueryClient();

  const loadMore = useCallback(async () => {
    if (!endpoint) return;

    if (loadMorePromiseRef.current) {
      return loadMorePromiseRef.current;
    }

    loadMorePromiseRef.current = (async () => {
      setPaginationError(null);

      if (hasPendingListRequests) {
        const nextListRequestCount = Math.min(
          listRequests.length,
          activeListRequestCount + (limit ?? listRequests.length)
        );
        const nextListRequests = listRequests.slice(activeListRequestCount, nextListRequestCount);
        const nextQueries = nextListRequests.map(({ cluster, namespace }) =>
          kubeObjectListQuery<K>(
            kubeObjectClass,
            endpoint,
            namespace,
            cluster,
            perRequestQueryParams,
            refetchInterval
          )
        );

        const results = await Promise.allSettled(
          nextQueries.map(q => queryClient.fetchQuery(q as any))
        );

        const rejectedResultIndex = results.findIndex(result => result.status === 'rejected');
        const rejectedResult = results[rejectedResultIndex];
        if (rejectedResult?.status === 'rejected') {
          const rejectedRequest = nextListRequests[rejectedResultIndex];
          setPaginationError(
            toPaginationApiError(
              rejectedResult.reason,
              rejectedRequest.cluster,
              rejectedRequest.namespace
            )
          );
          return;
        }

        setActiveListRequestCount(nextListRequestCount);
        return;
      }

      // P1 (#14, A1): live-subset re-baseline. Instead of appending the next page
      // from the pinned LIST snapshot (which would leave the newly-loaded pods stale
      // by the events that streamed while they were unloaded — the §F event-gap),
      // re-LIST each active query's loaded prefix + one more page at a FRESH snapshot
      // and REPLACE its cache. A fresh listResourceVersion restarts the watch exactly
      // once; the newly-loaded pods are current as of the new RV; the whole-collection
      // watch then covers new-RV→now with no gap. Retained state stays O(loaded).
      if (liveSubsetActive) {
        const pageSize = getPositiveLimit(perRequestQueryParams) ?? DEFAULT_LIST_LIMIT;
        const results = await Promise.allSettled(
          queries.map(async q => {
            const cached = queryClient.getQueryData<ListResponse<K>>(q.queryKey!);
            if (!cached?.list) return;
            // Nothing more to load for this query → leave it (and its watch) as is.
            if (!cached.list.metadata?.continue) return;
            const newLimit = cached.list.items.length + pageSize;
            const fetchParams: QueryParameters = { ...perRequestQueryParams, limit: newLimit };
            let raw: KubeList<any>;
            try {
              raw = await clusterFetch(
                makeUrl([KubeObjectEndpoint.toUrl(endpoint, cached.namespace)], fetchParams),
                { cluster: cached.cluster }
              ).then(r => r.json());
            } catch (e) {
              const error =
                e instanceof ApiError
                  ? e
                  : new ApiError(e instanceof Error ? e.message : 'Failed to load more resources');
              error.cluster = cached.cluster;
              error.namespace = cached.namespace;
              // 410: the snapshot expired mid re-baseline. Invalidate → queryFn relists
              // a fresh page 1 (existing recovery); the watch re-baselines from that.
              if (error.status === 410) {
                queryClient.invalidateQueries({ queryKey: q.queryKey! });
              }
              throw error;
            }
            const kind = raw.kind.replace(/List$/, '');
            const apiVersion = raw.apiVersion;
            const items: K[] = raw.items.map((item: any) => {
              if (item.metadata?.managedFields) delete item.metadata.managedFields;
              item.kind = kind;
              item.apiVersion = apiVersion;
              const obj = new kubeObjectClass(item) as K;
              obj.cluster = cached.cluster;
              return obj;
            });
            queryClient.setQueryData<ListResponse<K>>(q.queryKey!, old =>
              old
                ? {
                    ...old,
                    list: {
                      ...old.list,
                      // REPLACE (not append): a fresh consistent prefix snapshot.
                      items,
                      metadata: {
                        resourceVersion: raw.metadata.resourceVersion,
                        // Fresh LIST snapshot ⇒ this is the new watch identity (#15):
                        // exactly one intentional watch restart per Load-More.
                        listResourceVersion: raw.metadata.resourceVersion,
                        continue: raw.metadata.continue,
                        remainingItemCount: raw.metadata.remainingItemCount,
                        // Still more beyond this prefix ⇒ keep the paginated guard set.
                        paginated: !!raw.metadata.continue,
                      },
                    },
                  }
                : old
            );
          })
        );
        const rejected = results.find(r => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        if (rejected) {
          const reason: any = rejected.reason;
          setPaginationError(
            toPaginationApiError(reason, reason?.cluster ?? '', reason?.namespace ?? '')
          );
        }
        return;
      }

      const pageRequests = queries.map(q => {
        const cached = queryClient.getQueryData<ListResponse<K>>(q.queryKey!);
        return { query: q, cached, priorPaginated: !!cached?.list?.metadata?.paginated };
      });

      // P1 (#14): synchronously mark each to-be-appended query as `paginated` BEFORE
      // any network await, so a page-1 refetch that resolves mid-load-more sees the
      // marker at its commit boundary and keeps the accumulated list — closing the
      // in-flight-overlap and cross-snapshot windows. Only keys with a continue token
      // are appended, so only those are marked.
      pageRequests.forEach(({ query: q, cached }) => {
        if (!cached?.list?.metadata?.continue) return;
        queryClient.setQueryData<ListResponse<K>>(q.queryKey!, old =>
          old
            ? { ...old, list: { ...old.list, metadata: { ...old.list.metadata, paginated: true } } }
            : old
        );
      });

      const results = await Promise.allSettled(
        pageRequests.map(async ({ query: q, cached, priorPaginated }) => {
          const continueToken = cached?.list?.metadata?.continue;
          if (!continueToken || !cached) return;

          const fetchParams: QueryParameters = {
            ...perRequestQueryParams,
            continue: continueToken,
          };
          let raw: KubeList<any>;
          try {
            raw = await clusterFetch(
              makeUrl([KubeObjectEndpoint.toUrl(endpoint, cached.namespace)], fetchParams),
              { cluster: cached.cluster }
            ).then(r => r.json());
          } catch (e) {
            const error =
              e instanceof ApiError
                ? e
                : new ApiError(e instanceof Error ? e.message : 'Failed to load more resources');
            error.cluster = cached.cluster;
            error.namespace = cached.namespace;

            if (error.status === 410) {
              // P1 (#14): the paginated snapshot is gone. Clear the marker so the
              // relist's fresh page 1 is allowed to replace the now-invalid accumulated
              // list — matching the pre-#14 410 recovery behavior.
              queryClient.setQueryData<ListResponse<K>>(q.queryKey!, old =>
                old
                  ? {
                      ...old,
                      list: { ...old.list, metadata: { ...old.list.metadata, paginated: false } },
                    }
                  : old
              );
              queryClient.invalidateQueries({ queryKey: q.queryKey! });
            } else {
              // P1 (#14): no new page was appended for this key. Restore the marker to
              // its value from before this load-more: previously-accumulated pages stay
              // protected; a page-1-only list resumes fallback refresh.
              queryClient.setQueryData<ListResponse<K>>(q.queryKey!, old =>
                old
                  ? {
                      ...old,
                      list: {
                        ...old.list,
                        metadata: { ...old.list.metadata, paginated: priorPaginated },
                      },
                    }
                  : old
              );
            }

            throw error;
          }

          const kind = raw.kind.replace(/List$/, '');
          const apiVersion = raw.apiVersion;
          const newItems: K[] = raw.items.map((item: any) => {
            if (item.metadata?.managedFields) delete item.metadata.managedFields;
            item.kind = kind;
            item.apiVersion = apiVersion;
            const obj = new kubeObjectClass(item) as K;
            obj.cluster = cached.cluster;
            return obj;
          });

          queryClient.setQueryData<ListResponse<K>>(q.queryKey!, old => {
            if (!old) return old;
            return {
              ...old,
              list: {
                ...old.list,
                metadata: {
                  resourceVersion: raw.metadata.resourceVersion,
                  // P1 (#15): keep the LIST-generation RV in sync. Paginated pages
                  // share the same consistent snapshot resourceVersion, so this is
                  // stable across "load more" and correctly becomes the watch
                  // identity once pagination completes and the watch turns on.
                  listResourceVersion: raw.metadata.resourceVersion,
                  continue: raw.metadata.continue,
                  remainingItemCount: raw.metadata.remainingItemCount,
                  // P1 (#14): this cache now holds accumulated pagination pages. Keep
                  // the correctness marker set so no page-1 refetch can overwrite them.
                  paginated: true,
                },
                items: [...old.list.items, ...newItems],
              },
            };
          });
        })
      );

      const rejectedResultIndex = results.findIndex(result => result.status === 'rejected');
      const rejectedResult = results[rejectedResultIndex];
      if (rejectedResult?.status === 'rejected') {
        const cached = pageRequests[rejectedResultIndex].cached!;
        setPaginationError(
          toPaginationApiError(rejectedResult.reason, cached.cluster, cached.namespace)
        );
      }
    })();

    try {
      return await loadMorePromiseRef.current;
    } finally {
      loadMorePromiseRef.current = null;
    }
  }, [
    endpoint,
    activeListRequestCount,
    hasPendingListRequests,
    limit,
    listRequests,
    queries,
    queryClient,
    kubeObjectClass,
    perRequestQueryParams,
    refetchInterval,
  ]);

  // @ts-ignore - TS compiler gets confused with iterators
  return {
    items: endpointError ? [] : query.items,
    errors: endpointError ? [endpointError] : errors.length > 0 ? errors : null,
    error: endpointError ?? paginationError ?? query.errors.find(it => it !== null) ?? null,
    clusterResults: query.clusterResults,
    isError: query.isError || !!paginationError,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isSuccess: query.isSuccess,
    hasMore: query.hasMore,
    remainingItemCount: query.remainingItemCount,
    loadMore: query.hasMore ? loadMore : undefined,
    *[Symbol.iterator](): ArrayIterator<ApiError | K[] | null> {
      yield query.items;
      yield endpointError ?? paginationError ?? query.errors.find(it => it !== null) ?? null;
    },
  };
}
