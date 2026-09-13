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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import {
  canSelectCluster,
  getClusterReadiness,
  getClusterReadinessLabel,
  getClusterStatus,
  getClusterStatusLabel,
} from './clusterStatus';

describe('getClusterStatus', () => {
  it('maps version check states to display states', () => {
    expect(getClusterStatus(null)).toBe('active');
    expect(getClusterStatus(undefined)).toBe('loading');
    expect(getClusterStatus(new ApiError('Unauthorized', { status: 401 }))).toBe('auth-error');
    expect(getClusterStatus(new ApiError('Forbidden', { status: 403 }))).toBe('permission-error');
    expect(getClusterStatus(new ApiError('Bad Gateway', { status: 502 }))).toBe('unavailable');
  });
});

describe('canSelectCluster', () => {
  it('only allows clusters with a successful status check to be selected', () => {
    expect(canSelectCluster(null)).toBe(true);
    expect(canSelectCluster(undefined)).toBe(false);
    expect(canSelectCluster(new ApiError('Unauthorized', { status: 401 }))).toBe(false);
    expect(canSelectCluster(new ApiError('Forbidden', { status: 403 }))).toBe(false);
    expect(canSelectCluster(new ApiError('Bad Gateway', { status: 502 }))).toBe(false);
  });
});

describe('getClusterStatusLabel', () => {
  const t = (key: string) => key;

  it('maps status states to translated labels', () => {
    expect(getClusterStatusLabel(t, null)).toBe('translation|Active');
    expect(getClusterStatusLabel(t, undefined)).toBe('⋯');
    expect(getClusterStatusLabel(t, new ApiError('Unauthorized', { status: 401 }))).toBe(
      'translation|Authentication required'
    );
    expect(getClusterStatusLabel(t, new ApiError('Forbidden', { status: 403 }))).toBe(
      'translation|Insufficient permissions'
    );
    expect(getClusterStatusLabel(t, new ApiError('Bad Gateway', { status: 502 }))).toBe(
      'translation|Unavailable'
    );
  });
});

describe('getClusterReadiness', () => {
  const err = (status: number) => new ApiError('e', { status });

  it('falls back to reachability-only "active" when auth is not tracked', () => {
    expect(getClusterReadiness(null)).toBe('active');
    expect(getClusterReadiness(null, { tracked: false })).toBe('active');
    expect(getClusterReadiness(undefined)).toBe('loading');
    expect(getClusterReadiness(err(502))).toBe('unavailable');
  });

  it('lets a reachability failure win over the auth check', () => {
    expect(getClusterReadiness(err(502), { tracked: true, error: null })).toBe('unavailable');
    expect(getClusterReadiness(undefined, { tracked: true, error: null })).toBe('loading');
  });

  it('refines a reachable cluster by its auth result', () => {
    // reachable (version ok) + auth pending => reachable
    expect(getClusterReadiness(null, { tracked: true, error: undefined })).toBe('reachable');
    // reachable + authorized => ready
    expect(getClusterReadiness(null, { tracked: true, error: null })).toBe('ready');
    // reachable + 401 => auth-error
    expect(getClusterReadiness(null, { tracked: true, error: err(401) })).toBe('auth-error');
    // reachable + 403 => permission-error
    expect(getClusterReadiness(null, { tracked: true, error: err(403) })).toBe('permission-error');
    // reachable + non-auth failure (timeout/5xx) => reachable (auth uncertain, cluster is up)
    expect(getClusterReadiness(null, { tracked: true, error: err(408) })).toBe('reachable');
    expect(getClusterReadiness(null, { tracked: true, error: err(500) })).toBe('reachable');
  });
});

describe('getClusterReadinessLabel', () => {
  const t = (key: string) => key;
  it('labels the readiness states', () => {
    expect(getClusterReadinessLabel(t, 'ready')).toBe('translation|Ready');
    expect(getClusterReadinessLabel(t, 'reachable')).toBe('translation|Reachable');
    expect(getClusterReadinessLabel(t, 'active')).toBe('translation|Active');
    expect(getClusterReadinessLabel(t, 'auth-error')).toBe('translation|Authentication required');
    expect(getClusterReadinessLabel(t, 'permission-error')).toBe(
      'translation|Insufficient permissions'
    );
    expect(getClusterReadinessLabel(t, 'unavailable')).toBe('translation|Unavailable');
    expect(getClusterReadinessLabel(t, 'loading')).toBe('⋯');
  });
});

describe('MULTI_HOME_ENABLED', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it('defaults to true when REACT_APP_MULTI_HOME_ENABLED is an empty string', async () => {
    try {
      vi.stubEnv('REACT_APP_MULTI_HOME_ENABLED', '');
      const { MULTI_HOME_ENABLED } = await vi.importActual('./config');
      expect(MULTI_HOME_ENABLED).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is false when REACT_APP_MULTI_HOME_ENABLED is set to "false"', async () => {
    try {
      vi.stubEnv('REACT_APP_MULTI_HOME_ENABLED', 'false');
      const { MULTI_HOME_ENABLED } = await vi.importActual('./config');
      expect(MULTI_HOME_ENABLED).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is true when REACT_APP_MULTI_HOME_ENABLED is set to "true"', async () => {
    try {
      vi.stubEnv('REACT_APP_MULTI_HOME_ENABLED', 'true');
      const { MULTI_HOME_ENABLED } = await vi.importActual('./config');
      expect(MULTI_HOME_ENABLED).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
