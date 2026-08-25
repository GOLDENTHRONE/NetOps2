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
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { createMuiTheme } from '../../lib/themes';
import { TestContext } from '../../test';
import { PureNamespacesAutocomplete } from './NamespacesAutocomplete';

// cyclic imports fix
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

// A representative slice of a real cluster: one unrelated namespace plus a
// group that shares a substring, so filtering + multi-select can be exercised.
const NAMESPACES = ['cert-manager', 'wnv7a0vbgw0001c', 'wnv7a0vbgw0002c', 'wnv7a0vbgw0003c'];

/** Controlled harness mirroring how ProjectList drives the component. */
function Harness(props: Partial<React.ComponentProps<typeof PureNamespacesAutocomplete>>) {
  const [selected, setSelected] = React.useState<string[]>([]);
  return (
    <PureNamespacesAutocomplete
      namespaceNames={NAMESPACES}
      filter={{ namespaces: new Set(selected) }}
      onChange={(_event, newValue) => setSelected(newValue)}
      {...props}
    />
  );
}

function renderHarness(props?: Partial<React.ComponentProps<typeof PureNamespacesAutocomplete>>) {
  return render(
    <TestContext>
      <ThemeProvider theme={createMuiTheme({ name: 'Light', base: 'light' })}>
        <Harness {...props} />
      </ThemeProvider>
    </TestContext>
  );
}

/** Returns the currently rendered option labels in the open listbox. */
function optionNames() {
  const listbox = screen.queryByRole('listbox');
  if (!listbox) return [];
  return within(listbox)
    .queryAllByRole('option')
    .map(o => o.textContent);
}

describe('PureNamespacesAutocomplete', () => {
  beforeEach(() => {
    // setupTests installs matchMedia, but earlier suites' restoreAllMocks can
    // clear it; MUI's Autocomplete needs it, so re-install defensively.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
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

  it('filters the options as the user types', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    const names = optionNames();
    expect(names).toContain('wnv7a0vbgw0002c');
    expect(names).not.toContain('cert-manager');
  });

  it('keeps the filter after selecting so multiple matches can be picked seamlessly', () => {
    renderHarness({ keepFilterTextOnSelect: true });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));

    // The list stays open and still filtered to the typed text, so the
    // sibling matches remain immediately clickable (no reset to all 4).
    expect((input as HTMLInputElement).value).toBe('vbgw');
    const names = optionNames();
    expect(names).toContain('wnv7a0vbgw0003c');
    expect(names).not.toContain('cert-manager');
  });

  it('by default clears the filter on select (unchanged behavior for other pages)', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));

    // Filter is wiped, so the full list is shown again.
    expect((input as HTMLInputElement).value).toBe('');
    expect(optionNames()).toContain('cert-manager');
  });

  it('supports selecting several namespaces (multi-select accumulates)', () => {
    renderHarness({ keepFilterTextOnSelect: true });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0001c' }));
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0003c' }));

    // Both remain checked in the still-open, still-filtered list.
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'wnv7a0vbgw0001c' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(listbox).getByRole('option', { name: 'wnv7a0vbgw0003c' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
