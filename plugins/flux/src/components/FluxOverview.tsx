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

import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Link as HeadlampLink,
  Loader,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardActionArea, CardContent, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { FLUX_KINDS, FluxCategory, fluxClass, FluxKind } from '../flux/kinds';
import { getStatusInfo } from '../flux/utils';
import { ReadySummary, SectionEmpty } from './common';

const { ResourceClasses } = K8s;
const { createRouteURL } = Router;

const CATEGORY_PAGES: { category: FluxCategory; label: string; route: string; icon: string }[] = [
  { category: 'sources', label: 'Sources', route: 'fluxSources', icon: 'mdi:source-branch' },
  {
    category: 'kustomizations',
    label: 'Kustomizations',
    route: 'fluxKustomizations',
    icon: 'mdi:layers-triple-outline',
  },
  {
    category: 'helmreleases',
    label: 'Helm Releases',
    route: 'fluxHelmReleases',
    icon: 'mdi:ship-wheel',
  },
  {
    category: 'notifications',
    label: 'Notifications',
    route: 'fluxNotifications',
    icon: 'mdi:bell-outline',
  },
  {
    category: 'imageautomation',
    label: 'Image Automation',
    route: 'fluxImageAutomation',
    icon: 'mdi:image-sync-outline',
  },
];

/** Lists one Flux kind and reports the result up. */
function useKindList(
  kindDef: FluxKind,
  cluster?: string
): {
  items: any[] | null;
  error: any;
} {
  const [items, error] = (fluxClass(kindDef) as any).useList(cluster ? { cluster } : {});
  return { items, error };
}

function CategoryCard(props: { category: (typeof CATEGORY_PAGES)[number] }) {
  const { category } = props;
  const history = useHistory();
  const kinds = FLUX_KINDS.filter(k => k.category === category.category);

  // Hooks in a loop are fine here: FLUX_KINDS is a constant list.
  const results = kinds.map(kindDef => useKindList(kindDef));
  const loaded = results.filter(r => r.items !== null);
  const objects = loaded.flatMap(r => (r.items ?? []).map((i: any) => i.jsonData));
  const allFailed = results.length > 0 && results.every(r => r.error && r.items === null);

  return (
    <Card variant="outlined" sx={{ minWidth: 230, flex: '1 1 230px' }}>
      <CardActionArea onClick={() => history.push(createRouteURL(category.route))}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Icon icon={category.icon} width="1.5rem" />
            <Typography variant="h6">{category.label}</Typography>
          </Box>
          {allFailed ? (
            <Typography variant="body2" color="textSecondary">
              CRDs not installed
            </Typography>
          ) : loaded.length === 0 ? (
            <Loader title={`Loading ${category.label}`} size={20} />
          ) : (
            <>
              <Typography variant="h4" sx={{ mb: 1 }}>
                {objects.length}
              </Typography>
              <ReadySummary objects={objects} />
            </>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** Health of the Flux controllers (source-controller, kustomize-controller, ...). */
export function FluxControllersSection(props: { cluster?: string } = {}) {
  const [deployments, error] = ResourceClasses.Deployment.useList({
    labelSelector: 'app.kubernetes.io/part-of=flux',
    ...(props.cluster ? { cluster: props.cluster } : {}),
  });

  const rows = (deployments ?? []).map((d: any) => {
    const spec = d.jsonData.spec ?? {};
    const status = d.jsonData.status ?? {};
    const wanted = spec.replicas ?? 1;
    const ready = status.readyReplicas ?? 0;
    const version =
      d.jsonData.metadata?.labels?.['app.kubernetes.io/version'] ||
      (spec.template?.spec?.containers?.[0]?.image ?? '').split(':')[1] ||
      '-';
    return { deployment: d, wanted, ready, version };
  });

  return (
    <SectionBox title="Flux Controllers">
      {error ? (
        <SectionEmpty message={`Could not list Flux controllers: ${error}`} />
      ) : deployments === null ? (
        <Loader title="Loading Flux controllers" />
      ) : rows.length === 0 ? (
        <SectionEmpty
          message={
            'No Flux controllers found (looked for Deployments labeled ' +
            'app.kubernetes.io/part-of=flux). Flux may not be installed in this cluster.'
          }
        />
      ) : (
        <SimpleTable
          columns={[
            {
              label: 'Controller',
              getter: (row: any) => (
                <HeadlampLink kubeObject={row.deployment}>
                  {row.deployment.metadata.name}
                </HeadlampLink>
              ),
            },
            { label: 'Namespace', getter: (row: any) => row.deployment.metadata.namespace },
            { label: 'Version', getter: (row: any) => row.version },
            {
              label: 'Pods',
              getter: (row: any) => `${row.ready}/${row.wanted}`,
            },
            {
              label: 'Status',
              getter: (row: any) =>
                row.ready >= row.wanted ? (
                  <StatusLabel status="success">Running</StatusLabel>
                ) : (
                  <StatusLabel status="error">Degraded</StatusLabel>
                ),
            },
          ]}
          data={rows}
        />
      )}
    </SectionBox>
  );
}

export default function FluxOverview() {
  return (
    <>
      <SectionBox title="Flux" headerProps={{ headerStyle: 'main' }}>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Everything Flux manages in this cluster: sources, kustomizations, Helm releases and
          automation, with their live status.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {CATEGORY_PAGES.map(category => (
            <CategoryCard key={category.category} category={category} />
          ))}
        </Box>
      </SectionBox>
      <FluxControllersSection />
    </>
  );
}

/** Ready/total summary counts for one cluster, used by the Home page tab. */
export function useFluxSummary(cluster?: string) {
  const results = FLUX_KINDS.map(kindDef => useKindList(kindDef, cluster));
  const objects = results.flatMap(r => (r.items ?? []).map((i: any) => i.jsonData));
  const loaded = results.some(r => r.items !== null);
  const failed = objects.filter(o => getStatusInfo(o).health === 'NotReady').length;
  return { total: objects.length, failed, loaded };
}
