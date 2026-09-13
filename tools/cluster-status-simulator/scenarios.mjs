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
 * scenarios.mjs — a generic, fully-masked cluster fleet.
 *
 * All names/versions here are invented placeholders. They do NOT correspond to
 * any real cluster, host, tenant, or environment.
 */

/** @typedef {import('./simulator.mjs').ClusterSim} ClusterSim */

export const scenarios = {
  // A healthy OpenShift cluster you're authorized on. Table: Active, versions
  // populated. Opening it succeeds. This is the fully-consistent happy path.
  'openshift-healthy-authorized': {
    name: 'cluster-ocp-a',
    kind: 'openshift',
    authType: 'token',
    probes: {
      version: 200,
      gitVersion: 'v1.29.0+placeholder',
      ocp: 200,
      ocpVersion: '4.16.0',
      warningsList: 200,
      warningCount: 12,
      warningsWatch: true,
      openAuth: 200,
    },
  },

  // The headline bug class: /version says 200 (Active) but the separate open
  // auth probe returns 401. Table shows "Active"; opening shows Connecting then
  // the token/authentication screen.
  'active-but-open-auth-401': {
    name: 'cluster-ocp-b',
    kind: 'openshift',
    authType: 'token',
    probes: {
      version: 200,
      gitVersion: 'v1.29.0+placeholder',
      ocp: 200,
      ocpVersion: '4.16.0',
      warningsList: 200,
      warningCount: 3,
      warningsWatch: true,
      openAuth: 401,
    },
  },

  // Same gap, but the open probe times out (5s) instead of 401. Router falls
  // through to the login flow rather than the token flow.
  'active-but-open-timeout': {
    name: 'cluster-ocp-c',
    kind: 'openshift',
    authType: 'token',
    probes: {
      version: 200,
      gitVersion: 'v1.29.0+placeholder',
      ocp: 200,
      ocpVersion: '4.16.0',
      warningsList: 200,
      warningCount: 0,
      warningsWatch: true,
      openAuth: 'timeout',
    },
  },

  // A plain (non-OpenShift) but healthy cluster. OCP column is '⋯' because the
  // OpenShift endpoint 404s — this is NORMAL, not a fault.
  'plain-k8s-healthy': {
    name: 'cluster-plain-d',
    kind: 'plain-k8s',
    authType: 'token',
    probes: {
      version: 200,
      gitVersion: 'v1.30.0+placeholder',
      ocp: 404,
      warningsList: 200,
      warningCount: 1,
      warningsWatch: true,
      openAuth: 200,
    },
  },

  // Genuinely unreachable through the backend (e.g. HTTP 502). Table shows
  // "Unavailable"; versions/warnings blank-ish. Opening would also fail.
  'unreachable-502': {
    name: 'cluster-unreachable-e',
    kind: 'plain-k8s',
    authType: 'token',
    probes: {
      version: 502,
      ocp: 502,
      warningsList: 502,
      warningsWatch: false,
      openAuth: 'timeout',
    },
  },

  // Authorized to reach the API, but forbidden (403) on the /version probe.
  'permission-error-403': {
    name: 'cluster-forbidden-f',
    kind: 'plain-k8s',
    authType: 'token',
    probes: {
      version: 403,
      ocp: 403,
      warningsList: 403,
      warningsWatch: false,
      openAuth: 403,
    },
  },

  // Configured but NOT connected: no probe has run. Table shows "Not connected"
  // with a Connect action. Version/OCP/warnings cells are blank.
  'configured-not-connected': {
    name: 'cluster-idle-g',
    kind: 'plain-k8s',
    authType: 'token',
    probes: {
      version: null, // not resolved
      openAuth: 200,
    },
  },

  // Control-plane health condition reports False (Cluster Inventory). This wins
  // over a would-be "Active" and shows "Control plane unhealthy".
  'control-plane-unhealthy': {
    name: 'cluster-inventory-h',
    kind: 'plain-k8s',
    authType: 'token',
    controlPlaneHealthy: 'False',
    probes: {
      version: 200,
      gitVersion: 'v1.29.0+placeholder',
      warningsList: 200,
      warningCount: 60, // exercises the 50+ cap
      warningsWatch: false, // watch failed: count is a snapshot, not live
      openAuth: 200,
    },
  },
};

export const scenarioNames = Object.keys(scenarios);
