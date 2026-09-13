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
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import { Cluster } from '../../../lib/k8s/cluster';
import { createMuiTheme } from '../../../lib/themes';
import { TestContext } from '../../../test';
import ClusterTable from './ClusterTable';

// This test intentionally renders the REAL common/Table (no mock) so it
// exercises the memoized body cells. The cluster name is always clickable now:
// opening a cluster whose status hasn't resolved is safe because the route shows
// the centered access gate. These tests guard that the name renders as a link in
// every status state (loading, Active, Unavailable) and is never blocked.

const theme = createMuiTheme({ name: 'light', base: 'light' });

const i18nStub = {
  resolvedLanguage: 'en',
  language: 'en',
  changeLanguage: () => Promise.resolve((k: string) => k),
  exists: () => false,
  on: () => {},
  off: () => {},
};

vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key.split('|').pop() ?? key, i18n: i18nStub }),
  };
});

const cluster: Cluster = { name: 'my-cluster', auth_type: '', meta_data: { source: 'kubeconfig' } };

function Wrapper({ errors }: { errors: { [name: string]: ApiError | null } }) {
  return (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <TestContext>
          <ClusterTable
            customNameClusters={[cluster]}
            clusters={{ 'my-cluster': cluster }}
            versions={{}}
            errors={errors}
            warningLabels={{}}
            connectedClusterNames={new Set(['my-cluster'])}
          />
        </TestContext>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function renderTable(errors: { [name: string]: ApiError | null }) {
  return render(<Wrapper errors={errors} />);
}

describe('ClusterTable name link is always clickable', () => {
  it('renders the cluster name as a link even while the status is still loading', async () => {
    renderTable({}); // errors undefined => Connecting…
    await screen.findByText('my-cluster');
    // Always a link now — opening while connecting is handled by the access gate.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /my-cluster/ })).toBeInTheDocument();
    });
  });

  it('keeps the link once the status resolves to Active', async () => {
    const { rerender } = renderTable({});
    await screen.findByText('my-cluster');
    expect(screen.getByRole('link', { name: /my-cluster/ })).toBeInTheDocument();

    rerender(<Wrapper errors={{ 'my-cluster': null }} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /my-cluster/ })).toBeInTheDocument();
    });
  });

  it('keeps the name clickable when the status resolves to Unavailable', async () => {
    renderTable({ 'my-cluster': new ApiError('unavailable', { status: 500 }) });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /my-cluster/ })).toBeInTheDocument();
    });
  });
});
