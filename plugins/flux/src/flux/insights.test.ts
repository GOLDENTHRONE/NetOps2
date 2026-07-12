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
  collectDownstream,
  collectUpstream,
  diagnose,
  extractMentionedResources,
  getFailureCounts,
  getTargetNamespaces,
  isBlockedOnDependency,
  pluralizeKind,
  summarizeWave,
} from './insights';
import { FluxObject, makeDependencyNodes } from './utils';

function notReady(reason: string, message: string, extra: Partial<FluxObject> = {}): FluxObject {
  return {
    kind: 'Kustomization',
    metadata: { name: 'app', namespace: 'apps' },
    ...extra,
    status: {
      conditions: [{ type: 'Ready', status: 'False', reason, message }],
      ...(extra.status ?? {}),
    },
  };
}

describe('diagnose', () => {
  it('reports healthy resources as ok', () => {
    const d = diagnose({
      status: { conditions: [{ type: 'Ready', status: 'True', reason: 'Succeeded' }] },
    });
    expect(d.category).toBe('ok');
  });

  it('explains suspended resources', () => {
    const d = diagnose({ spec: { suspend: true } });
    expect(d.category).toBe('suspended');
    expect(d.headline).toContain('Paused');
  });

  it('detects a dependency block and extracts the dependency id', () => {
    const d = diagnose(
      notReady('DependencyNotReady', "dependency 'flux-system/infra' is not ready")
    );
    expect(d.category).toBe('dependency');
    expect(d.blockedOn).toEqual(['flux-system/infra']);
  });

  it('qualifies unqualified dependency names with the resource namespace', () => {
    const d = diagnose(notReady('DependencyNotReady', "dependency 'database' is not ready"));
    expect(d.blockedOn).toEqual(['apps/database']);
  });

  it('recognizes Helm install failures with hook problems', () => {
    const d = diagnose(
      notReady('InstallFailed', 'Helm install failed: failed post-install: 1 error occurred')
    );
    expect(d.category).toBe('helm');
    expect(d.headline).toContain('install failed');
    expect(d.action).toContain('hook');
  });

  it('recognizes missing CRDs as a cluster problem', () => {
    const d = diagnose(
      notReady(
        'ReconciliationFailed',
        'CustomResourceDefinition/foo dry-run failed: no matches for kind "Certificate"'
      )
    );
    expect(d.category).toBe('cluster');
    expect(d.explanation).toContain('CRD');
  });

  it('recognizes authentication failures', () => {
    const d = diagnose(notReady('GitOperationFailed', 'unable to clone: authentication required'));
    expect(d.category).toBe('auth');
    expect(d.action).toContain('Secret');
  });

  it('recognizes image pull problems', () => {
    const d = diagnose(
      notReady('HealthCheckFailed', 'deployment web: pod stuck in ImagePullBackOff')
    );
    expect(d.category).toBe('image');
  });

  it('recognizes failed health checks as a rollout problem', () => {
    const d = diagnose(
      notReady('HealthCheckFailed', 'timeout waiting for Deployment/apps/web to become ready')
    );
    expect(d.category).toBe('rollout');
  });

  it('treats a reconciling resource as progressing', () => {
    const d = diagnose({
      status: {
        conditions: [
          { type: 'Ready', status: 'Unknown', reason: 'Progressing', message: 'applying' },
          { type: 'Reconciling', status: 'True', reason: 'Progressing', message: 'applying' },
        ],
      },
    });
    expect(d.category).toBe('progressing');
  });

  it('falls back to the raw message for unknown failures', () => {
    const d = diagnose(notReady('SomethingNew', 'mystery problem'));
    expect(d.category).toBe('unknown');
    expect(d.explanation).toBe('mystery problem');
  });
});

describe('isBlockedOnDependency', () => {
  it('is true only for dependency-caused failures', () => {
    expect(
      isBlockedOnDependency(
        notReady('DependencyNotReady', "dependency 'flux-system/infra' is not ready")
      )
    ).toBe(true);
    expect(isBlockedOnDependency(notReady('BuildFailed', 'kustomize build failed'))).toBe(false);
    expect(isBlockedOnDependency({ spec: { suspend: true } })).toBe(false);
  });
});

describe('getFailureCounts', () => {
  it('collects HelmRelease failure counters', () => {
    expect(
      getFailureCounts({ status: { failures: 4, installFailures: 1, upgradeFailures: 3 } })
    ).toEqual({ total: 4, install: 1, upgrade: 3 });
  });

  it('omits zero and missing counters', () => {
    expect(getFailureCounts({ status: { failures: 0 } })).toEqual({});
    expect(getFailureCounts({})).toEqual({});
  });
});

describe('getTargetNamespaces', () => {
  it('derives namespaces from the inventory', () => {
    const ns = getTargetNamespaces({
      status: {
        inventory: {
          entries: [
            { id: 'apps_web_apps_Deployment' },
            { id: 'apps_web_' },
            { id: '_cluster-role__ClusterRole' },
            { id: 'monitoring_grafana_apps_Deployment' },
          ],
        },
      },
    });
    expect(ns).toEqual(['apps', 'monitoring']);
  });

  it('includes spec.targetNamespace', () => {
    const ns = getTargetNamespaces({ spec: { targetNamespace: 'prod' } });
    expect(ns).toEqual(['prod']);
  });

  it('falls back to the release namespace for HelmReleases', () => {
    const ns = getTargetNamespaces({
      kind: 'HelmRelease',
      metadata: { name: 'app', namespace: 'apps' },
    });
    expect(ns).toEqual(['apps']);
  });
});

describe('collectUpstream / collectDownstream', () => {
  const objects: FluxObject[] = [
    { metadata: { name: 'infra', namespace: 'ns' } },
    { metadata: { name: 'db', namespace: 'ns' }, spec: { dependsOn: [{ name: 'infra' }] } },
    { metadata: { name: 'app', namespace: 'ns' }, spec: { dependsOn: [{ name: 'db' }] } },
    { metadata: { name: 'other', namespace: 'ns' } },
  ];
  const nodes = makeDependencyNodes(objects);

  it('collects transitive upstream dependencies', () => {
    expect(collectUpstream(nodes, 'ns/app')).toEqual(new Set(['ns/db', 'ns/infra']));
    expect(collectUpstream(nodes, 'ns/infra').size).toBe(0);
  });

  it('collects transitive downstream dependents', () => {
    expect(collectDownstream(nodes, 'ns/infra')).toEqual(new Set(['ns/db', 'ns/app']));
    expect(collectDownstream(nodes, 'ns/app').size).toBe(0);
  });
});

describe('extractMentionedResources', () => {
  it('extracts Kind/namespace/name references from health check failures', () => {
    const refs = extractMentionedResources(
      "health check failed: [Deployment/apps/web status: 'Failed', Pod/apps/web-abc123 not ready]"
    );
    expect(refs).toEqual([
      { kind: 'Deployment', namespace: 'apps', name: 'web' },
      { kind: 'Pod', namespace: 'apps', name: 'web-abc123' },
    ]);
  });

  it('extracts Kind/name references without a namespace', () => {
    const refs = extractMentionedResources('HelmChart/podinfo is not ready');
    expect(refs).toEqual([{ kind: 'HelmChart', name: 'podinfo' }]);
  });

  it('ignores unknown kinds and deduplicates', () => {
    const refs = extractMentionedResources(
      'Foo/bar/baz failed; Deployment/apps/web failed; Deployment/apps/web still failing'
    );
    expect(refs).toEqual([{ kind: 'Deployment', namespace: 'apps', name: 'web' }]);
  });

  it('returns nothing for empty messages', () => {
    expect(extractMentionedResources(undefined)).toEqual([]);
    expect(extractMentionedResources('all good')).toEqual([]);
  });
});

describe('pluralizeKind', () => {
  it('pluralizes common kinds the way Kubernetes does', () => {
    expect(pluralizeKind('VaultStaticSecret')).toBe('vaultstaticsecrets');
    expect(pluralizeKind('Ingress')).toBe('ingresses');
    expect(pluralizeKind('NetworkPolicy')).toBe('networkpolicies');
    expect(pluralizeKind('Gateway')).toBe('gateways');
  });
});

describe('summarizeWave', () => {
  it('classifies wave states', () => {
    expect(summarizeWave(['Ready', 'Ready'])).toBe('complete');
    expect(summarizeWave(['Ready', 'Suspended'])).toBe('complete');
    expect(summarizeWave(['Ready', 'NotReady'])).toBe('blocked');
    expect(summarizeWave(['Ready', 'Reconciling'])).toBe('active');
    expect(summarizeWave(['Unknown'])).toBe('waiting');
    expect(summarizeWave([])).toBe('waiting');
  });
});
