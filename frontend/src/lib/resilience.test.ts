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

import { describe, expect, it } from 'vitest';
import {
  AUTH_TIMEOUT_MS,
  isBlipStatus,
  KEEP_LAST_GOOD,
  OPEN_GATE_RETRY,
  POLL_JITTER_PCT,
  STATUS_FAIL_THRESHOLD,
  watchFallbackRefetchInterval,
  withJitter,
} from './resilience';

describe('resilience config defaults (env unset in tests)', () => {
  it('uses the P0 default knobs', () => {
    expect(AUTH_TIMEOUT_MS).toBe(15000);
    expect(OPEN_GATE_RETRY).toBe(1);
    expect(STATUS_FAIL_THRESHOLD).toBe(2);
    expect(KEEP_LAST_GOOD).toBe(true);
    expect(POLL_JITTER_PCT).toBeCloseTo(0.15);
  });
});

describe('isBlipStatus', () => {
  it('treats 401/403 as NOT a blip (genuine auth failures, never hidden)', () => {
    expect(isBlipStatus(401)).toBe(false);
    expect(isBlipStatus(403)).toBe(false);
  });
  it('treats timeout/5xx/network as a blip (eligible for keep-last-good)', () => {
    expect(isBlipStatus(408)).toBe(true);
    expect(isBlipStatus(502)).toBe(true);
    expect(isBlipStatus(500)).toBe(true);
    expect(isBlipStatus(undefined)).toBe(true);
  });
});

describe('withJitter', () => {
  it('returns the input unchanged when pct is 0', () => {
    expect(withJitter(10000, 0)).toBe(10000);
  });
  it('stays within +/-pct of the input over many samples', () => {
    for (let i = 0; i < 500; i++) {
      const v = withJitter(10000, 0.15);
      expect(v).toBeGreaterThanOrEqual(8500);
      expect(v).toBeLessThanOrEqual(11500);
    }
  });
  it('actually spreads the value (not a constant)', () => {
    const values = new Set(Array.from({ length: 50 }, () => withJitter(10000, 0.15)));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('watchFallbackRefetchInterval (P1 safety-net)', () => {
  it('returns false for a paginated list (never resets loaded pages)', () => {
    expect(watchFallbackRefetchInterval(true)).toBe(false);
  });
  it('returns a jittered interval (~90s +/-15%) for a non-paginated watched list', () => {
    for (let i = 0; i < 200; i++) {
      const v = watchFallbackRefetchInterval(false);
      expect(v).not.toBe(false);
      expect(v as number).toBeGreaterThanOrEqual(90000 * 0.85);
      expect(v as number).toBeLessThanOrEqual(90000 * 1.15);
    }
  });
});
