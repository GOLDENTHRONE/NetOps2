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

import { addBackstageAuthHeaders } from '../../../../helpers/addBackstageAuthHeaders';
import { getAppUrl } from '../../../../helpers/getAppUrl';
import { getHeadlampAPIHeaders } from '../../../../helpers/getHeadlampAPIHeaders';
import { findKubeconfigByClusterName } from '../../../../stateless/findKubeconfigByClusterName';
import { getUserIdFromLocalStorage } from '../../../../stateless/getUserIdFromLocalStorage';
import { ApiError } from './ApiError';
import { noteClusterAuthSuccess, reportClusterAuthFailure } from './authExpiry';
import { makeUrl } from './makeUrl';

// @deprecated BASE_HTTP_URL is deprecated for Electron apps with custom ports.
// It's evaluated at module load time, before window.headlampBackendPort is set.
// Use getAppUrl() directly instead for runtime port configuration.
export const BASE_HTTP_URL = getAppUrl();

/**
 * Simple wrapper around Fetch function
 * Sends a request to the backend
 *
 * @param url - URL path
 * @param init - options parameter for the Fetch function
 *
 * @returns fetch Response
 */
export async function backendFetch(url: string | URL, init: RequestInit = {}) {
  // Always include credentials
  init.credentials = 'include';
  init.headers = addBackstageAuthHeaders(init.headers);
  const response = await fetch(makeUrl([getAppUrl(), url]), init);

  // The backend signals through this header that it wants a reload.
  // See plugins.go
  const headerVal = response.headers.get('X-Reload');
  if (headerVal && headerVal.indexOf('reload') !== -1) {
    window.location.reload();
  }

  if (!response.ok) {
    // Try to parse error message from response
    let maybeErrorMessage: string | undefined;
    try {
      const body = await response.json();
      maybeErrorMessage = typeof body === 'string' ? body : body.message;
    } catch (e) {
      console.debug(
        `Failed to parse error response body for ${url} (status ${response.status}):`,
        e
      );
    }

    throw new ApiError(maybeErrorMessage ?? 'Unreachable', { status: response.status });
  }

  return response;
}

/**
 * A wrapper around Fetch function
 * Allows sending requests to a particular cluster
 *
 * @param url - URL path
 * @param init - same as second parameter of the Fetch function
 * @param init.cluster - name of the cluster
 *
 * @returns fetch Response
 */
export async function clusterFetch(
  url: string | URL,
  init: RequestInit & { cluster: string; autoLogoutOnAuthError?: boolean }
) {
  // P1 (#18): mirror v1's `autoLogoutOnAuthError` (default true). A cluster-scoped 401
  // routes into the existing re-auth flow (see authExpiry.ts). Callers that must NOT
  // trigger re-auth (e.g. login/set-token) pass false; but note set-token uses
  // backendFetch (no cluster), so it is naturally excluded regardless.
  const autoLogoutOnAuthError = init.autoLogoutOnAuthError !== false;
  init.headers = new Headers(init.headers);
  if (init.cluster) {
    for (const [name, value] of Object.entries(getHeadlampAPIHeaders())) {
      init.headers.set(name, value);
    }
  }

  // Set stateless kubeconfig if exists
  const kubeconfig = await findKubeconfigByClusterName(init.cluster);
  if (kubeconfig !== null) {
    const userID = getUserIdFromLocalStorage();
    init.headers.set('KUBECONFIG', kubeconfig);
    init.headers.set('X-HEADLAMP-USER-ID', userID);
  }

  const urlParts = init.cluster ? ['clusters', init.cluster, url] : [url];

  try {
    const response = await backendFetch(makeUrl(urlParts), init);

    // P1 (#18): a successful cluster response ends any auth-failure episode for it, so a
    // later genuine expiry can re-fire the gate.
    if (init.cluster) {
      noteClusterAuthSuccess(init.cluster);
    }
    return response;
  } catch (e) {
    if (e instanceof ApiError) {
      e.cluster = init.cluster;
      // P1 (#18): ONLY a 401 (authentication failure — evaluated before RBAC) proves the
      // session is unusable. 403/410/429/network/timeout are NOT auth failures and never
      // trigger re-auth. Cluster-scoped only; de-duplicated per cluster (authExpiry.ts).
      if (autoLogoutOnAuthError && e.status === 401 && init.cluster) {
        reportClusterAuthFailure(init.cluster);
      }
    }
    throw e;
  }
}
