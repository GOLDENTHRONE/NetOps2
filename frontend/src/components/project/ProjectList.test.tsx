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
import { render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useProjectResources', () => ({
  useProjectItems: () => ({ items: [], isLoading: false }),
}));

import App from '../../App';
import Namespace from '../../lib/k8s/namespace';
import { createMuiTheme } from '../../lib/themes';
import { HeadlampEventType } from '../../redux/headlampEventSlice';
import { recordHeadlampEvents, TestContext } from '../../test';
import ProjectList, { discoverProjectsFromNamespaces, useProject } from './ProjectList';
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
      { id: 'app-prod', namespaces: ['app-prod'], clusters: ['cluster-a'] },
      { id: 'app-staging', namespaces: ['app-staging'], clusters: ['cluster-a'] },
      { id: 'billing', namespaces: ['billing'], clusters: ['cluster-a'] },
    ]);
  });

  it('collapses a same-named namespace across clusters into one application', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('shared', { cluster: 'cluster-a' }),
      ns('shared', { cluster: 'cluster-b' }),
    ]);

    expect(projects).toHaveLength(1);
    expect(projects[0].namespaces).toEqual(['shared']);
    expect(projects[0].clusters).toEqual(['cluster-a', 'cluster-b']);
  });

  it('excludes system / infrastructure namespaces', () => {
    const projects = discoverProjectsFromNamespaces([
      ns('openshift-config'),
      ns('kube-system'),
      ns('open-cluster-management-agent'),
      ns('default'),
      ns('my-app'),
    ]);

    expect(projects).toEqual([{ id: 'my-app', namespaces: ['my-app'], clusters: ['cluster-a'] }]);
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
    expect(projects).toEqual([{ id: 'real', namespaces: ['real'], clusters: ['cluster-a'] }]);
  });
});

describe('useProject', () => {
  it('returns a loaded empty project when no matching namespaces exist', () => {
    vi.spyOn(Namespace, 'useList').mockReturnValue({
      items: [],
      isLoading: false,
    } as any);

    const { result } = renderHook(() => useProject('missing-project'), {
      wrapper: ({ children }) => <TestContext>{children}</TestContext>,
    });

    expect(result.current).toEqual({
      isLoading: false,
      project: { id: 'missing-project', clusters: [], namespaces: [] },
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
              { id: 'app-prod', namespaces: ['app-prod'], clusters: ['cluster-a'] },
              { id: 'billing', namespaces: ['billing'], clusters: ['cluster-a'] },
            ],
          },
        },
      ]);
    });
  });
});
