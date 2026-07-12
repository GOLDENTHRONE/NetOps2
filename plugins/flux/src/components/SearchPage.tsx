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
import { DateLabel, Loader, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, InputAdornment, TextField, useTheme } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import { FluxActionButtons } from '../flux/actions';
import { ICONS, kindIcon } from '../flux/icon';
import { getLastSyncTime, getSourceRef, parseRevision } from '../flux/utils';
import { FluxLink, FluxStatusLabel } from './common';
import { ErrorState, pickMostRelevantError } from './errors';
import { FluxRow, useAllFluxObjects } from './operations';
import { EmptyState, NamespaceBar, RADII, Surface, useAccents } from './ui';

/** Operational states the quick filters slice by. */
type StateFilter = 'all' | 'failing' | 'blocked' | 'progressing' | 'suspended' | 'ready';

const STATE_FILTERS: { id: StateFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'Everything', icon: ICONS.resources },
  { id: 'failing', label: 'Failing', icon: ICONS.statusError },
  { id: 'blocked', label: 'Waiting on dependencies', icon: ICONS.clock },
  { id: 'progressing', label: 'Deploying', icon: ICONS.statusReconciling },
  { id: 'suspended', label: 'Suspended', icon: ICONS.statusSuspended },
  { id: 'ready', label: 'Up to date', icon: ICONS.statusReady },
];

function matchesState(row: FluxRow, state: StateFilter): boolean {
  switch (state) {
    case 'all':
      return true;
    case 'failing':
      return row.info.health === 'NotReady' && row.diagnosis.category !== 'dependency';
    case 'blocked':
      return row.diagnosis.category === 'dependency';
    case 'progressing':
      return row.info.health === 'Reconciling' && row.diagnosis.category !== 'dependency';
    case 'suspended':
      return row.info.health === 'Suspended';
    case 'ready':
      return row.info.health === 'Ready';
  }
}

/**
 * Free-text match across the fields an operator actually searches by:
 * name, namespace, kind, revision/commit, source name, controller and the
 * failure message.
 */
function matchesQuery(row: FluxRow, query: string): boolean {
  if (!query) {
    return true;
  }
  const object = row.object;
  const revision = object?.status?.artifact?.revision ?? object?.status?.lastAppliedRevision ?? '';
  const parsed = parseRevision(revision);
  const haystack = [
    object.metadata?.name,
    object.metadata?.namespace,
    row.kindDef.kind,
    row.kindDef.controller,
    revision,
    parsed.ref,
    parsed.shortHash,
    getSourceRef(object)?.name,
    row.info.message,
    row.info.reason,
    row.diagnosis.headline,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every(term => haystack.includes(term));
}

function FilterChip(props: {
  active: boolean;
  label: string;
  icon: string;
  count?: number;
  onClick: () => void;
}) {
  const { active, label, icon, count, onClick } = props;
  const theme = useTheme();
  const accents = useAccents();
  const color = active ? accents.primary : theme.palette.text.secondary;
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.6,
        px: 1.25,
        py: '5px',
        borderRadius: RADII.pill,
        border: `1px solid ${alpha(color, active ? 0.5 : 0.25)}`,
        backgroundColor: active ? alpha(color, 0.12) : 'transparent',
        color,
        fontSize: '0.8rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s ease',
        '&:hover': { backgroundColor: alpha(color, 0.08) },
      }}
    >
      <Icon icon={icon} width="0.95rem" />
      {label}
      {typeof count === 'number' && (
        <Box component="span" sx={{ opacity: 0.7 }}>
          {count}
        </Box>
      )}
    </Box>
  );
}

/**
 * One search across everything Flux manages, sliced by operational state
 * instead of resource kind: failed deployments, resources stuck behind
 * dependencies, live rollouts, suspended objects — plus free-text search
 * over names, namespaces, commits, sources and failure messages.
 */
export default function FluxSearchPage() {
  const location = useLocation();
  const history = useHistory();
  const data = useAllFluxObjects();

  const selectedNamespaces = useSelector(
    (state: any) => state.filter?.namespaces as Set<string> | undefined
  );

  const params = new URLSearchParams(location.search);
  const stateParam = params.get('state') as StateFilter | null;
  const state: StateFilter =
    stateParam && STATE_FILTERS.some(f => f.id === stateParam) ? stateParam : 'all';
  const [query, setQuery] = React.useState(params.get('q') ?? '');

  const setState = (next: StateFilter) => {
    const p = new URLSearchParams(location.search);
    if (next === 'all') {
      p.delete('state');
    } else {
      p.set('state', next);
    }
    history.replace({ ...location, search: p.toString() });
  };

  const scoped = React.useMemo(() => {
    if (!selectedNamespaces || selectedNamespaces.size === 0) {
      return data.rows;
    }
    return data.rows.filter(row => selectedNamespaces.has(row.object.metadata?.namespace ?? ''));
  }, [data.rows, selectedNamespaces]);

  const countFor = React.useMemo(() => {
    const counts = new Map<StateFilter, number>();
    for (const f of STATE_FILTERS) {
      counts.set(f.id, scoped.filter(row => matchesState(row, f.id)).length);
    }
    return counts;
  }, [scoped]);

  const results = React.useMemo(
    () =>
      scoped
        .filter(row => matchesState(row, state) && matchesQuery(row, query))
        .sort((a, b) => {
          const rank = (r: FluxRow) =>
            r.info.health === 'NotReady'
              ? 0
              : r.info.health === 'Reconciling'
              ? 1
              : r.info.health === 'Suspended'
              ? 2
              : 3;
          return (
            rank(a) - rank(b) ||
            (a.object.metadata?.name ?? '').localeCompare(b.object.metadata?.name ?? '')
          );
        }),
    [scoped, state, query]
  );

  const allFailed = data.errors.length >= 1 && data.rows.length === 0 && !data.loading;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          mb: 2,
        }}
      >
        <TextField
          size="small"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, namespace, kind, commit, source or failure message…"
          sx={{ flex: '1 1 340px', maxWidth: 620 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon={ICONS.search} width="1.1rem" />
              </InputAdornment>
            ),
          }}
        />
        <Box sx={{ ml: 'auto' }}>
          <NamespaceBar />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {STATE_FILTERS.map(f => (
          <FilterChip
            key={f.id}
            active={state === f.id}
            label={f.label}
            icon={f.icon}
            count={data.loading ? undefined : countFor.get(f.id)}
            onClick={() => setState(f.id)}
          />
        ))}
      </Box>

      {allFailed ? (
        <Surface sx={{ p: 2 }}>
          <ErrorState error={pickMostRelevantError(data.errors)} what="the Flux resources" />
        </Surface>
      ) : data.loading ? (
        <Surface sx={{ p: 2 }}>
          <Loader title="Loading Flux resources" />
        </Surface>
      ) : results.length === 0 ? (
        <Surface sx={{ p: 2 }}>
          <EmptyState
            icon={ICONS.search}
            title="Nothing matches"
            description="Try a different state filter, clear the search text, or widen the namespace filter above."
          />
        </Surface>
      ) : (
        <Surface sx={{ px: 2, py: 0.5 }}>
          <SimpleTable
            columns={[
              {
                label: 'Resource',
                getter: (row: FluxRow) => (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Icon icon={kindIcon(row.kindDef.kind, row.kindDef.group)} width="1.2rem" />
                    <FluxLink
                      kind={row.kindDef.kind}
                      name={row.object.metadata?.name ?? ''}
                      namespace={row.object.metadata?.namespace}
                    >
                      {row.object.metadata?.name}
                    </FluxLink>
                  </Box>
                ),
              },
              { label: 'Kind', getter: (row: FluxRow) => row.kindDef.kind },
              {
                label: 'Namespace',
                getter: (row: FluxRow) => row.object.metadata?.namespace ?? '-',
              },
              {
                label: 'Status',
                getter: (row: FluxRow) => <FluxStatusLabel object={row.object} />,
              },
              {
                label: 'Why',
                getter: (row: FluxRow) =>
                  row.diagnosis.category === 'ok'
                    ? row.diagnosis.headline
                    : `${row.diagnosis.headline}${
                        row.diagnosis.explanation ? ` — ${row.diagnosis.explanation}` : ''
                      }`,
              },
              {
                label: 'Last sync',
                getter: (row: FluxRow) => {
                  const lastSync = getLastSyncTime(row.object);
                  return lastSync ? <DateLabel date={lastSync} format="mini" /> : '-';
                },
              },
              {
                label: 'Actions',
                getter: (row: FluxRow) => <FluxActionButtons item={row.item} variant="inline" />,
              },
            ]}
            data={results}
          />
        </Surface>
      )}
    </Box>
  );
}
