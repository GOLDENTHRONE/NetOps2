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
 * Observational accountant for the A1 whole-collection Pod live-subset watch.
 *
 * PURPOSE: measure the REAL cost of a watch (event rate, wire bytes, parse cost,
 * reconnects, lifetime) so a future fallback/gating decision can be based on
 * production evidence instead of guessed thresholds. This file is MEASUREMENT
 * ONLY — it never opens/closes sockets, never touches listeners, liveness (#16),
 * reconnect (#15) or the multiplexer guard. It only reads what already flows.
 *
 * OVERHEAD: disabled by default. When disabled the watch hot path pays a single
 * cached boolean read (`isWatchAccountingEnabled()`) and nothing else. When
 * enabled (testing / an explicit opt-in) it adds an allocation-free UTF-8 byte
 * count per frame and a `performance.now()` delta around the parse that already
 * happens — no second parse, no per-event allocation, no extra network work.
 *
 * MEMORY: one fixed-size record per live connection (removed on teardown), so the
 * A1 O(loaded) invariant is preserved — accounting state is O(connections), not
 * O(events) and not O(objects).
 *
 * Enable for testing with the build-time env `REACT_APP_WATCH_ACCOUNTING=true`
 * (see resilience.ts `WATCH_ACCOUNTING`) OR, without rebuilding, by setting
 * `window.__HEADLAMP_WATCH_ACCOUNTING__ = true` BEFORE the app bundle loads
 * (a CDP/Playwright `addInitScript` does this). Snapshots are read from
 * `window.__headlampWatchAccounting()`.
 */

import { isWatchAdaptiveEnabled, WATCH_ACCOUNTING } from '../../../resilience';

/** A point-in-time cost snapshot for one watch connection. */
export interface WatchAccountSnapshot {
  /** The watch URL (identity; includes the pinned resourceVersion for A1). */
  url: string;
  /** Milliseconds this connection has been open (per-watch lifetime, #11). */
  ageMs: number;
  /** Total frames received (data events + bookmarks + anything else). */
  frames: number;
  /** ADDED/MODIFIED/DELETED frames only (#1). */
  dataEvents: number;
  /** BOOKMARK frames (liveness/progress; not user-visible data). */
  bookmarks: number;
  /** Cumulative EXACT wire bytes (UTF-8) since the watch opened (#3, #5). */
  bytes: number;
  /** Mean bytes per data event (#3), 0 when no data events yet. */
  bytesPerEvent: number;
  /** Data events per second over the connection lifetime (#2). */
  eventsPerSec: number;
  /** Wire bytes per second over the connection lifetime (#4). */
  bytesPerSec: number;
  /** Cumulative time spent in JSON.parse for this watch, ms (#7). Coarse clock. */
  parseMsTotal: number;
  /** Reconnects (socket re-opens after a drop) for this connection (#6). */
  reconnects: number;
}

interface WatchAccount {
  url: string;
  openedAt: number;
  lastFrameAt: number;
  frames: number;
  dataEvents: number;
  bookmarks: number;
  bytes: number;
  parseMsTotal: number;
  reconnects: number;
}

const accounts = new Map<string, WatchAccount>();

// Lazy-cached enable flag. `null` = not yet resolved. Resolving reads the
// build-time env once and the runtime global once, then the hot path is a single
// boolean read. `setWatchAccountingEnabled` overrides it (used by tests).
let enabled: boolean | null = null;

/**
 * Whether accounting is on. Near-zero cost after the first call: a single cached
 * boolean read on the watch hot path.
 */
export function isWatchAccountingEnabled(): boolean {
  if (enabled === null) {
    const runtime =
      typeof globalThis !== 'undefined' &&
      (globalThis as any).__HEADLAMP_WATCH_ACCOUNTING__ === true;
    // The adaptive controller (C4) REQUIRES the accountant as its in-band cost signal,
    // and the watch socket opens before the controller's effect runs — so accounting
    // must be on from the very first frame whenever adaptive is enabled. Otherwise the
    // initial `accountOpen` is skipped and no per-watch record is ever created.
    enabled = WATCH_ACCOUNTING || isWatchAdaptiveEnabled() || runtime;
  }
  return enabled;
}

/** Force accounting on/off (tests). Turning it off also clears recorded state. */
export function setWatchAccountingEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    accounts.clear();
  }
}

/** Remove all recorded state (tests). */
export function resetWatchAccounting(): void {
  accounts.clear();
}

/**
 * Exact UTF-8 byte length of a JS string, WITHOUT allocating (unlike
 * `new TextEncoder().encode(s).length` or `Buffer.from`). Matches the WHATWG
 * encoder: a lone surrogate counts as the 3-byte U+FFFD replacement. This is the
 * true wire size of a text frame's payload — NOT `s.length` (UTF-16 code units)
 * and NOT `JSON.parse(s).length`.
 */
export function utf8ByteLength(str: string): number {
  let bytes = 0;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a 4-byte code point iff a low surrogate follows.
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3; // lone high surrogate → U+FFFD
      }
    } else {
      // BMP (incl. lone low surrogate → U+FFFD, also 3 bytes).
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Record a socket open for a connection. First open starts the lifetime; any
 * later open for a connection that still has a record is a reconnect (#6). No-op
 * when accounting is disabled.
 */
export function accountOpen(connectionKey: string, url: string): void {
  if (!isWatchAccountingEnabled()) return;
  const existing = accounts.get(connectionKey);
  const now = Date.now();
  if (existing) {
    existing.reconnects += 1;
    existing.lastFrameAt = now;
    existing.url = url;
  } else {
    accounts.set(connectionKey, {
      url,
      openedAt: now,
      lastFrameAt: now,
      frames: 0,
      dataEvents: 0,
      bookmarks: 0,
      bytes: 0,
      parseMsTotal: 0,
      reconnects: 0,
    });
  }
}

/**
 * Record one received frame: its exact wire bytes and its kind (from the
 * already-parsed `type`, so there is no extra scan/parse). `parseMs` is the time
 * the caller measured around the parse it already performs. No-op when disabled.
 */
export function accountFrame(
  connectionKey: string,
  rawData: string,
  type: string | undefined,
  parseMs: number
): void {
  if (!isWatchAccountingEnabled()) return;
  const acc = accounts.get(connectionKey);
  if (!acc) return;
  acc.frames += 1;
  acc.bytes += utf8ByteLength(rawData);
  acc.parseMsTotal += parseMs;
  acc.lastFrameAt = Date.now();
  if (type === 'ADDED' || type === 'MODIFIED' || type === 'DELETED') {
    acc.dataEvents += 1;
  } else if (type === 'BOOKMARK') {
    acc.bookmarks += 1;
  }
}

/**
 * Drop a connection's record on full teardown (all listeners gone). A later
 * re-subscribe starts a fresh lifetime rather than counting as a reconnect.
 * No-op when disabled.
 */
export function accountTeardown(connectionKey: string): void {
  if (!isWatchAccountingEnabled()) return;
  accounts.delete(connectionKey);
}

/** Derive a read-time snapshot (rates computed here, never per event). */
function toSnapshot(acc: WatchAccount): WatchAccountSnapshot {
  const ageMs = Math.max(0, Date.now() - acc.openedAt);
  const ageSec = ageMs / 1000 || 1; // avoid /0 on a just-opened watch
  return {
    url: acc.url,
    ageMs,
    frames: acc.frames,
    dataEvents: acc.dataEvents,
    bookmarks: acc.bookmarks,
    bytes: acc.bytes,
    bytesPerEvent: acc.dataEvents > 0 ? Math.round(acc.bytes / acc.dataEvents) : 0,
    eventsPerSec: +(acc.dataEvents / ageSec).toFixed(2),
    bytesPerSec: +(acc.bytes / ageSec).toFixed(1),
    parseMsTotal: +acc.parseMsTotal.toFixed(2),
    reconnects: acc.reconnects,
  };
}

/** Snapshot of every live watch connection's cost. Empty when disabled/none. */
export function getWatchAccounting(): WatchAccountSnapshot[] {
  const out: WatchAccountSnapshot[] = [];
  for (const acc of accounts.values()) {
    out.push(toSnapshot(acc));
  }
  return out;
}

// Expose a read-only accessor for out-of-band tooling (CDP/Playwright drivers),
// so a test can read cumulative cost without hooking React. Never used by app code.
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__headlampWatchAccounting = getWatchAccounting;
}
