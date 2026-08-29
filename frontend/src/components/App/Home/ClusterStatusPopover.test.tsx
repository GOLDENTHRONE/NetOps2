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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import { Cluster } from '../../../lib/k8s/cluster';
import { createMuiTheme } from '../../../lib/themes';
import ClusterStatusPopover from './ClusterStatusPopover';

vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key.split('|').pop() ?? key }),
  };
});

const theme = createMuiTheme({ name: 'light', base: 'light' });
const cluster: Cluster = {
  name: 'test-cluster',
  auth_type: '',
  server: 'https://api.example.com:6443',
};

function renderPopover(ui: ReactNode) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function openPopover(error: ApiError | null | undefined, statusText: string) {
  renderPopover(
    <ClusterStatusPopover
      cluster={cluster}
      error={error}
      statusKind={error ? 'error' : 'active'}
      statusText={statusText}
    >
      <span>{statusText}</span>
    </ClusterStatusPopover>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Click to see why' }));
}

describe('ClusterStatusPopover', () => {
  it('shows the HTTP code and message for an authentication error', () => {
    openPopover(new ApiError('Unauthorized', { status: 401 }), 'Authentication required');

    expect(screen.getByText('Reachable (HTTP 401)')).toBeInTheDocument();
    expect(screen.getByText('401')).toBeInTheDocument();
    expect(screen.getByText('Unauthorized')).toBeInTheDocument();
  });

  it('shows the HTTP code and message for a permission error', () => {
    openPopover(new ApiError('Forbidden', { status: 403 }), 'Insufficient permissions');

    expect(screen.getByText('Reachable (HTTP 403)')).toBeInTheDocument();
    expect(screen.getByText('403')).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
  });

  it('reports the API server as not reachable when the request failed', () => {
    openPopover(new ApiError('Bad Gateway', { status: 502 }), 'Unavailable');

    expect(screen.getByText('Not reachable (HTTP 502)')).toBeInTheDocument();
    expect(screen.getByText('Bad Gateway')).toBeInTheDocument();
  });

  it('closes when the close button is clicked', async () => {
    openPopover(new ApiError('Bad Gateway', { status: 502 }), 'Unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByText('Not reachable (HTTP 502)')).not.toBeInTheDocument()
    );
  });

  it('shows the API server as reachable when the version request succeeded', () => {
    openPopover(null, 'Active');

    expect(screen.getByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText('https://api.example.com:6443')).toBeInTheDocument();
    // A successful request carries no status code, so the row is left out.
    expect(screen.queryByText('HTTP code')).not.toBeInTheDocument();
  });
});
