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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './ApiError';
import { clusterFetch } from './fetch';
import {
  DEFAULT_LIST_LIMIT,
  kubeObjectListQuery,
  ListResponse,
  makeListRequests,
  useKubeObjectList,
  useWatchKubeObjectLists,
} from './useKubeObjectList';
import * as websocket from './webSocket';

// Mock WebSocket functionality
const mockUseWebSockets = vi.fn();
const mockSubscribe = vi.fn().mockImplementation(() => Promise.resolve(() => {}));
const mockClusterFetch = vi.mocked(clusterFetch);

vi.mock('./webSocket', () => ({
  useWebSockets: (...args: any[]) => mockUseWebSockets(...args),
  BASE_WS_URL: 'http://localhost:3000',
  // P1 (#14 C4): the adaptive controller reads the global "reconnecting" signal.
  useAnyWatchReconnecting: () => false,
}));

vi.mock('./multiplexer', () => ({
  WebSocketManager: {
    subscribe: (...args: any[]) => mockSubscribe(...args),
  },
}));

vi.mock('./fetch', () => ({
  clusterFetch: vi.fn(),
}));

describe('makeListRequests', () => {
  describe('for non namespaced resource', () => {
    it('should not include namespace in requests', () => {
      const requests = makeListRequests(['default'], () => ['namespace-a'], false, [
        'namepspace-a',
        'namespace-b',
      ]);
      expect(requests).toEqual([{ cluster: 'default', namespaces: undefined }]);
    });
  });
  describe('for namespaced resource', () => {
    it('should make request with no namespaces provided', () => {
      const requests = makeListRequests(['default'], () => [], true);
      expect(requests).toEqual([{ cluster: 'default', namespaces: [] }]);
    });

    it('should not make a cluster-wide request when a namespace restriction resolves empty', () => {
      const requests = makeListRequests(
        ['default'],
        () => [],
        true,
        [],
        () => true
      );
      expect(requests).toEqual([]);
    });

    it('should reject requested namespaces when a namespace restriction resolves empty', () => {
      const requests = makeListRequests(
        ['default'],
        () => [],
        true,
        ['namespace-a'],
        () => true
      );
      expect(requests).toEqual([]);
    });

    it('should make requests for allowed namespaces only', () => {
      const requests = makeListRequests(['default'], () => ['namespace-a'], true);
      expect(requests).toEqual([{ cluster: 'default', namespaces: ['namespace-a'] }]);
    });

    it('should make requests for allowed namespaces only, even when requested other', () => {
      const requests = makeListRequests(['default'], () => ['namespace-a'], true, [
        'namespace-a',
        'namespace-b',
      ]);
      expect(requests).toEqual([{ cluster: 'default', namespaces: ['namespace-a'] }]);
    });

    it('should skip a cluster when requested namespaces do not intersect its allow-list', () => {
      const requests = makeListRequests(
        ['cluster-a', 'cluster-b'],
        cluster => (cluster === 'cluster-a' ? ['namespace-a'] : ['namespace-b']),
        true,
        ['namespace-a'],
        () => true
      );
      expect(requests).toEqual([{ cluster: 'cluster-a', namespaces: ['namespace-a'] }]);
    });

    it('should make requests for allowed namespaces per cluster', () => {
      const requests = makeListRequests(
        ['cluster-a', 'cluster-b'],
        (cluster: string | null) => (cluster === 'cluster-a' ? ['namespace-a'] : ['namespace-b']),
        true
      );
      expect(requests).toEqual([
        { cluster: 'cluster-a', namespaces: ['namespace-a'] },
        { cluster: 'cluster-b', namespaces: ['namespace-b'] },
      ]);
    });

    it('should make requests for allowed namespaces per cluster, even if requested other', () => {
      const requests = makeListRequests(
        ['cluster-a', 'cluster-b'],
        (cluster: string | null) => (cluster === 'cluster-a' ? ['namespace-a'] : ['namespace-b']),
        true,
        ['namespace-a', 'namespace-b', 'namespace-c']
      );
      expect(requests).toEqual([
        { cluster: 'cluster-a', namespaces: ['namespace-a'] },
        { cluster: 'cluster-b', namespaces: ['namespace-b'] },
      ]);
    });

    it('should make requests for allowed namespaces per cluster, with one cluster without allowed namespaces', () => {
      const requests = makeListRequests(
        ['cluster-a', 'cluster-b'],
        (cluster: string | null) => (cluster === 'cluster-a' ? ['namespace-a'] : []),
        true,
        ['namespace-a', 'namespace-b', 'namespace-c']
      );
      expect(requests).toEqual([
        { cluster: 'cluster-a', namespaces: ['namespace-a'] },
        { cluster: 'cluster-b', namespaces: ['namespace-a', 'namespace-b', 'namespace-c'] },
      ]);
    });
  });
});

const mockClass = class {
  static apiVersion = 'v1';
  static apiName = 'pods';

  static apiEndpoint = {
    apiInfo: [
      {
        group: '',
        resource: 'pods',
        version: 'v1',
      },
    ],
  };

  constructor(public jsonData: any) {}
} as any;

const mockNodeClass = class {
  static apiVersion = 'v1';
  static apiName = 'nodes';

  static apiEndpoint = {
    apiInfo: [
      {
        group: '',
        resource: 'nodes',
        version: 'v1',
      },
    ],
  };

  constructor(public jsonData: any) {}
} as any;

function makeListResponse({
  kind = 'PodList',
  items = [],
  resourceVersion = '1',
  continueToken,
  remainingItemCount,
}: {
  kind?: string;
  items?: any[];
  resourceVersion?: string;
  continueToken?: string;
  remainingItemCount?: number;
} = {}) {
  return {
    kind,
    apiVersion: 'v1',
    metadata: {
      resourceVersion,
      continue: continueToken,
      remainingItemCount,
    },
    items,
  };
}

function makePod(name: string, resourceVersion: string) {
  return {
    metadata: {
      name,
      namespace: 'default',
      resourceVersion,
      uid: name,
    },
  };
}

function queryClientWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useWatchKubeObjectLists', () => {
  beforeEach(() => {
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'false');
    vi.clearAllMocks();
  });

  it('should not be enabled when no endpoint is provided', () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();
    renderHook(() => useWatchKubeObjectLists({ kubeObjectClass: mockClass, lists: [] }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    expect(spy).toHaveBeenCalledWith({ enabled: false, connections: [] });
  });

  it('should call useWebSockets when endpoint and lists are provided', () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          lists: [{ cluster: 'default', resourceVersion: '1' }],
          endpoint: { version: 'v1', resource: 'pods' },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(spy.mock.calls[0][0].enabled).toBe(true);
    expect(spy.mock.calls[0][0].connections[0].cluster).toBe('default');
    expect(spy.mock.calls[0][0].connections[0].url).toBe(
      'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
    );
  });

  it('should call useWebSockets when endpoint and 2 lists are provided', () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          lists: [
            { cluster: 'default', resourceVersion: '1', namespace: 'a' },
            { cluster: 'default', resourceVersion: '1', namespace: 'b' },
          ],
          endpoint: { version: 'v1', resource: 'pods' },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(spy.mock.calls[0][0].enabled).toBe(true);
    expect(spy.mock.calls[0][0].connections[0].cluster).toBe('default');
    expect(spy.mock.calls[0][0].connections[0].url).toBe(
      'api/v1/namespaces/a/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
    );

    expect(spy.mock.calls[0][0].connections[1].cluster).toBe('default');
    expect(spy.mock.calls[0][0].connections[1].url).toBe(
      'api/v1/namespaces/b/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
    );
  });

  it('should update query data on ADDED message', () => {
    const useWebSocketSpy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();

    // Given
    const kubeObjectClass = mockClass;
    const endpoint = { version: 'v1', resource: 'pods' };
    const lists = [
      { cluster: 'default', resourceVersion: '1', namespace: 'a' },
      { cluster: 'default', resourceVersion: '1', namespace: 'b' },
    ];
    const cluster = 'default';
    const queryParams = {};
    const keyForNamespaceA = kubeObjectListQuery(
      mockClass,
      endpoint,
      'a',
      cluster,
      queryParams
    ).queryKey;
    const keyForNamespaceB = kubeObjectListQuery(
      mockClass,
      endpoint,
      'b',
      cluster,
      queryParams
    ).queryKey;

    // Prepopulate query data with existing list
    queryClient.setQueryData(keyForNamespaceA, {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster,
    });
    queryClient.setQueryData(keyForNamespaceB, {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster,
    });

    // When watching lists
    renderHook(() => useWatchKubeObjectLists({ kubeObjectClass, lists, endpoint }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    // And receiving updates
    const connectionToNamespaceA = useWebSocketSpy.mock.calls[0][0].connections[0];
    const objectA = { metadata: { namespace: 'a', resourceVersion: '123' } };
    connectionToNamespaceA.onMessage({
      type: 'ADDED',
      object: objectA,
    });
    const connectionToNamespaceB = useWebSocketSpy.mock.calls[0][0].connections[1];
    const objectB = { metadata: { namespace: 'b', resourceVersion: '123' } };
    connectionToNamespaceB.onMessage({
      type: 'ADDED',
      object: objectB,
    });

    // Should put object in the appropriate query data
    expect(
      (queryClient.getQueryData(keyForNamespaceA) as ListResponse<any>).list.items[0].jsonData
    ).toBe(objectA);

    expect(
      (queryClient.getQueryData(keyForNamespaceB) as ListResponse<any>).list.items[0].jsonData
    ).toBe(objectB);
  });

  it('should not call WebSocketManager.subscribe when multiplexer is disabled', () => {
    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          lists: [{ cluster: 'default', resourceVersion: '1' }],
          endpoint: { version: 'v1', resource: 'pods' },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        ),
      }
    );
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

describe('useKubeObjectList', () => {
  beforeEach(() => {
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'false');
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns an empty result without fetching when no list requests are allowed', () => {
    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [],
          emptyWhenNoRequests: true,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) }
    );

    expect(result.result.current.items).toEqual([]);
    expect(mockClusterFetch).not.toHaveBeenCalled();
  });

  it('does not probe endpoints when no list requests are allowed', async () => {
    const multiVersionClass = class {
      static apiVersion = 'v1';
      static apiName = 'ingresses';
      static apiEndpoint = {
        apiInfo: [
          { group: 'networking.k8s.io', resource: 'ingresses', version: 'v1' },
          { group: 'extensions', resource: 'ingresses', version: 'v1beta1' },
        ],
      };
    } as any;

    renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: multiVersionClass,
          requests: [],
          emptyWhenNoRequests: true,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) }
    );

    await waitFor(() => expect(mockClusterFetch).not.toHaveBeenCalled());
  });

  it('fetches allowed namespaces individually without starting a cluster-wide watch', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespaces: ['team-a', 'team-b'] })
    );
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            metadata: { name: 'team-a', managedFields: [{ manager: 'kubectl' }] },
          }),
      } as Response)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ metadata: { name: 'team-b' } }),
      } as Response);

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      {}
    );
    const response = await (query.queryFn as any)();
    const items = response.list.items as Array<{
      cluster: string;
      jsonData: { metadata: { name: string; managedFields?: unknown[] } };
    }>;

    expect(mockClusterFetch).toHaveBeenNthCalledWith(1, 'api/v1/namespaces/team-a', {
      cluster: 'restricted',
    });
    expect(mockClusterFetch).toHaveBeenNthCalledWith(2, 'api/v1/namespaces/team-b', {
      cluster: 'restricted',
    });
    expect(items.map(item => item.jsonData.metadata.name)).toEqual(['team-a', 'team-b']);
    expect(items[0].jsonData.metadata.managedFields).toBeUndefined();
    expect(items.every(item => item.cluster === 'restricted')).toBe(true);
    expect(response.skipWatch).toBe(true);
  });

  it('adds cluster and namespace context to allowed namespace errors', async () => {
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespaces: ['team-a'] })
    );
    const error = new ApiError('Forbidden', { status: 403 });
    mockClusterFetch.mockRejectedValueOnce(error);

    const query = kubeObjectListQuery(
      class {
        static apiVersion = 'v1';
        static apiName = 'namespaces';
        static kind = 'Namespace';
      } as any,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      {}
    );

    await expect((query.queryFn as any)()).rejects.toBe(error);
    expect(error).toMatchObject({ cluster: 'restricted', namespace: 'team-a', status: 403 });
  });

  it('preserves non-ApiError failures from allowed namespace requests', async () => {
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespaces: ['team-a'] })
    );
    const error = new TypeError('invalid namespace response');
    mockClusterFetch.mockRejectedValueOnce(error);

    const query = kubeObjectListQuery(
      class {
        static apiVersion = 'v1';
        static apiName = 'namespaces';
        static kind = 'Namespace';
      } as any,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      {}
    );

    await expect((query.queryFn as any)()).rejects.toBe(error);
  });

  it('uses the cluster-wide namespace query when no allowed namespaces are configured', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    mockClusterFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(makeListResponse({ kind: 'NamespaceList' })),
    } as Response);

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'unrestricted',
      {}
    );
    const response = await (query.queryFn as any)();

    expect(mockClusterFetch).toHaveBeenCalledWith('api/v1/namespaces', {
      cluster: 'unrestricted',
    });
    expect(response.skipWatch).toBeUndefined();
  });

  it('uses a selector list when a namespace restriction resolves empty', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespacesSelector: 'team=frontend' })
    );
    localStorage.setItem(
      'cluster_allowed_namespaces_selector_cache.restricted',
      JSON.stringify({
        selector: 'team=frontend',
        namespaces: [],
        resolvedAt: Date.now(),
      })
    );
    mockClusterFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(makeListResponse({ kind: 'NamespaceList' })),
    } as Response);

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      {}
    );
    const response = await (query.queryFn as any)();

    expect(response.list.items).toEqual([]);
    expect(response.skipWatch).toBe(true);
    expect(mockClusterFetch).toHaveBeenCalledWith(
      'api/v1/namespaces?labelSelector=team%3Dfrontend',
      { cluster: 'restricted' }
    );
  });

  it('lists selector-restricted namespaces without requiring per-name get access', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespacesSelector: 'team=frontend' })
    );
    localStorage.setItem(
      'cluster_allowed_namespaces_selector_cache.restricted',
      JSON.stringify({
        selector: 'team=frontend',
        namespaces: ['team-a'],
        resolvedAt: Date.now(),
      })
    );
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            kind: 'NamespaceList',
            items: [{ metadata: { name: 'team-a', labels: { team: 'frontend' } } }],
          })
        ),
    } as Response);

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      {}
    );
    const response = await (query.queryFn as any)();

    expect(mockClusterFetch).toHaveBeenCalledTimes(1);
    expect(mockClusterFetch).toHaveBeenCalledWith(
      'api/v1/namespaces?labelSelector=team%3Dfrontend',
      { cluster: 'restricted' }
    );
    expect(response.list.items.map((item: any) => item.jsonData.metadata.name)).toEqual(['team-a']);
  });

  it('uses the labeled namespace query while resolving a selector', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({
        allowedNamespaces: ['manual'],
        allowedNamespacesSelector: 'team=frontend',
      })
    );
    mockClusterFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(makeListResponse({ kind: 'NamespaceList' })),
    } as Response);

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      { labelSelector: 'team=frontend' }
    );
    await (query.queryFn as any)();

    expect(mockClusterFetch).toHaveBeenCalledWith(
      'api/v1/namespaces?labelSelector=team%3Dfrontend',
      { cluster: 'restricted' }
    );
  });

  it('intersects view selectors and only gets manually configured namespaces by name', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({
        allowedNamespaces: ['manual'],
        allowedNamespacesSelector: 'team=frontend',
      })
    );
    mockClusterFetch.mockImplementation(async url => {
      if (url === 'api/v1/namespaces/manual') {
        return {
          json: () => Promise.resolve({ metadata: { name: 'manual' } }),
        } as Response;
      }
      return {
        json: () =>
          Promise.resolve(
            makeListResponse({
              kind: 'NamespaceList',
              items: [{ metadata: { name: 'manual' } }, { metadata: { name: 'selected' } }],
            })
          ),
      } as Response;
    });

    const query = kubeObjectListQuery(
      namespaceClass,
      { version: 'v1', resource: 'namespaces' },
      undefined,
      'restricted',
      { labelSelector: 'headlamp.dev/project-id' }
    );
    const response = await (query.queryFn as any)();

    expect(mockClusterFetch).toHaveBeenCalledWith('api/v1/namespaces/manual', {
      cluster: 'restricted',
    });
    expect(mockClusterFetch).toHaveBeenCalledWith(
      'api/v1/namespaces?labelSelector=team%3Dfrontend%2Cheadlamp.dev%2Fproject-id',
      { cluster: 'restricted' }
    );
    expect(response.list.items.map((item: any) => item.jsonData.metadata.name)).toEqual([
      'manual',
      'selected',
    ]);
  });

  it('does not watch the synthesized allowed namespace list', async () => {
    const namespaceClass = class {
      static apiVersion = 'v1';
      static apiName = 'namespaces';
      static kind = 'Namespace';
      static apiEndpoint = {
        apiInfo: [{ group: '', resource: 'namespaces', version: 'v1' }],
      };

      constructor(public jsonData: any) {}
    } as any;
    localStorage.setItem(
      'cluster_settings.restricted',
      JSON.stringify({ allowedNamespaces: ['team-a'] })
    );
    mockClusterFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ metadata: { name: 'team-a' } }),
    } as Response);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: namespaceClass,
          requests: [{ cluster: 'restricted' }],
        }),
      { wrapper: queryClientWrapper(new QueryClient()) }
    );

    await waitFor(() => expect(result.result.current.items).toHaveLength(1));
    expect(mockUseWebSockets.mock.calls.at(-1)?.[0].connections).toEqual([]);
  });

  it('should not add a list limit unless the caller opts in', async () => {
    mockClusterFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(makeListResponse()),
    } as Response);

    const query = kubeObjectListQuery(
      mockClass,
      { version: 'v1', resource: 'pods' },
      undefined,
      'default',
      {}
    );

    await (query.queryFn as any)();

    expect(mockClusterFetch).toHaveBeenCalledWith('api/v1/pods', {
      cluster: 'default',
    });
  });

  it('should not fetch when no endpoint is available', async () => {
    const query = kubeObjectListQuery(mockClass, undefined as any, undefined, 'default', {});

    await expect((query.queryFn as any)()).resolves.toBeUndefined();
    expect(mockClusterFetch).not.toHaveBeenCalled();
  });

  it('should remove managed fields from listed objects', async () => {
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            items: [
              {
                ...makePod('pod-with-managed-fields', '1'),
                metadata: {
                  ...makePod('pod-with-managed-fields', '1').metadata,
                  managedFields: [{ manager: 'kubectl' }],
                },
              },
            ],
          })
        ),
    } as Response);

    const query = kubeObjectListQuery(
      mockClass,
      { version: 'v1', resource: 'pods' },
      undefined,
      'default',
      {}
    );
    const response = await (query.queryFn as any)();

    expect(response.list.items[0].jsonData.metadata.managedFields).toBeUndefined();
  });

  it('should strip only the List suffix from item kind', async () => {
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            kind: 'EventListenerList',
            items: [makePod('listener-1', '1')],
          })
        ),
    } as Response);

    const query = kubeObjectListQuery(
      mockClass,
      { version: 'v1', resource: 'pods' },
      undefined,
      'default',
      {}
    );

    const response = await (query.queryFn as any)();

    expect(response.list.items[0].jsonData.kind).toBe('EventListener');
  });

  it('should append the next page and start watching when all pages are loaded', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'token-1',
              remainingItemCount: 1,
            })
          ),
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              kind: 'EventListenerList',
              items: [makePod('pod-2', '2')],
              resourceVersion: '2',
            })
          ),
      } as Response);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.result.current.items?.length).toBe(1));

    expect(mockClusterFetch.mock.calls[0][0]).toBe('api/v1/pods?limit=1000');
    expect(result.result.current.hasMore).toBe(true);
    expect(result.result.current.remainingItemCount).toBe(1);
    expect(result.result.current.loadMore).toEqual(expect.any(Function));
    expect(mockUseWebSockets.mock.calls.at(-1)?.[0].connections).toEqual([]);

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    await waitFor(() => expect(result.result.current.items?.length).toBe(2));
    expect(result.result.current.items?.map(item => item.jsonData.metadata.name)).toEqual([
      'pod-1',
      'pod-2',
    ]);
    expect(result.result.current.items?.[1].jsonData.kind).toBe('EventListener');
    expect(mockClusterFetch.mock.calls[1][0]).toBe('api/v1/pods?limit=1000&continue=token-1');
    expect(result.result.current.hasMore).toBe(false);
    expect(result.result.current.loadMore).toBeUndefined();
    await waitFor(() =>
      expect(
        mockUseWebSockets.mock.calls.some(
          ([call]) =>
            call.connections[0]?.url ===
            'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=2'
        )
      ).toBe(true)
    );
  });

  it('should refresh list resourceVersions when watching resumes after a query change', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ resourceVersion: '1' })),
      } as Response)
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ resourceVersion: '2' })),
      } as Response);

    const result = renderHook(
      (props: { queryParams: Record<string, number> }) =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: props.queryParams,
        }),
      {
        wrapper: queryClientWrapper(queryClient),
        initialProps: {
          queryParams: {},
        },
      }
    );

    await waitFor(() =>
      expect(
        mockUseWebSockets.mock.calls.some(
          ([call]) =>
            call.connections[0]?.url ===
            'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
        )
      ).toBe(true)
    );

    result.rerender({ queryParams: { limit: DEFAULT_LIST_LIMIT } });

    await waitFor(() =>
      expect(
        mockUseWebSockets.mock.calls.some(
          ([call]) =>
            call.connections[0]?.url ===
            'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=2'
        )
      ).toBe(true)
    );
  });

  it('does NOT mutate the cache or rebuild the watch when a BOOKMARK arrives (no churn) [#16]', async () => {
    const queryClient = new QueryClient();
    mockUseWebSockets.mockClear();
    mockClusterFetch.mockResolvedValue({
      json: () => Promise.resolve(makeListResponse({ resourceVersion: '1' })),
    } as Response);

    renderHook(
      () => useKubeObjectList({ kubeObjectClass: mockClass, requests: [{ cluster: 'default' }] }),
      { wrapper: queryClientWrapper(queryClient) }
    );

    // Initial watch established at resourceVersion=1.
    await waitFor(() =>
      expect(
        mockUseWebSockets.mock.calls.some(
          ([call]) =>
            call.connections[0]?.url ===
            'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
        )
      ).toBe(true)
    );

    // Deliver a BOOKMARK that advances the server resourceVersion to 999.
    const lastCall = mockUseWebSockets.mock.calls.at(-1)![0];
    const onMessage = lastCall.connections[0].onMessage;
    const setSpy = vi.spyOn(queryClient, 'setQueryData');
    act(() => {
      onMessage({
        type: 'BOOKMARK',
        object: { kind: 'Pod', metadata: { resourceVersion: '999' } },
      });
    });

    // A BOOKMARK must NOT write to the React Query cache...
    expect(setSpy).not.toHaveBeenCalled();
    // ...and must NOT rebuild the watch to the bookmark's resourceVersion — otherwise
    // the socket would close/reopen every ~bookmark interval (60s churn).
    await new Promise(r => setTimeout(r, 50));
    const rebuiltToBookmarkRV = mockUseWebSockets.mock.calls.some(([call]) =>
      call.connections?.[0]?.url?.includes('resourceVersion=999')
    );
    expect(rebuiltToBookmarkRV).toBe(false);
  });

  it('does NOT rebuild the watch on an applied ADDED/MODIFIED/DELETED event (no churn) [#15]', async () => {
    const queryClient = new QueryClient();
    mockUseWebSockets.mockClear();
    mockClusterFetch.mockResolvedValue({
      json: () => Promise.resolve(makeListResponse({ resourceVersion: '1' })),
    } as Response);

    renderHook(
      () => useKubeObjectList({ kubeObjectClass: mockClass, requests: [{ cluster: 'default' }] }),
      { wrapper: queryClientWrapper(queryClient) }
    );

    // Initial watch identity = listResourceVersion=1 (stamped from the fresh LIST).
    await waitFor(() =>
      expect(
        mockUseWebSockets.mock.calls.some(
          ([call]) =>
            call.connections[0]?.url ===
            'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
        )
      ).toBe(true)
    );

    // Apply a real ADDED event that bumps the LIVE resourceVersion to 2.
    const onMessage = mockUseWebSockets.mock.calls.at(-1)![0].connections[0].onMessage;
    act(() => {
      onMessage({
        type: 'ADDED',
        object: {
          kind: 'Pod',
          metadata: { uid: 'p2', name: 'p2', namespace: 'default', resourceVersion: '2' },
        },
      });
    });
    await new Promise(r => setTimeout(r, 50));

    // The watch identity is listResourceVersion (still 1) — applyUpdate bumped only
    // the live resourceVersion. So NO watch URL with resourceVersion=2 is ever built:
    // the socket is not torn down and recreated on the event.
    const rebuiltToEventRV = mockUseWebSockets.mock.calls.some(([call]) =>
      (call.connections?.[0]?.url ?? '').includes('resourceVersion=2')
    );
    expect(rebuiltToEventRV).toBe(false);
    // The watch URL is still pinned to the LIST-generation RV (1).
    expect(mockUseWebSockets.mock.calls.at(-1)![0].connections[0]?.url).toBe(
      'api/v1/pods?watch=1&allowWatchBookmarks=true&resourceVersion=1'
    );
  });

  it('should split an opt-in limit across namespace requests', async () => {
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-a', '1')] })),
      } as Response)
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-b', '1')] })),
      } as Response);

    renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default', namespaces: ['a', 'b'] }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(new QueryClient()),
      }
    );

    await waitFor(() => expect(mockClusterFetch).toHaveBeenCalledTimes(2));

    expect(mockClusterFetch.mock.calls[0][0]).toBe('api/v1/namespaces/a/pods?limit=500');
    expect(mockClusterFetch.mock.calls[1][0]).toBe('api/v1/namespaces/b/pods?limit=500');
  });

  it('should not issue more initial namespace requests than the opt-in limit', async () => {
    const nextNamespace = deferred<Response>();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-a', '1')] })),
      } as Response)
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-b', '1')] })),
      } as Response)
      .mockReturnValueOnce(nextNamespace.promise);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default', namespaces: ['a', 'b', 'c'] }],
          queryParams: { limit: 2 },
        }),
      {
        wrapper: queryClientWrapper(new QueryClient()),
      }
    );

    await waitFor(() => expect(mockClusterFetch).toHaveBeenCalledTimes(2));

    expect(mockClusterFetch.mock.calls[0][0]).toBe('api/v1/namespaces/a/pods?limit=1');
    expect(mockClusterFetch.mock.calls[1][0]).toBe('api/v1/namespaces/b/pods?limit=1');
    expect(result.result.current.hasMore).toBe(true);
    expect(result.result.current.remainingItemCount).toBeUndefined();

    await act(async () => {
      let loadMoreSettled = false;
      const loadMorePromise = result.result.current.loadMore?.().then(() => {
        loadMoreSettled = true;
      });

      await waitFor(() => expect(mockClusterFetch).toHaveBeenCalledTimes(3));
      expect(loadMoreSettled).toBe(false);

      nextNamespace.resolve({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-c', '1')] })),
      } as Response);
      await loadMorePromise;
      expect(loadMoreSettled).toBe(true);
    });

    expect(mockClusterFetch.mock.calls[2][0]).toBe('api/v1/namespaces/c/pods?limit=1');
  });

  it('should leave remainingItemCount unset when the server does not report it', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            items: [makePod('pod-1', '1')],
            resourceVersion: '1',
            continueToken: 'token-1',
          })
        ),
    } as Response);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.result.current.hasMore).toBe(true));

    expect(result.result.current.remainingItemCount).toBeUndefined();
  });

  it('should expose loadMore errors through the list response', async () => {
    const queryClient = new QueryClient();
    const loadMoreError = new ApiError('expired continue token', { status: 410 });
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'token-1',
            })
          ),
      } as Response)
      .mockRejectedValueOnce(loadMoreError);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    await waitFor(() =>
      expect(result.result.current.error?.message).toBe('expired continue token')
    );
    expect(result.result.current.isError).toBe(true);
    expect(result.result.current.errors).toContainEqual(
      expect.objectContaining({ message: 'expired continue token', status: 410 })
    );
  });

  it('should normalize pending list request rejections to ApiError', async () => {
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve(makeListResponse({ items: [makePod('pod-a', '1')] })),
      } as Response)
      .mockRejectedValueOnce(new SyntaxError('invalid list response'));

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default', namespaces: ['a', 'b'] }],
          queryParams: { limit: 1 },
        }),
      {
        wrapper: queryClientWrapper(new QueryClient()),
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    expect(result.result.current.error).toBeInstanceOf(ApiError);
    expect(result.result.current.error).toMatchObject({
      message: 'invalid list response',
      cluster: 'default',
      namespace: 'b',
    });
  });

  it('should normalize unexpected page processing errors to ApiError', async () => {
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              continueToken: 'token-1',
            })
          ),
      } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) } as Response);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default', namespaces: ['a'] }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(new QueryClient()),
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    expect(result.result.current.error).toBeInstanceOf(ApiError);
    expect(result.result.current.error).toMatchObject({
      cluster: 'default',
      namespace: 'a',
    });
  });

  it('should clear loadMore errors when request inputs change', async () => {
    const queryClient = new QueryClient();
    const loadMoreError = new ApiError('expired continue token', { status: 410 });
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'token-1',
            })
          ),
      } as Response)
      .mockRejectedValueOnce(loadMoreError)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-2', '1')],
              resourceVersion: '1',
            })
          ),
      } as Response);

    const result = renderHook(
      (props: { requests: Array<{ cluster: string; namespaces?: string[] }> }) =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: props.requests,
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
        initialProps: {
          requests: [{ cluster: 'default', namespaces: ['a'] }],
        },
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    await waitFor(() =>
      expect(result.result.current.error?.message).toBe('expired continue token')
    );

    result.rerender({ requests: [{ cluster: 'default', namespaces: ['b'] }] });

    await waitFor(() => expect(result.result.current.error).toBeNull());
  });

  it('should ignore duplicate loadMore calls while a page is already loading', async () => {
    const queryClient = new QueryClient();
    const nextPage = deferred<Response>();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'token-1',
            })
          ),
      } as Response)
      .mockReturnValueOnce(nextPage.promise);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      const firstLoad = result.result.current.loadMore?.();
      const secondLoad = result.result.current.loadMore?.();

      expect(mockClusterFetch).toHaveBeenCalledTimes(2);

      nextPage.resolve({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-2', '2')],
              resourceVersion: '2',
            })
          ),
      } as Response);

      await Promise.all([firstLoad, secondLoad]);
    });

    await waitFor(() => expect(result.result.current.items?.length).toBe(2));
    expect(mockClusterFetch.mock.calls[1][0]).toBe('api/v1/pods?limit=1000&continue=token-1');
  });

  it('should call useKubeObjectList with 1 namespace after reducing amount of namespaces', async () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();

    queryClient.setQueryData(['kubeObject', 'list', 'v1', 'pods', 'default', 'a', {}], {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster: 'default',
      namespace: 'a',
    });
    queryClient.setQueryData(['kubeObject', 'list', 'v1', 'pods', 'default', 'b', {}], {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster: 'default',
      namespace: 'b',
    });

    const result = renderHook(
      (props: {}) =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default', namespaces: ['a', 'b'] }],
          ...props,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      }
    );

    result.rerender({ requests: [{ cluster: 'default', namespaces: ['a'] }] });

    await waitFor(() => expect(spy.mock.calls.at(-1)?.[0].connections.length).toBe(1));
    expect(spy.mock.calls.at(-1)?.[0].connections[0].url).toContain('/namespaces/a/');
  });

  it('should clean up cluster-scoped resources when cluster is removed', async () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');
    const queryClient = new QueryClient();

    queryClient.setQueryData(['kubeObject', 'list', 'v1', 'nodes', 'cluster-1', '', {}], {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster: 'cluster-1',
    });
    queryClient.setQueryData(['kubeObject', 'list', 'v1', 'nodes', 'cluster-2', '', {}], {
      list: { items: [], metadata: { resourceVersion: '0' } },
      cluster: 'cluster-2',
    });

    const result = renderHook(
      (props: { requests: Array<{ cluster: string; namespaces?: string[] }> }) =>
        useKubeObjectList({
          kubeObjectClass: mockNodeClass,
          requests: props.requests,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
        initialProps: {
          requests: [{ cluster: 'cluster-1' }, { cluster: 'cluster-2' }],
        },
      }
    );

    expect(spy.mock.calls[1][0].connections.length).toBe(2);

    result.rerender({ requests: [{ cluster: 'cluster-1' }] });

    expect(spy.mock.calls[3][0].connections.length).toBe(1);
    expect(spy.mock.calls[3][0].connections[0].cluster).toBe('cluster-1');
  });
});

describe('useWatchKubeObjectLists (Multiplexer)', () => {
  beforeEach(() => {
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'true');
    vi.clearAllMocks();
  });

  it('should subscribe using WebSocketManager when multiplexer is enabled', () => {
    const lists = [{ cluster: 'cluster-a', namespace: 'namespace-a', resourceVersion: '1' }];

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          endpoint: { version: 'v1', resource: 'pods' },
          lists,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(mockSubscribe).toHaveBeenCalledWith(
      'cluster-a',
      expect.stringContaining('/api/v1/namespaces/namespace-a/pods'),
      'watch=1&resourceVersion=1',
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should subscribe to multiple clusters', () => {
    const lists = [
      { cluster: 'cluster-a', namespace: 'namespace-a', resourceVersion: '1' },
      { cluster: 'cluster-b', namespace: 'namespace-b', resourceVersion: '2' },
    ];

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          endpoint: { version: 'v1', resource: 'pods' },
          lists,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenNthCalledWith(
      1,
      'cluster-a',
      expect.stringContaining('/api/v1/namespaces/namespace-a/pods'),
      'watch=1&resourceVersion=1',
      expect.any(Function),
      expect.any(Function)
    );
    expect(mockSubscribe).toHaveBeenNthCalledWith(
      2,
      'cluster-b',
      expect.stringContaining('/api/v1/namespaces/namespace-b/pods'),
      'watch=1&resourceVersion=2',
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should handle non-namespaced resources', () => {
    const lists = [{ cluster: 'cluster-a', resourceVersion: '1' }];

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          endpoint: { version: 'v1', resource: 'pods' },
          lists,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(mockSubscribe).toHaveBeenCalledWith(
      'cluster-a',
      expect.stringContaining('/api/v1/pods'),
      'watch=1&resourceVersion=1',
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should not call legacy useWebSockets with connections when multiplexer is enabled', () => {
    const spy = vi.spyOn(websocket, 'useWebSockets');

    renderHook(
      () =>
        useWatchKubeObjectLists({
          kubeObjectClass: mockClass,
          lists: [{ cluster: 'cluster-a', namespace: 'namespace-a', resourceVersion: '1' }],
          endpoint: { version: 'v1', resource: 'pods' },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        ),
      }
    );

    expect(spy).toHaveBeenCalledWith({ enabled: false, connections: [] });
  });

  it('should omit pagination query params after loading all pages', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'token-1',
            })
          ),
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-2', '2')],
              resourceVersion: '2',
            })
          ),
      } as Response);

    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      {
        wrapper: queryClientWrapper(queryClient),
      }
    );

    await waitFor(() => expect(result.result.current.loadMore).toEqual(expect.any(Function)));

    await act(async () => {
      await result.result.current.loadMore?.();
    });

    await waitFor(() =>
      expect(
        mockSubscribe.mock.calls.some(
          ([cluster, pathname, query]) =>
            cluster === 'default' &&
            pathname === '/api/v1/pods' &&
            query === 'watch=1&resourceVersion=2'
        )
      ).toBe(true)
    );
  });
});

// P1 (#14): the paginated-marker guard is the CORRECTNESS mechanism. These tests fail
// if the queryFn commit-time guard (kubeObjectListQuery) is removed.
describe('#14 paginated-marker guard (page-1 refetch must not clobber accumulated pages)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const endpoint = { version: 'v1', resource: 'pods' } as any;
  const names = (data: any) => (data?.list?.items ?? []).map((i: any) => i.jsonData.metadata.name);
  const primed = (items: any[], paginated: boolean, continueToken?: string) => ({
    cluster: 'default',
    namespace: '',
    list: {
      kind: 'Pod',
      apiVersion: 'v1',
      items: items.map(p => ({ jsonData: p })),
      metadata: {
        resourceVersion: '10',
        listResourceVersion: '10',
        continue: continueToken,
        paginated,
      },
    },
  });
  const freshPage1Once = () =>
    mockClusterFetch.mockImplementationOnce(
      async () =>
        ({
          json: () =>
            Promise.resolve(
              makeListResponse({ items: [makePod('FRESH', '12')], resourceVersion: '12' })
            ),
        } as Response)
    );

  it('forced refetch with paginated=true keeps the accumulated list (guard) [#14]', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = kubeObjectListQuery(mockClass, endpoint, undefined, 'default', {});
    qc.setQueryData(
      query.queryKey!,
      primed([makePod('p1', '10'), makePod('p2', '10')], true, 'TOK')
    );
    freshPage1Once();
    await qc.fetchQuery({ ...(query as any), staleTime: 0, retry: false });
    expect(names(qc.getQueryData(query.queryKey!))).toEqual(['p1', 'p2']);
    expect((qc.getQueryData(query.queryKey!) as any).list.metadata.paginated).toBe(true);
  });

  it('forced refetch with paginated=false lets a fresh page 1 replace [#14]', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = kubeObjectListQuery(mockClass, endpoint, undefined, 'default', {});
    qc.setQueryData(query.queryKey!, primed([makePod('old', '9')], false));
    freshPage1Once();
    await qc.fetchQuery({ ...(query as any), staleTime: 0, retry: false });
    expect(names(qc.getQueryData(query.queryKey!))).toEqual(['FRESH']);
  });

  it('deterministic race: a page-1 refetch resolving AFTER load-more marks+appends keeps page 2 [#14]', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = kubeObjectListQuery(mockClass, endpoint, undefined, 'default', {});
    qc.setQueryData(query.queryKey!, primed([makePod('p1', '10')], false, 'TOK'));
    // Page-1 fetch is held open until we release it (in flight while load-more runs).
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    mockClusterFetch.mockImplementationOnce(async () => {
      await gate;
      return {
        json: () =>
          Promise.resolve(
            makeListResponse({ items: [makePod('FRESH', '12')], resourceVersion: '12' })
          ),
      } as Response;
    });
    const fetchP = qc.fetchQuery({ ...(query as any), staleTime: 0, retry: false }).catch(() => {});
    await Promise.resolve();
    // load-more: synchronously mark paginated, then append page 2 (mirrors loadMore M2).
    qc.setQueryData(query.queryKey!, (o: any) => ({
      ...o,
      list: { ...o.list, metadata: { ...o.list.metadata, paginated: true } },
    }));
    qc.setQueryData(query.queryKey!, (o: any) => ({
      ...o,
      list: {
        ...o.list,
        items: [...o.list.items, { jsonData: makePod('p2', '10') }],
        metadata: { ...o.list.metadata, paginated: true },
      },
    }));
    release();
    await fetchP;
    expect(names(qc.getQueryData(query.queryKey!))).toEqual(['p1', 'p2']);
    expect(names(qc.getQueryData(query.queryKey!))).not.toContain('FRESH');
  });

  it('per-query isolation: paginated ns A is protected while page-1 ns B still refreshes [#14]', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const qA = kubeObjectListQuery(mockClass, endpoint, 'nsA', 'default', {});
    const qB = kubeObjectListQuery(mockClass, endpoint, 'nsB', 'default', {});
    qc.setQueryData(qA.queryKey!, primed([makePod('A1', '10'), makePod('A2', '10')], true));
    qc.setQueryData(qB.queryKey!, primed([makePod('B-old', '9')], false));
    freshPage1Once(); // for A refetch (guarded -> ignored)
    freshPage1Once(); // for B refetch (allowed)
    await qc.fetchQuery({ ...(qA as any), staleTime: 0, retry: false });
    await qc.fetchQuery({ ...(qB as any), staleTime: 0, retry: false });
    expect(names(qc.getQueryData(qA.queryKey!))).toEqual(['A1', 'A2']); // protected
    expect(names(qc.getQueryData(qB.queryKey!))).toEqual(['FRESH']); // refreshed
  });

  it('#16 confirm refetch on a paginated list: pages kept, dataUpdatedAt advances on success, failure surfaces [#14/#16]', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = kubeObjectListQuery(mockClass, endpoint, undefined, 'default', {});
    qc.setQueryData(query.queryKey!, primed([makePod('p1', '10'), makePod('p2', '10')], true));
    const before = qc.getQueryState(query.queryKey!)!.dataUpdatedAt;
    await new Promise(r => setTimeout(r, 5));
    freshPage1Once();
    await qc.fetchQuery({ ...(query as any), staleTime: 0, retry: false }); // #16 confirm = forced refetch
    expect(names(qc.getQueryData(query.queryKey!))).toEqual(['p1', 'p2']); // pages kept
    expect(qc.getQueryState(query.queryKey!)!.dataUpdatedAt).toBeGreaterThan(before); // reachability confirmed
    // Server unreachable -> queryFn throws -> error state, so #16 would close/reconnect.
    mockClusterFetch.mockRejectedValueOnce(new ApiError('down', { status: 503 }));
    await qc.fetchQuery({ ...(query as any), staleTime: 0, retry: false }).catch(() => {});
    expect(qc.getQueryState(query.queryKey!)!.status).toBe('error');
  });
});

// P1 (#14): loadMore marker lifecycle at the hook level.
describe('#14 loadMore paginated marker lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const cachedList = (queryClient: QueryClient) => {
    const entries = queryClient.getQueriesData<ListResponse<any>>({
      queryKey: ['kubeObject', 'list'],
    });
    return entries.find(([, data]) => !!data)?.[1] as any;
  };

  it('sets metadata.paginated=true after a successful load-more append [#14]', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'tok-1',
              remainingItemCount: 1,
            })
          ),
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({ items: [makePod('pod-2', '2')], resourceVersion: '2' })
          ),
      } as Response);
    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      { wrapper: queryClientWrapper(queryClient) }
    );
    await waitFor(() => expect(result.result.current.items?.length).toBe(1));
    await act(async () => {
      await result.result.current.loadMore?.();
    });
    await waitFor(() => expect(result.result.current.items?.length).toBe(2));
    expect(cachedList(queryClient).list.metadata.paginated).toBe(true);
  });

  it('reverts metadata.paginated to false when a non-410 load-more fails [#14]', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'tok-1',
            })
          ),
      } as Response)
      .mockRejectedValueOnce(new ApiError('boom', { status: 500 }));
    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      { wrapper: queryClientWrapper(queryClient) }
    );
    await waitFor(() => expect(result.result.current.items?.length).toBe(1));
    await act(async () => {
      await result.result.current.loadMore?.();
    });
    await waitFor(() => expect(result.result.current.errors?.length).toBeGreaterThan(0));
    expect(cachedList(queryClient).list.metadata.paginated).toBe(false); // reverted -> fallback resumes
    expect(cachedList(queryClient).list.items.map((i: any) => i.jsonData.metadata.name)).toEqual([
      'pod-1',
    ]);
  });

  it('on a 410 load-more, clears the marker and relists a fresh page 1 [#14]', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'tok-1',
            })
          ),
      } as Response)
      .mockRejectedValueOnce(new ApiError('expired', { status: 410 }))
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({ items: [makePod('relisted', '5')], resourceVersion: '5' })
          ),
      } as Response);
    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      { wrapper: queryClientWrapper(queryClient) }
    );
    await waitFor(() => expect(result.result.current.items?.length).toBe(1));
    await act(async () => {
      await result.result.current.loadMore?.();
    });
    // The 410 triggers invalidate -> relist to a fresh page 1; marker must be cleared.
    await waitFor(() =>
      expect(cachedList(queryClient)?.list.items.map((i: any) => i.jsonData.metadata.name)).toEqual(
        ['relisted']
      )
    );
    // A fresh relisted page 1 carries no marker (falsy) -> page-1 refetch/refresh allowed again.
    expect(cachedList(queryClient).list.metadata.paginated).toBeFalsy();
  });

  it('ignores a duplicate load-more while one is in flight (single append) [#14]', async () => {
    const queryClient = new QueryClient();
    mockClusterFetch
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({
              items: [makePod('pod-1', '1')],
              resourceVersion: '1',
              continueToken: 'tok-1',
            })
          ),
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve(
            makeListResponse({ items: [makePod('pod-2', '2')], resourceVersion: '2' })
          ),
      } as Response);
    const result = renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: mockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
        }),
      { wrapper: queryClientWrapper(queryClient) }
    );
    await waitFor(() => expect(result.result.current.items?.length).toBe(1));
    await act(async () => {
      await Promise.all([result.result.current.loadMore?.(), result.result.current.loadMore?.()]);
    });
    await waitFor(() => expect(result.result.current.items?.length).toBe(2));
    // Exactly one page-2 fetch happened (page-1 + one page-2 = 2 total clusterFetch calls).
    expect(mockClusterFetch.mock.calls.length).toBe(2);
  });
});

// P1 (#14, A1): live-subset watch. Uses a mock class WITH a `metadata` getter (like the
// real KubeObject) so membership/apply resolve UIDs. liveSubsetWatch + a `limit`.
const liveMockClass = class {
  static apiVersion = 'v1';
  static apiName = 'pods';
  static apiEndpoint = { apiInfo: [{ group: '', resource: 'pods', version: 'v1' }] };
  constructor(public jsonData: any) {}
  get metadata() {
    return this.jsonData?.metadata;
  }
} as any;

describe('#14 A1 live-subset watch (filtered whole-collection watch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force the legacy watch path (where the A1 membership filter lives); an earlier
    // Multiplexer suite stubs this env to 'true' and clearAllMocks does not unstub it.
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'false');
    localStorage.clear();
  });

  const renderLive = (queryClient: QueryClient) =>
    renderHook(
      () =>
        useKubeObjectList({
          kubeObjectClass: liveMockClass,
          requests: [{ cluster: 'default' }],
          queryParams: { limit: DEFAULT_LIST_LIMIT },
          liveSubsetWatch: true,
        }),
      { wrapper: queryClientWrapper(queryClient) }
    );
  const lastConns = () => mockUseWebSockets.mock.calls.at(-1)![0].connections;
  const evt = (type: string, uid: string, rv: string) => ({
    type,
    object: {
      kind: 'Pod',
      metadata: { uid, name: uid, namespace: 'default', resourceVersion: rv },
    },
  });
  // A partially-paginated first page (continue token ⇒ hasMore ⇒ would NOT watch in legacy mode).
  const firstPage = (items: any[], rv = '1') =>
    ({
      json: () =>
        Promise.resolve(
          makeListResponse({
            items,
            resourceVersion: rv,
            continueToken: 'tok',
            remainingItemCount: 3,
          })
        ),
    } as Response);

  it('opens a watch WHILE partially paginated (legacy would not) [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(r.result.current.hasMore).toBe(true); // partially paginated
    const conns = lastConns();
    expect(conns.length).toBe(1); // watch is OPEN despite hasMore
    expect(conns[0].url).toContain('resourceVersion=1');
  });

  it('applies MODIFIED and DELETED for LOADED pods [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1'), makePod('p2', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));
    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    await waitFor(() =>
      expect(
        r.result.current.items?.find((i: any) => i.jsonData.metadata.uid === 'p1')?.jsonData
          .metadata.resourceVersion
      ).toBe('5')
    );
    act(() => lastConns()[0].onMessage(evt('DELETED', 'p2', '6')));
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(r.result.current.items?.[0].jsonData.metadata.uid).toBe('p1');
  });

  it('IGNORES ADDED and non-member MODIFIED/DELETED (bounded state) [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    act(() => {
      lastConns()[0].onMessage(evt('ADDED', 'pNew', '9')); // in-range new pod → ignored
      lastConns()[0].onMessage(evt('MODIFIED', 'pOut', '9')); // unloaded → ignored
      lastConns()[0].onMessage(evt('DELETED', 'pOut', '9')); // unloaded → ignored
    });
    await new Promise(res => setTimeout(res, 30));
    expect(r.result.current.items?.length).toBe(1);
    expect(r.result.current.items?.[0].jsonData.metadata.uid).toBe('p1');
  });

  it('stays O(loaded) under an adversarial out-of-page event burst [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    act(() => {
      for (let i = 0; i < 2000; i++) {
        lastConns()[0].onMessage(evt('ADDED', 'add-' + i, String(100 + i)));
        lastConns()[0].onMessage(evt('MODIFIED', 'mod-' + i, String(100 + i)));
      }
    });
    await new Promise(res => setTimeout(res, 30));
    expect(r.result.current.items?.length).toBe(1); // never grew toward N
  });

  it('delete+recreate with same name but NEW uid does not mis-update or duplicate [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    // Recreated pod: same name 'p1' but a different UID.
    act(() =>
      lastConns()[0].onMessage({
        type: 'MODIFIED',
        object: {
          kind: 'Pod',
          metadata: { uid: 'p1-NEW', name: 'p1', namespace: 'default', resourceVersion: '7' },
        },
      })
    );
    await new Promise(res => setTimeout(res, 30));
    expect(r.result.current.items?.length).toBe(1); // no duplicate
    // The original object (uid p1) was NOT updated by the recreate's event.
    expect(r.result.current.items?.[0].jsonData.metadata.uid).toBe('p1');
    expect(r.result.current.items?.[0].jsonData.metadata.resourceVersion).toBe('1');
  });

  it('a loaded MODIFIED does NOT rebuild the socket (#15 preserved in live-subset) [#14 A1]', async () => {
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p1', '5')));
    await new Promise(res => setTimeout(res, 30));
    const rebuiltToEventRV = mockUseWebSockets.mock.calls.some(([c]) =>
      (c.connections?.[0]?.url ?? '').includes('resourceVersion=5')
    );
    expect(rebuiltToEventRV).toBe(false);
    expect(lastConns()[0].url).toContain('resourceVersion=1'); // identity unchanged
  });

  it('SAFETY: multiplexer enabled disables live-subset (no unfiltered watch while paginating) [#14 A1]', async () => {
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'true');
    const qc = new QueryClient();
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')])); // continue ⇒ hasMore
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(r.result.current.hasMore).toBe(true);
    // With the multiplexer on, live-subset is force-disabled ⇒ shouldWatch is false while
    // paginating ⇒ NO watch is opened on the (unfiltered) multiplexed path.
    expect(mockSubscribe).not.toHaveBeenCalled();
    vi.stubEnv('REACT_APP_ENABLE_WEBSOCKET_MULTIPLEXER', 'false');
  });

  it('Load More re-baselines the prefix at a FRESH RV and closes the event gap [#14 A1]', async () => {
    const qc = new QueryClient();
    // Page 1 @ RV1 (p1), more available (continue). Watch opens @ RV1.
    mockClusterFetch.mockResolvedValueOnce(firstPage([makePod('p1', '1')]));
    const r = renderLive(qc);
    await waitFor(() => expect(r.result.current.items?.length).toBe(1));
    expect(lastConns()[0].url).toContain('resourceVersion=1');

    // An event for p2 arrives BEFORE p2 is loaded → ignored (not a member yet).
    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p2', '5')));
    await new Promise(res => setTimeout(res, 20));
    expect(r.result.current.items?.length).toBe(1);

    // Load More re-baselines: fresh LIST @ RV12 returns p1 + p2 at their CURRENT state
    // (p2 @ RV '12', i.e. AFTER the event that the watch had dropped). No continue ⇒ done.
    mockClusterFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve(
          makeListResponse({
            items: [makePod('p1', '10'), makePod('p2', '12')],
            resourceVersion: '12',
          })
        ),
    } as Response);
    await act(async () => {
      await r.result.current.loadMore?.();
    });
    await waitFor(() => expect(r.result.current.items?.length).toBe(2));
    // p2 reflects its CURRENT (post-event) state — the gap is closed by the re-baseline.
    expect(
      r.result.current.items?.find((i: any) => i.jsonData.metadata.uid === 'p2')?.jsonData.metadata
        .resourceVersion
    ).toBe('12');
    // The watch restarted exactly once, now pinned to the fresh RV 12.
    await waitFor(() => expect(lastConns()[0]?.url).toContain('resourceVersion=12'));
    // After re-baseline p2 is loaded ⇒ its events now apply live.
    act(() => lastConns()[0].onMessage(evt('MODIFIED', 'p2', '20')));
    await waitFor(() =>
      expect(
        r.result.current.items?.find((i: any) => i.jsonData.metadata.uid === 'p2')?.jsonData
          .metadata.resourceVersion
      ).toBe('20')
    );
  });
});
