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

import {
  clearTablePreferences,
  loadTablePreferences,
  storeTablePreferences,
} from './userPreferences';

describe('userPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('storeTablePreferences', () => {
    it('stores column sizing and order in localStorage', () => {
      storeTablePreferences('test-table', {
        columnSizing: { name: 150, status: 80 },
        columnOrder: ['name', 'status'],
      });

      const stored = JSON.parse(localStorage.getItem('user_preferences.table.test-table') || '{}');
      expect(stored).toEqual({
        columnSizing: { name: 150, status: 80 },
        columnOrder: ['name', 'status'],
      });
    });

    it('merges with existing preferences instead of overwriting them', () => {
      storeTablePreferences('test-table', { columnOrder: ['a', 'b'] });
      storeTablePreferences('test-table', { columnSizing: { a: 100 } });

      expect(loadTablePreferences('test-table')).toEqual({
        columnOrder: ['a', 'b'],
        columnSizing: { a: 100 },
      });
    });

    it('drops invalid sizing values but keeps valid ones', () => {
      storeTablePreferences('test-table', {
        columnSizing: { good: 120, zero: 0, negative: -5, nan: NaN, infinity: Infinity },
      });

      expect(loadTablePreferences('test-table')).toEqual({
        columnSizing: { good: 120 },
      });
    });

    it('removes the entry when the merged preferences are empty', () => {
      storeTablePreferences('test-table', { columnSizing: { a: 100 } });
      storeTablePreferences('test-table', { columnSizing: {}, columnOrder: [] });

      expect(localStorage.getItem('user_preferences.table.test-table')).toBeNull();
    });

    it('does nothing when tableId is empty', () => {
      storeTablePreferences('', { columnSizing: { a: 100 } });

      expect(localStorage.getItem('user_preferences.table.')).toBeNull();
    });

    it('catches and logs errors when localStorage.setItem throws', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });

      storeTablePreferences('test-table', { columnSizing: { a: 100 } });

      expect(spyError).toHaveBeenCalledWith(
        'Error occurred while updating user_preferences.table.test-table in local storage:',
        expect.any(Error)
      );
    });
  });

  describe('loadTablePreferences', () => {
    it('returns stored preferences', () => {
      const preferences = { columnSizing: { name: 150 }, columnOrder: ['name', 'status'] };
      localStorage.setItem('user_preferences.table.test-table', JSON.stringify(preferences));

      expect(loadTablePreferences('test-table')).toEqual(preferences);
    });

    it('returns an empty object when nothing is stored', () => {
      expect(loadTablePreferences('nonexistent-table')).toEqual({});
    });

    it('returns an empty object when tableId is empty or missing', () => {
      expect(loadTablePreferences('')).toEqual({});
      expect(loadTablePreferences()).toEqual({});
    });

    it('returns an empty object and warns when JSON is malformed', () => {
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('user_preferences.table.test-table', '{ malformed json ]');

      expect(loadTablePreferences('test-table')).toEqual({});
      expect(spyWarn).toHaveBeenCalledWith(
        'Failed to read user_preferences.table.test-table from local storage, falling back to defaults:',
        expect.any(Error)
      );
    });

    it('returns an empty object and warns when the stored value is not an object', () => {
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('user_preferences.table.test-table', JSON.stringify(['not', 'valid']));

      expect(loadTablePreferences('test-table')).toEqual({});
      expect(spyWarn).toHaveBeenCalledWith(
        'user_preferences.table.test-table is not an object, ignoring it.'
      );
    });

    it('ignores fields of the wrong type', () => {
      localStorage.setItem(
        'user_preferences.table.test-table',
        JSON.stringify({ columnSizing: 'wrong', columnOrder: [1, 2, 3] })
      );

      expect(loadTablePreferences('test-table')).toEqual({});
    });

    it('returns an empty object and warns when localStorage.getItem throws', () => {
      const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('Security error');
      });

      expect(loadTablePreferences('test-table')).toEqual({});
      expect(spyWarn).toHaveBeenCalled();
    });
  });

  describe('clearTablePreferences', () => {
    it('removes the stored preferences', () => {
      storeTablePreferences('test-table', { columnSizing: { a: 100 } });

      clearTablePreferences('test-table');

      expect(localStorage.getItem('user_preferences.table.test-table')).toBeNull();
    });

    it('does nothing when tableId is empty', () => {
      expect(() => clearTablePreferences('')).not.toThrow();
    });
  });
});
