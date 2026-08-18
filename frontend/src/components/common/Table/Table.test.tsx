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
import { describe, expect, it } from 'vitest';
import { createMuiTheme } from '../../../lib/themes';
import { TestContext } from '../../../test';
import Table from './Table';

const theme = createMuiTheme({ name: 'light', base: 'light' });

const columns = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  {
    id: 'status',
    header: 'Status',
    accessorKey: 'status',
    filterVariant: 'select' as const,
  },
];

const data = [
  { name: 'alpha', status: 'Healthy' },
  { name: 'beta', status: 'Healthy' },
  { name: 'gamma', status: 'Completed' },
];

function renderTable(props: Partial<React.ComponentProps<typeof Table>> = {}) {
  return render(
    <TestContext>
      <ThemeProvider theme={theme}>
        <Table columns={columns} data={data} {...props} />
      </ThemeProvider>
    </TestContext>
  );
}

function toggleFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Show/Hide filters' }));
}

describe('Table column filters', () => {
  it('hides and resets the filters when the filter toggle is switched off', async () => {
    renderTable();

    toggleFilters();

    const nameFilter = await screen.findByPlaceholderText('Filter by Name');
    fireEvent.change(nameFilter, { target: { value: 'alpha' } });

    await waitFor(() => expect(screen.queryByText('beta')).not.toBeInTheDocument());
    expect(screen.getByText('alpha')).toBeInTheDocument();

    toggleFilters();

    // The filter row is gone, and with it the filtering it was applying.
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter by Name')).toBeNull());
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('gamma')).toBeInTheDocument();

    // Showing the filters again starts from an empty filter.
    toggleFilters();
    expect(await screen.findByPlaceholderText('Filter by Name')).toHaveValue('');
  });

  it('offers the values of a select column with their counts', async () => {
    renderTable();

    toggleFilters();

    const statusFilter = await screen.findByRole('combobox', { name: 'Filter by Status' });
    fireEvent.mouseDown(statusFilter);

    const options = await screen.findAllByRole('option');
    const optionLabels = options.map(option => option.textContent?.trim());
    expect(optionLabels).toContain('Completed (1)');
    expect(optionLabels).toContain('Healthy (2)');
  });

  it('filters the rows by the selected value of a select column', async () => {
    renderTable();

    toggleFilters();

    const statusFilter = await screen.findByRole('combobox', { name: 'Filter by Status' });
    fireEvent.mouseDown(statusFilter);
    fireEvent.click(await screen.findByRole('option', { name: 'Completed (1)' }));

    await waitFor(() => expect(screen.queryByText('alpha')).not.toBeInTheDocument());
    expect(screen.getByText('gamma')).toBeInTheDocument();
  });

  it('shows the filter row when the table starts out with filters applied', async () => {
    renderTable({ state: { columnFilters: [{ id: 'name', value: 'alpha' }] } });

    expect(await screen.findByPlaceholderText('Filter by Name')).toHaveValue('alpha');
  });
});
