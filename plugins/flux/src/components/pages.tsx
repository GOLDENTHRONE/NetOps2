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

import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';
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

export function FluxSourcesPage() {
  return (
    <>
      <SectionBox title="Flux Sources" headerProps={{ headerStyle: 'main' }}>
        <Typography variant="body2" color="textSecondary">
          The repositories, charts and buckets Flux watches for changes.
        </Typography>
      </SectionBox>
      {kindsInCategory('sources').map(kindDef => (
        <FluxKindListSection key={kindDef.kind} kindDef={kindDef} title={TITLES[kindDef.kind]} />
      ))}
    </>
  );
}

export function FluxKustomizationsPage() {
  const kindDef = kindByName('Kustomization')!;
  return (
    <>
      <SectionBox title="Flux Kustomizations" headerProps={{ headerStyle: 'main' }} />
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection kindDef={kindDef} title={TITLES.Kustomization} />
    </>
  );
}

export function FluxHelmReleasesPage() {
  const kindDef = kindByName('HelmRelease')!;
  return (
    <>
      <SectionBox title="Flux Helm Releases" headerProps={{ headerStyle: 'main' }} />
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection kindDef={kindDef} title={TITLES.HelmRelease} />
    </>
  );
}

export function FluxNotificationsPage() {
  return (
    <>
      <SectionBox title="Flux Notifications" headerProps={{ headerStyle: 'main' }} />
      {kindsInCategory('notifications').map(kindDef => (
        <FluxKindListSection key={kindDef.kind} kindDef={kindDef} title={TITLES[kindDef.kind]} />
      ))}
    </>
  );
}

export function FluxImageAutomationPage() {
  return (
    <>
      <SectionBox title="Flux Image Automation" headerProps={{ headerStyle: 'main' }} />
      {kindsInCategory('imageautomation').map(kindDef => (
        <FluxKindListSection key={kindDef.kind} kindDef={kindDef} title={TITLES[kindDef.kind]} />
      ))}
    </>
  );
}
