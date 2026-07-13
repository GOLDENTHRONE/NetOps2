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
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { createMuiTheme } from '../../lib/themes';
import { ApplicationDefinition } from './applicationUtils';

// cyclic imports fix
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

const theme = createMuiTheme({ name: 'light', base: 'light' });

const applications: ApplicationDefinition[] = [
  {
    id: 'wnv7a0vbgw0001c',
    namespaces: ['wnv7a0vbgw0001c'],
    clusters: ['prod-cluster'],
    version: 'v1.24',
    deploymentType: 'Helm',
    status: 'Active',
  },
  {
    id: 'wnv7a1psdc0001c',
    namespaces: ['wnv7a1psdc0001c'],
    clusters: ['prod-cluster', 'dr-cluster'],
    version: 'n/a',
    deploymentType: 'n/a',
    status: 'n/a',
  },
];

vi.mock('./useApplications', () => ({
  useApplicationDefinitions: () => ({ applications, errors: [], isLoading: false }),
}));

vi.mock('./useApplicationResources', async importOriginal => ({
  ...(await importOriginal<typeof import('./useApplicationResources')>()),
  useAllApplicationResources: () => ({ items: [], errors: [], isLoading: false }),
}));

import { TestContext } from '../../test';
import ApplicationList from './ApplicationList';

describe('ApplicationList', () => {
  it('lists every application as a link to its own details page', () => {
    render(
      <ThemeProvider theme={theme}>
        <TestContext>
          <ApplicationList />
        </TestContext>
      </ThemeProvider>
    );

    const appLink = screen.getByRole('link', { name: 'wnv7a0vbgw0001c' });
    expect(appLink.getAttribute('href')).toBe('/application/wnv7a0vbgw0001c');
    expect(screen.getByRole('link', { name: 'wnv7a1psdc0001c' }).getAttribute('href')).toBe(
      '/application/wnv7a1psdc0001c'
    );
  });

  it('shows a small n/a for unavailable metadata and no Create Project button', () => {
    render(
      <ThemeProvider theme={theme}>
        <TestContext>
          <ApplicationList />
        </TestContext>
      </ThemeProvider>
    );

    // Second application has no uspe.dev metadata: version and deployment type
    // both fall back to the n/a placeholder.
    expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(2);

    // The Projects tab had a "Create Project" button; on Applications it is
    // commented out on purpose.
    expect(screen.queryByRole('button', { name: /create project/i })).toBeNull();
  });

  it('links clusters to the cluster view', () => {
    render(
      <ThemeProvider theme={theme}>
        <TestContext>
          <ApplicationList />
        </TestContext>
      </ThemeProvider>
    );

    const clusterLinks = screen.getAllByRole('link', { name: 'prod-cluster' });
    expect(clusterLinks.length).toBeGreaterThanOrEqual(1);
    expect(clusterLinks[0].getAttribute('href')).toContain('prod-cluster');
  });
});
