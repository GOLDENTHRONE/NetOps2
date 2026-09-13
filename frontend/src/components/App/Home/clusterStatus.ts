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

import type { ApiError } from '../../../lib/k8s/api/v2/ApiError';

export type ClusterStatusState =
  | 'active'
  | 'auth-error'
  | 'loading'
  | 'permission-error'
  | 'unavailable';
type Translate = (key: string) => string;

export function getClusterStatus(error?: ApiError | null): ClusterStatusState {
  if (error === undefined) {
    return 'loading';
  }

  if (error === null) {
    return 'active';
  }

  if (error.status === 401) {
    return 'auth-error';
  }
  if (error.status === 403) {
    return 'permission-error';
  }

  return 'unavailable';
}

export function canSelectCluster(error?: ApiError | null) {
  return getClusterStatus(error) === 'active';
}

export function getClusterStatusLabel(t: Translate, error?: ApiError | null) {
  const status = getClusterStatus(error);
  if (status === 'active') {
    return t('translation|Active');
  }
  if (status === 'auth-error') {
    return t('translation|Authentication required');
  }
  if (status === 'permission-error') {
    return t('translation|Insufficient permissions');
  }
  if (status === 'unavailable') {
    return t('translation|Unavailable');
  }
  return '⋯';
}

/**
 * The authorization check for a cluster, as produced by `useClustersAuth`.
 *
 * `tracked` is false when the readiness feature is off or the cluster isn't being
 * auth-polled — in that case the table keeps its original reachability-only status
 * ("Active"). When `tracked` is true, `error` is the auth result: `undefined` while
 * the first check is in flight, `null` when authorized, or an `ApiError` when it
 * failed (401/403/timeout/…).
 */
export type ClusterAuthCheck = { tracked: false } | { tracked: true; error?: ApiError | null };

/**
 * Readiness combines reachability (the `/version` probe) with authorization (the
 * `testAuth` probe). It is a strict superset of {@link ClusterStatusState}: the two
 * extra states, `ready` and `reachable`, only occur when the auth check is tracked.
 *
 * - `ready`: reachable AND authorized — safe to open.
 * - `reachable`: reachable, authorization not (yet) confirmed — openable, may prompt sign-in.
 * - `active`: reachable, auth not tracked (feature off) — original behaviour.
 */
export type ClusterReadinessState = ClusterStatusState | 'ready' | 'reachable';

/**
 * Derives the readiness of a cluster from its reachability result and its auth
 * check. A reachability failure always wins: if we can't reach `/version`, the auth
 * result is irrelevant. Only when the cluster is reachable does the auth check
 * refine the status into `ready` / `reachable` / `auth-error` / `permission-error`.
 */
export function getClusterReadiness(
  versionError: ApiError | null | undefined,
  auth: ClusterAuthCheck = { tracked: false }
): ClusterReadinessState {
  const reachability = getClusterStatus(versionError);

  // Not reachable (or still loading): reachability decides, auth is moot.
  if (reachability !== 'active') {
    return reachability;
  }

  // Reachable, but auth isn't tracked: keep the original "active" behaviour.
  if (!auth.tracked) {
    return 'active';
  }

  // Reachable, auth is tracked: refine by the auth result.
  if (auth.error === undefined) {
    return 'reachable'; // reachable, auth check still in flight
  }
  if (auth.error === null) {
    return 'ready'; // reachable AND authorized
  }
  if (auth.error.status === 401) {
    return 'auth-error';
  }
  if (auth.error.status === 403) {
    return 'permission-error';
  }
  // Auth check failed for a non-auth reason (timeout, transient 5xx, …). The
  // cluster answered `/version`, so it is reachable; authorization is just unknown.
  return 'reachable';
}

/** Human label for a readiness state (extends {@link getClusterStatusLabel}). */
export function getClusterReadinessLabel(t: Translate, state: ClusterReadinessState) {
  if (state === 'ready') {
    return t('translation|Ready');
  }
  if (state === 'reachable') {
    return t('translation|Reachable');
  }
  if (state === 'active') {
    return t('translation|Active');
  }
  if (state === 'auth-error') {
    return t('translation|Authentication required');
  }
  if (state === 'permission-error') {
    return t('translation|Insufficient permissions');
  }
  if (state === 'unavailable') {
    return t('translation|Unavailable');
  }
  return '⋯';
}
