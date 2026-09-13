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
 * Rigorous tests for the simulator. Run with:  node --test tools/cluster-status-simulator/
 *
 * These assert (a) the ported pure logic matches the real source, and (b) the
 * simulator reproduces the observed "Active-then-auth-screen" behaviour and the
 * backoff/versioning/warnings rules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getClusterStatus,
  getClusterStatusLabel,
  canSelectCluster,
  getClusterStatusInfo,
  versionRefetchInterval,
  versionFetchInterval,
  maxVersionFetchInterval,
  renderWarningsText,
  maxWarnings,
  deriveStatusCell,
  deriveVersionCell,
  deriveOcpCell,
  deriveWarningsCell,
  routeAuthOutcome,
} from './clusterStatusModel.mjs';

import { ClusterSim, toApiError, backoffTimeline } from './simulator.mjs';
import { scenarios, scenarioNames } from './scenarios.mjs';

// --- getClusterStatus mapping ----------------------------------------------

test('getClusterStatus maps every probe result exactly as clusterStatus.ts', () => {
  assert.equal(getClusterStatus(undefined), 'loading');
  assert.equal(getClusterStatus(null), 'active');
  assert.equal(getClusterStatus({ status: 401 }), 'auth-error');
  assert.equal(getClusterStatus({ status: 403 }), 'permission-error');
  assert.equal(getClusterStatus({ status: 502 }), 'unavailable');
  assert.equal(getClusterStatus({ status: 404 }), 'unavailable');
  assert.equal(getClusterStatus({ status: 408 }), 'unavailable'); // timeout
  assert.equal(getClusterStatus({ status: 500 }), 'unavailable');
});

test('getClusterStatusLabel returns the human labels', () => {
  assert.equal(getClusterStatusLabel(null), 'Active');
  assert.equal(getClusterStatusLabel({ status: 401 }), 'Authentication required');
  assert.equal(getClusterStatusLabel({ status: 403 }), 'Insufficient permissions');
  assert.equal(getClusterStatusLabel({ status: 502 }), 'Unavailable');
  assert.equal(getClusterStatusLabel(undefined), '⋯');
});

test('canSelectCluster is true only for active', () => {
  assert.equal(canSelectCluster(null), true);
  assert.equal(canSelectCluster(undefined), false);
  assert.equal(canSelectCluster({ status: 401 }), false);
  assert.equal(canSelectCluster({ status: 502 }), false);
});

// --- Cluster-Inventory-aware status ----------------------------------------

test('control-plane False overrides an otherwise-active probe', () => {
  const info = getClusterStatusInfo({ controlPlaneHealthy: 'False' }, null);
  assert.deepEqual(info, { kind: 'error', text: 'Control plane unhealthy' });
});

test('errors still surface even when control-plane is False-less', () => {
  assert.equal(getClusterStatusInfo({}, { status: 401 }).kind, 'error');
  assert.equal(getClusterStatusInfo({}, { status: 401 }).text, 'Authentication required');
});

test('loading / Unknown condition => unknown ⋯', () => {
  assert.equal(getClusterStatusInfo({}, undefined).text, '⋯');
  assert.equal(getClusterStatusInfo({ controlPlaneHealthy: 'Unknown' }, null).text, '⋯');
});

// --- backoff ----------------------------------------------------------------

test('versionRefetchInterval backs off 10 -> 20 -> 40 -> 60 (capped)', () => {
  assert.equal(versionRefetchInterval(0), 10000);
  assert.equal(versionRefetchInterval(1), 20000);
  assert.equal(versionRefetchInterval(2), 40000);
  assert.equal(versionRefetchInterval(3), 60000);
  assert.equal(versionRefetchInterval(4), 60000); // capped
  assert.equal(versionRefetchInterval(10), maxVersionFetchInterval);
  assert.equal(maxVersionFetchInterval, versionFetchInterval * 6);
});

test('backoffTimeline yields the documented sequence', () => {
  assert.deepEqual(backoffTimeline(4), [10000, 20000, 40000, 60000, 60000]);
});

// --- warnings ---------------------------------------------------------------

test('renderWarningsText caps at 50+ and shows ⋯ for missing/errored', () => {
  assert.equal(renderWarningsText(undefined), '⋯');
  assert.equal(renderWarningsText({ error: true }), '⋯');
  assert.equal(renderWarningsText({ warnings: 0 }), '0');
  assert.equal(renderWarningsText({ warnings: 49 }), '49');
  assert.equal(renderWarningsText({ warnings: 50 }), `${maxWarnings}+`);
  assert.equal(renderWarningsText({ warnings: 999 }), `${maxWarnings}+`);
});

// --- toApiError -------------------------------------------------------------

test('toApiError normalises probe responses', () => {
  assert.equal(toApiError(200), null);
  assert.equal(toApiError(null), undefined);
  assert.equal(toApiError(undefined), undefined);
  assert.deepEqual(toApiError('timeout'), { status: 408, message: 'Request timed-out' });
  assert.equal(toApiError(502).status, 502);
  assert.equal(toApiError(401).status, 401);
});

// --- table cell derivation --------------------------------------------------

test('unconnected + never-probed => Not connected, cells blank', () => {
  const cell = deriveStatusCell({ name: 'c' }, undefined, false);
  assert.equal(cell.state, 'not-connected');
  assert.equal(cell.label, 'Not connected');
  assert.equal(cell.canOpen, true);
  assert.equal(deriveVersionCell(undefined, false), '');
  assert.equal(deriveOcpCell(undefined, false), '');
  assert.equal(deriveWarningsCell(undefined, false), '');
});

test('connected + pending probe => Connecting…, and opening is blocked', () => {
  const cell = deriveStatusCell({ name: 'c' }, undefined, true);
  assert.equal(cell.state, 'connecting');
  assert.equal(cell.label, 'Connecting…');
  assert.equal(cell.canOpen, false);
});

test('OCP ⋯ for a plain cluster is not an error', () => {
  // Connected, /version 200, but OCP endpoint 404 => cell shows ⋯.
  assert.equal(deriveOcpCell(undefined, true), '⋯');
  assert.equal(deriveVersionCell({ gitVersion: 'v1.30.0+placeholder' }, true), 'v1.30.0+placeholder');
});

// --- routeAuthOutcome (the open-cluster gate) ------------------------------

test('open gate: pending => connecting screen', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'token', auth: { state: 'pending' } }).screen,
    'connecting'
  );
});

test('open gate: success => cluster', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'token', auth: { state: 'success' } }).screen,
    'cluster'
  );
});

test('open gate: 401/403 on token cluster => token screen', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'token', auth: { state: 'error', status: 401 } }).screen,
    'token'
  );
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'token', auth: { state: 'error', status: 403 } }).screen,
    'token'
  );
});

test('open gate: timeout/other error => login screen', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'token', auth: { state: 'error', status: 408 } }).screen,
    'login'
  );
});

test('open gate: oidc cluster always redirects to login on error', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: 'c', authType: 'oidc', auth: { state: 'error', status: 401 } }).screen,
    'login'
  );
});

test('open gate: no cluster => chooser', () => {
  assert.equal(
    routeAuthOutcome({ currentCluster: null, auth: { state: 'error', status: 401 } }).screen,
    'chooser'
  );
});

test('open gate: multi-select short-circuits to cluster', () => {
  assert.equal(
    routeAuthOutcome({
      currentCluster: 'c',
      authType: 'token',
      selectedClusterCount: 2,
      auth: { state: 'error', status: 401 },
    }).screen,
    'cluster'
  );
});

// --- the crux: Active in table vs. failure on open -------------------------

test('THE GAP: a cluster can read "Active" and still fail on open', () => {
  const sim = new ClusterSim(scenarios['active-but-open-auth-401']);
  const { row, open, gap } = sim.story(true);
  assert.equal(row.status, 'Active');
  assert.deepEqual(open.screens, ['connecting', 'token']);
  assert.match(gap, /MISMATCH/);
});

test('timeout variant: Active then connecting -> login', () => {
  const sim = new ClusterSim(scenarios['active-but-open-timeout']);
  const { row, open } = sim.story(true);
  assert.equal(row.status, 'Active');
  assert.deepEqual(open.screens, ['connecting', 'login']);
});

test('happy path is fully consistent', () => {
  const sim = new ClusterSim(scenarios['openshift-healthy-authorized']);
  const { row, open, gap } = sim.story(true);
  assert.equal(row.status, 'Active');
  assert.equal(row.ocpVersion, '4.16.0');
  assert.equal(open.final, 'cluster');
  assert.equal(gap, 'consistent');
});

// --- fleet-level invariants -------------------------------------------------

test('every scenario renders a row without throwing', () => {
  for (const key of scenarioNames) {
    const isConnected = key !== 'configured-not-connected';
    const row = new ClusterSim(scenarios[key]).renderRow(isConnected);
    assert.ok(typeof row.status === 'string' && row.status.length > 0, `${key} has a status`);
  }
});

test('unreachable cluster shows Unavailable and blank versions', () => {
  const row = new ClusterSim(scenarios['unreachable-502']).renderRow(true);
  assert.equal(row.status, 'Unavailable');
  assert.equal(row.kubernetesVersion, '⋯');
  assert.equal(row.ocpVersion, '⋯');
});

test('permission error shows Insufficient permissions', () => {
  const row = new ClusterSim(scenarios['permission-error-403']).renderRow(true);
  assert.equal(row.status, 'Insufficient permissions');
});

test('not-connected scenario shows Not connected and blank cells', () => {
  const row = new ClusterSim(scenarios['configured-not-connected']).renderRow(false);
  assert.equal(row.status, 'Not connected');
  assert.equal(row.kubernetesVersion, '');
  assert.equal(row.warnings, '');
});

test('control-plane-unhealthy overrides Active and caps warnings at 50+', () => {
  const row = new ClusterSim(scenarios['control-plane-unhealthy']).renderRow(true);
  assert.equal(row.status, 'Control plane unhealthy');
  assert.equal(row.warnings, `${maxWarnings}+`);
  assert.equal(row.warningsLive, false); // watch failed => count is a snapshot
});

test('warnings watch failure is surfaced as not-live', () => {
  const live = new ClusterSim(scenarios['openshift-healthy-authorized']).renderRow(true);
  assert.equal(live.warningsLive, true);
});
