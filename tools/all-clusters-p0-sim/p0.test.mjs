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

/* Run:  node --test tools/all-clusters-p0-sim/p0.test.mjs */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTH_TIMEOUT,
  GC_TIME,
  P0,
  STALE_TIME,
  jitterBounds,
} from './model.mjs';
import {
  f1_tableBlip,
  f2_openSlowAuth,
  f3_returnFourMinBlip,
  f4_genuinelyDown,
  f5_expired,
  pPositive,
  returnAfterAway,
} from './flows.mjs';

// --- verified constants (baseline STEP V0) ----------------------------------
test('constants match the verified code baseline', () => {
  assert.equal(AUTH_TIMEOUT, 5000); // clusterApi.ts:38-41 (before)
  assert.equal(STALE_TIME, 180000); // queryClient.ts:22
  assert.equal(GC_TIME, 300000); // v5 default
  assert.equal(P0.AUTH_TIMEOUT_MS, 15000); // P0: 5s -> 15s
  assert.equal(P0.STATUS_FAIL_THRESHOLD, 2);
  assert.equal(P0.OPEN_GATE_RETRY, 1);
});

test('P0 poll backoff gains +/-15% jitter bounds', () => {
  assert.deepEqual(jitterBounds(10000), { min: 8500, max: 11500 });
  assert.deepEqual(jitterBounds(20000), { min: 17000, max: 23000 });
});

// ============================ NEGATIVE FLOWS ================================

test('F1 table + one blip: BEFORE flickers, AFTER stays Ready', () => {
  const r = f1_tableBlip();
  assert.deepEqual(r.before, ['Ready', 'Unavailable', 'Ready']); // flicker (bug)
  assert.deepEqual(r.afterLabel, ['Ready', 'Ready', 'Ready']); // stable (fixed)
});

test('F2 open slow auth (6s), valid token: BEFORE gate, AFTER opens', () => {
  const r = f2_openSlowAuth(6000);
  assert.equal(r.before, 'unreachable'); // 5s timeout -> 408 -> gate
  assert.equal(r.after, 'cluster'); // 15s covers it -> opens
  // a genuinely dead-slow (>15s) auth still fails after, honestly:
  assert.equal(f2_openSlowAuth(16000).after, 'unreachable');
});

test('F3 return 4min, background re-check blips: BEFORE gate, AFTER page kept', () => {
  const r = f3_returnFourMinBlip();
  assert.equal(r.before.immediate, 'cluster');
  assert.equal(r.before.final, 'unreachable'); // THE bug: success -> gate
  assert.equal(r.after.immediate, 'cluster');
  assert.equal(r.after.final, 'cluster-reconnecting'); // fixed: page + chip
});

test('F4 genuinely down: AFTER keeps last-good ONCE then honestly gates (bounded)', () => {
  const r = f4_genuinelyDown();
  assert.equal(r.before[0], 'unreachable'); // before gates on the 1st fail
  assert.equal(r.after[0], 'cluster-reconnecting'); // after tolerates fail #1
  assert.equal(r.after[1], 'unreachable'); // fail #2 -> honest gate (not infinite)
  assert.equal(r.after[2], 'unreachable');
});

test('F5 token expired/revoked: AFTER shows it IMMEDIATELY (security, no hiding)', () => {
  assert.equal(f5_expired(401).before, 'expired');
  assert.equal(f5_expired(401).after, 'expired'); // keep-last-good must NOT hide 401
  assert.equal(f5_expired(403).before, 'forbidden');
  assert.equal(f5_expired(403).after, 'forbidden');
});

// ============================ POSITIVE FLOWS ================================
// These MUST be unchanged by P0 (before === after).

test('P+1/P+3/P+5 positive flows unchanged (before === after)', () => {
  const p = pPositive();
  assert.equal(p.p1.before, 'cluster');
  assert.equal(p.p1.after, 'cluster'); // fast open unaffected
  assert.equal(p.p3.before, 'checking');
  assert.equal(p.p3.after, 'checking'); // first-open in-flight unaffected
  assert.equal(p.p5.before, 'login');
  assert.equal(p.p5.after, 'login'); // OIDC redirect unchanged
});

// ==================== RETURN-AFTER-AWAY LIFECYCLE ==========================

test('return 2min (fresh cache): instant, no re-check — before === after', () => {
  const r = returnAfterAway({ awayMs: 2 * 60_000, bgHttp: 200, bgLatencyMs: 6000 });
  assert.equal(r.before.refetched, false);
  assert.equal(r.before.final, 'cluster');
  assert.equal(r.after.final, 'cluster');
});

test('return 4min (stale) + fast re-check: page instant, stays — both fine', () => {
  const r = returnAfterAway({ awayMs: 4 * 60_000, bgHttp: 200, bgLatencyMs: 300 });
  assert.equal(r.before.refetched, true);
  assert.equal(r.before.final, 'cluster');
  assert.equal(r.after.final, 'cluster');
});

test('CRUX return 4min (stale) + blip re-check: BEFORE gate, AFTER keeps page', () => {
  const r = returnAfterAway({ awayMs: 4 * 60_000, bgHttp: 'network-fail', bgLatencyMs: 300 });
  assert.equal(r.before.immediate, 'cluster');
  assert.equal(r.before.final, 'unreachable'); // the reproduced bug
  assert.equal(r.after.immediate, 'cluster');
  assert.equal(r.after.final, 'cluster-reconnecting'); // fixed
  assert.equal(r.after.cold, false);
});

test('return 6min (cold) + slow(6s) re-check: BEFORE gate, AFTER opens via 15s timeout', () => {
  const r = returnAfterAway({ awayMs: 6 * 60_000, bgHttp: 200, bgLatencyMs: 6000 });
  assert.equal(r.before.cold, true);
  assert.equal(r.before.immediate, 'checking');
  assert.equal(r.before.final, 'unreachable'); // 5s timeout trips
  assert.equal(r.after.immediate, 'checking');
  assert.equal(r.after.final, 'cluster'); // 15s timeout covers the 6s call
});

test('return 6min (cold) + genuine fail: BEFORE === AFTER honest gate (no cache to keep)', () => {
  const r = returnAfterAway({ awayMs: 6 * 60_000, bgHttp: 'network-fail', bgLatencyMs: 300 });
  assert.equal(r.before.final, 'unreachable');
  assert.equal(r.after.final, 'unreachable'); // keep-last-good does NOT apply when gc-ed
});
