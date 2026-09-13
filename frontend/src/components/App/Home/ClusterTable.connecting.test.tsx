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
// exercises the memoized body cells. It guards the regression where the name
// cell stayed locked on "Connecting…" after the status resolved, because the
// table only re-renders a cell when its accessor value changes and the name
// accessor didn't encode the connecting state.

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

describe('ClusterTable connecting gate', () => {
  it('disables the cluster name link while the status is still loading', async () => {
    renderTable({}); // errors undefined => Connecting…
    const name = await screen.findByText('my-cluster');
    // Not a link while connecting.
    expect(name.closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: /my-cluster/ })).toBeNull();
  });

  it('re-enables the link once the status resolves to Active (regression)', async () => {
    const { rerender } = renderTable({});
    await screen.findByText('my-cluster');
    expect(screen.queryByRole('link', { name: /my-cluster/ })).toBeNull();

    // Status resolves: error becomes null (Active). The memoized name cell must
    // re-render and turn back into a link.
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
