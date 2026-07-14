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
  Application,
  buildApplications,
  collectDownstream,
  collectUpstream,
  diagnose,
  extractMentionedResources,
  getFailureCounts,
  getTargetNamespaces,
  isBlockedOnDependency,
  memberOperation,
  pluralizeKind,
  summarizeApplication,
  summarizeAppLifecycle,
  summarizeAppPods,
  summarizeAppRollout,
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

describe('buildApplications', () => {
  const gitSource = { kind: 'GitRepository', name: 'cnf-gitops' };
  const rootA: FluxObject = {
    kind: 'Kustomization',
    metadata: { name: 'infra', namespace: 'flux-system' },
    spec: { sourceRef: gitSource },
    status: {
      inventory: {
        entries: [{ id: 'apps_web_apps_Deployment' }, { id: 'apps_cfg__ConfigMap' }],
      },
    },
  };
  const rootB: FluxObject = {
    kind: 'Kustomization',
    metadata: { name: 'apps', namespace: 'flux-system' },
    spec: { sourceRef: gitSource },
  };
  const child: FluxObject = {
    kind: 'HelmRelease',
    metadata: {
      name: 'db',
      namespace: 'apps',
      labels: {
        'kustomize.toolkit.fluxcd.io/name': 'apps',
        'kustomize.toolkit.fluxcd.io/namespace': 'flux-system',
      },
    },
    spec: { targetNamespace: 'apps' },
  };
  const standalone: FluxObject = {
    kind: 'HelmRelease',
    metadata: { name: 'solo', namespace: 'tools' },
  };

  it('merges everything from one source into one application', () => {
    const apps = buildApplications([
      { kind: 'Kustomization', object: rootA },
      { kind: 'Kustomization', object: rootB },
      { kind: 'HelmRelease', object: child },
      { kind: 'HelmRelease', object: standalone },
    ]);
    expect(apps.map(a => a.name).sort()).toEqual(['cnf-gitops', 'solo']);

    const repoApp = apps.find(a => a.name === 'cnf-gitops')!;
    expect(repoApp.rootKind).toBe('GitRepository');
    expect(repoApp.namespace).toBe('flux-system');
    expect(repoApp.members).toHaveLength(3);
    expect(repoApp.targetNamespaces).toEqual(['apps']);
    expect(repoApp.workloadPrefixes).toContainEqual({ namespace: 'apps', prefix: 'web' });
    expect(repoApp.workloadPrefixes).toContainEqual({ namespace: 'apps', prefix: 'db' });

    const soloApp = apps.find(a => a.name === 'solo')!;
    expect(soloApp.rootKind).toBe('HelmRelease');
    expect(soloApp.targetNamespaces).toEqual(['tools']);
  });
});

describe('summarizeAppPods', () => {
  const app: Application = {
    id: 'Kustomization/flux-system/app-root',
    name: 'app-root',
    namespace: 'flux-system',
    displayName: 'app-root',
    labelGrouped: false,
    rootKind: 'Kustomization',
    members: [],
    targetNamespaces: ['apps'],
    appNamespaces: ['apps'],
    managedByFlux: false,
    workloadPrefixes: [{ namespace: 'apps', prefix: 'web' }],
  };
  const pods: FluxObject[] = [
    {
      metadata: { name: 'web-abc', namespace: 'apps' },
      status: { phase: 'Running', containerStatuses: [{ ready: true }] },
    },
    {
      metadata: { name: 'web-def', namespace: 'apps' },
      status: {
        phase: 'Pending',
        containerStatuses: [{ ready: false, state: { waiting: { reason: 'ImagePullBackOff' } } }],
      },
    },
    // Same namespace, different workload: not this app's pod.
    {
      metadata: { name: 'other-1', namespace: 'apps' },
      status: { phase: 'Running', containerStatuses: [{ ready: true }] },
    },
    // Different namespace entirely.
    {
      metadata: { name: 'web-zzz', namespace: 'monitoring' },
      status: { phase: 'Running', containerStatuses: [{ ready: true }] },
    },
  ];

  it('counts ready pods and surfaces concrete issues', () => {
    const summary = summarizeAppPods(app, pods);
    expect(summary.total).toBe(2);
    expect(summary.ready).toBe(1);
    expect(summary.issues).toEqual([
      { name: 'web-def', namespace: 'apps', reason: 'ImagePullBackOff' },
    ]);
  });
});

describe('summarizeApplication', () => {
  const makeApp = (members: FluxObject[]): Application => ({
    id: 'x',
    name: 'x',
    namespace: 'ns',
    displayName: 'x',
    labelGrouped: false,
    rootKind: 'Kustomization',
    members: members.map(object => ({ kind: object.kind ?? 'Kustomization', object })),
    targetNamespaces: [],
    appNamespaces: [],
    managedByFlux: false,
    workloadPrefixes: [],
  });
  const ready: FluxObject = {
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };
  const failing: FluxObject = {
    status: { conditions: [{ type: 'Ready', status: 'False', reason: 'BuildFailed' }] },
  };
  const reconciling: FluxObject = {
    status: { conditions: [{ type: 'Ready', status: 'Unknown', reason: 'Progressing' }] },
  };

  it('judges the whole application', () => {
    expect(summarizeApplication(makeApp([ready, failing])).health).toBe('Failing');
    expect(summarizeApplication(makeApp([ready, reconciling])).health).toBe('Deploying');
    expect(summarizeApplication(makeApp([ready, ready])).health).toBe('Healthy');
    expect(summarizeApplication(makeApp([ready]), { total: 3, ready: 2, issues: [] }).health).toBe(
      'Degraded'
    );
    expect(summarizeApplication(makeApp([ready]), { total: 3, ready: 3, issues: [] }).health).toBe(
      'Healthy'
    );
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

describe('buildApplications with application-name labels', () => {
  const labelled = (name: string, ns: string, label: string, extra: Partial<FluxObject> = {}) => ({
    kind: 'Kustomization',
    object: {
      kind: 'Kustomization',
      metadata: { name, namespace: ns, labels: { 'uspe.dev/application-name': label } },
      spec: { sourceRef: { kind: 'GitRepository', name: 'gitops' } },
      ...extra,
    } as FluxObject,
  });

  it('keeps a labelled app grouped even after its root Kustomization is gone', () => {
    // Only the child appliers remain; the root that defined them was deleted.
    const apps = buildApplications([
      labelled('web', 'flux-system', 'shop', {
        status: { inventory: { entries: [{ id: 'shop_web_apps_Deployment' }] } },
      } as any),
      labelled('api', 'flux-system', 'shop'),
    ]);
    expect(apps).toHaveLength(1);
    expect(apps[0].displayName).toBe('shop');
    expect(apps[0].labelGrouped).toBe(true);
    expect(apps[0].members).toHaveLength(2);
  });

  it('surfaces the application-version label', () => {
    const apps = buildApplications([
      {
        kind: 'HelmRelease',
        object: {
          kind: 'HelmRelease',
          metadata: {
            name: 'web',
            namespace: 'flux-system',
            labels: {
              'uspe.dev/application-name': 'shop',
              'uspe.dev/application-version': '1.4.2',
            },
          },
          spec: { targetNamespace: 'shop' },
        } as FluxObject,
      },
    ]);
    expect(apps[0].version).toBe('1.4.2');
    expect(apps[0].displayName).toBe('shop');
  });
});

describe('app vs flux namespace separation', () => {
  it('hides the flux control namespace and flags managed-by-flux', () => {
    const apps = buildApplications([
      {
        kind: 'Kustomization',
        object: {
          kind: 'Kustomization',
          metadata: { name: 'shop', namespace: 'flux-system' },
          spec: { sourceRef: { kind: 'GitRepository', name: 'gitops' } },
          status: {
            inventory: {
              // One child Kustomization lands in flux-system, the workload in shop.
              entries: [
                { id: 'flux-system_shop-inner__Kustomization' },
                { id: 'shop_web_apps_Deployment' },
              ],
            },
          },
        } as FluxObject,
      },
    ]);
    const app = apps[0];
    expect(app.targetNamespaces).toEqual(['flux-system', 'shop']);
    expect(app.appNamespaces).toEqual(['shop']);
    expect(app.managedByFlux).toBe(true);
  });
});

describe('summarizeApplication termination', () => {
  const app = (members: FluxObject[]): Application => ({
    id: 'x',
    name: 'x',
    namespace: 'ns',
    displayName: 'x',
    labelGrouped: false,
    rootKind: 'Kustomization',
    members: members.map(object => ({ kind: object.kind ?? 'HelmRelease', object })),
    targetNamespaces: [],
    appNamespaces: [],
    managedByFlux: false,
    workloadPrefixes: [],
  });

  it('reads a deleted app as Terminating, not Deploying', () => {
    const deleting: FluxObject = {
      kind: 'HelmRelease',
      metadata: { name: 'a', namespace: 'ns', deletionTimestamp: '2026-01-01T00:00:00Z' },
      status: { conditions: [{ type: 'Ready', status: 'Unknown', reason: 'Progressing' }] },
    };
    expect(summarizeApplication(app([deleting])).health).toBe('Terminating');
    expect(summarizeApplication(app([deleting])).terminating).toBe(true);
  });
});

describe('memberOperation', () => {
  const reconciling = (kind: string, extra: any): FluxObject => ({
    kind,
    metadata: { name: 'x', namespace: 'ns' },
    status: {
      conditions: [{ type: 'Ready', status: 'Unknown', reason: 'Progressing' }],
      ...extra,
    },
  });

  it('detects a live deletion first', () => {
    expect(
      memberOperation({ metadata: { deletionTimestamp: '2026-01-01T00:00:00Z' } })
    ).toBe('terminating');
  });

  it('reads Helm install / upgrade / rollback from real status', () => {
    expect(memberOperation(reconciling('HelmRelease', { history: [] }))).toBe('installing');
    expect(
      memberOperation(reconciling('HelmRelease', { lastAttemptedReleaseAction: 'upgrade' }))
    ).toBe('upgrading');
    expect(
      memberOperation(reconciling('HelmRelease', { lastAttemptedReleaseAction: 'rollback' }))
    ).toBe('rollingback');
  });

  it('distinguishes Kustomization install from patch by applied revision', () => {
    expect(memberOperation(reconciling('Kustomization', {}))).toBe('installing');
    expect(memberOperation(reconciling('Kustomization', { lastAppliedRevision: 'main@sha1:abc' }))).toBe(
      'patching'
    );
  });

  it('is idle for a settled, ready resource', () => {
    expect(
      memberOperation({ status: { conditions: [{ type: 'Ready', status: 'True' }] } })
    ).toBe('idle');
  });
});

describe('summarizeAppRollout', () => {
  const app: Application = {
    id: 'x',
    name: 'x',
    namespace: 'ns',
    displayName: 'x',
    labelGrouped: false,
    rootKind: 'Kustomization',
    members: [],
    targetNamespaces: ['shop'],
    appNamespaces: ['shop'],
    managedByFlux: false,
    workloadPrefixes: [{ namespace: 'shop', prefix: 'web' }],
  };

  it('sums real replica counts for matching workloads', () => {
    const rollout = summarizeAppRollout(app, [
      {
        kind: 'Deployment',
        metadata: { name: 'web', namespace: 'shop' },
        spec: { replicas: 10 },
        status: { updatedReplicas: 3, readyReplicas: 3 },
      },
      // Different namespace: ignored.
      {
        kind: 'Deployment',
        metadata: { name: 'web', namespace: 'other' },
        spec: { replicas: 5 },
        status: { updatedReplicas: 5, readyReplicas: 5 },
      },
    ]);
    expect(rollout.desired).toBe(10);
    expect(rollout.updated).toBe(3);
    expect(rollout.rolling).toBe(true);
  });
});

describe('summarizeAppLifecycle', () => {
  const makeApp = (members: { kind: string; object: FluxObject }[]): Application => ({
    id: 'x',
    name: 'x',
    namespace: 'ns',
    displayName: 'x',
    labelGrouped: false,
    rootKind: 'HelmRelease',
    members,
    targetNamespaces: ['shop'],
    appNamespaces: ['shop'],
    managedByFlux: false,
    workloadPrefixes: [{ namespace: 'shop', prefix: 'web' }],
  });

  it('is inactive when everything is settled', () => {
    const ready: FluxObject = { status: { conditions: [{ type: 'Ready', status: 'True' }] } };
    const lc = summarizeAppLifecycle(makeApp([{ kind: 'HelmRelease', object: ready }]));
    expect(lc.active).toBe(false);
    expect(lc.operation).toBe('idle');
  });

  it('reports member progress (5/20 releases) while installing', () => {
    const installing: FluxObject = {
      kind: 'HelmRelease',
      status: { conditions: [{ type: 'Ready', status: 'Unknown', reason: 'Progressing' }], history: [] },
    };
    const ready: FluxObject = {
      kind: 'HelmRelease',
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const members = [
      { kind: 'HelmRelease', object: installing },
      ...Array.from({ length: 19 }, () => ({ kind: 'HelmRelease', object: ready })),
    ];
    const lc = summarizeAppLifecycle(makeApp(members));
    expect(lc.operation).toBe('installing');
    expect(lc.progress).toEqual({ current: 19, total: 20, unit: 'resources' });
  });

  it('prefers live pod rollout (3/10 pods) while patching', () => {
    const patching: FluxObject = {
      kind: 'Kustomization',
      status: {
        conditions: [{ type: 'Ready', status: 'Unknown', reason: 'Progressing' }],
        lastAppliedRevision: 'main@sha1:abc',
      },
    };
    const lc = summarizeAppLifecycle(makeApp([{ kind: 'Kustomization', object: patching }]), {
      rollout: { desired: 10, updated: 3, ready: 3, rolling: true },
    });
    expect(lc.operation).toBe('patching');
    expect(lc.progress).toEqual({ current: 3, total: 10, unit: 'pods' });
  });
});
