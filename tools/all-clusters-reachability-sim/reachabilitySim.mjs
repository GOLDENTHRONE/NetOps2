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
 * reachabilitySim.mjs — reproduce, deterministically and with generic data, why
 * a cluster flips to "not reachable" / an error screen while a valid token is
 * still in place.
 *
 * Two mechanisms are modelled:
 *   1. The Home-table STATUS poll over time: retry:false means one failed cycle
 *      immediately flips the row; exponential backoff then makes that error
 *      LINGER for up to ~60s before the next check can clear it.
 *   2. The OPEN-cluster paradox: the row can read "Ready" (/version 200) while
 *      opening the cluster fails with "not responding", because opening runs a
 *      SEPARATE testAuth with a tight 5s timeout — a slow-but-alive API server
 *      (or busy proxy) trips it even though nothing is actually wrong.
 */

import {
  AUTH_TIMEOUT,
  authCheckInterval,
  backoff,
  DEFAULT_TIMEOUT,
  getClusterReadiness,
  openOutcome,
  probe,
  readinessLabel,
  versionRefetchInterval,
} from './reachabilityModel.mjs';

const maxAuthCheckInterval = authCheckInterval * 6;

/**
 * Model what happens to an ALREADY-Ready cluster when you come back to the tab
 * after working elsewhere for a while.
 *
 * While the tab is backgrounded, polling is paused (refetchIntervalInBackground:
 * false). On return, refetchOnWindowFocus:'always' fires an immediate auth
 * recheck — so it DOES check right away. But the first auth call after an idle
 * period is often slow (the backend re-establishes/refreshes the cluster
 * credential), and testAuth's 5s timeout is tight. If it times out, the row
 * drops Ready -> Reachable, and backoff pushes the next attempt ~20s out, so the
 * row sits on "Reachable" for a while before it can turn "Ready" again.
 *
 * `/version` is assumed healthy throughout (it has a 2-min timeout, so it stays
 * reachable); this isolates the auth recheck that gates the "Ready" label.
 *
 * @param {Array<{http:any, latencyMs?:number}>} authCycles  auth results after return
 */
export function runReturnToTab(authCycles) {
  let failures = 0;
  const out = [];
  for (const c of authCycles) {
    const latency = c.latencyMs ?? 300;
    const authError = probe(c.http, latency, AUTH_TIMEOUT);
    if (authError === null) {
      failures = 0;
    } else {
      failures += 1;
    }
    const readiness = getClusterReadiness(null, { tracked: true, error: authError });
    const nextAuthInMs = backoff(authCheckInterval, maxAuthCheckInterval, failures);
    out.push({
      readiness,
      label: readinessLabel(readiness),
      authTimedOut: authError?.status === 408,
      nextAuthInMs,
    });
  }
  return out;
}

/**
 * Run the Home-table status poll across a series of cycles.
 *
 * Each cycle describes what the /version probe does that tick:
 *   { http: 200|401|403|502|'network-fail', latencyMs?: number }
 * latencyMs defaults to fast (well under the 2-min /version timeout).
 *
 * Returns, per cycle: the ApiError, the displayed label, and the interval until
 * the NEXT poll (which is where backoff makes an error linger).
 *
 * @param {Array<{http:any, latencyMs?:number}>} cycles
 * @param {{tracked?:boolean}} [opts]  whether auth is tracked (readiness on)
 */
export function runStatusPoll(cycles, opts = {}) {
  let consecutiveFailures = 0;
  const out = [];
  for (const cycle of cycles) {
    const latency = cycle.latencyMs ?? 50;
    const error = probe(cycle.http, latency, DEFAULT_TIMEOUT);

    // retry:false — the query does not retry within a cycle, so this single
    // result is what the UI shows until the next scheduled poll.
    if (error === null) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
    }

    // Auth is left "authorized" here to isolate the reachability behaviour.
    const auth = opts.tracked ? { tracked: true, error: null } : { tracked: false };
    const readiness = getClusterReadiness(error, auth);
    const nextPollInMs = versionRefetchInterval(consecutiveFailures);

    out.push({
      error,
      readiness,
      label: readinessLabel(readiness),
      consecutiveFailures,
      nextPollInMs,
    });
  }
  return out;
}

/**
 * How long (ms) an error state lingers after a single blip before the next poll
 * can clear it — i.e. the minimum time the user stares at "Unavailable" for a
 * one-off failure. This is versionRefetchInterval(1) with retry:false.
 */
export function lingerAfterSingleBlip() {
  return versionRefetchInterval(1);
}

/**
 * The open-cluster paradox: given the table's /version result and the latency of
 * the open-time testAuth call, show what the row says vs. what opening does.
 *
 * @param {object} spec
 * @param {number|'network-fail'} spec.versionHttp   the /version result (200 = reachable)
 * @param {number|'network-fail'} spec.authHttp      the testAuth result if it completes
 * @param {number} spec.authLatencyMs                how long testAuth actually takes
 * @param {string} [spec.authType]                   'token' | 'oidc'
 */
export function openParadox(spec) {
  const versionError = probe(spec.versionHttp, spec.versionLatencyMs ?? 50, DEFAULT_TIMEOUT);
  // The table also runs testAuth on a poll, but with the same 5s timeout; model
  // its last result the same way so table + open use consistent inputs.
  const authError = probe(spec.authHttp, spec.authLatencyMs, AUTH_TIMEOUT);

  const rowReadiness = getClusterReadiness(versionError, { tracked: true, error: authError });
  const rowLabel = readinessLabel(rowReadiness);

  const gate = openOutcome(authError, { authType: spec.authType ?? 'token' });

  const tokenActuallyValid = spec.authHttp === 200; // would have succeeded given time
  const misleading = tokenActuallyValid && gate !== 'cluster';

  return {
    rowLabel,
    gate,
    authTimedOut: authError?.status === 408,
    tokenActuallyValid,
    misleading,
  };
}
