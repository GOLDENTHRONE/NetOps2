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

import { afterEach, describe, expect, it } from 'vitest';
import {
  accountFrame,
  accountOpen,
  accountTeardown,
  getWatchAccounting,
  isWatchAccountingEnabled,
  resetWatchAccounting,
  setWatchAccountingEnabled,
  utf8ByteLength,
} from './watchAccounting';

const KEY = 'localhttp://x/api/v1/pods?watch=1&resourceVersion=42';
const URL = 'http://x/api/v1/pods?watch=1&resourceVersion=42';

// A representative MODIFIED Pod event, ASCII (bytes == string length).
const modified = (name: string, phase: string) =>
  JSON.stringify({
    type: 'MODIFIED',
    object: { metadata: { name, uid: name }, status: { phase } },
  });
const bookmark = (rv: string) =>
  JSON.stringify({ type: 'BOOKMARK', object: { metadata: { resourceVersion: rv } } });

afterEach(() => {
  setWatchAccountingEnabled(false); // also clears state
});

describe('utf8ByteLength', () => {
  const cases = [
    'plain ascii',
    '',
    'café', // 2-byte é
    'price €5', // 3-byte €
    '日本語クラスタ', // 3-byte CJK
    '🚀 pod restarted 🔥', // 4-byte astral (surrogate pairs)
    JSON.stringify({ type: 'MODIFIED', object: { name: 'péd-🚀', note: '日本' } }),
  ];
  it.each(cases)('matches the reference UTF-8 encoder for %j', s => {
    // Reference: Node Buffer and the WHATWG TextEncoder agree on valid UTF-16.
    expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, 'utf8'));
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });

  it('counts a lone surrogate as the 3-byte replacement (matches TextEncoder)', () => {
    const lone = 'a\uD83Db'; // high surrogate with no low surrogate
    expect(utf8ByteLength(lone)).toBe(new TextEncoder().encode(lone).length);
  });

  it('is NOT the UTF-16 code-unit count for multibyte input', () => {
    const s = '日本語'; // 3 code units, 9 UTF-8 bytes
    expect(s.length).toBe(3);
    expect(utf8ByteLength(s)).toBe(9);
  });
});

describe('watch accounting — disabled by default (near-zero overhead)', () => {
  it('records nothing while disabled', () => {
    resetWatchAccounting();
    expect(isWatchAccountingEnabled()).toBe(false);
    accountOpen(KEY, URL);
    accountFrame(KEY, modified('p-1', 'Running'), 'MODIFIED', 1.5);
    expect(getWatchAccounting()).toEqual([]);
  });
});

describe('watch accounting — enabled', () => {
  it('starts a lifetime on open and counts frames, bytes and kinds', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);

    const f1 = modified('p-1', 'Running');
    const f2 = modified('p-2', 'Failed');
    const bm = bookmark('99');
    accountFrame(KEY, f1, 'MODIFIED', 0.4);
    accountFrame(KEY, f2, 'MODIFIED', 0.6);
    accountFrame(KEY, bm, 'BOOKMARK', 0.1);

    const [snap] = getWatchAccounting();
    expect(snap.url).toBe(URL);
    expect(snap.frames).toBe(3);
    expect(snap.dataEvents).toBe(2);
    expect(snap.bookmarks).toBe(1);
    // Exact wire bytes = sum of UTF-8 lengths of every frame.
    expect(snap.bytes).toBe(utf8ByteLength(f1) + utf8ByteLength(f2) + utf8ByteLength(bm));
    expect(snap.parseMsTotal).toBeCloseTo(1.1, 5);
    expect(snap.reconnects).toBe(0);
    expect(snap.ageMs).toBeGreaterThanOrEqual(0);
    // bytesPerEvent divides by DATA events only (not bookmarks).
    expect(snap.bytesPerEvent).toBe(
      Math.round((utf8ByteLength(f1) + utf8ByteLength(f2) + utf8ByteLength(bm)) / 2)
    );
  });

  it('measures bytes as UTF-8, not string length, for multibyte payloads', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    const multibyte = JSON.stringify({ type: 'MODIFIED', object: { note: '日本語 🚀' } });
    accountFrame(KEY, multibyte, 'MODIFIED', 0);
    const [snap] = getWatchAccounting();
    expect(snap.bytes).toBe(utf8ByteLength(multibyte));
    expect(snap.bytes).toBeGreaterThan(multibyte.length); // UTF-8 > UTF-16 units here
  });

  it('counts a re-open on the same connection as a reconnect and keeps the lifetime', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    accountFrame(KEY, modified('p-1', 'Running'), 'MODIFIED', 0);
    const openedAt = getWatchAccounting()[0].ageMs;
    accountOpen(KEY, URL); // socket dropped + redialed
    const [snap] = getWatchAccounting();
    expect(snap.reconnects).toBe(1);
    expect(snap.frames).toBe(1); // frames preserved across the reconnect
    expect(snap.ageMs).toBeGreaterThanOrEqual(openedAt); // same lifetime, not reset
  });

  it('teardown ends the lifetime; a later open starts fresh (not a reconnect)', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    accountFrame(KEY, modified('p-1', 'Running'), 'MODIFIED', 0);
    accountTeardown(KEY);
    expect(getWatchAccounting()).toEqual([]);
    accountOpen(KEY, URL);
    const [snap] = getWatchAccounting();
    expect(snap.reconnects).toBe(0);
    expect(snap.frames).toBe(0);
  });

  it('derives rates on read', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    const f = modified('p-1', 'Running');
    accountFrame(KEY, f, 'MODIFIED', 0);
    const [snap] = getWatchAccounting();
    expect(snap.eventsPerSec).toBeGreaterThanOrEqual(0);
    expect(snap.bytesPerSec).toBeGreaterThanOrEqual(0);
    expect(snap.bytesPerEvent).toBe(utf8ByteLength(f));
  });

  it('is exposed on globalThis for out-of-band tooling', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    const fn = (globalThis as any).__headlampWatchAccounting;
    expect(typeof fn).toBe('function');
    expect(fn()).toHaveLength(1);
  });

  it('turning accounting off clears recorded state', () => {
    setWatchAccountingEnabled(true);
    accountOpen(KEY, URL);
    expect(getWatchAccounting()).toHaveLength(1);
    setWatchAccountingEnabled(false);
    expect(getWatchAccounting()).toEqual([]);
  });
});
