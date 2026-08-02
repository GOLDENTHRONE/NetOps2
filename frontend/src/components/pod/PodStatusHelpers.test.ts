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
import App from '../../App';
import { KubeContainerStatus } from '../../lib/k8s/cluster';
import { KubeEvent } from '../../lib/k8s/event';
import Pod from '../../lib/k8s/pod';
import {
  getContainerEventReason,
  getContainerReason,
  getPodEventReason,
  getPodStatusDisplay,
} from './List';

// cyclic imports fix
// eslint-disable-next-line no-unused-vars
const _dont_delete_me = App;

const t = ((key: string, opts?: Record<string, unknown>) => {
  const raw = key.includes('|') ? key.split('|').slice(1).join('|') : key;
  if (!opts) return raw;
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(opts[name] ?? ''));
}) as any;

function makePod(overrides: Partial<any>): Pod {
  const base = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'p', namespace: 'default', resourceVersion: '1' },
    spec: { containers: [{ name: 'c1' }] },
    status: {
      phase: 'Running',
      containerStatuses: [],
      conditions: [],
    },
  };
  const merged = {
    ...base,
    ...overrides,
    status: { ...base.status, ...(overrides.status || {}) },
  };
  return new Pod(merged as any);
}

function makeContainerStatus(overrides: Partial<KubeContainerStatus>): KubeContainerStatus {
  return {
    name: 'c1',
    image: 'nginx',
    imageID: '',
    ready: true,
    restartCount: 0,
    lastState: {},
    state: {},
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<KubeEvent> & { time?: string; fieldPath?: string }
): KubeEvent {
  const ts = overrides.time || '2026-08-01T12:00:00Z';
  return {
    type: 'Warning',
    reason: 'Unhealthy',
    message: '',
    metadata: { name: 'ev', namespace: 'default', creationTimestamp: ts } as any,
    involvedObject: {
      kind: 'Pod',
      namespace: 'default',
      name: 'p',
      uid: 'u',
      apiVersion: 'v1',
      resourceVersion: '1',
      fieldPath: overrides.fieldPath ?? '',
    },
    lastTimestamp: ts,
    ...overrides,
  };
}

describe('getPodStatusDisplay', () => {
  it('classifies a Running + Ready pod as success with proper description', () => {
    const pod = makePod({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'True' } as any],
        containerStatuses: [],
      },
    });
    const res = getPodStatusDisplay(pod, t);
    expect(res.category).toBe('success');
    expect(res.ready).toBe(true);
    expect(res.phase).toBe('Running');
    expect(res.description).toMatch(/running and ready/i);
  });

  it('relabels Running-but-not-Ready as "Not Ready" and gives warning description', () => {
    const pod = makePod({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' } as any],
        containerStatuses: [],
      },
    });
    const res = getPodStatusDisplay(pod, t);
    expect(res.category).toBe('warning');
    expect(res.label).toBe('Not Ready');
    expect(res.ready).toBe(false);
    expect(res.description).toMatch(/not ready to receive traffic/i);
  });

  it('classifies a Succeeded pod as success with "completed" description', () => {
    const pod = makePod({ status: { phase: 'Succeeded', conditions: [], containerStatuses: [] } });
    const res = getPodStatusDisplay(pod, t);
    expect(res.category).toBe('success');
    expect(res.description).toMatch(/completed successfully/i);
  });

  it('classifies a Failed pod as error', () => {
    const pod = makePod({ status: { phase: 'Failed', conditions: [], containerStatuses: [] } });
    const res = getPodStatusDisplay(pod, t);
    expect(res.category).toBe('error');
    expect(res.description).toMatch(/failed/i);
  });

  it('classifies a Pending pod as neutral with "waiting to start" description', () => {
    // getPodStatus in List.tsx only maps Failed/Succeeded/Running to categories;
    // Pending falls through to '' → 'neutral'. Description is still tied to phase.
    const pod = makePod({ status: { phase: 'Pending', conditions: [], containerStatuses: [] } });
    const res = getPodStatusDisplay(pod, t);
    expect(res.category).toBe('neutral');
    expect(res.description).toMatch(/waiting to start/i);
  });

  it('surfaces a real derived message from a waiting container', () => {
    // pod.getDetailedStatus() derives `message` from container state (not from
    // pod.status.message). A waiting container with a message is the real source.
    const pod = makePod({
      spec: { containers: [{ name: 'c1' }] },
      status: {
        phase: 'Pending',
        conditions: [],
        containerStatuses: [
          {
            name: 'c1',
            image: 'nginx',
            imageID: '',
            ready: false,
            restartCount: 0,
            lastState: {},
            state: {
              waiting: {
                reason: 'ImagePullBackOff',
                message: 'Back-off pulling image "x"',
              },
            },
          },
        ],
      },
    });
    const res = getPodStatusDisplay(pod, t);
    expect(res.message).toBe('Back-off pulling image "x"');
  });
});

describe('getContainerReason', () => {
  it('returns "" for a healthy running container', () => {
    const pod = makePod({});
    const cs = makeContainerStatus({
      ready: true,
      state: { running: { startedAt: '2026-08-01T00:00:00Z' } },
    });
    expect(getContainerReason(cs, pod)).toBe('');
  });

  it('returns waiting.reason with message when both present', () => {
    const pod = makePod({});
    const cs = makeContainerStatus({
      ready: false,
      state: {
        waiting: {
          reason: 'ImagePullBackOff',
          message: 'Back-off pulling image "x"',
        },
      },
    });
    expect(getContainerReason(cs, pod)).toBe('ImagePullBackOff — Back-off pulling image "x"');
  });

  it('returns waiting.reason alone when no message', () => {
    const pod = makePod({});
    const cs = makeContainerStatus({
      ready: false,
      state: { waiting: { reason: 'CrashLoopBackOff' } },
    });
    expect(getContainerReason(cs, pod)).toBe('CrashLoopBackOff');
  });

  it('returns terminated.reason with exit code and message', () => {
    const pod = makePod({});
    const cs = makeContainerStatus({
      ready: false,
      state: {
        terminated: {
          reason: 'Error',
          exitCode: 1,
          message: 'boom',
          containerID: '',
          finishedAt: '',
          startedAt: '',
        },
      },
    });
    expect(getContainerReason(cs, pod)).toBe('Error · exit 1 — boom');
  });

  it('handles terminated with exitCode 0 (Completed)', () => {
    const pod = makePod({});
    const cs = makeContainerStatus({
      ready: false,
      state: {
        terminated: {
          reason: 'Completed',
          exitCode: 0,
          containerID: '',
          finishedAt: '',
          startedAt: '',
        },
      },
    });
    expect(getContainerReason(cs, pod)).toBe('Completed · exit 0');
  });

  it('falls back to pod Ready condition when running-but-not-ready', () => {
    const pod = makePod({
      status: {
        phase: 'Running',
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            reason: 'ContainersNotReady',
            message: 'containers with unready status: [c1]',
          } as any,
        ],
        containerStatuses: [],
      },
    });
    const cs = makeContainerStatus({
      ready: false,
      state: { running: { startedAt: '2026-08-01T00:00:00Z' } },
    });
    expect(getContainerReason(cs, pod)).toBe('containers with unready status: [c1]');
  });

  it('uses condition reason when message is absent', () => {
    const pod = makePod({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' } as any],
        containerStatuses: [],
      },
    });
    const cs = makeContainerStatus({
      ready: false,
      state: { running: { startedAt: '2026-08-01T00:00:00Z' } },
    });
    expect(getContainerReason(cs, pod)).toBe('ContainersNotReady');
  });

  it('falls back to lastState.terminated when no Ready condition available', () => {
    const pod = makePod({
      status: { phase: 'Running', conditions: [], containerStatuses: [] },
    });
    const cs = makeContainerStatus({
      ready: false,
      state: { running: { startedAt: '2026-08-01T00:00:00Z' } },
      lastState: {
        terminated: {
          reason: 'OOMKilled',
          exitCode: 137,
          containerID: '',
          finishedAt: '',
          startedAt: '',
        },
      },
    });
    expect(getContainerReason(cs, pod)).toBe('Last exit: OOMKilled');
  });

  it('does not fabricate a reason for running-and-ready containers even with condition present', () => {
    const pod = makePod({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' } as any],
        containerStatuses: [],
      },
    });
    const cs = makeContainerStatus({
      ready: true, // container itself is ready
      state: { running: { startedAt: '2026-08-01T00:00:00Z' } },
    });
    expect(getContainerReason(cs, pod)).toBe('');
  });
});

describe('getContainerEventReason', () => {
  it('returns "" when no events', () => {
    expect(getContainerEventReason([], 'c1')).toBe('');
  });

  it('picks the latest Warning event matching fieldPath spec.containers{name}', () => {
    const older = makeEvent({
      reason: 'Unhealthy',
      message: 'Readiness probe failed: HTTP 500',
      fieldPath: 'spec.containers{c1}',
      time: '2026-07-30T10:00:00Z',
    });
    const newer = makeEvent({
      reason: 'Unhealthy',
      message: 'Readiness probe failed: HTTP 503',
      fieldPath: 'spec.containers{c1}',
      time: '2026-08-01T10:00:00Z',
    });
    expect(getContainerEventReason([older, newer], 'c1')).toBe(
      'Unhealthy: Readiness probe failed: HTTP 503'
    );
  });

  it('ignores Normal-type events', () => {
    const normal = makeEvent({
      type: 'Normal',
      reason: 'Pulled',
      message: 'Image pulled',
      fieldPath: 'spec.containers{c1}',
    });
    expect(getContainerEventReason([normal], 'c1')).toBe('');
  });

  it('ignores events for a different container', () => {
    const ev = makeEvent({
      reason: 'Unhealthy',
      message: 'Readiness probe failed',
      fieldPath: 'spec.containers{other}',
    });
    expect(getContainerEventReason([ev], 'c1')).toBe('');
  });

  it('handles events with reason-only or message-only', () => {
    const reasonOnly = makeEvent({
      reason: 'BackOff',
      message: '',
      fieldPath: 'spec.containers{c1}',
    });
    expect(getContainerEventReason([reasonOnly], 'c1')).toBe('BackOff');

    const msgOnly = makeEvent({
      reason: '',
      message: 'Something wrong',
      fieldPath: 'spec.containers{c1}',
    });
    expect(getContainerEventReason([msgOnly], 'c1')).toBe('Something wrong');
  });

  it('trims whitespace in event message', () => {
    const ev = makeEvent({
      reason: 'Unhealthy',
      message: '   Readiness probe failed  ',
      fieldPath: 'spec.containers{c1}',
    });
    expect(getContainerEventReason([ev], 'c1')).toBe('Unhealthy: Readiness probe failed');
  });

  it('is not confused by container name being a substring of another container', () => {
    const ev = makeEvent({
      reason: 'Unhealthy',
      message: 'probe failed',
      fieldPath: 'spec.containers{c1x}',
    });
    expect(getContainerEventReason([ev], 'c1')).toBe('');
  });
});

describe('getPodEventReason', () => {
  it('returns "" when no events', () => {
    expect(getPodEventReason([])).toBe('');
  });

  it('picks pod-scoped Warning event (fieldPath without curly brace)', () => {
    const ev = makeEvent({
      reason: 'FailedScheduling',
      message: '0/3 nodes are available: 3 Insufficient cpu.',
      fieldPath: '',
    });
    expect(getPodEventReason([ev])).toBe(
      'FailedScheduling: 0/3 nodes are available: 3 Insufficient cpu.'
    );
  });

  it('ignores container-scoped events', () => {
    const ev = makeEvent({
      reason: 'Unhealthy',
      message: 'probe failed',
      fieldPath: 'spec.containers{c1}',
    });
    expect(getPodEventReason([ev])).toBe('');
  });

  it('ignores Normal-type events', () => {
    const ev = makeEvent({
      type: 'Normal',
      reason: 'Scheduled',
      message: 'Successfully assigned',
      fieldPath: '',
    });
    expect(getPodEventReason([ev])).toBe('');
  });

  it('picks the latest among multiple pod-level warnings', () => {
    const older = makeEvent({
      reason: 'FailedMount',
      message: 'old',
      fieldPath: '',
      time: '2026-07-01T00:00:00Z',
    });
    const newer = makeEvent({
      reason: 'FailedScheduling',
      message: 'new',
      fieldPath: '',
      time: '2026-08-01T00:00:00Z',
    });
    expect(getPodEventReason([older, newer])).toBe('FailedScheduling: new');
  });

  it('falls back through timestamp sources (eventTime → firstTimestamp → creationTimestamp)', () => {
    const noLast = makeEvent({
      reason: 'FailedMount',
      message: 'a',
      fieldPath: '',
    });
    delete (noLast as any).lastTimestamp;
    (noLast as any).eventTime = '2026-08-05T00:00:00Z';
    const withLast = makeEvent({
      reason: 'FailedScheduling',
      message: 'b',
      fieldPath: '',
      time: '2026-08-01T00:00:00Z',
    });
    expect(getPodEventReason([noLast, withLast])).toBe('FailedMount: a');
  });
});
