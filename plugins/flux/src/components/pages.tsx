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

import { Box } from '@mui/material';
import React from 'react';
import { ICONS } from '../flux/icon';
import { kindByName, kindsInCategory } from '../flux/kinds';
import { DependencyWavesSection } from './DependencyWaves';
import { FluxKindListSection } from './FluxKindList';
import { NamespaceBar } from './ui';

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

const KIND_ICON: Record<string, string> = {
  GitRepository: ICONS.gitRepository,
  OCIRepository: ICONS.ociRepository,
  HelmRepository: ICONS.helmRepository,
  HelmChart: ICONS.helmChart,
  Bucket: ICONS.bucket,
  Kustomization: ICONS.kustomization,
  HelmRelease: ICONS.helmRelease,
  Alert: ICONS.alert,
  Provider: ICONS.provider,
  Receiver: ICONS.receiver,
  ImageRepository: ICONS.imageRepository,
  ImagePolicy: ICONS.imagePolicy,
  ImageUpdateAutomation: ICONS.imageUpdate,
};

/** Wraps a page's content with a padded container. */
function Page(props: { children: React.ReactNode }) {
  return <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1600, mx: 'auto' }}>{props.children}</Box>;
}

/** The slim page chrome: just the namespace context, top right. */
function TopBar() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
      <NamespaceBar />
    </Box>
  );
}

export function FluxSourcesPage() {
  return (
    <Page>
      <TopBar />
      {kindsInCategory('sources').map(kindDef => (
        <FluxKindListSection
          key={kindDef.kind}
          kindDef={kindDef}
          title={TITLES[kindDef.kind]}
          icon={KIND_ICON[kindDef.kind]}
          description={
            kindDef.kind === 'HelmChart'
              ? 'Charts pulled from the Helm repositories above — each row links to its source repository.'
              : undefined
          }
        />
      ))}
    </Page>
  );
}

export function FluxKustomizationsPage() {
  const kindDef = kindByName('Kustomization')!;
  return (
    <Page>
      <TopBar />
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection
        kindDef={kindDef}
        title={TITLES.Kustomization}
        icon={ICONS.kustomization}
      />
    </Page>
  );
}

export function FluxHelmReleasesPage() {
  const kindDef = kindByName('HelmRelease')!;
  return (
    <Page>
      <TopBar />
      <DependencyWavesSection kindDef={kindDef} />
      <FluxKindListSection kindDef={kindDef} title={TITLES.HelmRelease} icon={ICONS.helmRelease} />
    </Page>
  );
}

export function FluxNotificationsPage() {
  return (
    <Page>
      <TopBar />
      {kindsInCategory('notifications').map(kindDef => (
        <FluxKindListSection
          key={kindDef.kind}
          kindDef={kindDef}
          title={TITLES[kindDef.kind]}
          icon={KIND_ICON[kindDef.kind]}
        />
      ))}
    </Page>
  );
}

export function FluxImageAutomationPage() {
  return (
    <Page>
      <TopBar />
      {kindsInCategory('imageautomation').map(kindDef => (
        <FluxKindListSection
          key={kindDef.kind}
          kindDef={kindDef}
          title={TITLES[kindDef.kind]}
          icon={KIND_ICON[kindDef.kind]}
        />
      ))}
    </Page>
  );
}
