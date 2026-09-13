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

/*
 * run.mjs — print the reachability simulations.
 *   node tools/all-clusters-reachability-sim/run.mjs
 */

import { AUTH_TIMEOUT, DEFAULT_TIMEOUT } from './reachabilityModel.mjs';
import { lingerAfterSingleBlip, openParadox, runStatusPoll } from './reachabilitySim.mjs';

function line() {
  console.log('-'.repeat(76));
}

console.log('\n=== Timeout mismatch (the root of most surprises) ===\n');
console.log(`  /version (reachability): ${DEFAULT_TIMEOUT / 1000}s timeout`);
console.log(`  testAuth  (open + Ready): ${AUTH_TIMEOUT / 1000}s timeout   <-- 24x tighter`);

console.log('\n=== Scenario A: healthy cluster, one 1-cycle network blip ===');
console.log('(valid token throughout; /version succeeds except one tick)\n');
const blip = runStatusPoll([
  { http: 200 },
  { http: 200 },
  { http: 'network-fail' }, // a single transient blip
  { http: 200 },
  { http: 200 },
]);
blip.forEach((c, i) =>
  console.log(
    `  cycle ${i}: ${c.label.padEnd(14)} (failures=${c.consecutiveFailures}, next poll in ${
      c.nextPollInMs / 1000
    }s)`
  )
);
console.log(
  `\n  -> ONE blip flips the row to "${blip[2].label}". With retry:false it stays wrong`
);
console.log(
  `     until the next poll ~${lingerAfterSingleBlip() / 1000}s later. The token never expired.`
);

console.log('\n=== Scenario B: repeated failures -> backoff makes it linger longer ===\n');
const outage = runStatusPoll([
  { http: 200 },
  { http: 'network-fail' },
  { http: 'network-fail' },
  { http: 'network-fail' },
  { http: 200 },
]);
outage.forEach((c, i) =>
  console.log(
    `  cycle ${i}: ${c.label.padEnd(14)} (failures=${c.consecutiveFailures}, next poll in ${
      c.nextPollInMs / 1000
    }s)`
  )
);
console.log(
  '\n  -> After 3 failures the next check is 60s away, so recovery can take up to a minute.'
);

console.log('\n=== Scenario C: the "token is fine but it says not reachable" paradox ===\n');
line();
const cases = [
  { name: 'fast & authorized', versionHttp: 200, authHttp: 200, authLatencyMs: 300 },
  { name: 'slow SAR (6s), token VALID', versionHttp: 200, authHttp: 200, authLatencyMs: 6000 },
  { name: 'genuinely expired (401)', versionHttp: 200, authHttp: 401, authLatencyMs: 300 },
  { name: 'slow SAR on OIDC cluster', versionHttp: 200, authHttp: 200, authLatencyMs: 6000, authType: 'oidc' },
];
for (const c of cases) {
  const r = openParadox(c);
  const flag = r.misleading ? ' ⚠︎ MISLEADING' : '';
  console.log(
    `  ${c.name.padEnd(30)} row="${r.rowLabel}"  open-> ${r.gate}${flag}`
  );
}
line();
console.log(
  '\n  -> Row "Ready", token VALID, but a 6s auth call (> 5s timeout) opens onto'
);
console.log('     "This cluster is not responding". Nothing is actually wrong.\n');
