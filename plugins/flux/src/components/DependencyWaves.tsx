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
import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { alpha, Box, Card, Tooltip, Typography, useTheme } from '@mui/material';
import React from 'react';
import { fluxClass, FluxKind } from '../flux/kinds';
import {
  computeDependencyWaves,
  DependencyNode,
  FluxObject,
  getNextSyncTime,
  getStatusInfo,
  makeDependencyNodes,
} from '../flux/utils';
import { FluxLink, healthToStatus } from './common';
import { SectionEmpty } from './common';

function statusColor(theme: any, status: 'success' | 'warning' | 'error' | '') {
  if (status === '') {
    return theme.palette.text.disabled;
  }
  return theme.palette[status].main;
}

function NodeCard(props: { node: DependencyNode; object?: FluxObject; kind: string }) {
  const { node, object, kind } = props;
  const theme = useTheme();
  const info = object ? getStatusInfo(object) : undefined;
  const status = info ? healthToStatus(info.health) : '';
  const color = statusColor(theme, status);
  const nextSync = object ? getNextSyncTime(object) : null;

  const tooltip = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2">
        {node.namespace}/{node.name}
      </Typography>
      {info && (
        <Typography variant="body2">
          {info.health}
          {info.reason ? ` (${info.reason})` : ''}
        </Typography>
      )}
      {info?.message && (
        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
          {info.message}
        </Typography>
      )}
      {nextSync && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Next reconciliation: {nextSync.toLocaleString()}
        </Typography>
      )}
      {node.dependsOn.length > 0 && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Depends on: {node.dependsOn.join(', ')}
        </Typography>
      )}
      {node.missingDependencies.length > 0 && (
        <Typography variant="body2" sx={{ mt: 0.5 }} color="warning.main">
          Missing dependencies: {node.missingDependencies.join(', ')}
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip title={tooltip} arrow>
      <Card
        variant="outlined"
        sx={{
          px: 1.5,
          py: 1,
          borderLeft: `4px solid ${color}`,
          backgroundColor: alpha(color, 0.06),
          minWidth: 180,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Icon
            icon={
              info?.health === 'Ready'
                ? 'mdi:check-circle'
                : info?.health === 'NotReady'
                ? 'mdi:alert-circle'
                : info?.health === 'Suspended'
                ? 'mdi:pause-circle'
                : info?.health === 'Reconciling'
                ? 'mdi:progress-clock'
                : 'mdi:help-circle-outline'
            }
            color={color}
            width="1.1rem"
          />
          <FluxLink kind={kind} name={node.name} namespace={node.namespace}>
            <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
              {node.name}
            </Typography>
          </FluxLink>
        </Box>
        <Typography variant="caption" color="textSecondary">
          {node.namespace}
        </Typography>
      </Card>
    </Tooltip>
  );
}

export interface DependencyWavesSectionProps {
  kindDef: FluxKind;
  title?: string;
}

/**
 * Shows Kustomizations/HelmReleases arranged by their dependsOn relations,
 * in the order Flux deploys them: items in the same wave reconcile in
 * parallel; each wave waits for the previous one to be ready.
 */
export function DependencyWavesSection(props: DependencyWavesSectionProps) {
  const { kindDef, title } = props;
  const [items] = (fluxClass(kindDef) as any).useList();
  const filterFunc = useFilterFunc();

  const filtered = React.useMemo(
    () => (items ?? []).filter((item: any) => filterFunc(item)),
    [items, filterFunc]
  );

  const byId = React.useMemo(() => {
    const map = new Map<string, FluxObject>();
    for (const item of filtered) {
      const o = item.jsonData as FluxObject;
      map.set(`${o.metadata?.namespace}/${o.metadata?.name}`, o);
    }
    return map;
  }, [filtered]);

  const { waves, cycles } = React.useMemo(
    () => computeDependencyWaves(makeDependencyNodes(filtered.map((i: any) => i.jsonData))),
    [filtered]
  );

  return (
    <SectionBox title={title ?? 'Deployment order (dependsOn)'}>
      {items === null ? (
        <Loader title="Loading" />
      ) : filtered.length === 0 ? (
        <SectionEmpty message={`No ${kindDef.kind}s found`} />
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, overflowX: 'auto', pb: 1 }}>
            {waves.map((wave, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Icon icon="mdi:arrow-right-thin" width="1.6rem" />
                  </Box>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 190 }}>
                  <Typography variant="overline" color="textSecondary">
                    {i === 0 ? 'Wave 1 (first)' : `Wave ${i + 1}`}
                  </Typography>
                  {wave.map(node => (
                    <NodeCard
                      key={node.id}
                      node={node}
                      object={byId.get(node.id)}
                      kind={kindDef.kind}
                    />
                  ))}
                </Box>
              </React.Fragment>
            ))}
          </Box>
          {cycles.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="error">
                <Icon icon="mdi:alert" width="1rem" /> Dependency cycle detected — these will never
                reconcile:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {cycles.map(node => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    object={byId.get(node.id)}
                    kind={kindDef.kind}
                  />
                ))}
              </Box>
            </Box>
          )}
        </>
      )}
    </SectionBox>
  );
}
