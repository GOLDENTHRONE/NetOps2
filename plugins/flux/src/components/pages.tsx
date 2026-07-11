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

import React from 'react';
import { kindByName, kindsInCategory } from '../flux/kinds';
import { DependencyWavesSection } from './DependencyWaves';
import { FluxKindListSection } from './FluxKindList';

const TITLES: Record<string, string> = {
  GitRepository: 'Git Repositories',
  OCIRepository: 'OCI Repositories',
  HelmRepository: 'Helm Repositories',
  HelmChart: 'Helm Charts',
  Bucket: 'Buckets',
  Kustomization: 'Kustomizations',
  HelmRelease: 'Helm Releases',
  Alert: 'Alerts',
  Provider: 'Providers',
  Receiver: 'Receivers',
  ImageRepository: 'Image Repositories',
  ImagePolicy: 'Image Policies',
  ImageUpdateAutomation: 'Image Update Automations',
};

// The page location is already shown in the sidebar/breadcrumb, and each list
// carries its own section heading, so no redundant page title is rendered.

export function FluxSourcesPage() {
  return (
    <>
      {kindsInCategory('sources').map(kindDef => (
        <FluxKindListSection
          key={kindDef.kind}
          kindDef={kindDef}
          title={TITLES[kindDef.kind]}
          // Helm charts are pulled from the Helm repositories listed above;
          // the "From repository" column links each chart to its source.
          description={
            kindDef.kind === 'HelmChart'
              ? 'Charts pulled from the Helm repositories above — each row links to its source repository.'
              : undefined
          }
        />
      ))}
    </>
  );
}

export function FluxKustomizationsPage() {
  const kindDef = kindByName('Kustomization')!;
  return (
    <>
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection kindDef={kindDef} title={TITLES.Kustomization} />
    </>
  );
}

export function FluxHelmReleasesPage() {
  const kindDef = kindByName('HelmRelease')!;
  return (
    <>
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection kindDef={kindDef} title={TITLES.HelmRelease} />
    </>
  );
}

export function FluxNotificationsPage() {
  return (
    <>
      {kindsInCategory('notifications').map(kindDef => (
        <FluxKindListSection key={kindDef.kind} kindDef={kindDef} title={TITLES[kindDef.kind]} />
      ))}
    </>
  );
}

export function FluxImageAutomationPage() {
  return (
    <>
      {kindsInCategory('imageautomation').map(kindDef => (
        <FluxKindListSection key={kindDef.kind} kindDef={kindDef} title={TITLES[kindDef.kind]} />
      ))}
    </>
  );
}
