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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMuiTheme } from '../../../lib/themes';
import { TestContext } from '../../../test';
import Table, { TableColumn } from './Table';

const theme = createMuiTheme({ base: 'light', name: 'light' });

const data = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];

const columns: TableColumn<(typeof data)[number]>[] = [
  {
    id: 'name',
    header: 'Name',
    accessorFn: row => row.name,
    enableColumnFilter: true,
  },
];

const renderTable = () =>
  render(
    <TestContext>
      <ThemeProvider theme={theme}>
        <Table columns={columns} data={data} />
      </ThemeProvider>
    </TestContext>
  );

// The filter row is toggled from a toolbar button; its accessible name comes from
// the MRT localization ("Show/Hide filters").
const getToggleFiltersButton = () => screen.getByRole('button', { name: /show\/hide filters/i });

const getNameFilterInput = () =>
  screen.getByRole('textbox', { name: /filter by name/i }) as HTMLInputElement;

describe('Table column filters', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears active column filters when the filter row is hidden', async () => {
    const user = userEvent.setup();
    renderTable();

    const table = screen.getByRole('table');

    // Show the filter row and filter down to a single row.
    await user.click(getToggleFiltersButton());
    const input = getNameFilterInput();
    await user.type(input, 'alpha');

    // Wait until the (debounced) filter actually applies and hides other rows,
    // which confirms the value has landed in the table's column-filter state.
    await waitFor(() => {
      expect(within(table).queryByText('beta')).not.toBeInTheDocument();
      expect(within(table).queryByText('gamma')).not.toBeInTheDocument();
    });

    // Hide the filter row: this should also clear the active filter.
    await user.click(getToggleFiltersButton());

    // Show it again — the filter must start empty and every row visible again.
    await user.click(getToggleFiltersButton());

    await waitFor(() => {
      expect(getNameFilterInput().value).toBe('');
    });
    expect(within(table).getByText('alpha')).toBeInTheDocument();
    expect(within(table).getByText('beta')).toBeInTheDocument();
    expect(within(table).getByText('gamma')).toBeInTheDocument();
  });
});
