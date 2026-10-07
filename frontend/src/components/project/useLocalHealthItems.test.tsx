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

// UI-level test for the Applications List Status column body + evidence popover,
// on the FROZEN page-level design: <LocalHealthCell /> receives a pre-computed
// `health` badge + `liveItems` (it does NO fetching), and the popover body fetches
// on-demand data via useApplicationPopoverData (mocked here).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// On-demand popover data path is mocked so the UI test never drags in the live
// resource classes / network. Each test can override the return value.
vi.mock('./useApplicationPopoverData', () => ({
  useApplicationPopoverData: vi.fn(() => ({
    items: [],
    truncatedKinds: [],
    isLoading: false,
    hasErrors: false,
  })),
}));

import App from '../../App';
import { createMuiTheme } from '../../lib/themes';
import { TestContext } from '../../test';
import * as F from './__fixtures__/healthScenarios';
import { getApplicationBadge, getUnavailableHealth, LiveObservation } from './localHealth';
import { LocalHealthCell } from './ProjectList';
import { useApplicationPopoverData } from './useApplicationPopoverData';

// cyclic imports fix — same trick ProjectList.test.tsx uses.
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

const fakeProject: any = {
  id: 'demo',
  namespaces: ['demo'],
  clusters: ['test-cluster'],
};

const OK_OBS: LiveObservation = {
  loading: false,
  allLiveFailed: false,
  someLiveFailed: false,
  failed: [],
  truncatedKinds: [],
  cluster: 'test-cluster',
};

beforeEach(() => {
  (useApplicationPopoverData as any).mockReturnValue({
    items: [],
    truncatedKinds: [],
    isLoading: false,
    hasErrors: false,
  });
});

// Mount with the given items as the live set; badge computed via the real
// getApplicationBadge. The popover merges liveItems ⊕ on-demand, so on-demand
// defaults to [] here (disjoint) to avoid double-counting the same objects.
function mountWith(items: any[], onDemand: any[] = []) {
  const health = getApplicationBadge(items, OK_OBS);
  (useApplicationPopoverData as any).mockReturnValue({
    items: onDemand,
    truncatedKinds: [],
    isLoading: false,
    hasErrors: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createMuiTheme({ name: 'light', base: 'light' })}>
        <TestContext>
          <LocalHealthCell project={fakeProject} health={health} liveItems={items} />
        </TestContext>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// Mount an Unavailable badge (page-level decided it; the cell just renders it).
function mountUnavailable(httpCode?: number, errorMessage?: string) {
  const health = getUnavailableHealth({ cluster: 'test-cluster', httpCode, errorMessage });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createMuiTheme({ name: 'light', base: 'light' })}>
        <TestContext>
          <LocalHealthCell project={fakeProject} health={health as any} liveItems={[]} />
        </TestContext>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('LocalHealthCell — frozen page-level badge + popover', () => {
  it('renders "Healthy" for an all-healthy app (has a controller)', () => {
    mountWith(F.allHealthySingleCluster.items);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders "Unknown" (not "No Resources") when the live set is empty', () => {
    // Frozen design: controller-less / empty live observation is never "No Resources".
    mountWith([]);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('No Resources')).not.toBeInTheDocument();
  });

  it('renders "Degraded" when only warnings are present', () => {
    mountWith(F.deployment2Of3Ready.items);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders "Unhealthy" for a CrashLoopBackOff pod', () => {
    mountWith(F.podCrashLoopBackOff.items);
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('shows tooltip prompt "Click to see" on hover', async () => {
    const u = userEvent.setup();
    mountWith(F.podCrashLoopBackOff.items);
    const trigger = screen.getByRole('button', { name: /Unhealthy/i });
    await u.hover(trigger);
    await waitFor(() => expect(screen.getByText('Click to see')).toBeInTheDocument());
  });

  it('opens popover on click and lists CrashLoopBackOff evidence (from on-demand pods)', async () => {
    const u = userEvent.setup();
    mountWith(F.podCrashLoopBackOff.items);
    const trigger = screen.getByRole('button', { name: /Unhealthy/i });
    await u.click(trigger);
    expect(await screen.findByText(/CrashLoopBackOff/)).toBeInTheDocument();
    expect(screen.getByText(/Pod\/demo\/crasher/)).toBeInTheDocument();
  });

  it('groups health issues in the Details section', async () => {
    const u = userEvent.setup();
    mountWith([...F.deployment2Of3Ready.items, ...F.podFailed.items]);
    await u.click(screen.getByRole('button', { name: /Unhealthy/i }));
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(screen.queryByText('Errors')).not.toBeInTheDocument();
    expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
  });

  it('popover on a Healthy row collapses Inventory by default and expands on click', async () => {
    const u = userEvent.setup();
    mountWith(F.allHealthySingleCluster.items);
    await u.click(screen.getByRole('button', { name: /Healthy/i }));
    const inventoryToggle = await screen.findByRole('button', { name: /Inventory/i });
    expect(inventoryToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/3\/3 ready/)).not.toBeInTheDocument();

    await u.click(inventoryToggle);
    expect(inventoryToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/1 Deployment/i)).toBeInTheDocument();
    expect(screen.getByText(/3\/3 ready/)).toBeInTheDocument();
  });

  describe('unavailable popover — truthful wording', () => {
    it('HTTP 401: neutral summary + code + reported error, no cluster row, no old wording', async () => {
      const u = userEvent.setup();
      mountUnavailable(401, 'Authentication required');
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
    });

    it('HTTP 403: neutral summary + code + reported error, no cluster row / old caption', async () => {
      const u = userEvent.setup();
      mountUnavailable(403, 'Access denied');
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('403')).toBeInTheDocument();
      expect(screen.getByText('Access denied')).toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    });

    it('HTTP 5xx: neutral summary + raw code + reported error, no reachability conclusion', async () => {
      const u = userEvent.setup();
      mountUnavailable(502, 'Bad Gateway');
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('502')).toBeInTheDocument();
      expect(screen.getByText('Bad Gateway')).toBeInTheDocument();
      expect(screen.queryByText(/Reachable/i)).not.toBeInTheDocument();
    });

    it('no HTTP code: neutral summary + reported error, HTTP code and Cluster rows absent', async () => {
      const u = userEvent.setup();
      mountUnavailable(undefined, 'Failed to fetch');
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
      expect(screen.queryByText('HTTP code')).not.toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    });

    it('no HTTP code and no message: only the neutral summary, no blank detail rows', async () => {
      const u = userEvent.setup();
      mountUnavailable(undefined, undefined);
      await u.click(screen.getByRole('button', { name: /Unavailable/i }));

      expect(
        await screen.findByText('Application health could not be determined.')
      ).toBeInTheDocument();
      expect(screen.queryByText('HTTP code')).not.toBeInTheDocument();
      expect(screen.queryByText('Reported error')).not.toBeInTheDocument();
      expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    });

    it('badge stays "Unavailable"; popover opens and closes', async () => {
      const u = userEvent.setup();
      mountUnavailable(502, 'Bad Gateway');

      expect(screen.getByText('Unavailable')).toBeInTheDocument();

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
