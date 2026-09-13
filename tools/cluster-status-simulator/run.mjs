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
 * run.mjs — CLI to print the "All Clusters" table and the open() outcomes for
 * the whole generic fleet.  Usage:
 *
 *   node tools/cluster-status-simulator/run.mjs            # all scenarios
 *   node tools/cluster-status-simulator/run.mjs <name>     # one scenario
 *   node tools/cluster-status-simulator/run.mjs --backoff  # show backoff timeline
 */

import { ClusterSim, backoffTimeline } from './simulator.mjs';
import { scenarios, scenarioNames } from './scenarios.mjs';

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printTable() {
  console.log('\n=== "All Clusters" table (simulated, connected clusters) ===\n');
  console.log(
    pad('Name', 24),
    pad('Status', 26),
    pad('Warn', 5),
    pad('OCP', 10),
    pad('K8s Version', 20)
  );
  console.log('-'.repeat(90));
  for (const key of scenarioNames) {
    const isConnected = key !== 'configured-not-connected';
    const row = new ClusterSim(scenarios[key]).renderRow(isConnected);
    console.log(
      pad(row.name, 24),
      pad(row.status, 26),
      pad(row.warnings || '·', 5),
      pad(row.ocpVersion || '·', 10),
      pad(row.kubernetesVersion || '·', 20)
    );
  }
}

function printOpenFlows() {
  console.log('\n=== Opening each cluster (the SECOND, independent auth probe) ===\n');
  for (const key of scenarioNames) {
    const isConnected = key !== 'configured-not-connected';
    const sim = new ClusterSim(scenarios[key]);
    const { row, open, gap } = sim.story(isConnected);
    const flag = gap === 'consistent' ? '  ok ' : ' ⚠︎  ';
    console.log(`${flag}${pad(row.name, 24)} table="${row.status}"  ->  open: ${open.screens.join(' -> ')}`);
    if (gap !== 'consistent') console.log(`       ${gap}`);
  }
}

function printBackoff() {
  console.log('\n=== /version failure backoff (consecutive failures -> next poll) ===\n');
  const t = backoffTimeline(5);
  t.forEach((ms, i) => console.log(`  ${i} failure(s): ${ms / 1000}s`));
}

const arg = process.argv[2];
if (arg === '--backoff') {
  printBackoff();
} else if (arg && scenarios[arg]) {
  const isConnected = arg !== 'configured-not-connected';
  console.log(JSON.stringify(new ClusterSim(scenarios[arg]).story(isConnected), null, 2));
} else if (arg) {
  console.error(`Unknown scenario "${arg}". Known:\n  ${scenarioNames.join('\n  ')}`);
  process.exit(1);
} else {
  printTable();
  printOpenFlows();
  printBackoff();
  console.log('');
}
