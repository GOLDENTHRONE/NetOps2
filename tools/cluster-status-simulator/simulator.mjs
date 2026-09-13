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
 * ---------------------------------------------------------------------------
 * simulator.mjs — the "All Clusters" behaviour simulator
 *
 * Reproduces, deterministically and with generic data, the exact behaviour the
 * live investigation observed:
 *
 *   1. A cluster row is driven by TWO independent probes at TWO different times:
 *        - the table Status probe:  GET  /clusters/{c}/version        (10s poll)
 *        - the open-cluster probe:  POST .../selfsubjectrulesreviews  (on click)
 *      They can disagree, which is why a cluster can read "Active" and then, on
 *      open, show "Connecting… -> Authentication".
 *
 *   2. Failed /version polling backs off 10s -> 20 -> 40 -> 60 (cap).
 *
 * This file has NO app/framework dependencies so it runs under plain `node`.
 * ---------------------------------------------------------------------------
 */

import {
  deriveStatusCell,
  deriveVersionCell,
  deriveOcpCell,
  deriveWarningsCell,
  routeAuthOutcome,
  versionRefetchInterval,
} from './clusterStatusModel.mjs';

/**
 * Turn an HTTP-ish probe response into the ApiError shape the model consumes.
 *   200            -> null   (success)
 *   404            -> {status:404} (treated as "unavailable" for /version,
 *                     and as "not OpenShift" for the OCP query)
 *   401/403/5xx/... -> {status}
 *   'timeout'      -> {status:408}
 *   null/undefined -> undefined (not resolved yet)
 * @param {number|'timeout'|null|undefined} http
 */
export function toApiError(http) {
  if (http === null || http === undefined) return undefined;
  if (http === 200) return null;
  if (http === 'timeout') return { status: 408, message: 'Request timed-out' };
  return { status: http, message: `HTTP ${http}` };
}

/**
 * A ClusterSim models one row plus its open() behaviour.
 *
 * @param {object} spec
 * @param {string} spec.name                 generic display name
 * @param {'plain-k8s'|'openshift'} [spec.kind]
 * @param {'token'|'oidc'} [spec.authType]
 * @param {string} [spec.controlPlaneHealthy]  'True' | 'False' | 'Unknown'
 * @param {object} spec.probes
 * @param {number|'timeout'|null} spec.probes.version  the /version status probe result
 * @param {string} [spec.probes.gitVersion]            gitVersion string when 200
 * @param {number|'timeout'|null} [spec.probes.ocp]    OCP ClusterVersion query result
 * @param {string} [spec.probes.ocpVersion]            desired version when OCP 200
 * @param {number|'timeout'|null} [spec.probes.warningsList]  the /events list result
 * @param {number} [spec.probes.warningCount]          number of warning events
 * @param {boolean} [spec.probes.warningsWatch]        whether the live watch connected
 * @param {number|'timeout'} spec.probes.openAuth      testAuth (selfsubjectrulesreviews) result
 */
export class ClusterSim {
  constructor(spec) {
    this.spec = spec;
    this.name = spec.name;
  }

  /**
   * Render the table row exactly as the "All Clusters" table would, for a given
   * connection state.
   * @param {boolean} isConnected whether the cluster is in the polling set
   */
  renderRow(isConnected) {
    const { spec } = this;
    const versionErr = toApiError(spec.probes.version);
    const cluster = { name: spec.name, controlPlaneHealthy: spec.controlPlaneHealthy };

    const status = deriveStatusCell(cluster, versionErr, isConnected);

    // Warnings: only fetched for connected clusters; a failed list => '⋯'.
    const warningResult =
      spec.probes.warningsList === undefined
        ? undefined
        : spec.probes.warningsList === 200
        ? { warnings: spec.probes.warningCount ?? 0 }
        : { error: true };

    // OCP: a non-OpenShift cluster's endpoint 404s and is shown as '⋯', which
    // the model treats as "no OCP version" (not an error).
    const ocpVersion =
      spec.probes.ocp === 200 ? spec.probes.ocpVersion : undefined;

    return {
      name: spec.name,
      status: status.label,
      statusState: status.state,
      canOpen: status.canOpen,
      warnings: deriveWarningsCell(warningResult, isConnected),
      ocpVersion: deriveOcpCell(ocpVersion, isConnected),
      kubernetesVersion: deriveVersionCell(
        spec.probes.version === 200 ? { gitVersion: spec.probes.gitVersion } : undefined,
        isConnected
      ),
      // Freshness note: warnings keep updating only if the watch connected.
      warningsLive: isConnected ? spec.probes.warningsWatch !== false : undefined,
    };
  }

  /**
   * Simulate the user opening the cluster from the table. This runs the SECOND,
   * independent testAuth probe and returns the sequence of screens the user
   * would see (the Connecting screen is always shown while pending).
   * @param {{selectedClusterCount?: number}} [opts]
   */
  open(opts = {}) {
    const { spec } = this;
    const openHttp = spec.probes.openAuth;

    // While pending the router shows the Connecting screen...
    const pending = routeAuthOutcome({
      currentCluster: spec.name,
      authType: spec.authType,
      selectedClusterCount: opts.selectedClusterCount ?? 1,
      auth: { state: 'pending' },
    });

    // ...then the probe resolves.
    let resolved;
    if (openHttp === 200) {
      resolved = { state: 'success' };
    } else if (openHttp === 'timeout') {
      resolved = { state: 'error', status: 408 };
    } else {
      resolved = { state: 'error', status: openHttp };
    }

    const final = routeAuthOutcome({
      currentCluster: spec.name,
      authType: spec.authType,
      selectedClusterCount: opts.selectedClusterCount ?? 1,
      auth: resolved,
    });

    const screens = [pending.screen];
    if (final.screen !== pending.screen) screens.push(final.screen);
    return { screens, final: final.screen };
  }

  /**
   * The user-visible "story": what the table says vs. what opening does. This is
   * the crux of the whole investigation — the mismatch, made explicit.
   * @param {boolean} isConnected
   */
  story(isConnected) {
    const row = this.renderRow(isConnected);
    const open = this.open();
    const gap =
      row.statusState === 'active' && open.final !== 'cluster'
        ? `MISMATCH: table says "Active" but opening ends on "${open.final}"`
        : 'consistent';
    return { row, open, gap };
  }
}

/**
 * Produce the failure-backoff timeline of poll intervals for `n` consecutive
 * failures, e.g. [10000, 20000, 40000, 60000, 60000].
 * @param {number} n
 */
export function backoffTimeline(n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(versionRefetchInterval(i));
  return out;
}
