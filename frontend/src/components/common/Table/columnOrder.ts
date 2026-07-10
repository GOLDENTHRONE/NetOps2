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
 * Merge a persisted column order with the table's current set of column ids.
 *
 * - Persisted ids that no longer exist are dropped.
 * - New columns that are not part of the persisted order are inserted at
 *   their natural (default) position, so tables stay flexible when columns
 *   are added or removed between sessions.
 * - The row-selection column is always kept first and the row-actions column
 *   last, matching how the table renders them.
 *
 * This is an internal helper for Table.tsx (not re-exported through
 * components/common, so it doesn't leak into the plugin API surface).
 */
export function reconcileColumnOrder(
  savedOrder: string[] | undefined,
  defaultOrder: string[]
): string[] {
  if (!savedOrder || savedOrder.length === 0) {
    return defaultOrder;
  }

  const defaultSet = new Set(defaultOrder);
  const result = savedOrder.filter(id => defaultSet.has(id));
  defaultOrder.forEach((id, index) => {
    if (!result.includes(id)) {
      result.splice(Math.min(index, result.length), 0, id);
    }
  });

  // Keep the selection checkbox column first and the actions column last,
  // regardless of what was persisted.
  const middle = result.filter(id => id !== 'mrt-row-select' && id !== 'mrt-row-actions');
  return [
    ...(defaultSet.has('mrt-row-select') ? ['mrt-row-select'] : []),
    ...middle,
    ...(defaultSet.has('mrt-row-actions') ? ['mrt-row-actions'] : []),
  ];
}
