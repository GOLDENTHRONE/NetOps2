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

import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/K8s/crd';

/** The categories the Flux UI groups kinds into. */
export type FluxCategory =
  | 'sources'
  | 'kustomizations'
  | 'helmreleases'
  | 'notifications'
  | 'imageautomation';

export interface FluxKind {
  kind: string;
  plural: string;
  singular: string;
  group: string;
  /** Newest version first; used as fallbacks for older Flux installations. */
  versions: string[];
  category: FluxCategory;
  /** The Flux controller Deployment that reconciles this kind. */
  controller: string;
}

export const SOURCE_GROUP = 'source.toolkit.fluxcd.io';
export const KUSTOMIZE_GROUP = 'kustomize.toolkit.fluxcd.io';
export const HELM_GROUP = 'helm.toolkit.fluxcd.io';
export const NOTIFICATION_GROUP = 'notification.toolkit.fluxcd.io';
export const IMAGE_GROUP = 'image.toolkit.fluxcd.io';

export const FLUX_KINDS: FluxKind[] = [
  {
    kind: 'GitRepository',
    plural: 'gitrepositories',
    singular: 'gitrepository',
    group: SOURCE_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'sources',
    controller: 'source-controller',
  },
  {
    kind: 'OCIRepository',
    plural: 'ocirepositories',
    singular: 'ocirepository',
    group: SOURCE_GROUP,
    versions: ['v1', 'v1beta2'],
    category: 'sources',
    controller: 'source-controller',
  },
  {
    kind: 'HelmRepository',
    plural: 'helmrepositories',
    singular: 'helmrepository',
    group: SOURCE_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'sources',
    controller: 'source-controller',
  },
  {
    kind: 'HelmChart',
    plural: 'helmcharts',
    singular: 'helmchart',
    group: SOURCE_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'sources',
    controller: 'source-controller',
  },
  {
    kind: 'Bucket',
    plural: 'buckets',
    singular: 'bucket',
    group: SOURCE_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'sources',
    controller: 'source-controller',
  },
  {
    kind: 'Kustomization',
    plural: 'kustomizations',
    singular: 'kustomization',
    group: KUSTOMIZE_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'kustomizations',
    controller: 'kustomize-controller',
  },
  {
    kind: 'HelmRelease',
    plural: 'helmreleases',
    singular: 'helmrelease',
    group: HELM_GROUP,
    versions: ['v2', 'v2beta2', 'v2beta1'],
    category: 'helmreleases',
    controller: 'helm-controller',
  },
  {
    kind: 'Alert',
    plural: 'alerts',
    singular: 'alert',
    group: NOTIFICATION_GROUP,
    versions: ['v1beta3', 'v1beta2', 'v1beta1'],
    category: 'notifications',
    controller: 'notification-controller',
  },
  {
    kind: 'Provider',
    plural: 'providers',
    singular: 'provider',
    group: NOTIFICATION_GROUP,
    versions: ['v1beta3', 'v1beta2', 'v1beta1'],
    category: 'notifications',
    controller: 'notification-controller',
  },
  {
    kind: 'Receiver',
    plural: 'receivers',
    singular: 'receiver',
    group: NOTIFICATION_GROUP,
    versions: ['v1', 'v1beta2', 'v1beta1'],
    category: 'notifications',
    controller: 'notification-controller',
  },
  {
    kind: 'ImageRepository',
    plural: 'imagerepositories',
    singular: 'imagerepository',
    group: IMAGE_GROUP,
    versions: ['v1beta2', 'v1beta1'],
    category: 'imageautomation',
    controller: 'image-reflector-controller',
  },
  {
    kind: 'ImagePolicy',
    plural: 'imagepolicies',
    singular: 'imagepolicy',
    group: IMAGE_GROUP,
    versions: ['v1beta2', 'v1beta1'],
    category: 'imageautomation',
    controller: 'image-reflector-controller',
  },
  {
    kind: 'ImageUpdateAutomation',
    plural: 'imageupdateautomations',
    singular: 'imageupdateautomation',
    group: IMAGE_GROUP,
    versions: ['v1beta2', 'v1beta1'],
    category: 'imageautomation',
    controller: 'image-automation-controller',
  },
];

export const SOURCE_KINDS = FLUX_KINDS.filter(k => k.category === 'sources');

/** All Flux controllers we check the health of. Optional ones may not be installed. */
export const FLUX_CONTROLLERS = [
  { name: 'source-controller', optional: false },
  { name: 'kustomize-controller', optional: false },
  { name: 'helm-controller', optional: true },
  { name: 'notification-controller', optional: true },
  { name: 'image-reflector-controller', optional: true },
  { name: 'image-automation-controller', optional: true },
];

const classCache = new Map<string, ReturnType<typeof makeCustomResourceClass>>();

/** Returns (and caches) the KubeObject class used to list/watch/patch this Flux kind. */
export function fluxClass(kindDef: FluxKind) {
  const key = `${kindDef.group}/${kindDef.kind}`;
  let cls = classCache.get(key);
  if (!cls) {
    cls = makeCustomResourceClass({
      apiInfo: kindDef.versions.map(version => ({ group: kindDef.group, version })),
      kind: kindDef.kind,
      singularName: kindDef.singular,
      pluralName: kindDef.plural,
      isNamespaced: true,
    });
    classCache.set(key, cls);
  }
  return cls;
}

export function kindByName(kind: string, group?: string): FluxKind | undefined {
  return FLUX_KINDS.find(k => k.kind === kind && (!group || k.group === group));
}

export function kindByPlural(plural: string): FluxKind | undefined {
  return FLUX_KINDS.find(k => k.plural === plural);
}

export function kindsInCategory(category: FluxCategory): FluxKind[] {
  return FLUX_KINDS.filter(k => k.category === category);
}
