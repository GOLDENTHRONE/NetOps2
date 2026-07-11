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
  APP_DEPLOYMENT_TYPE_KEY,
  APP_NAME_KEY,
  APP_VERSION_KEY,
  buildApplications,
  getAppMetadataValue,
  isBusinessApplicationNamespace,
  isPlatformNamespace,
  isSystemNamespace,
  NamespaceLike,
  NOT_AVAILABLE,
  PLATFORM_NAMESPACES,
} from './applicationUtils';

function makeNamespace(
  name: string,
  cluster: string,
  overrides: Partial<NamespaceLike['metadata']> = {},
  phase?: string
): NamespaceLike {
  return {
    metadata: { name, ...overrides },
    status: phase ? { phase } : undefined,
    cluster,
  };
}

describe('isSystemNamespace', () => {
  it('flags well-known system namespaces', () => {
    expect(isSystemNamespace('kube-system')).toBe(true);
    expect(isSystemNamespace('kube-public')).toBe(true);
    expect(isSystemNamespace('kube-node-lease')).toBe(true);
    expect(isSystemNamespace('default')).toBe(true);
    expect(isSystemNamespace('openshift')).toBe(true);
    expect(isSystemNamespace('openshift-monitoring')).toBe(true);
    expect(isSystemNamespace('kube-whatever')).toBe(true);
    expect(isSystemNamespace('foo-system')).toBe(true);
  });

  it('does not flag application namespaces', () => {
    expect(isSystemNamespace('wnv7a0vbgw0013c')).toBe(false);
    expect(isSystemNamespace('my-app')).toBe(false);
    expect(isSystemNamespace('kubeless')).toBe(false);
  });
});

describe('isPlatformNamespace', () => {
  it('flags every known shared platform/service namespace', () => {
    for (const name of PLATFORM_NAMESPACES) {
      expect(isPlatformNamespace(name)).toBe(true);
    }
  });

  it('flags namespaces ending in -operator as a platform-namespace convention', () => {
    expect(isPlatformNamespace('some-future-operator')).toBe(true);
  });

  it('does not flag business application namespaces', () => {
    expect(isPlatformNamespace('wnv7a0vbgw0001c')).toBe(false);
    expect(isPlatformNamespace('wnv7a1psdc0001c')).toBe(false);
  });
});

describe('isBusinessApplicationNamespace', () => {
  it('accepts every business application namespace from the reference cluster layout', () => {
    const businessNamespaces = [
      'wnv7a0vbgw0001c',
      'wnv7a0vbgw0002c',
      'wnv7a1psdc0001c',
      'wnv7a0icsf0001c',
      'wnv7a0cncs0001c',
    ];
    for (const name of businessNamespaces) {
      expect(isBusinessApplicationNamespace(name)).toBe(true);
    }
  });

  it('rejects system namespaces', () => {
    expect(isBusinessApplicationNamespace('kube-system')).toBe(false);
    expect(isBusinessApplicationNamespace('openshift-monitoring')).toBe(false);
    expect(isBusinessApplicationNamespace('foo-system')).toBe(false);
    expect(isBusinessApplicationNamespace('default')).toBe(false);
  });

  it('rejects shared platform/service namespaces', () => {
    expect(isBusinessApplicationNamespace('cert-manager')).toBe(false);
    expect(isBusinessApplicationNamespace('cert-manager-operator')).toBe(false);
    expect(isBusinessApplicationNamespace('quay-registry')).toBe(false);
    expect(isBusinessApplicationNamespace('vault-secrets-operator')).toBe(false);
    expect(isBusinessApplicationNamespace('ldap-group-sync')).toBe(false);
    expect(isBusinessApplicationNamespace('cluster-backup')).toBe(false);
    expect(isBusinessApplicationNamespace('assisted-installer')).toBe(false);
  });
});

describe('getAppMetadataValue', () => {
  it('prefers labels over annotations', () => {
    const ns = makeNamespace('app-a', 'c1', {
      labels: { [APP_VERSION_KEY]: '1.2.3' },
      annotations: { [APP_VERSION_KEY]: '9.9.9' },
    });
    expect(getAppMetadataValue(ns, APP_VERSION_KEY)).toBe('1.2.3');
  });

  it('falls back to annotations', () => {
    const ns = makeNamespace('app-a', 'c1', {
      annotations: { [APP_DEPLOYMENT_TYPE_KEY]: 'Helm' },
    });
    expect(getAppMetadataValue(ns, APP_DEPLOYMENT_TYPE_KEY)).toBe('Helm');
  });

  it('returns NA when the key is absent or empty', () => {
    expect(getAppMetadataValue(makeNamespace('app-a', 'c1'), APP_VERSION_KEY)).toBe(NOT_AVAILABLE);
    expect(
      getAppMetadataValue(
        makeNamespace('app-a', 'c1', { labels: { [APP_VERSION_KEY]: '' } }),
        APP_VERSION_KEY
      )
    ).toBe(NOT_AVAILABLE);
  });
});

describe('buildApplications', () => {
  it('creates one row per namespace and cluster, excluding system namespaces', () => {
    const apps = buildApplications([
      makeNamespace('app-b', 'cluster-1', {}, 'Active'),
      makeNamespace('app-a', 'cluster-2'),
      makeNamespace('kube-system', 'cluster-1'),
      makeNamespace('openshift-monitoring', 'cluster-2'),
      makeNamespace('default', 'cluster-1'),
    ]);

    expect(apps.map(a => a.id)).toEqual(['cluster-2/app-a', 'cluster-1/app-b']);
  });

  it('excludes shared platform/service namespaces alongside system namespaces', () => {
    const apps = buildApplications([
      makeNamespace('wnv7a0vbgw0001c', 'cluster-1', {}, 'Active'),
      makeNamespace('cert-manager', 'cluster-1'),
      makeNamespace('cert-manager-operator', 'cluster-1'),
      makeNamespace('quay-registry', 'cluster-1'),
      makeNamespace('vault-secrets-operator', 'cluster-1'),
      makeNamespace('ldap-group-sync', 'cluster-1'),
      makeNamespace('cluster-backup', 'cluster-1'),
      makeNamespace('assisted-installer', 'cluster-1'),
      makeNamespace('kube-system', 'cluster-1'),
      makeNamespace('openshift-etcd', 'cluster-1'),
    ]);

    expect(apps.map(a => a.namespace)).toEqual(['wnv7a0vbgw0001c']);
  });

  it('keeps the same namespace in different clusters as separate rows', () => {
    const apps = buildApplications([
      makeNamespace('app-a', 'cluster-2'),
      makeNamespace('app-a', 'cluster-1'),
    ]);

    expect(apps.map(a => a.id)).toEqual(['cluster-1/app-a', 'cluster-2/app-a']);
    expect(apps.every(a => a.name === 'app-a')).toBe(true);
  });

  it('uses NA for missing version, deployment type and status', () => {
    const [app] = buildApplications([makeNamespace('app-a', 'cluster-1')]);

    expect(app.version).toBe(NOT_AVAILABLE);
    expect(app.deploymentType).toBe(NOT_AVAILABLE);
    expect(app.status).toBe(NOT_AVAILABLE);
  });

  it('reads uspe.dev metadata when present', () => {
    const [app] = buildApplications([
      makeNamespace(
        'wnv7a0vbgw0013c',
        'cluster-1',
        {
          labels: { [APP_NAME_KEY]: 'VBGW', [APP_VERSION_KEY]: 'v1.24' },
          annotations: { [APP_DEPLOYMENT_TYPE_KEY]: 'Helm' },
        },
        'Active'
      ),
    ]);

    expect(app.name).toBe('VBGW');
    expect(app.namespace).toBe('wnv7a0vbgw0013c');
    expect(app.version).toBe('v1.24');
    expect(app.deploymentType).toBe('Helm');
    expect(app.status).toBe('Active');
  });

  it('ignores malformed items without metadata', () => {
    expect(buildApplications([{ metadata: undefined, cluster: 'c1' } as any])).toEqual([]);
  });
});
