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

/*
 * Real-component tests for the P0 keep-last-good gate (AuthRoute), exercising the
 * actual @tanstack/react-query lifecycle — not a model. This is the proof that
 * the "return-to-tab 4-min gate" bug is fixed: after a prior success, a transient
 * blip keeps the page (with a reconnecting hint) instead of showing the gate,
 * while a genuine 401/403 still shows the gate immediately.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../test';

const testAuth = vi.fn();

vi.mock('../../lib/k8s/api/v1/clusterApi', () => ({
  testAuth: (...args: any[]) => testAuth(...args),
}));
vi.mock('../../lib/k8s', () => ({
  useCluster: () => 'cluster',
  useClustersConf: () => ({ cluster: { name: 'cluster' } }), // non-OIDC
}));
vi.mock('../../lib/cluster', async orig => {
  const actual = await orig<typeof import('../../lib/cluster')>();
  return { ...actual, getCluster: () => 'cluster', getSelectedClusters: () => ['cluster'] };
});
vi.mock('../../lib/k8s/event', () => ({ default: class Event {} }));
vi.mock('../common/ObjectEventList', () => ({ default: () => null }));

import { AuthRoute } from './RouteSwitcher';

const CHILD = 'CHILD_CONTENT_MARKER';
const AUTH_KEY = ['auth', 'cluster'];
const err = (status: number) => Object.assign(new Error(`http ${status}`), { status });

function renderGate(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TestContext>
        <AuthRoute
          path="/"
          sidebar={null as any}
          requiresAuth
          requiresCluster
          requiresToken={() => true}
        >
          <div>{CHILD}</div>
        </AuthRoute>
      </TestContext>
    </QueryClientProvider>
  );
}

afterEach(() => {
  testAuth.mockReset();
});

describe('AuthRoute — P0 keep-last-good gate', () => {
  it('shows the page when the auth check succeeds', async () => {
    testAuth.mockResolvedValue({});
    renderGate(new QueryClient());
    expect(await screen.findByText(CHILD)).toBeInTheDocument();
  });

  it('CRUX: a transient blip after a prior success keeps the page + shows Reconnecting (no gate)', async () => {
    const qc = new QueryClient();
    testAuth.mockResolvedValueOnce({}).mockRejectedValue(err(502));
    renderGate(qc);
    // prior success -> page is up
    expect(await screen.findByText(CHILD)).toBeInTheDocument();

    // force a background re-check that blips
    await act(async () => {
      await qc.refetchQueries({ queryKey: AUTH_KEY });
    });

    // page stays, a Reconnecting hint appears, and NO "unreachable" gate replaces it
    await waitFor(() => expect(screen.getByText('Reconnecting…')).toBeInTheDocument(), {
      timeout: 8000,
    });
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  }, 15000);

  it('a genuine 401 after a prior success shows the gate IMMEDIATELY (keep-last-good bypassed, not retried)', async () => {
    const qc = new QueryClient();
    testAuth.mockResolvedValueOnce({}).mockRejectedValue(err(401));
    renderGate(qc);
    expect(await screen.findByText(CHILD)).toBeInTheDocument();

    await act(async () => {
      await qc.refetchQueries({ queryKey: AUTH_KEY });
    });

    // children are replaced by the gate; no keep-last-good hint for a real 401
    await waitFor(() => expect(screen.queryByText(CHILD)).not.toBeInTheDocument(), {
      timeout: 8000,
    });
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
    expect(testAuth).toHaveBeenCalledTimes(2); // mount + the one 401 refetch, NOT retried
  }, 15000);

  it('a blip with NO prior success does not keep-last-good (no Reconnecting, page not shown)', async () => {
    const qc = new QueryClient();
    testAuth.mockRejectedValue(err(502));
    renderGate(qc);
    await waitFor(() => expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument(), {
      timeout: 8000,
    });
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  }, 15000);
});
