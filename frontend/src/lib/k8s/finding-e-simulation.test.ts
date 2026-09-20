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

import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, test, vi } from 'vitest';
import { POLL_JITTER_PCT, withJitter } from '../resilience';
import { createRouteURL } from '../router/createRouteURL';
import { versionRefetchInterval } from '.';
import { KubeObjectClass } from './KubeObject';
import Namespace from './namespace';

void createRouteURL;
void KubeObjectClass;
void Namespace;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('Finding E raw jitter trace during periodic option updates', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const randomValues = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6];
  let randomIndex = 0;
  const scheduledIntervals: number[] = [];
  const scheduledTimeouts: number[] = [];
  const clearedIntervals: unknown[] = [];
  const intervalCallbacks: unknown[] = [];
  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearInterval = globalThis.clearInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    const delayMs = Number(timeout ?? 0);
    scheduledIntervals.push(delayMs);
    console.log(`setInterval delayMs=${delayMs}`);
    return originalSetInterval(
      (...callbackArgs: unknown[]) => {
        intervalCallbacks.push(undefined);
        console.log('setInterval callback fired');
        if (typeof handler === 'function') {
          handler(...callbackArgs);
        }
      },
      timeout,
      ...args
    );
  });
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    const delayMs = Number(timeout ?? 0);
    scheduledTimeouts.push(delayMs);
    console.log(`setTimeout delayMs=${delayMs}`);
    return originalSetTimeout(handler, timeout, ...args);
  });
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(intervalId => {
    clearedIntervals.push(intervalId);
    console.log(`clearInterval intervalId=${String(intervalId)}`);
    originalClearInterval(intervalId);
  });
  vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = randomValues[randomIndex % randomValues.length];
    randomIndex += 1;
    return value;
  });

  const startedAt = Date.now();
  const queryCalls: number[] = [];
  const intervalEvaluations: Array<{ elapsedMs: number; intervalMs: number }> = [];
  const optionUpdates: number[] = [];
  console.log(`POLL_JITTER_PCT=${POLL_JITTER_PCT}`);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
    },
  });
  const options = {
    queryKey: ['finding-e-simulation'],
    queryFn: async () => {
      queryCalls.push(Date.now() - startedAt);
      return { version: 'success' };
    },
    refetchInterval: () => {
      const intervalMs = withJitter(versionRefetchInterval(0));
      const elapsedMs = Date.now() - startedAt;
      intervalEvaluations.push({ elapsedMs, intervalMs });
      console.log(`refetchInterval elapsedMs=${elapsedMs} intervalMs=${intervalMs}`);
      return intervalMs;
    },
    refetchIntervalInBackground: true,
    retry: false,
  };
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(() => undefined);

  try {
    await vi.advanceTimersByTimeAsync(0);

    for (let elapsedMs = 1_000; elapsedMs <= 180_000; elapsedMs += 1_000) {
      optionUpdates.push(elapsedMs);
      console.log(`observer.setOptions elapsedMs=${elapsedMs}`);
      observer.setOptions(options);
      await vi.advanceTimersByTimeAsync(1_000);
    }

    const gapsMs = queryCalls.slice(1).map((calledAt, index) => calledAt - queryCalls[index]);
    const gapsInsideExpectedRange = gapsMs.filter(gap => gap >= 8_500 && gap <= 11_500).length;
    const gapsOutsideExpectedRange = gapsMs.length - gapsInsideExpectedRange;

    console.log(
      JSON.stringify({
        queryFnInvocations: queryCalls.map(elapsedMs => ({ elapsedMs })),
        gapsMs,
        gapsInside8500To11500Ms: gapsInsideExpectedRange,
        gapsOutside8500To11500Ms: gapsOutsideExpectedRange,
        largestGapMs: Math.max(...gapsMs),
        refetchIntervalEvaluations: intervalEvaluations,
        observerSetOptionsCalls: optionUpdates,
        scheduledIntervals,
        scheduledTimeouts,
        clearedIntervals: clearedIntervals.map(String),
        intervalCallbackCount: intervalCallbacks.length,
      })
    );
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});
