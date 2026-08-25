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
function Harness({
  onSelect,
  ...props
}: Partial<React.ComponentProps<typeof PureNamespacesAutocomplete>> & {
  onSelect?: (value: string[]) => void;
}) {
  const [selected, setSelected] = React.useState<string[]>([]);
  return (
    <PureNamespacesAutocomplete
      namespaceNames={NAMESPACES}
      filter={{ namespaces: new Set(selected) }}
      onChange={(_event, newValue) => {
        setSelected(newValue);
        onSelect?.(newValue);
      }}
      {...props}
    />
  );
}

function renderHarness(
  props?: Partial<React.ComponentProps<typeof PureNamespacesAutocomplete>> & {
    onSelect?: (value: string[]) => void;
  }
) {
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

  it('clears the search and shows the selected name after selecting', () => {
    renderHarness();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));

    // The search text is cleared on select, so the input shows the selected
    // name (not the typed 'vbgw') and the list is no longer filtered.
    expect(input.value).toBe('');
    expect(screen.getAllByText('wnv7a0vbgw0002c').length).toBeGreaterThanOrEqual(1);
    expect(optionNames()).toContain('cert-manager');
  });

  it('accumulates multiple selections, clearing the search on each pick', () => {
    renderHarness();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0001c' }));

    // Search cleared -> full list shown again; pick another from it.
    expect(input.value).toBe('');
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0003c' }));

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

  it('clears the typed filter when the dropdown closes (without selecting)', () => {
    renderHarness();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });
    expect(input.value).toBe('vbgw');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });

  it('shows the full list again after closing and reopening', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));
    fireEvent.keyDown(input, { key: 'Escape' });

    // Reopen: the filter is gone, so every namespace is listed again.
    fireEvent.mouseDown(input);
    expect(optionNames()).toContain('cert-manager');
  });

  it('shows the selected summary in the input when picking via checkbox (not typing)', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);

    // Pick via the checkbox, without typing anything.
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));

    // The name appears twice: as the checked option in the list AND as the
    // summary shown in the input box (this was the reported bug — the input
    // was empty after selecting).
    expect(screen.getAllByText('wnv7a0vbgw0002c')).toHaveLength(2);
  });

  it('hides the summary while typing, and shows it when not typing', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);

    // Select via checkbox (no typing) -> the summary shows the name (it appears
    // in the list AND in the input summary).
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0002c' }));
    expect(screen.getAllByText('wnv7a0vbgw0002c')).toHaveLength(2);

    // Now type -> the summary is hidden, so the name is only in the list.
    fireEvent.change(input, { target: { value: 'vbgw' } });
    expect(screen.getAllByText('wnv7a0vbgw0002c')).toHaveLength(1);

    // Clear the typed text -> the summary comes back.
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByText('wnv7a0vbgw0002c')).toHaveLength(2);
  });

  it('unchecking a selected option removes it from the selection', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'vbgw' } });

    const option = () => screen.getByRole('option', { name: 'wnv7a0vbgw0002c' });
    fireEvent.click(option());
    expect(option()).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(option());
    expect(option()).toHaveAttribute('aria-selected', 'false');
  });

  it('emits the selected namespaces to the parent', () => {
    const onSelect = vi.fn();
    renderHarness({ onSelect });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);

    fireEvent.click(screen.getByRole('option', { name: 'cert-manager' }));
    expect(onSelect).toHaveBeenLastCalledWith(['cert-manager']);

    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0001c' }));
    expect(onSelect).toHaveBeenLastCalledWith(['cert-manager', 'wnv7a0vbgw0001c']);
  });

  it('clears the whole selection with the clear (X) button', () => {
    const onSelect = vi.fn();
    renderHarness({ onSelect });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.click(screen.getByRole('option', { name: 'cert-manager' }));
    fireEvent.click(screen.getByRole('option', { name: 'wnv7a0vbgw0001c' }));

    fireEvent.click(screen.getByTitle('Clear'));
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('shows no options for a non-matching filter', () => {
    renderHarness();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'zzzzzz' } });

    expect(optionNames()).toHaveLength(0);
    expect(screen.getByText('No options')).toBeInTheDocument();
  });

  it('can select an option with the keyboard (ArrowDown + Enter)', () => {
    const onSelect = vi.fn();
    renderHarness({ onSelect });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenLastCalledWith(['cert-manager']);
  });
});
