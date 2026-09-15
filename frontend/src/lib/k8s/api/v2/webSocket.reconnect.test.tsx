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
 * Real tests for the P1 legacy-watch auto-reconnect (useWebSockets), driving a
 * fake global WebSocket: an unexpected drop redials; an intentional close
 * (unmount) does NOT redial and leaves nothing open; leaving mid-reconnect stops
 * the loop. Uses the real webSocket.ts code (not a model).
 */

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WatchFreshnessChip from '../../../../components/cluster/WatchFreshnessChip';

vi.mock('../../../../helpers/getAppUrl', () => ({ getAppUrl: () => 'http://localhost:4466' }));
vi.mock('../../../../helpers/getHeadlampAPIHeaders', () => ({
  getHeadlampWebSocketProtocol: () => null,
}));
vi.mock('../../../../stateless/findKubeconfigByClusterName', () => ({
  findKubeconfigByClusterName: async () => null,
}));
vi.mock('../../../../stateless/getUserIdFromLocalStorage', () => ({
  getUserIdFromLocalStorage: () => '',
}));

import { useWebSockets } from './webSocket';

/** Minimal fake WebSocket that records instances and lets tests fire events. */
class MockWS {
  static instances: MockWS[] = [];
  static openCount = 0;
  url: string;
  protocols: any;
  binaryType = 'blob';
  readyState = 0;
  closedIntentionally = false;
  private handlers: Record<string, Array<(ev: any) => void>> = {};
  constructor(url: string, protocols?: any) {
    this.url = url;
    this.protocols = protocols;
    MockWS.instances.push(this);
    MockWS.openCount += 1;
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    (this.handlers[type] ||= []).push(cb);
  }
  removeEventListener() {}
  close() {
    this.readyState = 3;
    this.fire('close', { code: 1000 });
  }
  fire(type: string, ev: any) {
    (this.handlers[type] || []).forEach(cb => cb(ev));
  }
  /** simulate the server/network dropping the socket unexpectedly */
  drop() {
    this.readyState = 3;
    this.fire('close', { code: 1006 });
  }
  static get open() {
    return MockWS.instances.filter(s => s.readyState !== 3).length;
  }
  static reset() {
    MockWS.instances = [];
    MockWS.openCount = 0;
  }
}

const conn = (onMessage = () => {}) => [{ cluster: '', url: '/watch/pods', onMessage }];

beforeEach(() => {
  MockWS.reset();
  (globalThis as any).WebSocket = MockWS as any;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWebSockets — P1 auto-reconnect', () => {
  it('opens a socket and delivers messages', async () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSockets({ connections: conn(onMessage), type: 'json' }));
    await waitFor(() => expect(MockWS.instances.length).toBe(1));
    act(() => MockWS.instances[0].fire('message', { data: JSON.stringify({ hello: 1 }) }));
    expect(onMessage).toHaveBeenCalledWith({ hello: 1 });
  });

  it('reconnects after an UNEXPECTED drop (new socket opens)', async () => {
    renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await waitFor(() => expect(MockWS.instances.length).toBe(1));
    act(() => MockWS.instances[0].drop()); // unexpected close
    // a redial is scheduled with backoff (~1s) — wait for the new socket
    await waitFor(() => expect(MockWS.instances.length).toBe(2), { timeout: 4000 });
    expect(MockWS.open).toBe(1); // exactly one live socket, no leak
  }, 10000);

  it('does NOT reconnect after an intentional close (unmount)', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await waitFor(() => expect(MockWS.instances.length).toBe(1));
    act(() => unmount()); // cleanup closes the socket on purpose
    // give any (wrong) reconnect time to fire — none should
    await new Promise(r => setTimeout(r, 1500));
    expect(MockWS.instances.length).toBe(1);
    expect(MockWS.open).toBe(0); // closed, nothing left open
  }, 10000);

  it('stops the reconnect loop if the page is left mid-reconnect', async () => {
    const { unmount } = renderHook(() => useWebSockets({ connections: conn(), type: 'json' }));
    await waitFor(() => expect(MockWS.instances.length).toBe(1));
    act(() => MockWS.instances[0].drop()); // schedules a reconnect
    act(() => unmount()); // leave before the timer fires
    await new Promise(r => setTimeout(r, 1500));
    expect(MockWS.instances.length).toBe(1); // never redialed
    expect(MockWS.open).toBe(0);
  }, 10000);
});

// Item 3: the freshness chip reflects the reconnecting state end-to-end.
function FreshnessHarness() {
  useWebSockets({ connections: conn(), type: 'json' });
  return <WatchFreshnessChip />;
}

describe('WatchFreshnessChip — P1 freshness indicator', () => {
  it('is hidden while live, shows on a drop, and hides again after reconnect', async () => {
    // Match regardless of whether an i18n instance is initialised in this test
    // context (raw key "translation|Reconnecting live updates…" vs the resolved text).
    const CHIP = /Reconnecting live updates/;
    render(<FreshnessHarness />);
    await waitFor(() => expect(MockWS.instances.length).toBe(1));
    // live -> no chip
    expect(screen.queryByText(CHIP)).not.toBeInTheDocument();

    act(() => MockWS.instances[0].drop());
    // reconnecting -> chip appears
    await waitFor(() => expect(screen.getByText(CHIP)).toBeInTheDocument());

    // after the redial succeeds -> chip disappears
    await waitFor(() => expect(MockWS.instances.length).toBe(2), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByText(CHIP)).not.toBeInTheDocument());
  }, 10000);
});
