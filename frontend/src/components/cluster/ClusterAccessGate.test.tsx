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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { createMuiTheme } from '../../lib/themes';
import ClusterAccessGate, { ClusterAccessGateState } from './ClusterAccessGate';

const theme = createMuiTheme({ name: 'light', base: 'light' });

vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        let s = key.split('|').pop() ?? key;
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
        }
        return s;
      },
    }),
  };
});

function renderGate(
  state: ClusterAccessGateState,
  handlers: Partial<{
    onBack: () => void;
    onRetry: () => void;
    onSignIn: () => void;
    error: ApiError | null;
  }> = {}
) {
  const onBack = handlers.onBack ?? vi.fn();
  return {
    onBack,
    ...render(
      <ThemeProvider theme={theme}>
        <ClusterAccessGate
          clusterName="cluster-a"
          state={state}
          error={handlers.error}
          onBack={onBack}
          onRetry={handlers.onRetry}
          onSignIn={handlers.onSignIn}
        />
      </ThemeProvider>
    ),
  };
}

describe('ClusterAccessGate', () => {
  it('always shows the cluster name and a Back to All Clusters action', () => {
    const onBack = vi.fn();
    renderGate('checking', { onBack });
    expect(screen.getByText('cluster-a')).toBeInTheDocument();
    const back = screen.getByRole('button', { name: /Back to All Clusters/ });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('checking state shows the checking title and no Sign in / Retry', () => {
    renderGate('checking');
    expect(screen.getByText('Checking your access…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in again/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('expired state offers Sign in again and interpolates the cluster name', () => {
    const onSignIn = vi.fn();
    renderGate('expired', { onSignIn, error: new ApiError('Unauthorized', { status: 401 }) });
    expect(screen.getByText('Your session for this cluster expired')).toBeInTheDocument();
    expect(
      screen.getByText(/We reached "cluster-a", but your sign-in is no longer valid/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sign in again/ }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('forbidden state shows only Back (no Sign in / Retry)', () => {
    renderGate('forbidden', { error: new ApiError('Forbidden', { status: 403 }) });
    expect(screen.getByText('You do not have access to this cluster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in again/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('unreachable state offers Retry', () => {
    const onRetry = vi.fn();
    renderGate('unreachable', { onRetry, error: new ApiError('Bad Gateway', { status: 502 }) });
    expect(screen.getByText('This cluster is not responding')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry now/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('reveals technical details with the real HTTP code on demand', () => {
    renderGate('expired', { error: new ApiError('Unauthorized', { status: 401 }) });
    // Hidden until toggled.
    expect(screen.queryByText(/HTTP code: 401/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Technical details/ }));
    expect(screen.getByText(/HTTP code: 401/)).toBeInTheDocument();
  });
});
