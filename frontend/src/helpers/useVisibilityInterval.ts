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

import { useEffect, useRef } from 'react';

/**
 * Calls `callback` on an interval that pauses when the browser tab is hidden
 * and resumes (with an immediate fire) when visible again.
 *
 * @param callback - Function to call each tick and on tab-return.
 * @param intervalMs - Interval in milliseconds.
 */
export function useVisibilityInterval(callback: () => void, intervalMs: number) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function tick() {
      cbRef.current();
    }

    function start() {
      if (intervalId) return;
      intervalId = setInterval(tick, intervalMs);
    }

    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stop();
      } else {
        tick();
        start();
      }
    }

    start();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs]);
}
