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
 * Rigorous tests. Run with:
 *   node --test tools/all-clusters-reachability-sim/reachability.test.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTH_TIMEOUT,
  DEFAULT_TIMEOUT,
  getClusterReadiness,
  getClusterStatus,
  openOutcome,
  probe,
  versionRefetchInterval,
} from './reachabilityModel.mjs';
import {
  lingerAfterSingleBlip,
  openParadox,
  runReturnToTab,
  runStatusPoll,
} from './reachabilitySim.mjs';

// --- the timeout mismatch that causes most surprises ------------------------

test('the open/Ready check times out 24x sooner than the reachability check', () => {
  assert.equal(DEFAULT_TIMEOUT, 120000);
  assert.equal(AUTH_TIMEOUT, 5000);
  assert.equal(DEFAULT_TIMEOUT / AUTH_TIMEOUT, 24);
});

test('a slow-but-alive response past the timeout is reported as 408, not success', () => {
  // testAuth (5s): a 6s response aborts -> 408
  assert.deepEqual(probe(200, 6000, AUTH_TIMEOUT), { status: 408 });
  // /version (2min): the same 6s response is fine
  assert.equal(probe(200, 6000, DEFAULT_TIMEOUT), null);
  // a genuine network failure surfaces as 502
  assert.deepEqual(probe('network-fail', 50, DEFAULT_TIMEOUT), { status: 502 });
});

// --- readiness mapping ------------------------------------------------------

test('a 408 timeout maps to unavailable via getClusterStatus', () => {
  assert.equal(getClusterStatus({ status: 408 }), 'unavailable');
  assert.equal(getClusterStatus({ status: 502 }), 'unavailable');
});

test('an auth-probe timeout keeps the row Reachable (not Ready), token intact', () => {
  // /version 200 (reachable) + auth timed out (408) => Reachable, NOT an error row
  assert.equal(
    getClusterReadiness(null, { tracked: true, error: { status: 408 } }),
    'reachable'
  );
});

// --- flapping: one blip flips the row and it lingers ------------------------

test('a single transient /version blip flips the row to Unavailable (retry:false)', () => {
  const cycles = runStatusPoll([
    { http: 200 },
    { http: 'network-fail' }, // one blip
    { http: 200 },
  ]);
  assert.equal(cycles[0].label, 'Active');
  assert.equal(cycles[1].label, 'Unavailable'); // instantly flips on one failure
  assert.equal(cycles[2].label, 'Active'); // recovers on next success
});

test('one blip makes the error linger until the next poll (~20s: backoff already applies)', () => {
  // After the FIRST failure consecutiveFailures=1, so the next poll is
  // versionRefetchInterval(1) = 20s away — the user stares at "Unavailable" for
  // ~20s after a single transient blip, even though the cluster is fine.
  assert.equal(lingerAfterSingleBlip(), 20000);
});

test('repeated failures back off so recovery can take up to ~60s', () => {
  const cycles = runStatusPoll([
    { http: 'network-fail' },
    { http: 'network-fail' },
    { http: 'network-fail' },
    { http: 'network-fail' },
  ]);
  assert.deepEqual(
    cycles.map(c => c.nextPollInMs),
    [20000, 40000, 60000, 60000]
  );
  // Every cycle shows Unavailable while failing.
  assert.ok(cycles.every(c => c.label === 'Unavailable'));
});

test('backoff resets to 10s immediately after a success', () => {
  const cycles = runStatusPoll([
    { http: 'network-fail' },
    { http: 'network-fail' },
    { http: 200 },
  ]);
  assert.equal(cycles[1].nextPollInMs, 40000);
  assert.equal(cycles[2].nextPollInMs, 10000); // reset on success
  assert.equal(cycles[2].label, 'Active');
});

test('versionRefetchInterval backoff sequence is 10/20/40/60(capped)', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(versionRefetchInterval), [10000, 20000, 40000, 60000, 60000]);
});

// --- the open-cluster paradox (token valid, still "not responding") ---------

test('open gate outcomes by result', () => {
  assert.equal(openOutcome('pending'), 'checking');
  assert.equal(openOutcome(null), 'cluster');
  assert.equal(openOutcome({ status: 401 }), 'expired');
  assert.equal(openOutcome({ status: 403 }), 'forbidden');
  assert.equal(openOutcome({ status: 408 }), 'unreachable');
  assert.equal(openOutcome({ status: 502 }), 'unreachable');
  assert.equal(openOutcome({ status: 401 }, { authType: 'oidc' }), 'login');
});

test('THE PARADOX: valid token + slow SAR (6s) => row Ready but open = not responding', () => {
  const r = openParadox({ versionHttp: 200, authHttp: 200, authLatencyMs: 6000 });
  assert.equal(r.rowLabel, 'Reachable'); // table: reachable (auth poll also timed out)
  assert.equal(r.gate, 'unreachable'); // open: "This cluster is not responding"
  assert.equal(r.authTimedOut, true);
  assert.equal(r.tokenActuallyValid, true); // the token would have worked given time
  assert.equal(r.misleading, true);
});

test('fast + authorized opens cleanly (no paradox)', () => {
  const r = openParadox({ versionHttp: 200, authHttp: 200, authLatencyMs: 300 });
  assert.equal(r.rowLabel, 'Ready');
  assert.equal(r.gate, 'cluster');
  assert.equal(r.misleading, false);
});

test('a genuinely expired token is correctly shown as expired (not a false alarm)', () => {
  const r = openParadox({ versionHttp: 200, authHttp: 401, authLatencyMs: 300 });
  assert.equal(r.gate, 'expired');
  assert.equal(r.tokenActuallyValid, false);
  assert.equal(r.misleading, false);
});

// --- returning to the tab after being away ---------------------------------

test('return-to-tab: a slow first auth (6s) drops Ready->Reachable, then recovers', () => {
  // Come back; first auth recheck is slow (backend refreshing creds) -> 5s
  // timeout -> Reachable; the next successful check flips back to Ready.
  const cycles = runReturnToTab([
    { http: 200, latencyMs: 6000 }, // slow first call after idle -> times out
    { http: 200, latencyMs: 300 }, // next call is fast
  ]);
  assert.equal(cycles[0].label, 'Reachable');
  assert.equal(cycles[0].authTimedOut, true);
  assert.equal(cycles[1].label, 'Ready');
});

test('return-to-tab: backoff pushes the Ready recovery ~20s out after one timeout', () => {
  const cycles = runReturnToTab([{ http: 200, latencyMs: 6000 }]);
  // One failed auth -> next attempt is 20s away, so "Reachable" persists ~20s.
  assert.equal(cycles[0].nextAuthInMs, 20000);
});

test('return-to-tab: a fast auth on return goes straight back to Ready', () => {
  const cycles = runReturnToTab([{ http: 200, latencyMs: 300 }]);
  assert.equal(cycles[0].label, 'Ready');
  assert.equal(cycles[0].nextAuthInMs, 10000);
});
