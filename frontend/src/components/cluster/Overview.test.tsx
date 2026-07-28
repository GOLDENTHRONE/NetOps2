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
import { render, waitFor } from '@testing-library/react';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Overview from './Overview';

const {
  chartMocks,
  eventUseList,
  nodeUseList,
  nodeUseMetrics,
  podUseList,
  podMetricsUseList,
  requestMock,
  deploymentUseList,
} = vi.hoisted(() => ({
  chartMocks: {
    CpuCircularChart: () => <div>cpu</div>,
    MemoryCircularChart: () => <div>memory</div>,
    NodesStatusCircleChart: () => <div>nodes</div>,
    PodsStatusCircleChart: () => <div>pods</div>,
    NamespaceCpuChart: () => <div>ns-cpu</div>,
    NamespaceMemoryChart: () => <div>ns-memory</div>,
    WorkloadsStatusChart: () => <div>workloads</div>,
  },
  eventUseList: vi.fn(() => ({ items: [], errors: null })),
  nodeUseList: vi.fn(() => [[]]),
  nodeUseMetrics: vi.fn(() => [[], null]),
  podUseList: vi.fn(() => [[]]),
  podMetricsUseList: vi.fn(() => [[]]),
  requestMock: vi.fn(() =>
    Promise.resolve({
      pods: { ready: 10, total: 12 },
      nodes: { ready: 4, total: 5 },
      deployments: { available: 8, desired: 8 },
      cpu: { used: 0, capacity: 0 },
      memory: { used: 0, capacity: 0 },
      metricsAvailable: true,
      synced: true,
      lastUpdated: new Date().toISOString(),
    })
  ),
  deploymentUseList: vi.fn(() => [[]]),
}));

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../lib/k8s/event', () => ({
  default: {
    maxLimit: 2000,
    useList: eventUseList,
  },
}));

vi.mock('../../lib/k8s/node', () => ({
  default: {
    useList: nodeUseList,
    useMetrics: nodeUseMetrics,
  },
}));

vi.mock('../../lib/k8s/pod', () => ({
  default: {
    useList: podUseList,
  },
}));

vi.mock('../../lib/k8s/api/v1/hooks', () => ({
  useCluster: () => 'test-cluster',
}));

vi.mock('../../lib/k8s/api/v1/clusterRequests', () => ({
  request: requestMock,
  clusterRequest: requestMock,
}));

vi.mock('../../lib/k8s/PodMetrics', () => ({
  PodMetrics: {
    useList: podMetricsUseList,
  },
}));

vi.mock('../../lib/k8s/deployment', () => ({
  default: {
    useList: deploymentUseList,
  },
}));

vi.mock('../../lib/util', () => ({
  useFilterFunc: () => () => true,
}));

vi.mock('../../redux/filterSlice', async importOriginal => ({
  ...(await importOriginal<typeof import('../../redux/filterSlice')>()),
  useNamespaces: () => [],
}));

vi.mock('../../redux/hooks', () => ({
  useTypedSelector: (selector: any) => selector({ overviewCharts: { processors: [] } }),
}));

vi.mock('../common/Resource/ResourceListView', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../common/Resource', () => ({
  PageGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../common/SectionBox', () => ({
  default: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string | React.ReactNode;
  }) => (
    <section>
      <h2>{typeof title === 'string' ? title : 'Overview'}</h2>
      {children}
    </section>
  ),
  SectionBox: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string | React.ReactNode;
  }) => (
    <section>
      <h2>{typeof title === 'string' ? title : 'Overview'}</h2>
      {children}
    </section>
  ),
}));

vi.mock('../common/SectionHeader', () => ({
  default: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

vi.mock('../common/NamespacesAutocomplete', () => ({
  NamespacesAutocomplete: () => <div data-testid="namespace-filter" />,
}));

vi.mock('./Charts', () => chartMocks);
vi.mock('./Charts/index', () => chartMocks);

describe('Overview', () => {
  it('polls overview resources instead of opening watch streams', async () => {
    const CLUSTER_REFETCH_INTERVAL_MS = 30_000;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Overview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/overview-stats', {
        cluster: 'test-cluster',
        autoLogoutOnAuthError: false,
      });
    });

    expect(nodeUseList).toHaveBeenCalledWith({ refetchInterval: CLUSTER_REFETCH_INTERVAL_MS });
    expect(eventUseList).toHaveBeenCalledWith({
      limit: 2000,
      namespace: [],
      refetchInterval: CLUSTER_REFETCH_INTERVAL_MS,
    });
  });
});
