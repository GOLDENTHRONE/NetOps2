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

/* Run:  node --test tools/all-clusters-final-sim/final.test.mjs */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTH_TIMEOUT,
  DEFAULT_TIMEOUT,
  GC_TIME,
  STALE_TIME,
  authRouteScreen,
  getClusterReadiness,
  probe,
} from './finalModel.mjs';
import { openParadox, pollFlap, returnAfterAway } from './finalSim.mjs';

// --- verified constants -----------------------------------------------------
test('constants match the code', () => {
  assert.equal(DEFAULT_TIMEOUT, 120000);
  assert.equal(AUTH_TIMEOUT, 5000);
  assert.equal(STALE_TIME, 180000);
  assert.equal(GC_TIME, 300000);
  assert.equal(DEFAULT_TIMEOUT / AUTH_TIMEOUT, 24);
});

// --- timeout -> 408 ---------------------------------------------------------
test('a 6s response trips the 5s auth timeout but not the 2m version timeout', () => {
  assert.deepEqual(probe(200, 6000, AUTH_TIMEOUT), { status: 408 });
  assert.equal(probe(200, 6000, DEFAULT_TIMEOUT), null);
});

// --- readiness --------------------------------------------------------------
test('readiness combines version + auth', () => {
  assert.equal(getClusterReadiness(null, { tracked: true, error: null }), 'ready');
  assert.equal(getClusterReadiness(null, { tracked: true, error: { status: 408 } }), 'reachable');
  assert.equal(getClusterReadiness(null, { tracked: true, error: { status: 401 } }), 'auth-error');
  assert.equal(getClusterReadiness({ status: 502 }, { tracked: true, error: null }), 'unavailable');
  assert.equal(getClusterReadiness(null, { tracked: false }), 'active'); // feature off
});

// --- open paradox (valid token, still "not responding") ---------------------
test('valid token + slow (6s) SAR => open gate says not responding', () => {
  const r = openParadox({ authHttp: 200, authLatencyMs: 6000 });
  assert.equal(r.gate, 'unreachable');
  assert.equal(r.misleading, true);
});
test('valid token + fast SAR => opens cleanly', () => {
  const r = openParadox({ authHttp: 200, authLatencyMs: 300 });
  assert.equal(r.gate, 'cluster');
  assert.equal(r.misleading, false);
});
test('genuinely expired (401) => expired (not a false alarm)', () => {
  const r = openParadox({ authHttp: 401, authLatencyMs: 200 });
  assert.equal(r.gate, 'expired');
  assert.equal(r.misleading, false);
});

// --- flapping: one blip flips + lingers -------------------------------------
test('one transient blip flips the row and lingers (retry:false + backoff)', () => {
  const c = pollFlap([{ http: 200 }, { http: 'network-fail' }, { http: 200 }]);
  assert.equal(c[0].label, 'Ready'); // version 200 + auth ok (tracked) => Ready
  assert.equal(c[1].label, 'Unavailable'); // one blip flips it immediately
  assert.equal(c[1].nextPollS, 20); // backoff after 1st failure = 20s
  assert.equal(c[2].label, 'Ready'); // recovers on next success
});

// --- AuthRoute gate order (verified from code) ------------------------------
test('AuthRoute screen order: success->page, error->gate, pending->checking', () => {
  assert.equal(authRouteScreen({ status: 'success' }), 'cluster');
  assert.equal(authRouteScreen({ status: 'error', error: { status: 408 } }), 'unreachable');
  assert.equal(authRouteScreen({ status: 'error', error: { status: 401 } }), 'expired');
  assert.equal(authRouteScreen({ status: 'pending' }), 'checking');
  assert.equal(authRouteScreen({ status: 'error', error: { status: 401 }, authType: 'oidc' }), 'login');
});

// --- return-after-away (2 min / 4 min / 6 min) — the core scenario ----------
test('return at 2 min (fresh): no re-check, page instant', () => {
  const r = returnAfterAway({ awayMs: 2 * 60_000, bgAuthHttp: 200, bgAuthLatencyMs: 6000 });
  assert.equal(r.refetched, false);
  assert.equal(r.screenImmediate, 'cluster');
  assert.equal(r.screenFinal, 'cluster'); // even a slow backend is irrelevant: no re-check runs
});

test('return at 4 min (stale, cached) + fast re-check: page instant, stays', () => {
  const r = returnAfterAway({ awayMs: 4 * 60_000, bgAuthHttp: 200, bgAuthLatencyMs: 300 });
  assert.equal(r.refetched, true);
  assert.equal(r.screenImmediate, 'cluster');
  assert.equal(r.screenFinal, 'cluster');
});

test('CRUX: return at 4 min (stale, cached) + SLOW re-check (6s) => page then GATE', () => {
  const r = returnAfterAway({ awayMs: 4 * 60_000, bgAuthHttp: 200, bgAuthLatencyMs: 6000 });
  assert.equal(r.refetched, true);
  assert.equal(r.screenImmediate, 'cluster'); // shows page from cache first
  assert.equal(r.screenFinal, 'unreachable'); // then flips to "not responding" — token was fine
  assert.equal(r.cold, false);
});

test('return at 6 min (gc-ed): cold "checking" first', () => {
  const rOk = returnAfterAway({ awayMs: 6 * 60_000, bgAuthHttp: 200, bgAuthLatencyMs: 300 });
  assert.equal(rOk.cold, true);
  assert.equal(rOk.screenImmediate, 'checking');
  assert.equal(rOk.screenFinal, 'cluster');

  const rSlow = returnAfterAway({ awayMs: 6 * 60_000, bgAuthHttp: 200, bgAuthLatencyMs: 6000 });
  assert.equal(rSlow.screenImmediate, 'checking');
  assert.equal(rSlow.screenFinal, 'unreachable'); // cold + slow => stuck on checking then gate
});
