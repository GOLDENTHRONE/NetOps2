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

/*
 * ---------------------------------------------------------------------------
 * reachabilityModel.mjs
 *
 * A faithful, dependency-free port of the GT_D_V1 "All Clusters" decision logic,
 * focused on WHY a cluster can flip to "not reachable" / an error screen even
 * when the token is perfectly valid. Every constant and rule mirrors a specific
 * place in the source:
 *
 *   - DEFAULT_TIMEOUT (2 min)         frontend/src/lib/k8s/api/v1/constants.ts
 *   - testAuth timeout (5 s)          frontend/src/lib/k8s/api/v1/clusterApi.ts
 *   - AbortError -> HTTP 408          frontend/src/lib/k8s/api/v1/clusterRequests.ts
 *   - getClusterStatus / readiness    frontend/src/components/App/Home/clusterStatus.ts
 *   - versionRefetchInterval + retry:false + backoff  frontend/src/lib/k8s/index.ts
 *   - routeAuthOutcome / access gate  frontend/src/components/App/RouteSwitcher.tsx
 *                                     frontend/src/components/cluster/ClusterAccessGate.tsx
 *
 * All data used with this model is generic/synthetic. No real cluster names,
 * hosts, tokens, or namespaces appear anywhere in this tool.
 * ---------------------------------------------------------------------------
 */

// --- timeouts (ms) ----------------------------------------------------------
export const DEFAULT_TIMEOUT = 2 * 60 * 1000; // /version and most requests
export const AUTH_TIMEOUT = 5 * 1000; // testAuth (selfsubjectrulesreviews)

// --- poll cadence + backoff -------------------------------------------------
export const versionFetchInterval = 10000;
export const maxVersionFetchInterval = versionFetchInterval * 6; // 60s
export const authCheckInterval = 10000;

export function backoff(base, cap, consecutiveFailures) {
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, cap);
}
export const versionRefetchInterval = f => backoff(versionFetchInterval, maxVersionFetchInterval, f);

/**
 * Model one HTTP-ish probe with a latency, against a client-side timeout — this
 * is the crux of the bug. If the response takes longer than the timeout, the
 * request layer aborts and synthesises HTTP 408 (see clusterRequests.ts). So a
 * SLOW-BUT-ALIVE cluster looks the same as a dead one.
 *
 * @param {number|'network-fail'} http  the eventual HTTP status (200/401/403/502…)
 *                                       or 'network-fail' for a connection error
 * @param {number} latencyMs  how long the response actually takes
 * @param {number} timeoutMs  the client-side timeout for this request
 * @returns {null | {status:number}}  null on success (200), else an ApiError-shape
 */
export function probe(http, latencyMs, timeoutMs) {
  if (latencyMs > timeoutMs) {
    return { status: 408 }; // AbortError -> 408 "Request timed-out"
  }
  if (http === 'network-fail') {
    return { status: 502 }; // proxy/connection failure surfaces as a non-401/403 error
  }
  if (http === 200) return null;
  return { status: http };
}

// --- status mapping (clusterStatus.ts) --------------------------------------
export function getClusterStatus(error) {
  if (error === undefined) return 'loading';
  if (error === null) return 'active';
  if (error.status === 401) return 'auth-error';
  if (error.status === 403) return 'permission-error';
  return 'unavailable';
}

/**
 * Readiness (version + auth), ported from getClusterReadiness on GT_D_V1.
 * @param {null|{status:number}|undefined} versionError
 * @param {{tracked:boolean, error?:null|{status:number}|undefined}} auth
 */
export function getClusterReadiness(versionError, auth = { tracked: false }) {
  const reachability = getClusterStatus(versionError);
  if (reachability !== 'active') return reachability; // a version failure wins
  if (!auth.tracked) return 'active';
  if (auth.error === undefined) return 'reachable';
  if (auth.error === null) return 'ready';
  if (auth.error.status === 401) return 'auth-error';
  if (auth.error.status === 403) return 'permission-error';
  return 'reachable'; // auth failed for a non-auth reason (e.g. 408 timeout)
}

const READINESS_LABEL = {
  ready: 'Ready',
  reachable: 'Reachable',
  active: 'Active',
  'auth-error': 'Authentication required',
  'permission-error': 'Insufficient permissions',
  unavailable: 'Unavailable',
  loading: '⋯',
};
export const readinessLabel = state => READINESS_LABEL[state] ?? '⋯';

/**
 * The access gate outcome when a user OPENS a cluster (AuthRoute + ClusterAccessGate).
 * The open-time check is testAuth with the 5s timeout.
 * @param {'pending'|null|{status:number}} authResult  null = success
 * @param {{authType?:string}} clusterConf
 */
export function openOutcome(authResult, clusterConf = {}) {
  if (authResult === 'pending') return 'checking';
  if (authResult === null) return 'cluster'; // opens
  if (clusterConf.authType === 'oidc') return 'login'; // OIDC keeps its redirect
  if (authResult.status === 401) return 'expired';
  if (authResult.status === 403) return 'forbidden';
  return 'unreachable'; // 408 timeout / 502 / other -> "This cluster is not responding"
}
