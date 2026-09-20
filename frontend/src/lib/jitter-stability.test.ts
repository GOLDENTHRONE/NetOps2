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

// @vitest-environment jsdom

import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, test, vi } from 'vitest';
import { versionRefetchInterval } from './k8s';
import { KubeObjectClass } from './k8s/KubeObject';
import Namespace from './k8s/namespace';
import { POLL_JITTER_PCT, withStableJitter } from './resilience';
import { createRouteURL } from './router/createRouteURL';

void createRouteURL;
void KubeObjectClass;
void Namespace;

afterEach(() => {
  vi.useRealTimers();
});

test('reports jitter stability across periodic option updates', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });

  const startedAt = Date.now();
  const queryFnInvocations: number[] = [];
  const intervalCallbackFires: number[] = [];
  const refetchIntervalValues: number[] = [];
  let setIntervalCalls = 0;
  let clearIntervalCalls = 0;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    setIntervalCalls += 1;
    return originalSetInterval(
      (...callbackArgs: unknown[]) => {
        intervalCallbackFires.push(Date.now() - startedAt);
        if (typeof handler === 'function') {
          handler(...callbackArgs);
        }
      },
      timeout,
      ...args
    );
  });
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(intervalId => {
    clearIntervalCalls += 1;
    originalClearInterval(intervalId);
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
    },
  });
  const options = {
    queryKey: ['jitter-stability'],
    queryFn: async () => {
      queryFnInvocations.push(Date.now() - startedAt);
      return { ok: true };
    },
    refetchInterval: () => {
      const intervalMs = withStableJitter(versionRefetchInterval(0), 'test-cluster:version');
      console.log(
        `refetchIntervalEvaluation elapsedMs=${Date.now() - startedAt} intervalMs=${intervalMs}`
      );
      refetchIntervalValues.push(intervalMs);
      return intervalMs;
    },
    refetchIntervalInBackground: true,
    retry: false,
  };
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(() => undefined);

  try {
    await vi.advanceTimersByTimeAsync(0);

    for (let elapsedMs = 2_500; elapsedMs <= 180_000; elapsedMs += 2_500) {
      observer.setOptions(options);
      await vi.advanceTimersByTimeAsync(2_500);
    }

    const gapsMs = queryFnInvocations
      .slice(1)
      .map((calledAt, index) => calledAt - queryFnInvocations[index]);
    const gapsInsideExpectedRange = gapsMs.filter(gap => gap >= 8_500 && gap <= 11_500).length;
    const gapsOutsideExpectedRange = gapsMs.length - gapsInsideExpectedRange;
    const distinctRefetchIntervalValues = [...new Set(refetchIntervalValues)].sort(
      (left, right) => left - right
    );

    console.log(`pollJitterPct=${POLL_JITTER_PCT}`);
    console.log(`queryFnInvocations=${queryFnInvocations.join(',')}`);
    console.log(`gapsMs=${gapsMs.join(',')}`);
    console.log(`gapsInside8500To11500Ms=${gapsInsideExpectedRange}`);
    console.log(`gapsOutside8500To11500Ms=${gapsOutsideExpectedRange}`);
    console.log(`intervalCallbackFireCount=${intervalCallbackFires.length}`);
    console.log(`intervalCallbackFires=${intervalCallbackFires.join(',')}`);
    console.log(`setIntervalCalls=${setIntervalCalls}`);
    console.log(`clearIntervalCalls=${clearIntervalCalls}`);
    console.log(`distinctRefetchIntervalValues=${distinctRefetchIntervalValues.join(',')}`);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});
