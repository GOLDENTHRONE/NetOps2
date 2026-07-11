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
import React from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMuiTheme } from '../../lib/themes';

const theme = createMuiTheme({ name: 'light', base: 'light' });

// A namespace object with just enough shape for ApplicationDetails to render.
const mockNamespace = {
  metadata: { name: 'wnv7a0vbgw0001c', labels: undefined, creationTimestamp: undefined },
  status: { phase: 'Active' },
  cluster: 'prod-cluster',
};

const emptyList = { items: [], errors: [] as any[] };

vi.mock('../../lib/k8s/namespace', () => ({
  __esModule: true,
  default: { useGet: () => [mockNamespace, null] },
}));
vi.mock('../../lib/k8s/deployment', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));
vi.mock('../../lib/k8s/statefulSet', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));
vi.mock('../../lib/k8s/daemonSet', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));
vi.mock('../../lib/k8s/pod', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));
vi.mock('../../lib/k8s/service', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));
vi.mock('../../lib/k8s/resourceQuota', () => ({
  __esModule: true,
  default: { useList: () => emptyList },
}));

const { mockActivityClose } = vi.hoisted(() => ({ mockActivityClose: vi.fn() }));
vi.mock('../activity/Activity', () => ({
  Activity: { close: mockActivityClose },
  useActivity: () => [{ id: 'application-prod-cluster-wnv7a0vbgw0001c' }],
}));

import { TestContext } from '../../test';
import ApplicationDetails from './ApplicationDetails';

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('ApplicationDetails', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to the namespace details page and closes the panel when the namespace link is clicked', () => {
    render(
      <ThemeProvider theme={theme}>
        <TestContext>
          <ApplicationDetails
            appName="wnv7a0vbgw0001c"
            namespace="wnv7a0vbgw0001c"
            cluster="prod-cluster"
          />
          <LocationDisplay />
        </TestContext>
      </ThemeProvider>
    );

    const initialPath = screen.getByTestId('location').textContent;

    // The namespace value appears as a clickable button, not as inert text.
    const namespaceButton = screen.getByRole('button', { name: 'wnv7a0vbgw0001c' });
    fireEvent.click(namespaceButton);

    const finalPath = screen.getByTestId('location').textContent;

    // A real navigation happened: the router location actually changed to
    // the namespace's own page (unlike opening another drawer, which would
    // leave the URL untouched).
    expect(finalPath).not.toEqual(initialPath);
    expect(finalPath).toContain('/namespaces/wnv7a0vbgw0001c');
    expect(finalPath).toContain('prod-cluster');

    // The temporary Applications side panel is closed once we've navigated
    // away, instead of being silently replaced by another drawer.
    expect(mockActivityClose).toHaveBeenCalledWith('application-prod-cluster-wnv7a0vbgw0001c');
  });
});
