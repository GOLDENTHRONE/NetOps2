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
import { Box, Divider, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { groupBy, uniq } from 'lodash';
import React, { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClustersConf } from '../../lib/k8s';
import Namespace from '../../lib/k8s/namespace';
import { HeadlampEventType, useEventCallback } from '../../redux/headlampEventSlice';
import { useTypedSelector } from '../../redux/hooks';
import { ProjectDefinition } from '../../redux/projectsSlice';
import AllowedNamespacesSelectorGate from '../App/AllowedNamespacesSelectorGate';
import { StatusLabel } from '../common';
import Link from '../common/Link';
import { PureNamespacesAutocomplete } from '../common/NamespacesAutocomplete';
import Table, { TableColumn } from '../common/Table/Table';
import {
  getLocalHealth,
  getUnavailableHealth,
  LocalHealthEvidence,
  LocalHealthResult,
} from './localHealth';
// NOTE (p17): if you restore the upstream 'health' column below, re-add
// `getHealthIcon, getResourcesHealth` to the import list on the next line.
import { isSystemNamespace } from './projectUtils';
import { useLocalHealthItems } from './useLocalHealthItems';
import { useProjectItems } from './useProjectResources';

// Applications are auto-discovered: every namespace the user's token can see
// becomes an application (application name = namespace name), except system /
// infrastructure namespaces (see isSystemNamespace). Namespaces with the same
// name across multiple clusters are collapsed into a single application that
// spans those clusters.
//
// metadata.name is guarded because the multi-cluster fan-out / react-query
// cache can transiently yield items without it. See issue #5254.
export function discoverProjectsFromNamespaces(
  namespaces: ReadonlyArray<{
    metadata: { name: string };
    cluster: string;
  }>
): ProjectDefinition[] {
  const visible = namespaces.filter(n => n.metadata?.name && !isSystemNamespace(n.metadata.name));
  return Object.entries(groupBy(visible, n => n.metadata.name)).map(([name, ns]) => ({
    id: name,
    namespaces: [name],
    clusters: uniq(ns.map(it => it.cluster)),
  }));
}

/**
 * Filters the application (project) list by a set of selected namespaces.
 *
 * An empty selection means "no filter" and returns every project unchanged, so
 * the default view (nothing selected) shows all applications.
 *
 * @param projects - The full list of discovered applications.
 * @param selectedNamespaces - Namespaces chosen in the dropdown.
 * @returns The projects that include at least one of the selected namespaces.
 */
export function filterProjectsByNamespaces(
  projects: ProjectDefinition[],
  selectedNamespaces: string[]
): ProjectDefinition[] {
  if (!selectedNamespaces || selectedNamespaces.length === 0) {
    return projects;
  }
  const selected = new Set(selectedNamespaces);
  return projects.filter(project => project.namespaces.some(ns => selected.has(ns)));
}

const useProjects = (): ProjectDefinition[] => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces } = Namespace.useList({
    clusters: clusters.map(c => c.name),
  });

  return useMemo(() => discoverProjectsFromNamespaces(namespaces ?? []), [namespaces]);
};

export const useProject = (name: string) => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces, isLoading } = Namespace.useList({
    clusters: clusters.map(c => c.name),
  });

  return useMemo(
    () => ({
      isLoading,
      project: namespaces
        ? discoverProjectsFromNamespaces(namespaces).find(project => project.id === name) ?? {
            id: name,
            clusters: [],
            namespaces: [],
          }
        : undefined,
    }),
    [namespaces, name, isLoading]
  );
};

// ===== BEGIN p17 local health Cell (with p18 evidence popover) =====
// Renders the new "Status" column body. Extracted as a standalone component
// so useLocalHealthItems.test.tsx can mount it directly. See p17.txt +
// p18.txt on branch GT_D_V1.
export interface LocalHealthCellProps {
  project: ProjectDefinition;
  onRank?: (id: string, rank: number) => void;
}

// Map badge status → theme colour token used to tint the popover header
// and the badge chip. Keeps a single source of truth per state.
function statusColor(theme: any, status: LocalHealthResult['status']): string {
  switch (status) {
    case 'error':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'success':
      return theme.palette.success.main;
    case 'unavailable':
      return theme.palette.error.main;
    case 'passive':
    case 'empty':
    default:
      return theme.palette.text.secondary;
  }
}

// Small "label │ value" row used inside the popover body.
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box display="flex" gap={2} alignItems="baseline" py={0.4}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>{value}</Box>
    </Box>
  );
}

export function LocalHealthCell({ project, onRank }: LocalHealthCellProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { items, errors: fetchErrors } = useLocalHealthItems(project);

  // If the cluster fetch itself failed (proxy 5xx, network down, cluster
  // paused, ...), we don't know the app's health — surface "Unavailable"
  // instead of pretending it's Healthy from an empty result set.
  const health = useMemo<LocalHealthResult>(() => {
    if (fetchErrors && fetchErrors.length > 0) {
      const first = fetchErrors[0] as any;
      const apiErr = first?.errors?.[0];
      return getUnavailableHealth({
        cluster: project.clusters?.[0],
        httpCode: apiErr?.status,
        errorMessage: apiErr?.message,
      });
    }
    return getLocalHealth(items);
  }, [items, fetchErrors, project.clusters]);

  useEffect(() => {
    onRank?.(project.id, health.rank);
  }, [project.id, health.rank, onRank]);

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const closePopover = useCallback(() => setAnchor(null), []);
  const openPopover = useCallback(
    (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget),
    []
  );

  if (health.status === 'empty') {
    return <span>{t('No Resources')}</span>;
  }

  const errors = health.evidence.filter(e => e.severity === 'error');
  const warnings = health.evidence.filter(e => e.severity === 'warning');
  const totalItems = items?.length ?? 0;
  const color = statusColor(theme, health.status);
  // StatusLabel only knows success | warning | error | '' (grey).
  // Passive/empty → grey. Unavailable → red. Everything else maps one-to-one.
  const summaryStatusLabel: 'success' | 'warning' | 'error' | '' =
    health.status === 'success'
      ? 'success'
      : health.status === 'warning'
      ? 'warning'
      : health.status === 'passive' || health.status === 'empty'
      ? ''
      : 'error';
  const contextLine = `${project.namespaces.join(', ')} @ ${project.clusters.join(', ')}`;

  return (
    <>
      <Tooltip title={t('Click to see why')}>
        <Box
          component="button"
          type="button"
          aria-haspopup="dialog"
          aria-label={`${t(health.label)} — ${t('Click to see why')}`}
          onClick={openPopover}
          sx={{
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
            borderRadius: 1,
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
          }}
        >
          <StatusLabel status={summaryStatusLabel}>
            <Icon icon={health.icon} style={{ fontSize: 24 }} />
            {t(health.label)}
          </StatusLabel>
        </Box>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={closePopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              maxWidth: 480,
              minWidth: 340,
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box px={2} pt={1.5} pb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <Icon icon={health.icon} width={20} color={color} />
            <Typography variant="subtitle1" sx={{ color, fontWeight: 700, flexGrow: 1 }}>
              {t(health.label)}
            </Typography>
            <IconButton size="small" aria-label={t('Close')} onClick={closePopover}>
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Box>
          <Box display="flex" alignItems="baseline" gap={0.75} mt={0.75}>
            <Typography variant="body2" color="text.secondary">
              {t('Application:')}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
              {contextLine}
            </Typography>
          </Box>
        </Box>
        <Divider />
        <Box px={2} py={1.25}>
          {health.status === 'unavailable' ? (
            <UnavailableBody health={health as any} color={color} t={t} />
          ) : health.status === 'passive' ? (
            <Typography variant="body2" color="text.secondary">
              {t(
                'This application has {{count}} supporting resource(s) but no runnable workload (no Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod, Job or CronJob). Health is undetermined.',
                { count: totalItems }
              )}
            </Typography>
          ) : errors.length === 0 && warnings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('Healthy — no issues detected across {{count}} resources.', {
                count: totalItems,
              })}
            </Typography>
          ) : (
            <>
              {errors.length > 0 && (
                <EvidenceSection title={t('Errors')} color={color} evidence={errors} />
              )}
              {warnings.length > 0 && (
                <>
                  {errors.length > 0 && <Divider sx={{ my: 1 }} />}
                  <EvidenceSection
                    title={t('Warnings')}
                    color={theme.palette.warning.main}
                    evidence={warnings}
                  />
                </>
              )}
            </>
          )}
        </Box>
      </Popover>
    </>
  );
}

function UnavailableBody({
  health,
  color,
  t,
}: {
  health: {
    cluster?: string;
    httpCode?: number;
    errorMessage?: string;
  };
  color: string;
  t: (k: string, opts?: any) => string;
}) {
  return (
    <>
      <DetailRow
        label={t('Cluster')}
        value={
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {health.cluster ?? '—'}
          </Typography>
        }
      />
      {health.httpCode !== undefined && (
        <DetailRow
          label={t('HTTP code')}
          value={
            <Typography variant="body2" sx={{ color, fontWeight: 600 }}>
              {health.httpCode}
            </Typography>
          }
        />
      )}
      {health.errorMessage && (
        <DetailRow
          label={t('Reported error')}
          value={
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {health.errorMessage}
            </Typography>
          }
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {t(
          'The cluster API server could not be reached, so the application’s real health is unknown. Retry when connectivity is restored.'
        )}
      </Typography>
    </>
  );
}

// Kubernetes kind → Headlamp route name for the resource details page.
// Kinds not in this map fall back to plain text (no hyperlink).
const KIND_TO_ROUTE: Record<string, string> = {
  Pod: 'pod',
  Deployment: 'deployment',
  StatefulSet: 'statefulSet',
  DaemonSet: 'daemonSet',
  ReplicaSet: 'replicaSet',
  Job: 'job',
  CronJob: 'cronJob',
  Service: 'service',
  Ingress: 'ingress',
  PersistentVolumeClaim: 'persistentVolumeClaim',
  Endpoints: 'endpoint',
  EndpointSlice: 'endpointslice',
  ConfigMap: 'configMap',
  Secret: 'secret',
  HorizontalPodAutoscaler: 'horizontalPodAutoscaler',
};

function EvidenceRow({ evidence }: { evidence: LocalHealthEvidence }) {
  const label = `${evidence.kind}/${evidence.namespace || '-'}/${evidence.name}`;
  const routeName = KIND_TO_ROUTE[evidence.kind];
  const cluster = (evidence.object as any)?.cluster;
  const canLink = Boolean(routeName && evidence.name);

  const primary = canLink ? (
    <Link
      routeName={routeName}
      params={{
        name: evidence.name,
        namespace: evidence.namespace,
        ...(cluster ? { cluster } : {}),
      }}
    >
      <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
        {label}
      </Typography>
    </Link>
  ) : (
    <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
      {label}
    </Typography>
  );

  return (
    <Box component="li" sx={{ py: 0.35, lineHeight: 1.4 }}>
      {primary}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {evidence.message}
      </Typography>
    </Box>
  );
}

function EvidenceSection({
  title,
  color,
  evidence,
}: {
  title: string;
  color: string;
  evidence: LocalHealthEvidence[];
}) {
  return (
    <>
      <Typography
        variant="overline"
        sx={{ color, fontWeight: 700, display: 'block', lineHeight: 1.6 }}
      >
        {title}
      </Typography>
      <Box component="ul" sx={{ pl: 2, m: 0 }}>
        {evidence.map((e, i) => (
          <EvidenceRow key={`${e.kind}/${e.namespace}/${e.name}/${i}`} evidence={e} />
        ))}
      </Box>
    </>
  );
}
// ===== END p17 local health Cell =====

function ProjectListContent() {
  const { t } = useTranslation();
  const pluginApiResources = useTypedSelector(state => state.projects.apiResources);

  const projects = useProjects();
  const dispatchHeadlampEvent = useEventCallback(HeadlampEventType.PROJECT_LIST_VIEW);

  // No namespace is selected by default, so the table shows every application.
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);

  const namespaceOptions = useMemo(
    () => uniq(projects.flatMap(project => project.namespaces)).sort(),
    [projects]
  );

  const filteredProjects = useMemo(
    () => filterProjectsByNamespaces(projects, selectedNamespaces),
    [projects, selectedNamespaces]
  );

  useEffect(() => {
    dispatchHeadlampEvent({ projects });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // MRT can only sort a column when it has a value on the row data (accessorFn/accessorKey),
  // and it only recomputes that value when the *data array reference* passed to the table
  // changes. The "Resources" and "Health" columns are rendered purely from a per-row Cell
  // hook (useProjectItems), so the counts/ranks below are collected as they're computed and
  // then baked directly onto the row objects (see `projectRows`) so a new data array is
  // produced whenever they change, without altering what each Cell renders.
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({});
  const [healthRanks, setHealthRanks] = useState<Record<string, number>>({});

  const reportResourceCount = useCallback((id: string, count: number) => {
    setResourceCounts(prev => (prev[id] === count ? prev : { ...prev, [id]: count }));
  }, []);

  const reportHealthRank = useCallback((id: string, rank: number) => {
    setHealthRanks(prev => (prev[id] === rank ? prev : { ...prev, [id]: rank }));
  }, []);

  // -1 (not yet loaded) sorts before any loaded count/rank.
  const projectRows = useMemo(
    () =>
      filteredProjects.map(project => ({
        ...project,
        resourceCount: resourceCounts[project.id] ?? -1,
        healthRank: healthRanks[project.id] ?? -1,
      })),
    [filteredProjects, resourceCounts, healthRanks]
  );

  const columns = useMemo(() => {
    const columns: TableColumn<(typeof projectRows)[number], any>[] = [
      {
        id: 'name',
        header: t('Name'),
        accessorFn: it => it.id,
        Cell: ({ row: { original } }) => (
          <>
            <Link routeName="projectDetails" params={{ name: original.id }}>
              {original.id}
            </Link>
          </>
        ),
      },
      {
        id: 'resources',
        header: t('Resources'),
        accessorFn: it => it.resourceCount,
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          useEffect(() => {
            reportResourceCount(original.id, items.length);
          }, [original.id, items.length]);
          return items.length;
        },
        gridTemplate: 'min-content',
      },
      // ===== BEGIN p17 disabled upstream 'health' column — DO NOT DELETE =====
      // Restore by removing this BEGIN/END wrapper. Kept in place so an
      // upstream sync merges cleanly and so the original logic is one
      // uncomment away. Local replacement is the { id: 'localHealth', ... }
      // object immediately below. See p17.txt on branch GT_D_V1.
      /*
      {
        id: 'health',
        header: t('Health'),
        // Rank used for sorting: 0 = no resources, 1 = healthy, 2 = degraded, 3 = unhealthy.
        // No filter here: health is computed lazily per visible row (see Cell below), so
        // pagination means only on-screen rows have resolved -- a filter/count would be
        // inaccurate or permanently empty for off-screen rows. Default-sorted worst-first instead.
        accessorFn: it => it.healthRank,
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          const projectHealth = getResourcesHealth(items);
          useEffect(() => {
            const rank =
              items.length === 0
                ? 0
                : projectHealth.error > 0
                ? 3
                : projectHealth.warning > 0
                ? 2
                : 1;
            reportHealthRank(original.id, rank);
          }, [original.id, items.length, projectHealth.error, projectHealth.warning]);
          return (
            <StatusLabel
              status={
                projectHealth.error > 0
                  ? 'error'
                  : projectHealth.warning > 0
                  ? 'warning'
                  : 'success'
              }
            >
              <Icon
                icon={getHealthIcon(
                  projectHealth.success,
                  projectHealth.error,
                  projectHealth.warning
                )}
                style={{
                  fontSize: 24,
                }}
              />
              {items.length === 0
                ? t('No Resources')
                : projectHealth.error > 0
                ? t('Unhealthy')
                : projectHealth.warning > 0
                ? t('Degraded')
                : t('Healthy')}
            </StatusLabel>
          );
        },
        gridTemplate: 'min-content',
      },
      */
      // ===== END p17 disabled upstream 'health' column =====
      {
        id: 'localHealth',
        header: t('Status'),
        // Rank used for sorting: 0 = no resources, 1 = healthy, 2 = degraded, 3 = unhealthy.
        // Same reason as the old column: computed lazily per visible row.
        accessorFn: it => it.healthRank,
        Cell: ({ row: { original } }) => (
          <LocalHealthCell project={original} onRank={reportHealthRank} />
        ),
        gridTemplate: 'min-content',
      },
      {
        id: 'clusters',
        header: t('Clusters'),
        accessorFn: it => it.clusters.join(', '),
      },
      {
        id: 'namespaces',
        header: t('Namespaces'),
        accessorFn: it => it.namespaces.join(', '),
      },
    ];

    return columns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  if (projects.length === 0) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="400px"
        textAlign="center"
      >
        <Icon icon="mdi:apps" style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }} />
        <Typography variant="h6" gutterBottom>
          {t('No applications found')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('No namespaces are visible to your account, or they are all system namespaces.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        '& .MuiTable-root': {
          mt: '8px',
        },
      }}
    >
      <Table
        key={pluginApiResources.length}
        columns={columns}
        data={projectRows}
        // Render the namespace filter on the left of the table's top toolbar so
        // it sits on the same line as the search and column/filter buttons.
        // Reuses the app's standard namespace selector (checkboxes + Filter box)
        // for a consistent look and feel.
        renderTopToolbarCustomActions={() => (
          <PureNamespacesAutocomplete
            namespaceNames={namespaceOptions}
            filter={{ namespaces: new Set(selectedNamespaces) }}
            onChange={(_event, newValue) => setSelectedNamespaces(newValue)}
          />
        )}
      />
    </Box>
  );
}

/**
 * Resolves configured namespace selectors before querying the project list.
 *
 * @returns The gated project list.
 */
export default function ProjectList() {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {}).map(cluster => cluster.name);

  return (
    <AllowedNamespacesSelectorGate clusters={clusters}>
      <ProjectListContent />
    </AllowedNamespacesSelectorGate>
  );
}
