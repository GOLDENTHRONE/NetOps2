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
 * TEMPORARY diagnostic logging for the "status doesn't reflect until reload"
 * investigation (cluster auth/version recovery on the All Clusters tab).
 *
 * OFF by default. Turn on in the browser console with:
 *     window.__GT_DEBUG__ = true
 * and turn off with:
 *     window.__GT_DEBUG__ = false
 *
 * It only ever logs status codes / booleans / cluster names — NEVER token or
 * header values — so no secrets are printed. Remove this file and its call
 * sites (grep "gtDebug") once the investigation is done.
 */
export function gtDebug(scope: string, data: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }
    const w = window as unknown as { __GT_DEBUG__?: boolean };
    if (!w.__GT_DEBUG__) {
      return;
    }
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    // eslint-disable-next-line no-console
    console.log(`[GT-DEBUG ${ts}] ${scope}`, data);
  } catch {
    /* diagnostics must never break the app */
  }
}
