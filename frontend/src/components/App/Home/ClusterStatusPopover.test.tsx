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
  fireEvent.click(screen.getByRole('button', { name: 'Click to see' }));
}

function openPopoverWithTiming(statusTiming: {
  lastStatusCheckAt?: number;
  nextStatusCheckAt?: number;
  intervalMs: number;
  isFetching: boolean;
}) {
  renderPopover(
    <ClusterStatusPopover
      cluster={cluster}
      error={null}
      statusTiming={statusTiming}
      statusKind="active"
      statusText="Active"
    >
      <span>Active</span>
    </ClusterStatusPopover>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Click to see' }));
}

describe('ClusterStatusPopover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('shows status timing when the status check has completed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 8_000,
      nextStatusCheckAt: 28_000,
      intervalMs: 20_000,
      isFetching: false,
    });

    expect(screen.getByText('Status checked')).toBeInTheDocument();
    expect(screen.getByText('12s ago')).toBeInTheDocument();
    expect(screen.getByText('Next status check')).toBeInTheDocument();
    expect(screen.getByText('~in 8s')).toBeInTheDocument();
  });

  it('shows just now when the status check completed within the current second', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 19_900,
      nextStatusCheckAt: 30_000,
      intervalMs: 10_000,
      isFetching: false,
    });

    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.queryByText('in 0s')).not.toBeInTheDocument();
    expect(screen.queryByText('-1s')).not.toBeInTheDocument();
  });

  it('shows just now when the completed status timestamp is slightly ahead of now', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 20_250,
      nextStatusCheckAt: 30_250,
      intervalMs: 10_000,
      isFetching: false,
    });

    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.queryByText('in 1s')).not.toBeInTheDocument();
  });

  it('does not overstate a ten-second next-check countdown due to captured-now skew', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 20_250,
      nextStatusCheckAt: 30_250,
      intervalMs: 10_000,
      isFetching: false,
    });

    expect(screen.getByText('~in 10s')).toBeInTheDocument();
    expect(screen.queryByText('~in 11s')).not.toBeInTheDocument();
  });

  it('shows checking and omits next check when status has never been checked', () => {
    openPopoverWithTiming({ intervalMs: 10_000, isFetching: true });

    expect(screen.getByText('Status checked')).toBeInTheDocument();
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(screen.queryByText('Next status check')).not.toBeInTheDocument();
  });

  it('shows due now when the estimated next status check is in the past', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 8_000,
      nextStatusCheckAt: 19_000,
      intervalMs: 10_000,
      isFetching: false,
    });

    expect(screen.getByText('Next status check')).toBeInTheDocument();
    expect(screen.getByText('due now')).toBeInTheDocument();
  });

  it('shows checking now instead of a future countdown while refetching', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 8_000,
      nextStatusCheckAt: 28_000,
      intervalMs: 20_000,
      isFetching: true,
    });

    expect(screen.getByText('Status checked')).toBeInTheDocument();
    expect(screen.getByText('12s ago')).toBeInTheDocument();
    expect(screen.getByText('Status check')).toBeInTheDocument();
    expect(screen.getByText('Checking now…')).toBeInTheDocument();
    expect(screen.queryByText('Next status check')).not.toBeInTheDocument();
    expect(screen.queryByText('~in 8s')).not.toBeInTheDocument();
  });

  it('shows checking now instead of due now while refetching', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20_000);

    openPopoverWithTiming({
      lastStatusCheckAt: 8_000,
      nextStatusCheckAt: 19_000,
      intervalMs: 10_000,
      isFetching: true,
    });

    expect(screen.getByText('Checking now…')).toBeInTheDocument();
    expect(screen.queryByText('Next status check')).not.toBeInTheDocument();
    expect(screen.queryByText('due now')).not.toBeInTheDocument();
  });
});
