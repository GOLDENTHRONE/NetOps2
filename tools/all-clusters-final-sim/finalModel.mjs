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
 * ===========================================================================
 * finalModel.mjs — the consolidated, code-verified model of the "All Clusters"
 * status + cluster-open behaviour on branch GT_D_V1.
 *
 * Every constant/rule below was re-read from the source and (for the react-query
 * lifecycle) confirmed by running the real @tanstack/react-query v5.51 engine
 * headless. Source anchors are cited inline. ALL DATA IS GENERIC/SYNTHETIC —
 * no real cluster names, hosts, tokens, or namespaces appear anywhere.
 *
 *   timeouts        frontend/src/lib/k8s/api/v1/constants.ts:26  (DEFAULT_TIMEOUT 120000)
 *                   frontend/src/lib/k8s/api/v1/clusterApi.ts:40 (testAuth timeout 5000)
 *   abort -> 408    frontend/src/lib/k8s/api/v1/clusterRequests.ts:185
 *   non-ok default  frontend/src/lib/k8s/api/v1/clusterRequests.ts:179 (502 "Unreachable")
 *   poll options    frontend/src/lib/k8s/index.ts:459-461,558-560,640-642
 *                   (refetchIntervalInBackground:false, refetchOnWindowFocus:'always', retry:false)
 *   intervals       frontend/src/lib/k8s/index.ts:313 (version 10000),
 *                   :368 (ocp default 3600000), :391 (auth default 10000), :319 (cap x6)
 *   readiness       frontend/src/components/App/Home/clusterStatus.ts (getClusterReadiness)
 *   AuthRoute gate  frontend/src/components/App/RouteSwitcher.tsx:221 (isSuccess->page),
 *                   :227 (isError->gate), :273 (pending->"checking")
 *   auth query      frontend/src/components/App/RouteSwitcher.tsx:172 (key ['auth',cluster], retry:0,
 *                   NO staleTime/refetchInterval override -> inherits global)
 *   global defaults frontend/src/lib/queryClient.ts:22-23 (staleTime 180000, refetchOnWindowFocus:false)
 *                   gcTime: NOT overridden anywhere -> react-query v5 default 300000 (5 min)
 *   two Home routes frontend/src/lib/router/index.tsx (path '/' and '/projects' both render <Home/>)
 * ===========================================================================
 */

// --- verified constants (ms) ------------------------------------------------
export const DEFAULT_TIMEOUT = 2 * 60 * 1000; // 120000 — /version and most requests
export const AUTH_TIMEOUT = 5 * 1000; // 5000 — testAuth (open gate + Ready poll)
export const STALE_TIME = 3 * 60 * 1000; // 180000 — auth query "fresh" window (inherited)
export const GC_TIME = 5 * 60 * 1000; // 300000 — react-query v5 default (not overridden)
export const versionFetchInterval = 10000;
export const authCheckInterval = 10000;
export const ocpVersionFetchInterval = 60 * 60 * 1000; // 1h
export const maxBackoff = versionFetchInterval * 6; // 60000

export function backoff(base, cap, consecutiveFailures) {
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, cap);
}
export const versionRefetchInterval = f => backoff(versionFetchInterval, maxBackoff, f);

/**
 * One request against a client-side timeout. A response slower than the timeout
 * is ABORTED and reported as HTTP 408 (clusterRequests.ts:185); a plain failure
 * is 502 (clusterRequests.ts:179).
 * @param {number|'network-fail'} http
 * @param {number} latencyMs
 * @param {number} timeoutMs
 * @returns {null|{status:number}}  null = 200 success
 */
export function probe(http, latencyMs, timeoutMs) {
  if (latencyMs > timeoutMs) return { status: 408 };
  if (http === 'network-fail') return { status: 502 };
  if (http === 200) return null;
  return { status: http };
}

// --- table readiness (clusterStatus.ts getClusterReadiness) -----------------
export function getClusterStatus(error) {
  if (error === undefined) return 'loading';
  if (error === null) return 'active';
  if (error.status === 401) return 'auth-error';
  if (error.status === 403) return 'permission-error';
  return 'unavailable';
}
export function getClusterReadiness(versionError, auth = { tracked: false }) {
  const reach = getClusterStatus(versionError);
  if (reach !== 'active') return reach;
  if (!auth.tracked) return 'active';
  if (auth.error === undefined) return 'reachable';
  if (auth.error === null) return 'ready';
  if (auth.error.status === 401) return 'auth-error';
  if (auth.error.status === 403) return 'permission-error';
  return 'reachable';
}
const LABEL = {
  ready: 'Ready', reachable: 'Reachable', active: 'Active',
  'auth-error': 'Authentication required', 'permission-error': 'Insufficient permissions',
  unavailable: 'Unavailable', loading: '⋯',
};
export const readinessLabel = s => LABEL[s] ?? '⋯';

// --- AuthRoute gate outcome (RouteSwitcher.tsx) -----------------------------
/**
 * Maps an auth-query STATE to the screen AuthRoute renders. The order matches
 * the code: isSuccess -> page, else isError -> gate, else pending -> checking.
 * @param {{status:'success'|'error'|'pending', error?:{status:number}, authType?:string}} q
 */
export function authRouteScreen(q) {
  if (q.status === 'success') return 'cluster'; // page opens
  if (q.status === 'error') {
    if (q.authType === 'oidc') return 'login'; // OIDC keeps redirect
    const s = q.error?.status;
    if (s === 401) return 'expired';
    if (s === 403) return 'forbidden';
    return 'unreachable'; // 408 timeout / 502 / other -> "not responding"
  }
  return 'checking'; // pending
}
