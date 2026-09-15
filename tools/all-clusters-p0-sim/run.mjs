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

/* Run:  node tools/all-clusters-p0-sim/run.mjs
 * Prints the BEFORE (current code) vs AFTER (P0) outcome for every scenario. */

import {
  f1_tableBlip,
  f2_openSlowAuth,
  f3_returnFourMinBlip,
  f4_genuinelyDown,
  f5_expired,
  pPositive,
  returnAfterAway,
} from './flows.mjs';

const line = (name, before, after, note = '') =>
  console.log(
    `  ${name.padEnd(34)} BEFORE: ${String(before).padEnd(26)} AFTER: ${String(after).padEnd(26)} ${note}`
  );

console.log('\n=== All Clusters P0 simulator — BEFORE (current) vs AFTER (P0) ===\n');
console.log('NEGATIVE FLOWS (bug before -> fixed after):');
const f1 = f1_tableBlip();
line('F1 table + 1 blip', f1.before.join('>'), f1.afterLabel.join('>'), '(flicker -> stable)');
const f2 = f2_openSlowAuth(6000);
line('F2 open slow auth 6s (valid)', f2.before, f2.after, '(5s timeout -> 15s ok)');
const f3 = f3_returnFourMinBlip();
line('F3 return 4min, re-check blip', f3.before.final, f3.after.final, '(gate -> page kept)');
const f4 = f4_genuinelyDown();
line('F4 genuinely down (x3)', f4.before.join(','), f4.after.join(','), '(bounded: fails on #2)');
line('F5 token expired (401)', f5_expired(401).before, f5_expired(401).after, '(immediate both — safe)');

console.log('\nPOSITIVE FLOWS (must be unchanged, before === after):');
const p = pPositive();
line('P+1 valid + fast open', p.p1.before, p.p1.after);
line('P+3 first open, in flight', p.p3.before, p.p3.after);
line('P+5 OIDC expired', p.p5.before, p.p5.after);

console.log('\nRETURN-AFTER-AWAY LIFECYCLE (cache 3min fresh / 5min gc):');
for (const [label, opts] of [
  ['2min fresh', { awayMs: 2 * 60_000, bgHttp: 200, bgLatencyMs: 6000 }],
  ['4min stale + blip', { awayMs: 4 * 60_000, bgHttp: 'network-fail', bgLatencyMs: 300 }],
  ['6min cold + slow 6s', { awayMs: 6 * 60_000, bgHttp: 200, bgLatencyMs: 6000 }],
  ['6min cold + fail', { awayMs: 6 * 60_000, bgHttp: 'network-fail', bgLatencyMs: 300 }],
]) {
  const r = returnAfterAway(opts);
  line('return ' + label, r.before.final, r.after.final);
}
console.log('');
