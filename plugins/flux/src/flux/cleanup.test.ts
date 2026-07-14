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

import {
  CLEANUP_KINDS,
  CleanupItem,
  findRecentUninstalls,
  namespacesFromMessage,
  summarizeCleanup,
} from './cleanup';
import { FluxObject } from './utils';

const NOW = new Date('2026-07-14T12:00:00Z').getTime();

function event(overrides: Record<string, any>): FluxObject {
  return {
    reason: 'GarbageCollection',
    message: '',
    type: 'Normal',
    lastTimestamp: new Date(NOW - 60 * 1000).toISOString(),
    metadata: {},
    source: { component: 'kustomize-controller' },
    ...overrides,
  } as FluxObject;
}

describe('namespacesFromMessage', () => {
  it('extracts a namespace from a Helm uninstall message', () => {
    expect(namespacesFromMessage('Helm uninstall succeeded for release podinfo/podinfo.v3')).toEqual(
      ['podinfo']
    );
  });

  it('extracts a namespace from explicit namespace phrasing', () => {
    expect(namespacesFromMessage("pruned Deployment in namespace 'shop'")).toContain('shop');
  });
});

describe('findRecentUninstalls', () => {
  it('suggests namespaces from recent Flux deletion events', () => {
    const out = findRecentUninstalls(
      [
        event({
          source: { component: 'helm-controller' },
          reason: 'UninstallSucceeded',
          message: 'Helm uninstall succeeded for release shop/web.v2',
        }),
      ],
      { now: NOW }
    );
    expect(out).toHaveLength(1);
    expect(out[0].namespace).toBe('shop');
    expect(out[0].controller).toBe('helm-controller');
  });

  it('ignores events outside the time window', () => {
    const out = findRecentUninstalls(
      [
        event({
          lastTimestamp: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(),
          message: 'pruned Deployment shop/web',
        }),
      ],
      { now: NOW }
    );
    expect(out).toHaveLength(0);
  });

  it('ignores non-Flux and non-deletion events', () => {
    const out = findRecentUninstalls(
      [
        event({ source: { component: 'kubelet' }, message: 'deleted pod shop/web' }),
        event({ reason: 'ReconciliationSucceeded', message: 'applied shop/web' }),
      ],
      { now: NOW }
    );
    expect(out).toHaveLength(0);
  });

  it('never suggests Flux control namespaces', () => {
    const out = findRecentUninstalls(
      [
        event({
          reason: 'Finalization',
          message: 'garbage collection for deleted Kustomization flux-system/apps',
        }),
      ],
      { now: NOW }
    );
    expect(out).toHaveLength(0);
  });

  it('merges multiple events for the same namespace, keeping the newest', () => {
    const out = findRecentUninstalls(
      [
        event({
          lastTimestamp: new Date(NOW - 10 * 60 * 1000).toISOString(),
          message: 'pruned ConfigMap shop/cfg',
        }),
        event({
          lastTimestamp: new Date(NOW - 2 * 60 * 1000).toISOString(),
          reason: 'UninstallSucceeded',
          message: 'pruned Deployment shop/web',
        }),
      ],
      { now: NOW }
    );
    expect(out).toHaveLength(1);
    expect(out[0].namespace).toBe('shop');
    expect(out[0].eventCount).toBe(2);
    expect(out[0].reason).toBe('UninstallSucceeded');
  });
});

describe('CLEANUP_KINDS defaults', () => {
  it('keeps risky, data-bearing kinds off by default', () => {
    const off = new Set(
      CLEANUP_KINDS.filter(k => !k.defaultSelected).map(k => k.kind)
    );
    expect(off.has('PersistentVolumeClaim')).toBe(true);
    expect(off.has('RoleBinding')).toBe(true);
    const on = new Set(CLEANUP_KINDS.filter(k => k.defaultSelected).map(k => k.kind));
    expect(on.has('Pod')).toBe(true);
    expect(on.has('ConfigMap')).toBe(true);
    expect(on.has('Secret')).toBe(true);
  });
});

describe('summarizeCleanup', () => {
  it('tallies deleted and failed objects by kind', () => {
    const items: CleanupItem[] = [
      { kind: 'Pod', name: 'a', namespace: 'shop', status: 'deleted', force: false },
      { kind: 'Pod', name: 'b', namespace: 'shop', status: 'deleted', force: true },
      { kind: 'Pod', name: 'c', namespace: 'shop', status: 'failed', force: false, error: 'boom' },
      { kind: 'Secret', name: 's', namespace: 'shop', status: 'deleted', force: false },
      { kind: 'ConfigMap', name: 'cm', namespace: 'shop', status: 'pending', force: false },
    ];
    const summary = summarizeCleanup(items);
    expect(summary.totalDeleted).toBe(3);
    expect(summary.totalFailed).toBe(1);
    expect(summary.byKind).toEqual([
      { kind: 'Pod', deleted: 2, failed: 1 },
      { kind: 'Secret', deleted: 1, failed: 0 },
    ]);
  });
});
