#!/usr/bin/env node
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

import { AUTH_TIMEOUT, DEFAULT_TIMEOUT } from './finalModel.mjs';
import { openParadox, pollFlap, returnAfterAway } from './finalSim.mjs';

console.log('\n=== Timeout mismatch (verified) ===');
console.log(`  /version: ${DEFAULT_TIMEOUT / 1000}s   testAuth: ${AUTH_TIMEOUT / 1000}s  (24x tighter)\n`);

console.log('=== One transient blip on the Home table (retry:false) ===');
pollFlap([{ http: 200 }, { http: 'network-fail' }, { http: 200 }]).forEach((c, i) =>
  console.log(`  cycle ${i}: ${c.label.padEnd(12)} next poll in ${c.nextPollS}s`)
);

console.log('\n=== Open paradox (valid token) ===');
for (const c of [
  { name: 'fast SAR', authHttp: 200, authLatencyMs: 300 },
  { name: 'slow SAR 6s', authHttp: 200, authLatencyMs: 6000 },
  { name: 'expired 401', authHttp: 401, authLatencyMs: 200 },
]) {
  const r = openParadox(c);
  console.log(`  ${c.name.padEnd(14)} open-> ${r.gate}${r.misleading ? '  ⚠ MISLEADING' : ''}`);
}

console.log('\n=== Return to a cluster page after being away ===');
for (const [label, awayMin, lat] of [
  ['2 min, slow backend', 2, 6000],
  ['4 min, fast re-check', 4, 300],
  ['4 min, SLOW re-check (6s)', 4, 6000],
  ['6 min (cache gone), fast', 6, 300],
  ['6 min (cache gone), slow', 6, 6000],
]) {
  const r = returnAfterAway({ awayMs: awayMin * 60000, bgAuthHttp: 200, bgAuthLatencyMs: lat });
  const flip = r.screenImmediate !== r.screenFinal ? ` -> ${r.screenFinal}` : '';
  const warn = r.screenFinal !== 'cluster' ? '  ⚠' : '';
  console.log(
    `  ${label.padEnd(28)} re-check:${String(r.refetched).padEnd(5)} shows: ${r.screenImmediate}${flip}${warn}`
  );
}
console.log('');
