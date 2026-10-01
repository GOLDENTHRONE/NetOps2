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

import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import {
  isClusterAuthFailing,
  noteClusterAuthSuccess,
  reportClusterAuthFailure,
  resetAuthExpiry,
} from './authExpiry';

const setToken = vi.fn(() => Promise.resolve()) as Mock;
const resetQueries = vi.fn(() => Promise.resolve()) as Mock;

// Mocks for the LAZY dynamic imports authExpiry performs (auth.ts / queryClient.ts).
vi.mock('../../../auth', () => ({ setToken: (c: string, t: string | null) => setToken(c, t) }));
vi.mock('../../../queryClient', () => ({
  queryClient: { resetQueries: (a: unknown) => resetQueries(a) },
}));

// Let the pending dynamic import()/await chain microtasks settle.
const flush = () => new Promise(r => setTimeout(r, 10));

afterEach(() => {
  resetAuthExpiry();
  setToken.mockClear();
  resetQueries.mockClear();
});

describe('authExpiry (P1 #18)', () => {
  it('a 401 report clears the cluster token once and resets its auth query', async () => {
    reportClusterAuthFailure('A');
    await flush();
    // Token cleared for THIS cluster (setToken(null)), not a full logout — so the ['auth']
    // query survives for the reset below to refetch its active observer.
    expect(setToken).toHaveBeenCalledTimes(1);
    expect(setToken).toHaveBeenCalledWith('A', null);
    // Reset (not invalidate) so a failing re-check lands in status:'error' -> gate.
    // Scoped to this cluster's exact auth key so cluster B is never disturbed.
    expect(resetQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['auth', 'A'], exact: true })
    );
    expect(isClusterAuthFailing('A')).toBe(true);
  });

  it('de-duplicates concurrent 401s into one logout episode', async () => {
    reportClusterAuthFailure('A');
    reportClusterAuthFailure('A');
    reportClusterAuthFailure('A');
    reportClusterAuthFailure('A');
    await flush();
    expect(setToken).toHaveBeenCalledTimes(1);
  });

  it('a success resets the episode so a later expiry re-fires', async () => {
    reportClusterAuthFailure('A');
    await flush();
    expect(setToken).toHaveBeenCalledTimes(1);
    noteClusterAuthSuccess('A');
    expect(isClusterAuthFailing('A')).toBe(false);
    reportClusterAuthFailure('A');
    await flush();
    expect(setToken).toHaveBeenCalledTimes(2);
  });

  it('is cluster-scoped: a failure for A does not affect B', async () => {
    reportClusterAuthFailure('A');
    await flush();
    expect(setToken).toHaveBeenCalledTimes(1);
    expect(setToken).toHaveBeenCalledWith('A', null);
    expect(isClusterAuthFailing('A')).toBe(true);
    expect(isClusterAuthFailing('B')).toBe(false);
    // A distinct cluster B fires independently.
    reportClusterAuthFailure('B');
    await flush();
    expect(setToken).toHaveBeenCalledWith('B', null);
    expect(setToken).toHaveBeenCalledTimes(2);
  });

  it('ignores an empty cluster name', async () => {
    reportClusterAuthFailure('');
    await flush();
    expect(setToken).not.toHaveBeenCalled();
  });
});
