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
 * finalSim.mjs — reproduces every symptom discussed, from the verified model.
 *
 * The react-query lifecycle rules encoded in `returnAfterAway` were confirmed by
 * running the real @tanstack/react-query v5.51 engine headless:
 *   - fresh (age < staleTime): a new observer does NOT refetch; cached success shown.
 *   - stale (staleTime <= age, still within gcTime): cached success shown immediately
 *     AND a background refetch runs.
 *   - CRUX: if that refetch fails (retry:false), status becomes 'error' and
 *     isSuccess becomes FALSE *even though cached data exists* -> AuthRoute flips
 *     from page to the gate.
 *   - gc'd (inactive >= gcTime): cache removed; a new observer starts cold (pending).
 */

import {
  AUTH_TIMEOUT,
  authRouteScreen,
  DEFAULT_TIMEOUT,
  GC_TIME,
  getClusterReadiness,
  probe,
  readinessLabel,
  STALE_TIME,
  versionRefetchInterval,
} from './finalModel.mjs';

/**
 * The "not reachable even with a valid token" open paradox (table vs open).
 */
export function openParadox({ versionHttp = 200, authHttp, authLatencyMs, authType = 'token' }) {
  const versionError = probe(versionHttp, 50, DEFAULT_TIMEOUT);
  const authError = probe(authHttp, authLatencyMs, AUTH_TIMEOUT);
  const rowLabel = readinessLabel(getClusterReadiness(versionError, { tracked: true, error: authError }));
  const gate = authRouteScreen({
    status: authError === null ? 'success' : 'error',
    error: authError ?? undefined,
    authType,
  });
  return {
    rowLabel,
    gate,
    tokenActuallyValid: authHttp === 200,
    misleading: authHttp === 200 && gate !== 'cluster',
  };
}

/**
 * Home-table status poll over cycles (retry:false + backoff). One blip flips the
 * row immediately; backoff makes it linger.
 * @param {Array<{http:any, latencyMs?:number}>} cycles
 */
export function pollFlap(cycles) {
  let failures = 0;
  return cycles.map(c => {
    const err = probe(c.http, c.latencyMs ?? 50, DEFAULT_TIMEOUT);
    failures = err === null ? 0 : failures + 1;
    return {
      label: readinessLabel(getClusterReadiness(err, { tracked: true, error: null })),
      nextPollS: versionRefetchInterval(failures) / 1000,
    };
  });
}

/**
 * Coming back to a cluster page after being away `awayMs`, where the last
 * successful testAuth happened when you left (t=0).
 *
 * @param {object} p
 * @param {number} p.awayMs                how long you were away
 * @param {number|'network-fail'} p.bgAuthHttp  result of the re-check (if one runs)
 * @param {number} p.bgAuthLatencyMs       how long that re-check takes
 * @param {string} [p.authType]            'token' | 'oidc'
 * @returns {{refetched:boolean, screenImmediate:string, screenFinal:string, cold:boolean}}
 */
export function returnAfterAway({ awayMs, bgAuthHttp = 200, bgAuthLatencyMs = 300, authType = 'token' }) {
  const cold = awayMs >= GC_TIME; // cache garbage-collected
  const stale = awayMs >= STALE_TIME; // needs a re-check on mount

  // The re-check result (only runs when stale or cold).
  const authError = probe(bgAuthHttp, bgAuthLatencyMs, AUTH_TIMEOUT);
  const settledScreen = authRouteScreen({
    status: authError === null ? 'success' : 'error',
    error: authError ?? undefined,
    authType,
  });

  if (cold) {
    // No cached data -> pending -> "checking" until the fresh testAuth settles.
    return { refetched: true, screenImmediate: 'checking', screenFinal: settledScreen, cold: true };
  }
  if (stale) {
    // Cached success shown instantly; background refetch runs. If it FAILS,
    // react-query flips status to 'error' (verified) -> AuthRoute shows the gate.
    return {
      refetched: true,
      screenImmediate: 'cluster',
      screenFinal: settledScreen, // 'cluster' if re-check ok, else the gate
      cold: false,
    };
  }
  // Fresh: no refetch, page stays.
  return { refetched: false, screenImmediate: 'cluster', screenFinal: 'cluster', cold: false };
}
