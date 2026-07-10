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

/**
 * Per-user, per-table layout preferences (column widths and column order).
 *
 * These are persisted to localStorage so that if the user resizes a column or
 * drags a column to a new position, the table looks the same after the window
 * is closed or the user navigates away and comes back.
 *
 * Column visibility is handled separately by helpers/tableSettings.ts; this
 * module intentionally only deals with sizing and ordering.
 */
export interface TablePreferences {
  /** Map of column id -> width in pixels. */
  columnSizing?: Record<string, number>;
  /** Column ids in the order the user arranged them. */
  columnOrder?: string[];
}

const storageKey = (tableId: string) => `user_preferences.table.${tableId}`;

function sanitizeColumnSizing(value: unknown): Record<string, number> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const sizing: Record<string, number> = {};
  for (const [key, size] of Object.entries(value as Record<string, unknown>)) {
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
      sizing[key] = size;
    }
  }
  return Object.keys(sizing).length > 0 ? sizing : undefined;
}

function sanitizeColumnOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(it => typeof it === 'string')) {
    return undefined;
  }
  return value.length > 0 ? (value as string[]) : undefined;
}

/**
 * Load the persisted layout preferences for a table.
 *
 * @param tableId - The ID of the table.
 * @returns The persisted preferences; an empty object when there are none or
 *          when the stored data is missing/invalid. Never throws.
 */
export function loadTablePreferences(tableId?: string): TablePreferences {
  if (!tableId) {
    return {};
  }

  try {
    const item = localStorage.getItem(storageKey(tableId));
    if (item === null) {
      return {};
    }
    const parsed = JSON.parse(item);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`${storageKey(tableId)} is not an object, ignoring it.`);
      return {};
    }
    const preferences: TablePreferences = {};
    const columnSizing = sanitizeColumnSizing(parsed.columnSizing);
    if (columnSizing) {
      preferences.columnSizing = columnSizing;
    }
    const columnOrder = sanitizeColumnOrder(parsed.columnOrder);
    if (columnOrder) {
      preferences.columnOrder = columnOrder;
    }
    return preferences;
  } catch (error) {
    console.warn(
      `Failed to read ${storageKey(tableId)} from local storage, falling back to defaults:`,
      error
    );
    return {};
  }
}

/**
 * Store layout preferences for a table, merging with what is already stored,
 * so updating only the sizing keeps the persisted order and vice versa.
 * Passing an explicit `undefined` for a field leaves it untouched; when the
 * merged result is empty the entry is removed entirely.
 *
 * @param tableId - The ID of the table.
 * @param preferences - The preferences to merge-write.
 */
export function storeTablePreferences(tableId: string, preferences: TablePreferences) {
  if (!tableId) {
    console.debug('storeTablePreferences: tableId is empty!', new Error().stack);
    return;
  }

  try {
    const current = loadTablePreferences(tableId);
    const merged: TablePreferences = {
      ...current,
      ...(preferences.columnSizing !== undefined
        ? { columnSizing: sanitizeColumnSizing(preferences.columnSizing) }
        : {}),
      ...(preferences.columnOrder !== undefined
        ? { columnOrder: sanitizeColumnOrder(preferences.columnOrder) }
        : {}),
    };
    if (merged.columnSizing === undefined) {
      delete merged.columnSizing;
    }
    if (merged.columnOrder === undefined) {
      delete merged.columnOrder;
    }

    if (Object.keys(merged).length === 0) {
      localStorage.removeItem(storageKey(tableId));
      return;
    }
    localStorage.setItem(storageKey(tableId), JSON.stringify(merged));
  } catch (error) {
    console.error(`Error occurred while updating ${storageKey(tableId)} in local storage:`, error);
  }
}

/**
 * Remove all persisted layout preferences for a table (reset to defaults).
 *
 * @param tableId - The ID of the table.
 */
export function clearTablePreferences(tableId: string) {
  if (!tableId) {
    return;
  }
  try {
    localStorage.removeItem(storageKey(tableId));
  } catch (error) {
    console.error(
      `Error occurred while removing ${storageKey(tableId)} from local storage:`,
      error
    );
  }
}
