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

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useProjectResources', () => ({
  useProjectItems: () => ({ items: [], isLoading: false }),
}));

import App from '../../App';
import Namespace from '../../lib/k8s/namespace';
import { createMuiTheme } from '../../lib/themes';
import { HeadlampEventType } from '../../redux/headlampEventSlice';
import { recordHeadlampEvents, TestContext } from '../../test';
import ProjectList, {
  discoverProjectsFromNamespaces,
  filterProjectsByNamespaces,
  projectDetailsParams,
  useProject,
} from './ProjectList';
import { PROJECT_ID_LABEL } from './projectUtils';

// cyclic imports fix
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

function ns(name: string, opts: { project?: string; cluster?: string } = {}) {
  return {
    metadata: {
      name,
      labels: opts.project ? { [PROJECT_ID_LABEL]: opts.project } : undefined,
    },
    cluster: opts.cluster ?? 'cluster-a',
  };
}

describe('discoverProjectsFromNamespaces', () => {
  it('maps every namespace to an application named after the namespace', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('app-prod'),
      ns('app-staging'),
      ns('billing'),
    ]);

    expect(projects).toEqual([
      { id: 'cluster-a/app-prod', namespaces: ['app-prod'], clusters: ['cluster-a'] },
      { id: 'cluster-a/app-staging', namespaces: ['app-staging'], clusters: ['cluster-a'] },
      { id: 'cluster-a/billing', namespaces: ['billing'], clusters: ['cluster-a'] },
    ]);
  });

  it('emits one row per cluster for a same-named namespace (no collapsing)', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('shared', { cluster: 'cluster-a' }),
      ns('shared', { cluster: 'cluster-b' }),
    ]);

    expect(projects).toHaveLength(2);
    expect(projects).toEqual([
      { id: 'cluster-a/shared', namespaces: ['shared'], clusters: ['cluster-a'] },
      { id: 'cluster-b/shared', namespaces: ['shared'], clusters: ['cluster-b'] },
    ]);
    // ids must stay unique so the details route cannot collide
    expect(new Set(projects.map(p => p.id)).size).toBe(2);
  });

  it('gives every row exactly one cluster and one namespace', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('one', { cluster: 'cluster-a' }),
      ns('one', { cluster: 'cluster-b' }),
      ns('two', { cluster: 'cluster-a' }),
    ]);

    expect(projects).toHaveLength(3);
    for (const project of projects) {
      expect(project.clusters).toHaveLength(1);
      expect(project.namespaces).toHaveLength(1);
    }
  });

  it('excludes system / infrastructure namespaces', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('openshift-config'),
      ns('kube-system'),
      ns('open-cluster-management-agent'),
      ns('default'),
      ns('my-app'),
    ]);

    expect(projects).toEqual([
      { id: 'cluster-a/my-app', namespaces: ['my-app'], clusters: ['cluster-a'] },
    ]);
  });

  // Regression guard for #5254: a namespace without metadata.name reached the
  // groupBy iteratee through a stale react-query cache and crashed the page.
  it('skips namespaces with no name instead of crashing', () => {
    expect(() =>
      discoverProjectsFromNamespaces([ns('real'), { metadata: {} as any, cluster: 'cluster-a' }])
    ).not.toThrow();

    const projects = discoverProjectsFromNamespaces([
      ns('real'),
      { metadata: {} as any, cluster: 'cluster-a' },
    ]);
    expect(projects).toEqual([
      { id: 'cluster-a/real', namespaces: ['real'], clusters: ['cluster-a'] },
    ]);
  });
});

describe('projectDetailsParams — collision-safe details routing', () => {
  it('routes each same-named instance to its own cluster', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('shared', { cluster: 'cluster-a' }),
      ns('shared', { cluster: 'cluster-b' }),
    ]);

    expect(projectDetailsParams(projects[0])).toEqual({ cluster: 'cluster-a', name: 'shared' });
    expect(projectDetailsParams(projects[1])).toEqual({ cluster: 'cluster-b', name: 'shared' });
  });

  it('round-trips params back to exactly one instance, including dotted cluster names', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('shared', { cluster: 'cluster.one' }),
      ns('shared', { cluster: 'cluster-b' }),
    ]);

    for (const project of projects) {
      const params = projectDetailsParams(project);
      const resolved = projects.filter(
        p => p.clusters[0] === params.cluster && p.namespaces[0] === params.name
      );
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe(project.id);
    }
  });
});

describe('filterProjectsByNamespaces', () => {
  const projects = [
    { id: 'a', namespaces: ['a'], clusters: ['c1'] },
    { id: 'b', namespaces: ['b'], clusters: ['c1'] },
    { id: 'c', namespaces: ['c'], clusters: ['c1'] },
  ];

  it('returns all projects when nothing is selected (default view)', () => {
    expect(filterProjectsByNamespaces(projects, [])).toEqual(projects);
  });

  it('returns only the project matching a single selected namespace', () => {
    expect(filterProjectsByNamespaces(projects, ['b'])).toEqual([projects[1]]);
  });

  it('returns projects matching any of several selected namespaces', () => {
    expect(filterProjectsByNamespaces(projects, ['a', 'c'])).toEqual([projects[0], projects[2]]);
  });

  it('returns an empty list when no project matches', () => {
    expect(filterProjectsByNamespaces(projects, ['does-not-exist'])).toEqual([]);
  });
});

describe('useProject', () => {
  it('returns a loaded empty project when no matching namespaces exist', () => {
    vi.spyOn(Namespace, 'useList').mockReturnValue({
      items: [],
      isLoading: false,
    } as any);

    const { result } = renderHook(() => useProject('cluster-a', 'missing-project'), {
      wrapper: ({ children }) => <TestContext>{children}</TestContext>,
    });

    expect(result.current).toEqual({
      isLoading: false,
      project: { id: 'cluster-a/missing-project', clusters: [], namespaces: [] },
    });
  });
});

describe('ProjectList events', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches PROJECT_LIST_VIEW with the listed projects', async () => {
    vi.spyOn(Namespace, 'useList').mockReturnValue({
      items: [ns('app-prod', { project: 'app' }), ns('billing', { project: 'billing' })],
      isLoading: false,
    } as any);
    const events = recordHeadlampEvents();

    render(
      <TestContext>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider theme={createMuiTheme({ name: 'Light', base: 'light' })}>
            <ProjectList />
          </ThemeProvider>
        </QueryClientProvider>
      </TestContext>
    );

    await waitFor(() => {
      expect(events.filter(e => e.type === HeadlampEventType.PROJECT_LIST_VIEW)).toEqual([
        {
          type: HeadlampEventType.PROJECT_LIST_VIEW,
          data: {
            projects: [
              { id: 'cluster-a/app-prod', namespaces: ['app-prod'], clusters: ['cluster-a'] },
              { id: 'cluster-a/billing', namespaces: ['billing'], clusters: ['cluster-a'] },
            ],
          },
        },
      ]);
    });
  });
});

describe('ProjectList namespace dropdown', () => {
  beforeEach(() => {
    // A previous test's vi.restoreAllMocks() clears the matchMedia mock that
    // setupTests installs; MRT's toolbar needs it, so re-install it here.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows all applications by default and filters the table by the selected namespace', async () => {
    vi.spyOn(Namespace, 'useList').mockReturnValue({
      items: [ns('app-prod'), ns('billing'), ns('web')],
      isLoading: false,
    } as any);

    render(
      <TestContext>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider theme={createMuiTheme({ name: 'Light', base: 'light' })}>
            <ProjectList />
          </ThemeProvider>
        </QueryClientProvider>
      </TestContext>
    );

    // Default: nothing selected -> every application row is visible.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'app-prod' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'billing' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'web' })).toBeInTheDocument();

    // Open the namespace dropdown and pick 'app-prod'.
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByRole('option', { name: 'app-prod' }));
    fireEvent.keyDown(input, { key: 'Escape' });

    // The table now shows only the selected namespace's row.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'billing' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'web' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'app-prod' })).toBeInTheDocument();
  });
});
