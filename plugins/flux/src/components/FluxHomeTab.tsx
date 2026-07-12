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
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { FLUX_ICON, ICONS } from '../flux/icon';
import { FLUX_KINDS, fluxClass } from '../flux/kinds';
import { getStatusInfo } from '../flux/utils';
import { InlineError, pickMostRelevantError } from './errors';
import { EmptyState, Pill, Surface, useAccents } from './ui';

const { ResourceClasses, useClustersConf } = K8s;

/** Flux state of one cluster, shown as a card on the Home page tab. */
function useClusterFluxStatus(cluster: string) {
  const [deployments, deploymentsError] = ResourceClasses.Deployment.useList({
    labelSelector: 'app.kubernetes.io/part-of=flux',
    cluster,
  });

  // Constant list of kinds, so the hook order is stable.
  const results = FLUX_KINDS.map(kindDef => (fluxClass(kindDef) as any).useList({ cluster }));
  const objects = results.flatMap(([items]: [any[] | null]) =>
    (items ?? []).map((i: any) => i.jsonData)
  );
  const anyLoaded = results.some(([items]: [any[] | null]) => items !== null);
  const errors = results.map(([, err]: [any, any]) => err);
  const allFailed =
    !!deploymentsError && results.every(([items, err]: [any, any]) => err && items === null);

  const controllersTotal = deployments?.length ?? 0;
  const controllersReady = (deployments ?? []).filter((d: any) => {
    const wanted = d.jsonData.spec?.replicas ?? 1;
    return (d.jsonData.status?.readyReplicas ?? 0) >= wanted;
  }).length;

  const failed = objects.filter(o => getStatusInfo(o).health === 'NotReady').length;
  const suspended = objects.filter(o => getStatusInfo(o).health === 'Suspended').length;

  return {
    loading: deployments === null && !anyLoaded && !deploymentsError,
    installed: controllersTotal > 0 || objects.length > 0,
    // When every request failed, report the reason instead of pretending
    // Flux is simply "not detected".
    error: allFailed ? pickMostRelevantError([deploymentsError, ...errors]) : undefined,
    controllersReady,
    controllersTotal,
    resources: objects.length,
    failed,
    suspended,
  };
}

function ClusterFluxCard(props: { cluster: string }) {
  const { cluster } = props;
  const status = useClusterFluxStatus(cluster);
  const history = useHistory();

  const controllersOk =
    status.controllersTotal === 0 || status.controllersReady >= status.controllersTotal;
  const accents = useAccents();
  const accent = !status.installed
    ? undefined
    : status.error || status.failed > 0 || !controllersOk
    ? accents.error
    : accents.success;

  return (
    <Surface
      interactive
      accent={accent}
      onClick={() => history.push(`/c/${cluster}/flux`)}
      sx={{ minWidth: 260, flex: '1 1 260px', p: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Icon icon={ICONS.cluster} width="1.2rem" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {cluster}
        </Typography>
      </Box>
      {status.loading ? (
        <Typography variant="body2" color="textSecondary">
          Checking Flux…
        </Typography>
      ) : status.error ? (
        <InlineError error={status.error} what="Flux resources" fluxKind="Flux" />
      ) : !status.installed ? (
        <Pill tone="neutral" icon={ICONS.statusUnknown}>
          Flux not detected
        </Pill>
      ) : (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Pill tone={controllersOk ? 'success' : 'error'} icon={ICONS.controllers}>
            {status.controllersTotal > 0
              ? `${status.controllersReady}/${status.controllersTotal} controllers`
              : 'controllers unknown'}
          </Pill>
          <Pill tone="info" icon={ICONS.resources}>
            {status.resources} resources
          </Pill>
          {status.failed > 0 ? (
            <Pill tone="error" icon={ICONS.statusError}>
              {status.failed} failing
            </Pill>
          ) : (
            <Pill tone="success" icon={ICONS.statusReady}>
              0 failing
            </Pill>
          )}
          {status.suspended > 0 && (
            <Pill tone="neutral" icon={ICONS.statusSuspended}>
              {status.suspended} suspended
            </Pill>
          )}
        </Box>
      )}
    </Surface>
  );
}

/**
 * The "Flux" tab on the Home page: Flux health at a glance for every
 * cluster, with links into the per-cluster Flux dashboards.
 */
export default function FluxHomeTab() {
  const clustersConf = useClustersConf();
  const clusters = Object.keys(clustersConf ?? {}).sort();

  // null means the cluster config is still loading; an empty object means
  // there really are no clusters; don't show an eternal spinner for that.
  if (clustersConf === null) {
    return <Loader title="Loading clusters" />;
  }
  if (clusters.length === 0) {
    return (
      <EmptyState
        icon={ICONS.cluster}
        title="No clusters yet"
        description="Add a cluster to see its Flux status here."
      />
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon={FLUX_ICON} width="1.1rem" />
        <Typography variant="body2" color="textSecondary">
          Flux status across your clusters. Open a cluster to see sources, kustomizations and Helm
          releases, and to trigger syncs.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {clusters.map(cluster => (
          <ClusterFluxCard key={cluster} cluster={cluster} />
        ))}
      </Box>
    </Box>
  );
}
