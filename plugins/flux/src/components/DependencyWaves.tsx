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
import {
  Loader,
  NamespacesAutocomplete,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Card, Divider, Paper, Popover, Typography, useTheme } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { FluxActionButtons } from '../flux/actions';
import { fluxClass, FluxKind } from '../flux/kinds';
import {
  computeDependencyWaves,
  DependencyNode,
  FluxObject,
  getLastSyncTime,
  getNextSyncTime,
  getSourceRef,
  getStatusInfo,
  makeDependencyNodes,
} from '../flux/utils';
import {
  FluxLink,
  FluxStatusLabel,
  healthToStatus,
  LastSyncLabel,
  NextSyncLabel,
  SectionEmpty,
} from './common';
import { ErrorState } from './errors';

const HEALTH_ICON: Record<string, string> = {
  Ready: 'mdi:check-circle',
  NotReady: 'mdi:alert-circle',
  Suspended: 'mdi:pause-circle',
  Reconciling: 'mdi:progress-clock',
  Unknown: 'mdi:help-circle-outline',
};

function statusColor(theme: any, status: 'success' | 'warning' | 'error' | '') {
  if (status === '') {
    return theme.palette.text.disabled;
  }
  return theme.palette[status].main;
}

/** Countdown chip shown on the node card (e.g. "next sync in 4m"). */
function NextReconcileHint(props: { object?: FluxObject }) {
  const { object } = props;
  if (!object) {
    return null;
  }
  const next = getNextSyncTime(object);
  if (!next) {
    return null;
  }
  const seconds = Math.max(0, Math.round((next.getTime() - Date.now()) / 1000));
  const text =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
      ? `${Math.round(seconds / 60)}m`
      : `${Math.round(seconds / 360) / 10}h`;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
      <Icon icon="mdi:timer-outline" width="0.85rem" />
      <Typography variant="caption" color="textSecondary">
        next in {text}
      </Typography>
    </Box>
  );
}

/** A rich, colored, structured detail card opened when a node is clicked. */
function NodePopoverContent(props: { item?: any; node: DependencyNode; kind: string }) {
  const { item, node, kind } = props;
  const object: FluxObject | undefined = item?.jsonData;
  const theme = useTheme();
  const info = object ? getStatusInfo(object) : undefined;
  const color = statusColor(theme, info ? healthToStatus(info.health) : '');
  const sourceRef = object ? getSourceRef(object) : undefined;

  return (
    <Paper sx={{ p: 2, maxWidth: 380, minWidth: 300 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon={HEALTH_ICON[info?.health ?? 'Unknown']} color={color} width="1.5rem" />
        <Box sx={{ minWidth: 0 }}>
          <FluxLink kind={kind} name={node.name} namespace={node.namespace}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
              {node.name}
            </Typography>
          </FluxLink>
          <Typography variant="caption" color="textSecondary">
            {kind} · {node.namespace}
          </Typography>
        </Box>
      </Box>

      {object && (
        <Box sx={{ mb: 1 }}>
          <FluxStatusLabel object={object} />
        </Box>
      )}

      {info?.message && (
        <Box
          sx={{
            p: 1,
            mb: 1,
            borderRadius: 1,
            backgroundColor: alpha(color, 0.08),
            borderLeft: `3px solid ${color}`,
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {info.message}
          </Typography>
        </Box>
      )}

      <Divider sx={{ my: 1 }} />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 0.5, columnGap: 1 }}>
        <Typography variant="caption" color="textSecondary">
          Last sync
        </Typography>
        <Typography variant="caption">
          {object ? <LastSyncLabel date={getLastSyncTime(object)} /> : '-'}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Next sync
        </Typography>
        <Typography variant="caption">
          {object ? <NextSyncLabel object={object} /> : '-'}
        </Typography>
        {sourceRef && (
          <>
            <Typography variant="caption" color="textSecondary">
              Source
            </Typography>
            <Typography variant="caption">
              <FluxLink kind={sourceRef.kind} name={sourceRef.name} namespace={sourceRef.namespace}>
                {sourceRef.kind}/{sourceRef.name}
              </FluxLink>
            </Typography>
          </>
        )}
        {node.dependsOn.length > 0 && (
          <>
            <Typography variant="caption" color="textSecondary">
              Waits for
            </Typography>
            <Typography variant="caption">
              {node.dependsOn.map(d => d.split('/').pop()).join(', ')}
            </Typography>
          </>
        )}
        {node.missingDependencies.length > 0 && (
          <>
            <Typography variant="caption" color="warning.main">
              Missing deps
            </Typography>
            <Typography variant="caption" color="warning.main">
              {node.missingDependencies.join(', ')}
            </Typography>
          </>
        )}
      </Box>

      {item && (
        <>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FluxActionButtons item={item} />
          </Box>
        </>
      )}
    </Paper>
  );
}

function NodeCard(props: { node: DependencyNode; item?: any; kind: string }) {
  const { node, item, kind } = props;
  const object: FluxObject | undefined = item?.jsonData;
  const theme = useTheme();
  const info = object ? getStatusInfo(object) : undefined;
  const status = info ? healthToStatus(info.health) : '';
  const color = statusColor(theme, status);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  return (
    <>
      <Card
        variant="outlined"
        onClick={e => setAnchorEl(e.currentTarget)}
        sx={{
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          borderLeft: `4px solid ${color}`,
          backgroundColor: alpha(color, 0.06),
          minWidth: 190,
          transition: 'box-shadow 0.15s, transform 0.15s',
          '&:hover': { boxShadow: 3, transform: 'translateY(-1px)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Icon icon={HEALTH_ICON[info?.health ?? 'Unknown']} color={color} width="1.15rem" />
          <Typography component="span" variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {node.name}
          </Typography>
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}
        >
          <Typography variant="caption" color="textSecondary" noWrap>
            {node.namespace}
          </Typography>
          <NextReconcileHint object={object} />
        </Box>
        {info?.health === 'NotReady' && info.message && (
          <Typography variant="caption" color="error" noWrap sx={{ display: 'block', mt: 0.25 }}>
            {info.reason || info.message}
          </Typography>
        )}
      </Card>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <NodePopoverContent item={item} node={node} kind={kind} />
      </Popover>
    </>
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
 *
 * The graph is only rendered once one or more namespaces are selected — a
 * cluster-wide graph can be far too large to be useful.
 */
export function DependencyWavesSection(props: DependencyWavesSectionProps) {
  const { kindDef, title } = props;
  const selectedNamespaces = useSelector(
    (state: any) => state.filter?.namespaces as Set<string> | undefined
  );
  const hasNamespace = !!selectedNamespaces && selectedNamespaces.size > 0;

  const [items, error] = (fluxClass(kindDef) as any).useList();

  const filtered = React.useMemo(
    () =>
      (items ?? []).filter((item: any) =>
        hasNamespace ? selectedNamespaces!.has(item.jsonData?.metadata?.namespace) : true
      ),
    [items, hasNamespace, selectedNamespaces]
  );

  const byId = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const item of filtered) {
      const o = item.jsonData as FluxObject;
      map.set(`${o.metadata?.namespace}/${o.metadata?.name}`, item);
    }
    return map;
  }, [filtered]);

  const { waves, cycles } = React.useMemo(
    () => computeDependencyWaves(makeDependencyNodes(filtered.map((i: any) => i.jsonData))),
    [filtered]
  );

  const sectionTitle = title ?? 'Deployment order';

  // Prompt for a namespace before drawing a potentially huge cluster-wide graph.
  if (!hasNamespace) {
    return (
      <SectionBox title={sectionTitle}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
            py: 4,
            textAlign: 'center',
          }}
        >
          <Icon icon="mdi:sitemap-outline" width="2.4rem" />
          <Typography variant="subtitle1">
            Select a namespace to see the deployment order
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ maxWidth: 460 }}>
            The dependency graph is scoped to a namespace so it stays readable. Choose one or more
            namespaces to visualize the order in which Flux applies these resources.
          </Typography>
          <Box sx={{ minWidth: 280, mt: 1 }}>
            <NamespacesAutocomplete />
          </Box>
        </Box>
      </SectionBox>
    );
  }

  return (
    <SectionBox title={sectionTitle}>
      {error && !items?.length ? (
        <ErrorState
          error={error}
          what={`${kindDef.kind}s`}
          fluxKind={kindDef.kind}
          group={kindDef.group}
        />
      ) : items === null ? (
        <Loader title="Loading" />
      ) : filtered.length === 0 ? (
        <SectionEmpty message={`No ${kindDef.kind}s in the selected namespace`} />
      ) : (
        <>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5 }}>
            Each column is a wave: everything in a wave reconciles in parallel, and each wave waits
            for the previous one to become ready. Click a card for details and actions.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1.5, overflowX: 'auto', pb: 1 }}>
            {waves.map((wave, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.disabled' }}>
                    <Icon icon="mdi:arrow-right-thin" width="1.8rem" />
                  </Box>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 200 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      color: 'text.secondary',
                    }}
                  >
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme => alpha(theme.palette.primary.main, 0.12),
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Typography variant="overline">
                      {i === 0 ? 'Deploys first' : `Wave ${i + 1}`}
                    </Typography>
                  </Box>
                  {wave.map(node => (
                    <NodeCard
                      key={node.id}
                      node={node}
                      item={byId.get(node.id)}
                      kind={kindDef.kind}
                    />
                  ))}
                </Box>
              </React.Fragment>
            ))}
          </Box>
          {cycles.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="error" sx={{ display: 'flex', gap: 0.5 }}>
                <Icon icon="mdi:alert" width="1.2rem" /> Dependency cycle detected — these can never
                become ready:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {cycles.map(node => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    item={byId.get(node.id)}
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
