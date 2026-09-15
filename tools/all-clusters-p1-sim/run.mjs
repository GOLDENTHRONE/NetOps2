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

/* Run:  node tools/all-clusters-p1-sim/run.mjs
 * Prints BEFORE (current watch) vs AFTER (P1) for the key watch scenarios. */

import { P1, WatchAfter, WatchBefore } from './model.mjs';

const cfg = { ...P1, JITTER_PCT: 0 };
const line = (name, before, after) =>
  console.log(`  ${name.padEnd(30)} BEFORE: ${String(before).padEnd(30)} AFTER: ${after}`);

console.log('\n=== All Clusters P1 watch simulator — BEFORE vs AFTER ===\n');

// W1 single drop
{
  const b = new WatchBefore();
  b.open();
  b.message('rv1');
  b.close();
  b.advance(120000);
  const a = new WatchAfter(cfg);
  a.open();
  a.message('rv1');
  a.close();
  a.advance(1500, { resume: 'ok' });
  line(
    'W1 single drop (2 min later)',
    `${b.freshness()} (reconnects ${b.reconnects})`,
    `${a.freshness()} (reconnects ${a.reconnects})`
  );
}

// W3 silently-dead socket
{
  const b = new WatchBefore();
  b.open();
  b.message('rv1');
  b.advance(120000);
  const a = new WatchAfter(cfg);
  a.open();
  a.message('rv1');
  a.advance(65000);
  line(
    'W3 silent-dead (no close)',
    `refetches ${b.refetches}, age ${b.dataAgeMs()}ms`,
    `refetches ${a.refetches}, age ${a.dataAgeMs()}ms`
  );
}

// W4 410 on resume
{
  const a = new WatchAfter(cfg);
  a.open();
  a.close();
  a.advance(1500, { resume: '410' });
  line('W4 stale bookmark (410)', 'n/a (never redials)', `re-list ${a.reListCount}, ${a.freshness()}`);
}

// W5 unsubscribe mid-reconnect
{
  const a = new WatchAfter(cfg);
  a.open();
  a.close();
  a.unsubscribe();
  a.advance(10000, { resume: 'ok' });
  line('W5 leave page mid-redial', 'n/a', `reconnects ${a.reconnects}, openSockets ${a.openSockets}`);
}

console.log('');
