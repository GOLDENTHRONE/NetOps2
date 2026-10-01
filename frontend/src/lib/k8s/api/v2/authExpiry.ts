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
 * P1 (#18) — idle session-expiry detection for the v2 data path.
 *
 * A cluster-scoped `401 Unauthorized` from the v2 fetch path (list / #16 confirm-LIST /
 * C4 poll / get / discovery …) means the K8s session for that cluster can no longer be
 * verified (authentication is evaluated before RBAC — a 401, unlike a 403, proves the
 * session is unusable). This module routes such a failure into the EXISTING re-auth flow
 * so a user idling on a page is not left staring at stale data presented as live:
 *   `setToken(cluster, null)` clears the (cookie/stored) token for this cluster, then
 *   `resetQueries(['auth', cluster])` clears the cached auth result AND refetches the
 *   mounted `AuthRoute` observer, which now 401s and lands in `status:'error'`, rendering
 *   the session-expired gate in place — replacing the page WITHOUT navigation (validated
 *   in a real browser against a real kube-apiserver).
 *
 * Why NOT `logout()` + `invalidate` (validated the hard way in a real browser):
 *  - React Query keeps a previously-SUCCEEDED query as `status:'success'`
 *    (`isSuccess === true`) when a later *refetch* fails (keep-last-good). `AuthRoute`
 *    gates on `query.isSuccess`, so an invalidate-driven refetch that 401s does NOT flip
 *    it to the gate — the stale success is retained and the stale page stays up.
 *  - `logout()` internally `removeQueries(['auth'])`. Removing the query first leaves the
 *    active `AuthRoute` observer with NOTHING to refetch: a later reset/refetch/invalidate
 *    targets a query that no longer exists, and a removed query does not reliably re-fetch
 *    on its own (confirmed: no `testAuth` request followed `logout`). The observer never
 *    re-ran the check, so the gate never appeared.
 *  So we clear the token WITHOUT removing the auth query (`setToken(cluster, null)`), then
 *  `resetQueries` the still-present, actively-observed query: reset clears its data and
 *  refetches the observer, so the 401 yields `status:'error'` and the gate renders. Steps
 *  are CHAINED (clear-token → reset), not raced.
 *
 * CIRCULAR-IMPORT SAFETY: `auth.ts` statically imports the v2 fetch module, so this file
 * must NOT statically import `auth.ts`. It uses a LAZY dynamic `import()` at call time,
 * which breaks the cycle (nothing here runs at module-eval of the fetch layer).
 *
 * DE-DUPLICATION: many requests can 401 at once (list + watch-confirm + discovery). Each
 * cluster fires the re-auth transition at most once per failure episode; a subsequent
 * SUCCESS for that cluster resets it, so a later genuine expiry re-fires. This — together
 * with `retry.ts` never retrying 401 — guarantees no auth/logout/request storm.
 *
 * SCOPE: keyed strictly by cluster; a failure for cluster A never touches cluster B.
 */

/** Clusters currently in an auth-failure episode (fired, awaiting recovery). */
const failing = new Set<string>();

/**
 * Report a definitive cluster-scoped 401. Fires the re-auth transition once per episode.
 * Safe to call from the fetch hot path: after the first call for a cluster it is a no-op
 * until `noteClusterAuthSuccess` resets it.
 */
export function reportClusterAuthFailure(cluster: string): void {
  if (!cluster || failing.has(cluster)) return;
  failing.add(cluster);
  // Chain (not race) the two lazy imports so the reset always runs AFTER the token has
  // been cleared. Lazy import() breaks the auth.ts <-> fetch.ts cycle.
  void (async () => {
    try {
      // Clear the token for THIS cluster WITHOUT removing the ['auth'] query (see header):
      // setToken(cluster, null) is the token-clearing half of logout() and also drops the
      // cached ['clusterMe', cluster] identity, but leaves ['auth', cluster] in place so
      // the reset below can refetch its active observer.
      const { setToken } = await import('../../../auth');
      await setToken(cluster, null);
    } catch {
      /* best-effort: even if clearing the token fails, the reset below still gates the UI */
    }
    try {
      const { queryClient } = await import('../../../queryClient');
      // Reset the still-present, actively-observed auth query for THIS cluster: clears its
      // cached success AND refetches the AuthRoute observer -> testAuth 401 ->
      // status:'error' -> the session-expired gate renders in place (no navigation).
      // Scoped to this cluster's exact key so a healthy cluster B is never disturbed.
      await queryClient.resetQueries({ queryKey: ['auth', cluster], exact: true });
    } catch {
      /* the refetch triggered by reset rejects on 401 — expected; the gate still renders */
    }
  })();
}

/**
 * Note a successful (non-401) response for a cluster, ending any auth-failure episode so a
 * later genuine expiry can fire again. Called on successful v2 responses.
 */
export function noteClusterAuthSuccess(cluster: string): void {
  if (cluster) failing.delete(cluster);
}

/** Whether a cluster is currently in a fired auth-failure episode (tests/diagnostics). */
export function isClusterAuthFailing(cluster: string): boolean {
  return failing.has(cluster);
}

/** Reset all episodes (tests). */
export function resetAuthExpiry(): void {
  failing.clear();
}
