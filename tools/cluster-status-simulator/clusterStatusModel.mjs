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
 * clusterStatusModel.mjs
 *
 * A faithful, dependency-free port of the pure decision logic that drives the
 * "All Clusters" tab. Each function mirrors a specific place in the real source
 * so the simulator's behaviour can be trusted to match the app. Source anchors:
 *
 *   - getClusterStatus / getClusterStatusLabel / canSelectCluster
 *       frontend/src/components/App/Home/clusterStatus.ts
 *   - getClusterStatusInfo (Cluster-Inventory-aware label)
 *       frontend/src/components/App/Home/ClusterInventory/index.ts
 *   - versionFetchInterval / maxVersionFetchInterval / versionRefetchInterval
 *       frontend/src/lib/k8s/index.ts
 *   - deriveStatusCell / warnings / version / ocp accessors
 *       frontend/src/components/App/Home/ClusterTable.tsx
 *   - renderWarningsText (cap at 50+)
 *       frontend/src/components/App/Home/index.tsx
 *   - routeAuthOutcome (the "open the cluster" auth gate)
 *       frontend/src/components/App/RouteSwitcher.tsx  (AuthRoute)
 *
 * NOTE ON DATA: every value here is generic. No real cluster names, hostnames,
 * tokens, or namespaces appear anywhere in this tool.
 * ---------------------------------------------------------------------------
 */

/**
 * An ApiError shape as produced by the request layer. `status` is the HTTP
 * status code (or 408 for a client-side timeout / AbortError).
 * @typedef {{status?: number, message?: string} | null | undefined} ApiError
 */

// --- clusterStatus.ts -------------------------------------------------------

/**
 * Maps a probe result to a status state.
 *   undefined => not resolved yet ("loading")
 *   null      => success ("active")
 *   401       => "auth-error"
 *   403       => "permission-error"
 *   anything else => "unavailable"
 * @param {ApiError} error
 * @returns {'active'|'auth-error'|'loading'|'permission-error'|'unavailable'}
 */
export function getClusterStatus(error) {
  if (error === undefined) {
    return 'loading';
  }
  if (error === null) {
    return 'active';
  }
  if (error.status === 401) {
    return 'auth-error';
  }
  if (error.status === 403) {
    return 'permission-error';
  }
  return 'unavailable';
}

/** Only an "active" (successful /version) cluster is row-selectable. */
export function canSelectCluster(error) {
  return getClusterStatus(error) === 'active';
}

/** Human labels. `t` is identity here; the real app translates these keys. */
export function getClusterStatusLabel(error) {
  const status = getClusterStatus(error);
  if (status === 'active') return 'Active';
  if (status === 'auth-error') return 'Authentication required';
  if (status === 'permission-error') return 'Insufficient permissions';
  if (status === 'unavailable') return 'Unavailable';
  return '⋯';
}

// --- ClusterInventory/index.ts ---------------------------------------------

/**
 * Cluster-Inventory-aware status. If the cluster carries a control-plane
 * health condition of "False", it wins over the probe result.
 * @param {{controlPlaneHealthy?: 'True'|'False'|'Unknown'}} cluster
 * @param {ApiError} error
 */
export function getClusterStatusInfo(cluster, error) {
  const condition = cluster?.controlPlaneHealthy;

  if (condition === 'False') {
    return { kind: 'error', text: 'Control plane unhealthy' };
  }

  const status = getClusterStatus(error);
  if (status === 'auth-error' || status === 'permission-error' || status === 'unavailable') {
    return { kind: 'error', text: getClusterStatusLabel(error) };
  }

  if (condition === 'Unknown' || status === 'loading') {
    return { kind: 'unknown', text: '⋯' };
  }

  return { kind: 'active', text: getClusterStatusLabel(error) };
}

// --- lib/k8s/index.ts (polling cadence + backoff) --------------------------

export const versionFetchInterval = 10000; // ms
export const maxVersionFetchInterval = versionFetchInterval * 6; // 60_000 ms

/**
 * Poll cadence for the /version (and OCP /version) queries. Healthy = base
 * interval; each consecutive failure doubles it, capped at max.
 * @param {number} consecutiveFailures
 */
export function versionRefetchInterval(consecutiveFailures) {
  if (consecutiveFailures <= 0) {
    return versionFetchInterval;
  }
  return Math.min(versionFetchInterval * 2 ** consecutiveFailures, maxVersionFetchInterval);
}

// --- index.tsx (warnings label) --------------------------------------------

export const maxWarnings = 50;

/**
 * Renders the Warnings cell text.
 *   error       => '⋯'
 *   no result   => '⋯'
 *   >= 50       => '50+'
 *   otherwise   => the count as a string
 * @param {{warnings?: number, error?: boolean} | undefined} warningResult
 */
export function renderWarningsText(warningResult) {
  const numWarnings = warningResult?.error ? -1 : warningResult?.warnings ?? -1;
  if (numWarnings === -1) return '⋯';
  if (numWarnings >= maxWarnings) return `${maxWarnings}+`;
  return String(numWarnings);
}

// --- ClusterTable.tsx (row cell derivation) --------------------------------

/**
 * Derives what the Status cell shows for one row, mirroring ClusterStatus in
 * ClusterTable.tsx. `isConnected` = the cluster is in the auto-connect/polling
 * set; `error` is the latest /version probe result (undefined = not resolved).
 * @param {{name: string, controlPlaneHealthy?: string}} cluster
 * @param {ApiError} error
 * @param {boolean} isConnected
 */
export function deriveStatusCell(cluster, error, isConnected) {
  // Not polled, never contacted.
  if (!isConnected && error === undefined) {
    return { state: 'not-connected', label: 'Not connected', canOpen: true, kind: 'unknown' };
  }
  // Polled, first probe still pending: block opening until it resolves.
  if (isConnected && error === undefined) {
    return { state: 'connecting', label: 'Connecting…', canOpen: false, kind: 'unknown' };
  }
  const info = getClusterStatusInfo(cluster, error);
  return {
    state: getClusterStatus(error),
    label: info.text,
    canOpen: true,
    kind: info.kind,
  };
}

/** Version cell: blank when unconnected, gitVersion when known, else '⋯'. */
export function deriveVersionCell(versionResult, isConnected) {
  if (!isConnected) return '';
  return versionResult?.gitVersion || '⋯';
}

/**
 * OCP cell: blank when unconnected, the desired version when the OpenShift
 * ClusterVersion resource exists, else '⋯'. A plain (non-OpenShift) cluster
 * legitimately shows '⋯' because the endpoint 404s — it is NOT an error.
 */
export function deriveOcpCell(ocpVersion, isConnected) {
  if (!isConnected) return '';
  return ocpVersion || '⋯';
}

/** Warnings cell: blank when unconnected, else the rendered warning text. */
export function deriveWarningsCell(warningResult, isConnected) {
  if (!isConnected) return '';
  return renderWarningsText(warningResult);
}

// --- RouteSwitcher.tsx (AuthRoute — the "open the cluster" gate) ------------

/**
 * The SECOND, independent check that runs when a user opens a cluster. This is
 * NOT the /version probe the table used; it is a POST selfsubjectrulesreviews
 * (testAuth) with a 5s timeout. Faithful port of AuthRoute's render logic.
 *
 * @param {{
 *   currentCluster: string | null,
 *   authType?: 'oidc' | 'token' | string,
 *   selectedClusterCount?: number,
 *   requiresAuth?: boolean,
 *   auth: {state: 'pending'|'success'|'error', status?: number}
 * }} params
 * @returns {{screen: 'cluster'|'connecting'|'token'|'login'|'chooser'}}
 */
export function routeAuthOutcome(params) {
  const {
    currentCluster,
    authType,
    selectedClusterCount = 1,
    requiresAuth = true,
    auth,
  } = params;

  if (!requiresAuth) return { screen: 'cluster' };

  // Multi-cluster selection short-circuits the single-cluster auth gate.
  if (selectedClusterCount > 1) return { screen: 'cluster' };

  // Which redirect target an error would use.
  let redirectRoute;
  if (!currentCluster) {
    redirectRoute = 'chooser';
  } else if (authType === 'oidc') {
    redirectRoute = 'login';
  } else if (auth.state === 'error' && [401, 403].includes(auth.status)) {
    redirectRoute = 'token';
  } else {
    redirectRoute = 'login';
  }

  if (auth.state === 'success') return { screen: 'cluster' };
  if (auth.state === 'error') return { screen: redirectRoute };
  // Still pending => the "Connecting to cluster…" screen (ClusterConnecting).
  if (currentCluster) return { screen: 'connecting' };
  return { screen: 'chooser' };
}
