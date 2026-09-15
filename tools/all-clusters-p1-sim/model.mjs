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
 * ===========================================================================
 * model.mjs — deterministic model of the "watch" (WebSocket) lifecycle for the
 * All Clusters list views on GT_D_V1, BEFORE (current code) vs AFTER (P1).
 *
 * BEFORE facts (verified from source, cited in p13.txt):
 *   legacy openWebSocket registers only 'message' + 'error' — NO 'close', NO
 *   reconnect (webSocket.ts:129-142); watch and periodic refetch are mutually
 *   exclusive: shouldWatch = watch && !refetchInterval (useKubeObjectList.ts:784).
 *   => a dropped socket = silent stale forever, and no safety-net refetch.
 *
 * AFTER (P1): auto-reconnect with backoff+jitter, resume from resourceVersion
 *   (410 -> re-list), a low-frequency safety-net refetch even while watching,
 *   stop on unsubscribe (no leaks). All values config-driven.
 *
 * Virtual clock (ms); no real timers. All data generic/synthetic.
 * ===========================================================================
 */

export const P1 = {
  RECONNECT: true,
  RECONNECT_BASE_MS: 1000, // 1s, doubles per attempt
  RECONNECT_CAP_MS: 30000, // 30s cap
  JITTER_PCT: 0.15,
  FALLBACK_REFETCH_MS: 60000, // safety-net refetch while watching (0 = off)
  STALE_AFTER_MS: 15000, // UI considers data "stale" after this with no update
};

export function withJitter(ms, pct = P1.JITTER_PCT, rnd = Math.random) {
  if (pct <= 0) return ms;
  const j = ms * pct;
  return Math.round(ms - j + rnd() * 2 * j);
}

export function backoff(attempt, base, cap) {
  return Math.min(base * 2 ** attempt, cap);
}

/**
 * BEFORE — the current legacy watch: opens, receives messages, and on close does
 * NOTHING (no redial, no fallback). Models today's silent-stale behaviour.
 */
export class WatchBefore {
  constructor() {
    this.now = 0;
    this.connected = false;
    this.lastUpdate = 0;
    this.lastRV = null;
    this.reconnects = 0;
    this.refetches = 0;
    this.subscribed = true;
  }
  open() {
    this.connected = true;
    this.lastUpdate = this.now;
  }
  message(rv) {
    this.lastRV = rv;
    this.lastUpdate = this.now;
  }
  close() {
    this.connected = false; // and nothing else — no redial, no fallback
  }
  receiveError() {
    // BEFORE: a watch ERROR (410) is swallowed — logged and ignored. No re-list,
    // so the list stays frozen on stale data.
  }
  unsubscribe() {
    this.subscribed = false;
  }
  advance(dt) {
    this.now += dt; // time passes; a closed socket never recovers
  }
  dataAgeMs() {
    return this.now - this.lastUpdate;
  }
  freshness(staleAfter = P1.STALE_AFTER_MS) {
    if (this.connected) return 'live';
    return this.dataAgeMs() > staleAfter ? 'stale' : 'live';
  }
}

/**
 * AFTER — P1 watch with auto-reconnect + safety-net refetch.
 * advance(dt, opts) fires any scheduled reconnect/fallback whose time falls in
 * [now, now+dt]; opts.resume selects what a reconnect attempt gets: 'ok' |
 * '410' (bookmark too old -> re-list) | 'fail' (retry again with more backoff).
 */
export class WatchAfter {
  constructor(cfg = P1) {
    this.cfg = cfg;
    this.now = 0;
    this.connected = false;
    this.state = 'connecting'; // live | reconnecting | stale | connecting | stopped
    this.lastUpdate = 0;
    this.lastRV = null;
    this.attempt = 0;
    this.nextReconnectAt = null;
    this.nextFallbackAt = cfg.FALLBACK_REFETCH_MS > 0 ? cfg.FALLBACK_REFETCH_MS : null;
    this.subscribed = true;
    this.reconnects = 0;
    this.refetches = 0;
    this.reListCount = 0;
    this.openSockets = 0; // to assert no leaks
  }
  open() {
    this.connected = true;
    this.state = 'live';
    this.attempt = 0;
    this.nextReconnectAt = null;
    this.lastUpdate = this.now;
    this.openSockets = 1; // exactly one live socket
  }
  message(rv) {
    this.lastRV = rv;
    this.lastUpdate = this.now;
  }
  receiveError() {
    // AFTER: a watch ERROR (410 Gone) triggers a fresh re-list (new snapshot +
    // resourceVersion); the list becomes fresh again instead of staying stale.
    this.reListCount += 1;
    this.lastRV = 'rv-fresh';
    this.lastUpdate = this.now;
    this.connected = true;
    this.state = 'live';
  }
  #scheduleReconnect() {
    const base = backoff(this.attempt, this.cfg.RECONNECT_BASE_MS, this.cfg.RECONNECT_CAP_MS);
    this.nextReconnectAt = this.now + withJitter(base, this.cfg.JITTER_PCT);
  }
  close() {
    this.connected = false;
    this.openSockets = 0;
    if (!this.subscribed || !this.cfg.RECONNECT) {
      this.state = this.subscribed ? 'stale' : 'stopped';
      return;
    }
    this.state = 'reconnecting';
    this.#scheduleReconnect();
  }
  unsubscribe() {
    this.subscribed = false;
    this.nextReconnectAt = null;
    this.nextFallbackAt = null;
    this.state = 'stopped';
  }
  advance(dt, { resume = 'ok' } = {}) {
    const target = this.now + dt;
    for (;;) {
      const due = [];
      if (this.nextReconnectAt != null && this.nextReconnectAt <= target) {
        due.push(['reconnect', this.nextReconnectAt]);
      }
      if (this.nextFallbackAt != null && this.nextFallbackAt <= target) {
        due.push(['fallback', this.nextFallbackAt]);
      }
      if (due.length === 0) break;
      due.sort((a, b) => a[1] - b[1]);
      const [kind, at] = due[0];
      this.now = at;
      if (kind === 'reconnect') {
        this.attempt += 1;
        if (resume === 'fail') {
          this.#scheduleReconnect(); // still down -> back off further
        } else {
          if (resume === '410') {
            this.reListCount += 1; // bookmark too old -> fresh re-list
            this.lastRV = 'rv-fresh';
          }
          this.reconnects += 1;
          this.open();
        }
      } else if (kind === 'fallback') {
        // safety-net refetch: refreshes data even if the socket is silently dead
        this.refetches += 1;
        this.lastUpdate = this.now;
        this.nextFallbackAt =
          this.subscribed && this.cfg.FALLBACK_REFETCH_MS > 0
            ? this.now + withJitter(this.cfg.FALLBACK_REFETCH_MS, this.cfg.JITTER_PCT)
            : null;
      }
    }
    this.now = target;
  }
  dataAgeMs() {
    return this.now - this.lastUpdate;
  }
  freshness(staleAfter = this.cfg.STALE_AFTER_MS) {
    if (this.state === 'stopped') return 'stopped';
    if (this.connected) return 'live';
    if (this.state === 'reconnecting') return 'reconnecting';
    return this.dataAgeMs() > staleAfter ? 'stale' : 'live';
  }
}
