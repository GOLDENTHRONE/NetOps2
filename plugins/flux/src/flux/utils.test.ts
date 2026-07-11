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
  computeDependencyWaves,
  getCommitInfo,
  getCommitWebUrl,
  getNextSyncTime,
  getSourceRef,
  getSourceWebUrl,
  getStatusInfo,
  makeDependencyNodes,
  parseDuration,
  parseRevision,
} from './utils';

describe('parseDuration', () => {
  it('parses common Go durations', () => {
    expect(parseDuration('10m')).toBe(600000);
    expect(parseDuration('1h30m')).toBe(5400000);
    expect(parseDuration('90s')).toBe(90000);
    expect(parseDuration('10m0s')).toBe(600000);
  });

  it('returns null for invalid inputs', () => {
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('getStatusInfo', () => {
  it('reports Ready', () => {
    const info = getStatusInfo({
      status: {
        conditions: [{ type: 'Ready', status: 'True', message: 'ok', reason: 'Succeeded' }],
      },
    });
    expect(info.health).toBe('Ready');
    expect(info.message).toBe('ok');
  });

  it('reports NotReady with the failure message', () => {
    const info = getStatusInfo({
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            message: 'kustomize build failed',
            reason: 'BuildFailed',
          },
        ],
      },
    });
    expect(info.health).toBe('NotReady');
    expect(info.message).toBe('kustomize build failed');
  });

  it('reports Suspended over other conditions', () => {
    const info = getStatusInfo({
      spec: { suspend: true },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    });
    expect(info.health).toBe('Suspended');
  });

  it('reports Reconciling when ready is unknown', () => {
    const info = getStatusInfo({
      status: {
        conditions: [
          { type: 'Ready', status: 'Unknown', reason: 'Progressing' },
          { type: 'Reconciling', status: 'True', message: 'working on it' },
        ],
      },
    });
    expect(info.health).toBe('Reconciling');
    expect(info.message).toBe('working on it');
  });
});

describe('getNextSyncTime', () => {
  it('returns null when suspended', () => {
    expect(
      getNextSyncTime({
        spec: { suspend: true, interval: '10m' },
        status: { artifact: { lastUpdateTime: new Date().toISOString() } },
      })
    ).toBeNull();
  });

  it('computes last sync + interval', () => {
    const last = new Date(Date.now() - 60_000).toISOString();
    const next = getNextSyncTime({
      spec: { interval: '10m' },
      status: { artifact: { lastUpdateTime: last } },
    });
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
    expect(next!.getTime()).toBeLessThanOrEqual(Date.now() + 600000);
  });
});

describe('parseRevision', () => {
  it('parses ref@algo:hash', () => {
    const rev = parseRevision('main@sha1:76d0e1b4d3b04dfbb9b12f8c34b3b12f8c34b3b1');
    expect(rev.ref).toBe('main');
    expect(rev.shortHash).toBe('76d0e1b4d3');
  });

  it('parses digest-only revisions', () => {
    const rev = parseRevision('sha256:abcdef0123456789');
    expect(rev.ref).toBeUndefined();
    expect(rev.shortHash).toBe('abcdef0123');
  });

  it('parses legacy branch/hash revisions', () => {
    const rev = parseRevision('main/76d0e1b4d3b04dfb');
    expect(rev.ref).toBe('main');
    expect(rev.hash).toBe('76d0e1b4d3b04dfb');
  });
});

describe('getCommitWebUrl', () => {
  it('handles https URLs', () => {
    expect(getCommitWebUrl('https://github.com/org/repo.git', 'abc')).toBe(
      'https://github.com/org/repo/commit/abc'
    );
  });

  it('handles ssh scp-like URLs', () => {
    expect(getCommitWebUrl('git@github.com:org/repo.git', 'abc')).toBe(
      'https://github.com/org/repo/commit/abc'
    );
  });

  it('uses the GitLab commit path for GitLab hosts', () => {
    expect(getCommitWebUrl('https://gitlab.com/org/repo', 'abc')).toBe(
      'https://gitlab.com/org/repo/-/commit/abc'
    );
  });

  it('returns undefined for unknown formats', () => {
    expect(getCommitWebUrl(undefined, 'abc')).toBeUndefined();
    expect(getCommitWebUrl('https://example.com/repo', undefined)).toBeUndefined();
  });
});

describe('getSourceWebUrl', () => {
  it('keeps https URLs and strips .git', () => {
    expect(getSourceWebUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo');
  });

  it('rewrites ssh URLs to https', () => {
    expect(getSourceWebUrl('ssh://git@github.com:22/org/repo.git')).toBe(
      'https://github.com/org/repo'
    );
  });

  it('rewrites scp-like git URLs to https', () => {
    expect(getSourceWebUrl('git@gitlab.com:org/repo.git')).toBe('https://gitlab.com/org/repo');
  });

  it('rewrites oci:// to https://', () => {
    expect(getSourceWebUrl('oci://ghcr.io/org/chart')).toBe('https://ghcr.io/org/chart');
  });

  it('returns undefined for non-browsable schemes', () => {
    expect(getSourceWebUrl('s3://my-bucket')).toBeUndefined();
    expect(getSourceWebUrl(undefined)).toBeUndefined();
  });
});

describe('getCommitInfo', () => {
  it('reads author/message/time from artifact metadata', () => {
    const info = getCommitInfo({
      status: {
        artifact: {
          lastUpdateTime: '2025-01-02T03:04:05Z',
          metadata: {
            'org.opencontainers.image.authors': 'Jane Doe <jane@example.com>',
            'org.opencontainers.image.title': 'Fix the thing\nmore detail',
          },
        },
      },
    });
    expect(info.author).toBe('Jane Doe <jane@example.com>');
    expect(info.message).toBe('Fix the thing');
    expect(info.time).toBe('2025-01-02T03:04:05Z');
  });

  it('returns empty info when no metadata', () => {
    expect(getCommitInfo({ status: {} })).toEqual({
      author: undefined,
      message: undefined,
      time: undefined,
    });
  });
});

describe('getSourceRef', () => {
  it('resolves Kustomization sourceRef', () => {
    expect(
      getSourceRef({
        metadata: { namespace: 'flux-system' },
        spec: { sourceRef: { kind: 'GitRepository', name: 'repo' } },
      })
    ).toEqual({ kind: 'GitRepository', name: 'repo', namespace: 'flux-system' });
  });

  it('resolves HelmRelease chart sourceRef', () => {
    expect(
      getSourceRef({
        metadata: { namespace: 'apps' },
        spec: {
          chart: {
            spec: {
              sourceRef: { kind: 'HelmRepository', name: 'bitnami', namespace: 'flux-system' },
            },
          },
        },
      })
    ).toEqual({ kind: 'HelmRepository', name: 'bitnami', namespace: 'flux-system' });
  });
});

describe('computeDependencyWaves', () => {
  const obj = (name: string, dependsOn: { name: string; namespace?: string }[] = []) => ({
    metadata: { name, namespace: 'flux-system' },
    spec: { dependsOn },
  });

  it('groups parallel items in the same wave and orders chains', () => {
    const nodes = makeDependencyNodes([
      obj('infra'),
      obj('cert-manager', [{ name: 'infra' }]),
      obj('ingress', [{ name: 'infra' }]),
      obj('apps', [{ name: 'cert-manager' }, { name: 'ingress' }]),
    ]);
    const { waves, cycles } = computeDependencyWaves(nodes);
    expect(cycles).toHaveLength(0);
    expect(waves).toHaveLength(3);
    expect(waves[0].map(n => n.name)).toEqual(['infra']);
    expect(waves[1].map(n => n.name).sort()).toEqual(['cert-manager', 'ingress']);
    expect(waves[2].map(n => n.name)).toEqual(['apps']);
  });

  it('detects cycles', () => {
    const nodes = makeDependencyNodes([
      obj('a', [{ name: 'b' }]),
      obj('b', [{ name: 'a' }]),
      obj('standalone'),
    ]);
    const { waves, cycles } = computeDependencyWaves(nodes);
    expect(waves).toHaveLength(1);
    expect(waves[0].map(n => n.name)).toEqual(['standalone']);
    expect(cycles.map(n => n.name).sort()).toEqual(['a', 'b']);
  });

  it('ignores dependencies outside the set', () => {
    const nodes = makeDependencyNodes([obj('a', [{ name: 'external', namespace: 'other' }])]);
    const { waves } = computeDependencyWaves(nodes);
    expect(waves[0][0].missingDependencies).toEqual(['other/external']);
    expect(waves[0][0].dependsOn).toEqual([]);
  });
});
