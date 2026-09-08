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

// UI-level test for the p17 Status column body + p18 evidence popover.
// Mounts <LocalHealthCell /> in isolation, with useLocalHealthItems mocked
// to return fabricated KubeObject arrays from __fixtures__/healthScenarios.
// See p18.txt on branch GT_D_V1.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./useLocalHealthItems', () => ({
  useLocalHealthItems: vi.fn(),
}));

// The Applications tab's data hook is mocked so its shared code path
// (which drags in Deployment / ReplicaSet / etc. classes and their
// cross-file circular imports) never executes in this UI test.
vi.mock('./useProjectResources', () => ({
  useProjectItems: () => ({ items: [], isLoading: false, errors: [] }),
}));

import App from '../../App';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { ApiResource } from '../../lib/k8s/api/v2/ApiResource';
import { createMuiTheme } from '../../lib/themes';
import { TestContext } from '../../test';
import * as F from './__fixtures__/healthScenarios';
import { LocalHealthCell } from './ProjectList';
import { useLocalHealthItems } from './useLocalHealthItems';

// Same resource shape useKubeLists.ts actually returns per failed kind.
const PODS_RESOURCE: ApiResource = {
  apiVersion: 'v1',
  version: 'v1',
  pluralName: 'pods',
  singularName: 'pod',
  kind: 'Pod',
  isNamespaced: true,
};

// cyclic imports fix — same trick ProjectList.test.tsx uses.
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

const fakeProject: any = {
  id: 'demo',
  namespaces: ['demo'],
  clusters: ['test-cluster'],
};

function mountWith(items: any[]) {
  (useLocalHealthItems as any).mockReturnValue({
    items,
    isLoading: false,
    errors: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createMuiTheme('light')}>
        <TestContext>
          <LocalHealthCell project={fakeProject} />
        </TestContext>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// Mounts with the real { resource, errors: ApiError[] }[] shape useKubeLists.ts
// produces, so the unavailable popover is exercised through its actual data path.
function mountWithFetchErrors(apiErrors: ApiError[], onRank?: (id: string, rank: number) => void) {
  (useLocalHealthItems as any).mockReturnValue({
    items: [],
    isLoading: false,
    errors: [{ resource: PODS_RESOURCE, errors: apiErrors }],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createMuiTheme({ name: 'light', base: 'light' })}>
        <TestContext>
          <LocalHealthCell project={fakeProject} onRank={onRank} />
        </TestContext>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('LocalHealthCell — p18 evidence popover', () => {
  it('renders "Healthy" for all-healthy items', () => {
    mountWith(F.allHealthySingleCluster.items);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders "No Resources" when items is empty', () => {
    mountWith([]);
    expect(screen.getByText('No Resources')).toBeInTheDocument();
  });

  it('renders "Degraded" when only warnings are present', () => {
    mountWith(F.deployment2Of3Ready.items);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders "Unhealthy" for a CrashLoopBackOff pod', () => {
    mountWith(F.podCrashLoopBackOff.items);
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('shows tooltip prompt "Click to see why" on hover', async () => {
    const u = userEvent.setup();
    mountWith(F.podCrashLoopBackOff.items);
    const trigger = screen.getByRole('button', { name: /Unhealthy/i });
    await u.hover(trigger);
    await waitFor(() => expect(screen.getByText('Click to see why')).toBeInTheDocument());
  });

  it('opens popover on click and lists CrashLoopBackOff evidence', async () => {
    const u = userEvent.setup();
    mountWith(F.podCrashLoopBackOff.items);
    const trigger = screen.getByRole('button', { name: /Unhealthy/i });
    await u.click(trigger);
    expect(await screen.findByText(/CrashLoopBackOff/)).toBeInTheDocument();
    expect(screen.getByText(/Pod\/demo\/crasher/)).toBeInTheDocument();
  });

  it('groups errors above warnings in the popover', async () => {
    const u = userEvent.setup();
    mountWith([...F.deployment2Of3Ready.items, ...F.podFailed.items]);
    await u.click(screen.getByRole('button', { name: /Unhealthy/i }));
    const errorsHeading = await screen.findByText('Errors');
    const warningsHeading = await screen.findByText('Warnings');
    expect(errorsHeading.compareDocumentPosition(warningsHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('popover on a Healthy row shows the resource inventory / stats', async () => {
    const u = userEvent.setup();
    mountWith(F.allHealthySingleCluster.items);
    await u.click(screen.getByRole('button', { name: /Healthy/i }));
    // Inventory heading is present
    expect(await screen.findByText(/Inventory/i)).toBeInTheDocument();
    // Real stats appear — the fixture has one Deployment 3/3 ready.
    expect(screen.getByText(/1 Deployment/i)).toBeInTheDocument();
    expect(screen.getByText(/3\/3 ready/)).toBeInTheDocument();
  });

  describe('unavailable popover — truthful wording regression', () => {
    it('HTTP 401: shows neutral summary + code + reported error, no cluster row, no old wording', async () => {
      const u = userEvent.setup();
      mountWithFetchErrors([new ApiError('Authentication required', { status: 401 })]);
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('401')).toBeInTheDocument();
      expect(screen.getByText('Authentication required')).toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
      expect(screen.queryByText(/could not be reached/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Retry when connectivity is restored/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Reachable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Not reachable/i)).not.toBeInTheDocument();
    });

    it('HTTP 403: shows neutral summary + code + reported error, no cluster row / old caption', async () => {
      const u = userEvent.setup();
      mountWithFetchErrors([new ApiError('Access denied', { status: 403 })]);
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('403')).toBeInTheDocument();
      expect(screen.getByText('Access denied')).toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
      expect(screen.queryByText(/could not be reached/i)).not.toBeInTheDocument();
    });

    it('HTTP 5xx: shows neutral summary + raw code + reported error, no reachability conclusion', async () => {
      const u = userEvent.setup();
      mountWithFetchErrors([new ApiError('Bad Gateway', { status: 502 })]);
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('502')).toBeInTheDocument();
      expect(screen.getByText('Bad Gateway')).toBeInTheDocument();
      expect(screen.queryByText(/Reachable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Not reachable/i)).not.toBeInTheDocument();
    });

    it('no HTTP code: shows neutral summary + reported error, HTTP code and Cluster rows absent', async () => {
      const u = userEvent.setup();
      mountWithFetchErrors([new ApiError('Failed to fetch')]);
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
      expect(screen.queryByText('HTTP code')).not.toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    });

    it('no HTTP code and no message: shows only the neutral summary, no blank detail rows', async () => {
      const u = userEvent.setup();
      mountWithFetchErrors([new ApiError('')]);
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.queryByText('HTTP code')).not.toBeInTheDocument();
      expect(screen.queryByText('Reported error')).not.toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    });

    it('regression: badge stays "Unavailable", rank is reported, popover opens and closes', async () => {
      const u = userEvent.setup();
      const onRank = vi.fn();
      mountWithFetchErrors([new ApiError('Bad Gateway', { status: 502 })], onRank);

      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      await waitFor(() => expect(onRank).toHaveBeenCalledWith('demo', 5));

      const trigger = screen.getByRole('button', { name: /Unavailable/i });
      await u.click(trigger);
      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();

      await u.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() =>
        expect(
          screen.queryByText('Application health could not be determined.')
        ).not.toBeInTheDocument()
      );
    });
  });
});
