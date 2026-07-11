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
import { Loader, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardActionArea, CardContent, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { FLUX_KINDS, fluxClass } from '../flux/kinds';
import { getStatusInfo } from '../flux/utils';

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

  return (
    <Card variant="outlined" sx={{ minWidth: 260, flex: '1 1 260px' }}>
      <CardActionArea onClick={() => history.push(`/c/${cluster}/flux`)}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Icon icon="mdi:hexagon-multiple-outline" width="1.2rem" />
            <Typography variant="h6">{cluster}</Typography>
          </Box>
          {status.loading ? (
            <Typography variant="body2" color="textSecondary">
              Checking Flux…
            </Typography>
          ) : !status.installed ? (
            <StatusLabel status="">Flux not detected</StatusLabel>
          ) : (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <StatusLabel
                status={
                  status.controllersTotal === 0 ||
                  status.controllersReady >= status.controllersTotal
                    ? 'success'
                    : 'error'
                }
              >
                {status.controllersTotal > 0
                  ? `${status.controllersReady}/${status.controllersTotal} controllers`
                  : 'controllers unknown'}
              </StatusLabel>
              <StatusLabel status="">{status.resources} resources</StatusLabel>
              {status.failed > 0 ? (
                <StatusLabel status="error">{status.failed} failing</StatusLabel>
              ) : (
                <StatusLabel status="success">0 failing</StatusLabel>
              )}
              {status.suspended > 0 && (
                <StatusLabel status="">{status.suspended} suspended</StatusLabel>
              )}
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/**
 * The "Flux" tab on the Home page: Flux health at a glance for every
 * cluster, with links into the per-cluster Flux dashboards.
 */
export default function FluxHomeTab() {
  const clustersConf = useClustersConf() ?? {};
  const clusters = Object.keys(clustersConf).sort();

  if (clusters.length === 0) {
    return <Loader title="Loading clusters" />;
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        Flux status across your clusters. Open a cluster to see sources, kustomizations and Helm
        releases, and to trigger syncs.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {clusters.map(cluster => (
          <ClusterFluxCard key={cluster} cluster={cluster} />
        ))}
      </Box>
    </Box>
  );
}
