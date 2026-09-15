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

/* Run:  node --test tools/all-clusters-p1-sim/p1.test.mjs */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P1, WatchAfter, WatchBefore, backoff, withJitter } from './model.mjs';

// deterministic timing: no jitter in tests
const cfg = { ...P1, JITTER_PCT: 0 };

// --- constants / helpers ----------------------------------------------------
test('backoff doubles and caps', () => {
  assert.equal(backoff(0, 1000, 30000), 1000);
  assert.equal(backoff(1, 1000, 30000), 2000);
  assert.equal(backoff(2, 1000, 30000), 4000);
  assert.equal(backoff(10, 1000, 30000), 30000); // capped
});
test('withJitter passthrough at pct 0', () => {
  assert.equal(withJitter(1000, 0), 1000);
});

// --- W1: a single drop on a healthy cluster --------------------------------
test('W1 BEFORE: a dropped watch never recovers (silent stale)', () => {
  const w = new WatchBefore();
  w.open();
  w.message('rv1');
  w.close();
  w.advance(120000); // 2 minutes pass
  assert.equal(w.connected, false);
  assert.equal(w.reconnects, 0);
  assert.equal(w.refetches, 0);
  assert.equal(w.freshness(), 'stale');
});
test('W1 AFTER: a dropped watch auto-reconnects and goes live again', () => {
  const w = new WatchAfter(cfg);
  w.open();
  w.message('rv1');
  w.close(); // schedules reconnect at +1s
  assert.equal(w.freshness(), 'reconnecting');
  w.advance(1500, { resume: 'ok' }); // 1s reconnect fires
  assert.equal(w.connected, true);
  assert.equal(w.reconnects, 1);
  assert.equal(w.freshness(), 'live');
  assert.equal(w.openSockets, 1); // no leak
});

// --- W2: repeated drops back off, no storm ---------------------------------
test('W2 AFTER: repeated failures back off (1s, 2s, 4s) then recover', () => {
  const w = new WatchAfter(cfg);
  w.open();
  w.close(); // attempt scheduled at +1000
  w.advance(1000, { resume: 'fail' }); // attempt 1 fails -> next at +2000
  assert.equal(w.reconnects, 0);
  assert.equal(w.nextReconnectAt, 1000 + 2000);
  w.advance(2000, { resume: 'fail' }); // attempt 2 fails -> next at +4000
  assert.equal(w.nextReconnectAt, 3000 + 4000);
  w.advance(4000, { resume: 'ok' }); // attempt 3 succeeds
  assert.equal(w.connected, true);
  assert.equal(w.reconnects, 1);
});

// --- W3: socket silently dead (no close) -> safety-net refetch heals -------
test('W3 BEFORE: a silently-dead socket is never refreshed', () => {
  const w = new WatchBefore();
  w.open();
  w.message('rv1');
  w.advance(120000); // no close event; nothing refreshes
  assert.equal(w.refetches, 0);
});
test('W3 AFTER: the safety-net refetch refreshes within the fallback window', () => {
  const w = new WatchAfter(cfg); // FALLBACK_REFETCH_MS = 60000
  w.open();
  w.message('rv1');
  w.advance(65000); // no close, but the 60s fallback fires
  assert.ok(w.refetches >= 1);
  assert.ok(w.dataAgeMs() < 60000); // data was refreshed, not 65s stale
});

// --- W4: resume bookmark too old (410) -> fresh re-list --------------------
test('W4 AFTER: a 410 on resume triggers a fresh re-list, then live', () => {
  const w = new WatchAfter(cfg);
  w.open();
  w.close();
  w.advance(1500, { resume: '410' });
  assert.equal(w.reListCount, 1);
  assert.equal(w.connected, true);
  assert.equal(w.lastRV, 'rv-fresh');
});

// --- W5: unsubscribe mid-reconnect -> loop stops, no leak ------------------
test('W5 AFTER: unsubscribing during reconnect stops the loop (no leaked socket)', () => {
  const w = new WatchAfter(cfg);
  w.open();
  w.close(); // reconnect scheduled
  w.unsubscribe(); // user left the page
  w.advance(10000, { resume: 'ok' });
  assert.equal(w.reconnects, 0); // never redialed after unsubscribe
  assert.equal(w.openSockets, 0); // nothing left open
  assert.equal(w.freshness(), 'stopped');
});

// --- W6: freshness state transitions ---------------------------------------
test('W6 AFTER: freshness goes live -> reconnecting -> live', () => {
  const w = new WatchAfter(cfg);
  w.open();
  assert.equal(w.freshness(), 'live');
  w.close();
  assert.equal(w.freshness(), 'reconnecting');
  w.advance(1500, { resume: 'ok' });
  assert.equal(w.freshness(), 'live');
});

// --- Positive: normal live updates unaffected ------------------------------
test('P1+ AFTER: a healthy watch just stays live as updates arrive', () => {
  const w = new WatchAfter(cfg);
  w.open();
  w.advance(30000);
  w.message('rv2');
  w.advance(30000);
  assert.equal(w.connected, true);
  assert.equal(w.freshness(), 'live');
  assert.equal(w.reListCount, 0);
});

// --- reconnect OFF (config rollback) behaves like BEFORE --------------------
test('config: RECONNECT off -> a drop stays stale (rollback path)', () => {
  const w = new WatchAfter({ ...cfg, RECONNECT: false, FALLBACK_REFETCH_MS: 0 });
  w.open();
  w.close();
  w.advance(120000);
  assert.equal(w.connected, false);
  assert.equal(w.reconnects, 0);
  assert.equal(w.freshness(), 'stale');
});
