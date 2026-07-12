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
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Divider, Paper, Popover, Theme, Typography, useTheme } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { FluxActionButtons } from '../flux/actions';
import { ICONS } from '../flux/icon';
import {
  collectDownstream,
  collectUpstream,
  diagnose,
  summarizeWave,
  WaveState,
} from '../flux/insights';
import { fluxClass, FluxKind } from '../flux/kinds';
import {
  computeDependencyWaves,
  DependencyNode,
  FluxHealth,
  FluxObject,
  getLastSyncTime,
  getNextSyncTime,
  getSourceRef,
  getStatusInfo,
  makeDependencyNodes,
} from '../flux/utils';
import { FluxLink, FluxStatusLabel, healthToStatus, LastSyncLabel, NextSyncLabel } from './common';
import { ErrorState } from './errors';
import { accentsFor, EmptyState, NamespacePicker, Pill, RADII, Section, Surface } from './ui';

const HEALTH_ICON: Record<string, string> = {
  Ready: ICONS.statusReady,
  NotReady: ICONS.statusError,
  Suspended: ICONS.statusSuspended,
  Reconciling: ICONS.statusReconciling,
  Unknown: ICONS.statusUnknown,
};

/** Vibrant, mode-aware status color for the wave cards. */
function statusColor(theme: Theme, status: 'success' | 'warning' | 'error' | '') {
  const a = accentsFor(theme);
  if (status === '') {
    return a.muted;
  }
  return a[status];
}

/** Height reserved for each wave's header, so the arrows line up with the cards. */
const WAVE_HEADER_HEIGHT = 30;

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
      <Icon icon={ICONS.timer} width="0.85rem" />
      <Typography variant="caption" color="textSecondary">
        next in {text}
      </Typography>
    </Box>
  );
}

/** A rich, colored, structured detail card opened when a node is clicked. */
function NodePopoverContent(props: {
  item?: any;
  node: DependencyNode;
  kind: string;
  upstreamCount: number;
  downstreamCount: number;
}) {
  const { item, node, kind, upstreamCount, downstreamCount } = props;
  const object: FluxObject | undefined = item?.jsonData;
  const theme = useTheme();
  const info = object ? getStatusInfo(object) : undefined;
  const diagnosis = object ? diagnose(object) : undefined;
  const color = statusColor(theme, info ? healthToStatus(info.health) : '');
  const sourceRef = object ? getSourceRef(object) : undefined;

  return (
    <Paper sx={{ p: 2, maxWidth: 380, minWidth: 300, borderRadius: RADII.card }}>
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

      {diagnosis && diagnosis.category !== 'ok' && (
        <Box
          sx={{
            p: 1,
            mb: 1,
            borderRadius: 1,
            backgroundColor: alpha(color, 0.08),
            borderLeft: `3px solid ${color}`,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {diagnosis.headline}
          </Typography>
          {diagnosis.explanation && (
            <Typography
              variant="body2"
              color="textSecondary"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.25 }}
            >
              {diagnosis.explanation}
            </Typography>
          )}
          {diagnosis.action && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {diagnosis.action}
            </Typography>
          )}
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
        {(upstreamCount > 0 || downstreamCount > 0) && (
          <>
            <Typography variant="caption" color="textSecondary">
              Highlighted
            </Typography>
            <Typography variant="caption">
              {upstreamCount} upstream · {downstreamCount} downstream
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

/** How a node participates in the current selection. */
type Emphasis = 'none' | 'selected' | 'upstream' | 'downstream' | 'dimmed';

function NodeCard(props: {
  node: DependencyNode;
  item?: any;
  kind: string;
  emphasis: Emphasis;
  onSelect: (id: string, anchor: HTMLElement) => void;
}) {
  const { node, item, kind, emphasis, onSelect } = props;
  const object: FluxObject | undefined = item?.jsonData;
  const theme = useTheme();
  const accents = accentsFor(theme);
  const info = object ? getStatusInfo(object) : undefined;
  const diagnosis = object ? diagnose(object) : undefined;
  const status = info ? healthToStatus(info.health) : '';
  const color = statusColor(theme, status);

  const emphasisRing =
    emphasis === 'selected'
      ? `0 0 0 2px ${accents.primary}`
      : emphasis === 'upstream'
      ? `0 0 0 2px ${alpha(accents.warning, 0.9)}`
      : emphasis === 'downstream'
      ? `0 0 0 2px ${alpha(accents.info, 0.9)}`
      : undefined;

  return (
    <Surface
      interactive
      accent={color}
      tinted
      onClick={e => onSelect(node.id, e.currentTarget as HTMLElement)}
      sx={{
        px: 1.5,
        py: 1,
        minWidth: 190,
        opacity: emphasis === 'dimmed' ? 0.35 : 1,
        transition: 'opacity 0.15s ease, box-shadow 0.15s ease',
        ...(emphasisRing ? { boxShadow: emphasisRing } : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Icon icon={HEALTH_ICON[info?.health ?? 'Unknown']} color={color} width="1.15rem" />
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {node.name}
        </Typography>
        {emphasis === 'upstream' && (
          <Typography variant="caption" sx={{ color: accents.warning, ml: 'auto' }}>
            needed first
          </Typography>
        )}
        {emphasis === 'downstream' && (
          <Typography variant="caption" sx={{ color: accents.info, ml: 'auto' }}>
            waits on it
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="textSecondary" noWrap>
          {node.namespace}
        </Typography>
        <NextReconcileHint object={object} />
      </Box>
      {info?.health === 'NotReady' && diagnosis && (
        <Typography variant="caption" color="error" noWrap sx={{ display: 'block', mt: 0.25 }}>
          {diagnosis.headline}
        </Typography>
      )}
      {info?.health === 'Reconciling' && diagnosis?.category === 'dependency' && (
        <Typography
          variant="caption"
          sx={{ display: 'block', mt: 0.25, color: accents.warning }}
          noWrap
        >
          waiting for dependency
        </Typography>
      )}
    </Surface>
  );
}

const WAVE_STATE_PRESENTATION: Record<
  WaveState,
  { label: string; icon: string; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' }
> = {
  complete: { label: 'deployed', icon: ICONS.statusReady, tone: 'success' },
  active: { label: 'deploying', icon: ICONS.statusReconciling, tone: 'info' },
  blocked: { label: 'blocked', icon: ICONS.statusError, tone: 'error' },
  waiting: { label: 'waiting', icon: ICONS.clock, tone: 'neutral' },
};

export interface DependencyWavesSectionProps {
  kindDef: FluxKind;
  title?: string;
}

/**
 * Shows Kustomizations/HelmReleases arranged by their dependsOn relations,
 * in the order Flux deploys them: items in the same wave reconcile in
 * parallel; each wave waits for the previous one to be ready.
 *
 * Clicking a node highlights its upstream dependencies (what must deploy
 * first) and downstream dependents (what waits on it), and opens a detail
 * card explaining the node's state in plain language.
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

  const [selection, setSelection] = React.useState<{
    id: string;
    anchor: HTMLElement;
  } | null>(null);

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

  const nodes = React.useMemo(
    () => makeDependencyNodes(filtered.map((i: any) => i.jsonData)),
    [filtered]
  );
  const { waves, cycles } = React.useMemo(() => computeDependencyWaves(nodes), [nodes]);

  const { upstream, downstream } = React.useMemo(() => {
    if (!selection) {
      return { upstream: new Set<string>(), downstream: new Set<string>() };
    }
    return {
      upstream: collectUpstream(nodes, selection.id),
      downstream: collectDownstream(nodes, selection.id),
    };
  }, [nodes, selection]);

  const emphasisOf = (id: string): Emphasis => {
    if (!selection) {
      return 'none';
    }
    if (id === selection.id) {
      return 'selected';
    }
    if (upstream.has(id)) {
      return 'upstream';
    }
    if (downstream.has(id)) {
      return 'downstream';
    }
    return 'dimmed';
  };

  const healthOf = (node: DependencyNode): FluxHealth => {
    const item = byId.get(node.id);
    return item ? getStatusInfo(item.jsonData).health : 'Unknown';
  };

  const onSelect = (id: string, anchor: HTMLElement) => setSelection({ id, anchor });
  const selectedNode = selection ? nodes.find(n => n.id === selection.id) : undefined;

  const sectionTitle = title ?? 'Deployment order';

  // Prompt for a namespace before drawing a potentially huge cluster-wide graph.
  if (!hasNamespace) {
    return (
      <Section title={sectionTitle} icon={ICONS.graph}>
        <Surface sx={{ p: 2 }}>
          <EmptyState
            icon={ICONS.graph}
            title="Pick a namespace to see the deployment order"
            description="Deployment graphs are scoped to one namespace so they stay readable. The namespace you pick becomes your working context on every Flux page until you change it."
            action={<NamespacePicker placeholder="Search namespaces…" />}
          />
        </Surface>
      </Section>
    );
  }

  return (
    <Section
      title={sectionTitle}
      icon={ICONS.graph}
      description="Click any step to highlight what must deploy before it and what waits on it."
    >
      {error && !items?.length ? (
        <Surface sx={{ p: 2 }}>
          <ErrorState
            error={error}
            what={`${kindDef.kind}s`}
            fluxKind={kindDef.kind}
            group={kindDef.group}
          />
        </Surface>
      ) : items === null ? (
        <Surface sx={{ p: 2 }}>
          <Loader title="Loading" />
        </Surface>
      ) : filtered.length === 0 ? (
        <Surface sx={{ p: 2 }}>
          <EmptyState
            icon={ICONS.kustomization}
            title={`No ${kindDef.kind}s in the selected namespace`}
            description="Try a different namespace, or create one with the + button in the list below."
          />
        </Surface>
      ) : (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1.5, overflowX: 'auto', pb: 1 }}>
            {waves.map((wave, i) => {
              const waveState = summarizeWave(wave.map(healthOf));
              const p = WAVE_STATE_PRESENTATION[waveState];
              return (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                      {/* Spacer matching the wave header, so the arrow centers on
                          the cards band rather than the whole column. */}
                      <Box sx={{ height: WAVE_HEADER_HEIGHT }} />
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'text.disabled',
                          px: 0.5,
                        }}
                      >
                        <Icon icon={ICONS.arrowRight} width="1.8rem" />
                      </Box>
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 200 }}>
                    <Box
                      sx={{
                        height: WAVE_HEADER_HEIGHT,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      <Typography
                        variant="overline"
                        sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}
                      >
                        Wave {i + 1}
                      </Typography>
                      <Pill tone={p.tone} icon={p.icon}>
                        {p.label}
                      </Pill>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {wave.map(node => (
                        <NodeCard
                          key={node.id}
                          node={node}
                          item={byId.get(node.id)}
                          kind={kindDef.kind}
                          emphasis={emphasisOf(node.id)}
                          onSelect={onSelect}
                        />
                      ))}
                    </Box>
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
          {cycles.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="error" sx={{ display: 'flex', gap: 0.5 }}>
                <Icon icon={ICONS.warning} width="1.2rem" /> Dependency cycle detected — these can
                never become ready:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {cycles.map(node => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    item={byId.get(node.id)}
                    kind={kindDef.kind}
                    emphasis={emphasisOf(node.id)}
                    onSelect={onSelect}
                  />
                ))}
              </Box>
            </Box>
          )}
          <Popover
            open={!!selection && !!selectedNode}
            anchorEl={selection?.anchor}
            onClose={() => setSelection(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            {selectedNode && (
              <NodePopoverContent
                item={byId.get(selectedNode.id)}
                node={selectedNode}
                kind={kindDef.kind}
                upstreamCount={upstream.size}
                downstreamCount={downstream.size}
              />
            )}
          </Popover>
        </Box>
      )}
    </Section>
  );
}
