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

import { act,renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibilityInterval } from './useVisibilityInterval';

describe('useVisibilityInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback on each interval tick', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000));

    cb.mockClear();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does not call callback while document.hidden === true', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Simulate tab hidden.
    Object.defineProperty(document, 'hidden', { value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    cb.mockClear();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires immediate callback on tab becoming visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Go hidden.
    Object.defineProperty(document, 'hidden', { value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    cb.mockClear();

    // Come back visible.
    Object.defineProperty(document, 'hidden', { value: false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resumes interval after tab becomes visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityInterval(cb, 1000));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Go hidden.
    Object.defineProperty(document, 'hidden', { value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Come back visible — this restarts the interval.
    Object.defineProperty(document, 'hidden', { value: false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    cb.mockClear();
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('cleans up listener and interval on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibilityInterval(cb, 1000));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    unmount();
    cb.mockClear();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
