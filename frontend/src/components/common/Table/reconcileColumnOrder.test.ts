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

import { reconcileColumnOrder } from './Table';

describe('reconcileColumnOrder', () => {
  it('returns the default order when nothing is saved', () => {
    expect(reconcileColumnOrder(undefined, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(reconcileColumnOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps the saved arrangement when the columns match', () => {
    expect(reconcileColumnOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('drops saved ids that no longer exist', () => {
    expect(reconcileColumnOrder(['c', 'removed', 'a', 'b'], ['a', 'b', 'c'])).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('inserts new columns at their natural position', () => {
    // 'd' is a new column appearing after 'c' in the defaults.
    expect(reconcileColumnOrder(['c', 'a', 'b'], ['a', 'b', 'c', 'd'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    // 'x' is a new column appearing first in the defaults.
    expect(reconcileColumnOrder(['b', 'a'], ['x', 'a', 'b'])).toEqual(['x', 'b', 'a']);
  });

  it('keeps the selection column first and the actions column last', () => {
    expect(
      reconcileColumnOrder(
        ['b', 'mrt-row-actions', 'a', 'mrt-row-select'],
        ['mrt-row-select', 'a', 'b', 'mrt-row-actions']
      )
    ).toEqual(['mrt-row-select', 'b', 'a', 'mrt-row-actions']);
  });

  it('adds the selection/actions columns when they were not saved', () => {
    expect(reconcileColumnOrder(['b', 'a'], ['mrt-row-select', 'a', 'b'])).toEqual([
      'mrt-row-select',
      'b',
      'a',
    ]);
  });
});
