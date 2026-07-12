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

/**
 * The operational heart of the Flux UI: one cluster-wide feed of everything
 * that needs an operator's attention right now, what is deploying, and what
 * recently changed — in plain language, not Kubernetes conditions.
 */

import { Icon } from '@iconify/react';
import { DateLabel, Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Link as MuiLink, Typography, useTheme } from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { FluxActionButtons } from '../flux/actions';
import { ICONS } from '../flux/icon';
import { diagnose, Diagnosis } from '../flux/insights';
import { FLUX_KINDS, fluxClass, FluxKind } from '../flux/kinds';
import {
  FluxObject,
  FluxStatusInfo,
  getCommitInfo,
  getLastSyncTime,
  getStatusInfo,
  parseRevision,
} from '../flux/utils';
import { FluxLink, healthPresentation } from './common';
import { Pill, Section, Surface, useAccents } from './ui';

/** One Flux object together with everything the UI needs to present it. */
export interface FluxRow {
  kindDef: FluxKind;
  /** The KubeObject (for links and actions). */
  item: any;
  object: FluxObject;
  info: FluxStatusInfo;
  diagnosis: Diagnosis;
}

export interface AllFluxObjects {
  rows: FluxRow[];
  /** True while nothing has loaded yet. */
  loading: boolean;
  errors: any[];
}

/**
 * Lists every Flux kind and returns one flat, diagnosed list. The hook count
 * is constant (FLUX_KINDS is a fixed list), so calling hooks in a loop is safe.
 */
export function useAllFluxObjects(cluster?: string): AllFluxObjects {
  const results = FLUX_KINDS.map(kindDef => {
    const [items, error] = (fluxClass(kindDef) as any).useList(cluster ? { cluster } : {});
    return { kindDef, items, error };
  });

  const loading = results.every(r => r.items === null);
  const errors = results.map(r => r.error).filter(Boolean);

  const rows: FluxRow[] = [];
  for (const { kindDef, items } of results) {
    for (const item of items ?? []) {
      const object = item.jsonData as FluxObject;
      rows.push({
        kindDef,
        item,
        object,
        info: getStatusInfo(object),
        diagnosis: diagnose(object),
      });
    }
  }
  return { rows, loading, errors };
}

const CATEGORY_ICON: Record<string, string> = {
  dependency: ICONS.clock,
  source: ICONS.gitRepository,
  auth: ICONS.lock,
  build: ICONS.document,
  rollout: ICONS.resources,
  helm: ICONS.helmRelease,
  image: ICONS.imageRepository,
  cluster: ICONS.cluster,
  network: ICONS.unreachable,
  suspended: ICONS.statusSuspended,
  progressing: ICONS.statusReconciling,
  unknown: ICONS.statusError,
};

/** One row of the attention/progress feeds: who, what, why and what to do. */
function OperationalRow(props: { row: FluxRow; tone: 'error' | 'warning' | 'info' }) {
  const { row, tone } = props;
  const theme = useTheme();
  const accents = useAccents();
  const color = accents[tone];
  const { object, kindDef, diagnosis, info } = row;
  const name = object.metadata?.name ?? '';
  const namespace = object.metadata?.namespace ?? '';

  return (
    <Surface accent={color} sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          borderRadius: '10px',
          flexShrink: 0,
          color,
          backgroundColor: alpha(color, 0.12),
          mt: 0.25,
        }}
      >
        <Icon icon={CATEGORY_ICON[diagnosis.category] ?? ICONS.statusError} width="1.2rem" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FluxLink kind={kindDef.kind} name={name} namespace={namespace}>
            <Typography component="span" variant="body2" sx={{ fontWeight: 700 }}>
              {name}
            </Typography>
          </FluxLink>
          <Typography variant="caption" color="text.secondary">
            {kindDef.kind} · {namespace}
          </Typography>
          {info.lastTransitionTime && (
            <Typography variant="caption" color="text.secondary" component="span">
              <DateLabel date={info.lastTransitionTime} format="mini" /> ago
            </Typography>
          )}
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color, mt: 0.25 }}>
          {diagnosis.headline}
        </Typography>
        {diagnosis.explanation && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {diagnosis.explanation}
          </Typography>
        )}
        {diagnosis.action && (
          <Typography
            variant="body2"
            sx={{ mt: 0.25, display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <Icon icon={ICONS.arrowRight} width="0.95rem" color={theme.palette.text.secondary} />
            {diagnosis.action}
          </Typography>
        )}
        {diagnosis.blockedOn && diagnosis.blockedOn.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Waiting for:
            </Typography>
            {diagnosis.blockedOn.map(id => {
              const [depNamespace, depName] = id.split('/');
              return (
                <FluxLink key={id} kind={kindDef.kind} name={depName} namespace={depNamespace}>
                  <Pill tone="warning" icon={ICONS.clock}>
                    {depName}
                  </Pill>
                </FluxLink>
              );
            })}
          </Box>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, alignSelf: 'center' }}>
        <FluxActionButtons item={row.item} variant="inline" />
      </Box>
    </Surface>
  );
}

/** Splits failing rows into real failures vs. resources merely queued behind them. */
export function splitAttention(rows: FluxRow[]): {
  failing: FluxRow[];
  blocked: FluxRow[];
  progressing: FluxRow[];
  suspended: FluxRow[];
} {
  const failing: FluxRow[] = [];
  const blocked: FluxRow[] = [];
  const progressing: FluxRow[] = [];
  const suspended: FluxRow[] = [];
  for (const row of rows) {
    if (row.info.health === 'Suspended') {
      suspended.push(row);
    } else if (row.info.health === 'Reconciling') {
      (row.diagnosis.category === 'dependency' ? blocked : progressing).push(row);
    } else if (row.info.health === 'NotReady') {
      (row.diagnosis.category === 'dependency' ? blocked : failing).push(row);
    }
  }
  const byTransition = (a: FluxRow, b: FluxRow) =>
    (b.info.lastTransitionTime ?? '').localeCompare(a.info.lastTransitionTime ?? '');
  failing.sort(byTransition);
  blocked.sort(byTransition);
  progressing.sort(byTransition);
  return { failing, blocked, progressing, suspended };
}

const MAX_FEED_ROWS = 8;

function FeedOverflowLink(props: { hidden: number }) {
  if (props.hidden <= 0) {
    return null;
  }
  return (
    <Typography variant="body2" sx={{ mt: 1 }}>
      <MuiLink component={RouterLink} to="/flux/search">
        …and {props.hidden} more — open search to see everything
      </MuiLink>
    </Typography>
  );
}

/**
 * "What needs my attention right now?" — every failing resource with a
 * plain-language cause and next step, followed by the resources queued
 * behind them, so operators fix root causes instead of symptoms.
 */
export function NeedsAttentionSection(props: { data: AllFluxObjects }) {
  const { rows, loading } = props.data;
  const accents = useAccents();
  const { failing, blocked } = splitAttention(rows);

  if (loading) {
    return null;
  }

  if (failing.length === 0 && blocked.length === 0) {
    return (
      <Section title="Needs attention" icon={ICONS.warning}>
        <Surface accent={accents.success} tinted sx={{ p: 2, display: 'flex', gap: 1.5 }}>
          <Icon icon={ICONS.statusReady} color={accents.success} width="1.6rem" />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Nothing needs your attention
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No failed reconciliations and nothing is stuck waiting on a dependency.
            </Typography>
          </Box>
        </Surface>
      </Section>
    );
  }

  return (
    <Section
      title={`Needs attention (${failing.length + blocked.length})`}
      icon={ICONS.warning}
      description="Failures first — fixing those usually unblocks everything waiting below them."
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {failing.slice(0, MAX_FEED_ROWS).map(row => (
          <OperationalRow key={rowKey(row)} row={row} tone="error" />
        ))}
        {blocked.slice(0, Math.max(0, MAX_FEED_ROWS - failing.length)).map(row => (
          <OperationalRow key={rowKey(row)} row={row} tone="warning" />
        ))}
      </Box>
      <FeedOverflowLink hidden={failing.length + blocked.length - MAX_FEED_ROWS} />
    </Section>
  );
}

/** "Is anything deploying right now?" — live reconciliations, with context. */
export function InProgressSection(props: { data: AllFluxObjects }) {
  const { rows, loading } = props.data;
  const { progressing } = splitAttention(rows);

  if (loading || progressing.length === 0) {
    return null;
  }

  return (
    <Section
      title={`Deploying now (${progressing.length})`}
      icon={ICONS.statusReconciling}
      description="Reconciliations currently in flight."
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {progressing.slice(0, MAX_FEED_ROWS).map(row => (
          <OperationalRow key={rowKey(row)} row={row} tone="info" />
        ))}
      </Box>
      <FeedOverflowLink hidden={progressing.length - MAX_FEED_ROWS} />
    </Section>
  );
}

/**
 * "What changed recently?" — the latest successful syncs of sources and
 * appliers with their revision and commit info, newest first.
 */
export function RecentActivitySection(props: { data: AllFluxObjects }) {
  const { rows, loading } = props.data;
  const theme = useTheme();

  const recent = React.useMemo(() => {
    return rows
      .map(row => ({ row, time: getLastSyncTime(row.object) }))
      .filter((r): r is { row: FluxRow; time: string } => !!r.time)
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, MAX_FEED_ROWS);
  }, [rows]);

  if (loading || recent.length === 0) {
    return null;
  }

  return (
    <Section
      title="Recent activity"
      icon={ICONS.clock}
      description="The latest changes Flux pulled and deployed, newest first."
    >
      <Surface sx={{ px: 2, py: 0.5 }}>
        {recent.map(({ row, time }, i) => {
          const { object, kindDef } = row;
          const revision =
            object?.status?.artifact?.revision ?? object?.status?.lastAppliedRevision;
          const parsed = parseRevision(revision);
          const commit = getCommitInfo(object);
          const p = healthPresentation(row.info.health);
          return (
            <Box
              key={rowKey(row)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                borderTop: i > 0 ? `1px solid ${alpha(theme.palette.divider, 0.5)}` : 'none',
              }}
            >
              <Icon icon={p.icon} width="1.1rem" style={{ flexShrink: 0, opacity: 0.7 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <FluxLink
                    kind={kindDef.kind}
                    name={object.metadata?.name ?? ''}
                    namespace={object.metadata?.namespace}
                  >
                    <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                      {object.metadata?.name}
                    </Typography>
                  </FluxLink>
                  <Typography variant="caption" color="text.secondary">
                    {kindDef.kind}
                  </Typography>
                  {(parsed.ref || parsed.shortHash) && (
                    <Pill tone="neutral" icon={ICONS.commit} title={revision}>
                      {[parsed.ref, parsed.shortHash].filter(Boolean).join(' @ ')}
                    </Pill>
                  )}
                </Box>
                {(commit.author || commit.message) && (
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {[commit.author, commit.message].filter(Boolean).join(' — ')}
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                <DateLabel date={time} format="mini" />
              </Typography>
            </Box>
          );
        })}
      </Surface>
    </Section>
  );
}

/** Loading placeholder shared by the overview feeds. */
export function FeedLoader() {
  return (
    <Surface sx={{ p: 2 }}>
      <Loader title="Checking the state of the cluster" />
    </Surface>
  );
}

function rowKey(row: FluxRow): string {
  return `${row.kindDef.kind}/${row.object.metadata?.namespace}/${row.object.metadata?.name}`;
}
