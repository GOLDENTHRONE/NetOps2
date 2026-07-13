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
import {
  alpha,
  Box,
  Divider,
  IconButton,
  Paper,
  Popover,
  Theme,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { FluxActionButtons } from '../flux/actions';
import { ICONS } from '../flux/icon';
import { collectDownstream, collectUpstream, diagnose } from '../flux/insights';
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
  NA,
  NextSyncLabel,
} from './common';
import { ErrorState } from './errors';
import { accentsFor, EmptyState, RADII, Section, Surface } from './ui';

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

/** The detail card opened by clicking a node. Actions live in the header as a gear menu. */
function NodeDetailCard(props: { item?: any; node: DependencyNode; kind: string }) {
  const { item, node, kind } = props;
  const object: FluxObject | undefined = item?.jsonData;
  const theme = useTheme();
  const info = object ? getStatusInfo(object) : undefined;
  const diagnosis = object ? diagnose(object) : undefined;
  const color = statusColor(theme, info ? healthToStatus(info.health) : '');
  const sourceRef = object ? getSourceRef(object) : undefined;

  return (
    <Paper elevation={6} sx={{ p: 2, maxWidth: 380, minWidth: 300, borderRadius: RADII.card }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon={HEALTH_ICON[info?.health ?? 'Unknown']} color={color} width="1.5rem" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <FluxLink kind={kind} name={node.name} namespace={node.namespace}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
              {node.name}
            </Typography>
          </FluxLink>
          <Typography variant="caption" color="textSecondary">
            {kind} · {node.namespace}
          </Typography>
        </Box>
        {item && <FluxActionButtons item={item} menuIcon={ICONS.gear} />}
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
          {object ? <LastSyncLabel date={getLastSyncTime(object)} /> : <NA />}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Next sync
        </Typography>
        <Typography variant="caption">
          {object ? <NextSyncLabel object={object} /> : <NA />}
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
    </Paper>
  );
}

/** How a node participates in the current highlight. */
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
    <Box>
      <Surface
        interactive
        accent={color}
        tinted
        onClick={e => onSelect(node.id, e.currentTarget as HTMLElement)}
        sx={{
          px: 1.5,
          py: 1,
          minWidth: 200,
          opacity: emphasis === 'dimmed' ? 0.35 : 1,
          transition: 'opacity 0.15s ease, box-shadow 0.15s ease',
          ...(emphasis === 'selected'
            ? {
                backgroundColor: alpha(accents.primary, theme.palette.mode === 'dark' ? 0.18 : 0.1),
              }
            : {}),
          ...(emphasisRing ? { boxShadow: emphasisRing } : {}),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Icon icon={HEALTH_ICON[info?.health ?? 'Unknown']} color={color} width="1.15rem" />
          <Typography component="span" variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
            {node.name}
          </Typography>
          {emphasis === 'upstream' && (
            <Typography
              variant="caption"
              noWrap
              sx={{ color: accents.warning, ml: 'auto', flexShrink: 0 }}
            >
              needed
            </Typography>
          )}
          {emphasis === 'downstream' && (
            <Typography
              variant="caption"
              noWrap
              sx={{ color: accents.info, ml: 'auto', flexShrink: 0 }}
            >
              waits
            </Typography>
          )}
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}
        >
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
      </Surface>
    </Box>
  );
}

/** Small always-visible legend explaining what the card colors mean. */
function StatusLegend() {
  const theme = useTheme();
  const accents = accentsFor(theme);
  const entries: { color: string; label: string }[] = [
    { color: accents.success, label: 'Ready' },
    { color: accents.error, label: 'Failed' },
    { color: accents.warning, label: 'Reconciling' },
    { color: accents.muted, label: 'Suspended' },
  ];
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      {entries.map(e => (
        <Box key={e.label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="span"
            sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: e.color }}
          />
          <Typography variant="caption" color="text.secondary">
            {e.label}
          </Typography>
        </Box>
      ))}
    </Box>
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
 * Clicking a node opens its detail card and highlights its upstream
 * dependencies ("needed") and downstream dependents ("waits"). Card colors
 * carry the live status; the legend at the top right explains them. When
 * the graph overflows, chevron buttons scroll it; there is no scrollbar.
 *
 * The graph is only rendered once one or more namespaces are selected; a
 * cluster-wide graph can be far too large to be useful.
 */
export function DependencyWavesSection(props: DependencyWavesSectionProps) {
  const { kindDef, title } = props;
  const hintAccent = accentsFor(useTheme()).info;
  const selectedNamespaces = useSelector(
    (state: any) => state.filter?.namespaces as Set<string> | undefined
  );
  const hasNamespace = !!selectedNamespaces && selectedNamespaces.size > 0;

  const [items, error] = (fluxClass(kindDef) as any).useList();

  // Clicking a card opens its detail popover and highlights its dependency
  // chain; closing the popover clears the highlight.
  const [selection, setSelection] = React.useState<{ id: string; anchor: HTMLElement } | null>(
    null
  );
  const onSelect = (id: string, anchor: HTMLElement) => setSelection({ id, anchor });

  // The graph never shows a scrollbar: when it overflows, arrow buttons at
  // either end scroll it a page at a time instead.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = React.useState({ left: false, right: false });
  const updateScrollState = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setScrollState(s => (s.left === left && s.right === right ? s : { left, right }));
  }, []);
  // Re-measure after every render (content width changes with the data) and
  // whenever the container itself resizes.
  React.useEffect(() => {
    updateScrollState();
  });
  React.useEffect(() => {
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollState) : undefined;
    if (scrollRef.current && observer) {
      observer.observe(scrollRef.current);
    }
    window.addEventListener('resize', updateScrollState);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);
  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollBy({ left: direction * Math.max(260, el.clientWidth * 0.6), behavior: 'smooth' });
  };

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

  const activeId = selection?.id ?? null;
  const { upstream, downstream } = React.useMemo(() => {
    if (!activeId) {
      return { upstream: new Set<string>(), downstream: new Set<string>() };
    }
    return {
      upstream: collectUpstream(nodes, activeId),
      downstream: collectDownstream(nodes, activeId),
    };
  }, [nodes, activeId]);

  const emphasisOf = (id: string): Emphasis => {
    if (!activeId) {
      return 'none';
    }
    if (id === activeId) {
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

  const selectedNode = selection ? nodes.find(n => n.id === selection.id) : undefined;

  const sectionTitle = title ?? 'Deployment order';

  // Without a namespace a cluster-wide graph would be unreadable; show a
  // gentle, minimal alert instead of a large empty section.
  if (!hasNamespace) {
    return (
      <Surface
        accent={hintAccent}
        tinted
        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, mb: 3 }}
      >
        <Icon icon={ICONS.graph} color={hintAccent} width="1.15rem" style={{ flexShrink: 0 }} />
        <Typography variant="body2">
          Select a namespace (top right) to visualize the deployment order.
        </Typography>
      </Surface>
    );
  }

  const cardProps = { kind: kindDef.kind, onSelect };

  return (
    <Section
      title={sectionTitle}
      icon={ICONS.graph}
      description="Click a card to know more."
      actions={<StatusLegend />}
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
          <Box sx={{ position: 'relative' }}>
            {scrollState.left && <ScrollArrow direction={-1} onClick={() => scrollByPage(-1)} />}
            {scrollState.right && <ScrollArrow direction={1} onClick={() => scrollByPage(1)} />}
            <Box
              ref={scrollRef}
              onScroll={updateScrollState}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                overflowX: 'hidden',
                pb: 1,
              }}
            >
              {waves.map((wave, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        color: 'text.disabled',
                        px: 0.5,
                        flexShrink: 0,
                      }}
                    >
                      <Icon icon={ICONS.arrowRight} width="1.8rem" />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 210 }}>
                    <Typography
                      variant="overline"
                      sx={{
                        fontWeight: 700,
                        color: 'text.secondary',
                        lineHeight: 1,
                        textAlign: 'center',
                        mb: 1,
                      }}
                    >
                      Wave {i + 1}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {wave.map(node => (
                        <NodeCard
                          key={node.id}
                          node={node}
                          item={byId.get(node.id)}
                          emphasis={emphasisOf(node.id)}
                          {...cardProps}
                        />
                      ))}
                    </Box>
                  </Box>
                </React.Fragment>
              ))}
            </Box>
          </Box>
          {cycles.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="error" sx={{ display: 'flex', gap: 0.5 }}>
                <Icon icon={ICONS.warning} width="1.2rem" /> Dependency cycle detected; these can
                never become ready:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {cycles.map(node => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    item={byId.get(node.id)}
                    emphasis={emphasisOf(node.id)}
                    {...cardProps}
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
              <NodeDetailCard
                item={byId.get(selectedNode.id)}
                node={selectedNode}
                kind={kindDef.kind}
              />
            )}
          </Popover>
        </Box>
      )}
    </Section>
  );
}

/** Floating chevron button revealing overflowed waves on click. */
function ScrollArrow(props: { direction: 1 | -1; onClick: () => void }) {
  const { direction, onClick } = props;
  const theme = useTheme();
  const accents = accentsFor(theme);
  return (
    <IconButton
      onClick={onClick}
      aria-label={direction === 1 ? 'Scroll right' : 'Scroll left'}
      sx={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        [direction === 1 ? 'right' : 'left']: -4,
        zIndex: 2,
        width: 38,
        height: 38,
        color: accents.primary,
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${alpha(accents.primary, 0.35)}`,
        boxShadow: '0 4px 14px rgba(16, 24, 40, 0.28)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        '&:hover': {
          backgroundColor: theme.palette.background.paper,
          transform: 'translateY(-50%) scale(1.08)',
          boxShadow: '0 6px 18px rgba(16, 24, 40, 0.35)',
        },
      }}
    >
      <Icon icon={direction === 1 ? ICONS.chevronRight : ICONS.chevronLeft} width="1.4rem" />
    </IconButton>
  );
}
