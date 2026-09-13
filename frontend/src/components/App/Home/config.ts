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

/**
 * Allow selecting multiple clusters on home page.
 *
 * Enabled by default. Set `REACT_APP_MULTI_HOME_ENABLED=false` to disable.
 */
export const MULTI_HOME_ENABLED = import.meta.env.REACT_APP_MULTI_HOME_ENABLED !== 'false';

/** Show recent clusters on the home page */
export const ENABLE_RECENT_CLUSTERS = import.meta.env.REACT_APP_ENABLE_RECENT_CLUSTERS === 'true';

/**
 * When true (default), clicking a cluster name on the Home page also connects
 * to that cluster (starts polling its version/status) in addition to the
 * explicit Connect button. Set to false if you want the Connect button to be
 * the only way to start polling a cluster.
 */
export const CONNECT_ON_CLUSTER_LINK =
  import.meta.env.REACT_APP_CONNECT_ON_CLUSTER_LINK !== 'false';

/**
 * When true (default), the Home page checks every configured cluster's status in
 * the background as soon as it opens — the upstream Headlamp behaviour — instead of
 * only recently-used clusters. Set `REACT_APP_AUTO_CONNECT_ALL=false` to fall back
 * to the recent-clusters-only, connect-on-demand policy (lighter on page load for
 * users with very large fleets).
 */
export const AUTO_CONNECT_ALL = import.meta.env.REACT_APP_AUTO_CONNECT_ALL !== 'false';

/**
 * When true (default), each connected cluster's authorization is checked in the
 * background so the status cell can show a truthful "Ready" (reachable AND
 * authorized) versus "Reachable" (answered, access not confirmed). Set
 * `REACT_APP_ENABLE_READY_CHECK=false` to disable the auth poll and keep the
 * reachability-only "Active" status.
 */
export const ENABLE_READY_CHECK = import.meta.env.REACT_APP_ENABLE_READY_CHECK !== 'false';
