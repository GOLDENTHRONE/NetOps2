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
import { uniq } from 'lodash';
import React, { ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClustersConf } from '../../lib/k8s';
import { KubeObject } from '../../lib/k8s/cluster';
import Namespace from '../../lib/k8s/namespace';
import { getKubeObjectCategory } from '../../lib/k8s/ResourceCategory';
import { HeadlampEventType, useEventCallback } from '../../redux/headlampEventSlice';
import { useTypedSelector } from '../../redux/hooks';
import { ProjectDefinition } from '../../redux/projectsSlice';
import AllowedNamespacesSelectorGate from '../App/AllowedNamespacesSelectorGate';
import { StatusLabel } from '../common';
import Link from '../common/Link';
import { PureNamespacesAutocomplete } from '../common/NamespacesAutocomplete';
import Table, { TableColumn } from '../common/Table/Table';
import {
  countApplicationResources,
  getApplicationBadge,
  getLocalHealth,
  LocalHealthEvidence,
  LocalHealthResult,
  LocalHealthStat,
} from './localHealth';
import { isSystemNamespace } from './projectUtils';
import { useApplicationPopoverData } from './useApplicationPopoverData';
import { useApplicationsHealth } from './useApplicationsHealth';

// Applications are auto-discovered: every namespace the user's token can see
// becomes an application (application name = namespace name), except system /
// infrastructure namespaces (see isSystemNamespace).
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
  return visible.map(({ metadata, cluster }) => ({
    id: `${cluster}/${metadata.name}`,
    namespaces: [metadata.name],
    clusters: [cluster],
  }));
}

export function projectDetailsParams(project: ProjectDefinition) {
  return {
    cluster: project.clusters[0] ?? '',
    name: project.namespaces[0] ?? '',
  };
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

export const useProject = (cluster: string, name: string) => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces, isLoading } = Namespace.useList({
    clusters: clusters.map(c => c.name),
  });

  return useMemo(
    () => ({
      isLoading,
      project: namespaces
        ? discoverProjectsFromNamespaces(namespaces).find(
            project => project.clusters[0] === cluster && project.namespaces[0] === name
          ) ?? {
            id: `${cluster}/${name}`,
            clusters: [],
            namespaces: [],
          }
        : undefined,
    }),
    [namespaces, cluster, name, isLoading]
  );
};

// ===== BEGIN local health Cell (frozen page-level design) =====
// The badge is computed ONCE per application at the page level (ProjectListContent,
// from the shared cluster-wide live dataset) and passed in — the cell does NO
// fetching. The popover opens an on-demand, per-namespace fetch (Pods + supporting
// kinds) only while it is open.

// Map badge status → theme colour token used to tint the popover header.
function statusColor(theme: any, status: LocalHealthResult['status']): string {
  switch (status) {
    case 'error':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'success':
      return theme.palette.success.main;
    case 'progressing':
      return theme.palette.info.main;
    case 'checking':
    case 'unknown':
      return theme.palette.text.secondary;
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

export interface LocalHealthCellProps {
  project: ProjectDefinition;
  /** Pre-computed live badge (from the page-level shared dataset). */
  health: LocalHealthResult;
  /** Live items for this app (for the popover's merged full diagnosis). */
  liveItems: KubeObject[];
}

export function LocalHealthCell({ project, health, liveItems }: LocalHealthCellProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const closePopover = useCallback(() => {
    anchor?.blur();
    setAnchor(null);
  }, [anchor]);
  const openPopover = useCallback(
    (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget),
    []
  );

  const partialSuffix = health.partial ? ` · ${t('Partial')}` : '';
  const labelText = `${t(health.label)}${partialSuffix}`;
  const color = statusColor(theme, health.status);
  // StatusLabel only knows success | warning | error | '' (grey).
  const summaryStatusLabel: 'success' | 'warning' | 'error' | '' =
    health.status === 'success'
      ? 'success'
      : health.status === 'warning'
      ? 'warning'
      : health.status === 'passive'
      ? ''
      : health.status === 'error' || health.status === 'unavailable'
      ? 'error'
      : '';
  // "New"/low-chrome states render as icon + coloured text (not a solid chip).
  const isNewState =
    health.status === 'progressing' ||
    health.status === 'unknown' ||
    health.status === 'checking' ||
    health.status === 'empty' ||
    (health.status === 'passive' && false);

  return (
    <>
      <Tooltip title={t('Click to see')}>
        <Box
          component="button"
          type="button"
          aria-haspopup="dialog"
          aria-label={`${labelText} — ${t('Click to see')}`}
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
          {isNewState ? (
            <Box display="flex" alignItems="center" gap={0.5} sx={{ color }}>
              <Icon icon={health.icon} style={{ fontSize: 24 }} />
              <Typography component="span" variant="body2">
                {labelText}
              </Typography>
            </Box>
          ) : (
            <StatusLabel status={summaryStatusLabel}>
              <Icon icon={health.icon} style={{ fontSize: 24 }} />
              {labelText}
            </StatusLabel>
          )}
        </Box>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={closePopover}
        disableRestoreFocus
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
        {open && (
          <ApplicationPopoverBody
            project={project}
            liveHealth={health}
            liveItems={liveItems}
            onClose={closePopover}
          />
        )}
      </Popover>
    </>
  );
}

// Rendered ONLY while the popover is open → the on-demand fetch (and any watches it
// opens) exist only for the open lifetime, then tear down. Never a permanent Pod watch.
function ApplicationPopoverBody({
  project,
  liveHealth,
  liveItems,
  onClose,
}: {
  project: ProjectDefinition;
  liveHealth: LocalHealthResult;
  liveItems: KubeObject[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const onDemand = useApplicationPopoverData(project);

  // Full diagnosis = live health-bearing items ⊕ on-demand (Pods, Jobs, RS, …).
  // This resolves controller-less "Unknown" apps (Pods now observed) and adds the
  // exact reasons (CrashLoop/ImagePull/…) + Needs-Attention (Jobs/Job-Pods).
  const merged = useMemo(
    () => [...(liveItems ?? []), ...(onDemand.items ?? [])],
    [liveItems, onDemand.items]
  );
  const full = useMemo(() => getLocalHealth(merged), [merged]);

  // Pod "Runtime" line (never part of the Resources count).
  const podStat = full.stats.find(s => s.kind === 'Pod');
  const podTruncated = onDemand.truncatedKinds.includes('Pod');
  const partial = !!liveHealth.partial || onDemand.truncatedKinds.length > 0 || onDemand.hasErrors;

  // While on-demand is still loading, prefer the live verdict's header; once loaded,
  // the merged `full` verdict is the richer, resolved one.
  const header = onDemand.isLoading ? liveHealth : full;
  const color = statusColor(theme, header.status);
  const totalItems = merged.length;

  return (
    <>
      <Box px={2} pt={1.5} pb={1.25} display="flex" alignItems="center" gap={1}>
        <Icon icon={header.icon} width={20} color={color} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ color, fontWeight: 700 }}>
            {t(header.label)}
            {partial ? ` · ${t('Partial')}` : ''}
          </Typography>
          {header.details.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('{{count}} issue(s) found', { count: header.details.length })}
            </Typography>
          )}
        </Box>
        <IconButton size="small" aria-label={t('Close')} onClick={onClose}>
          <Icon icon="mdi:close" width={16} />
        </IconButton>
      </Box>
      <Divider />
      <Box px={2} py={1.25}>
        {liveHealth.status === 'unavailable' ? (
          <UnavailableBody health={liveHealth as any} color={color} t={t} />
        ) : (
          <>
            {onDemand.isLoading && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('Loading details…')}
              </Typography>
            )}
            {partial && (
              <Typography variant="caption" sx={{ display: 'block', color, mb: 1 }}>
                {onDemand.truncatedKinds.length > 0
                  ? t('Some resource kinds exceeded {{limit}} items; results are partial.', {
                      limit: 1000,
                    })
                  : t('Some observations were unavailable; results are partial.')}
              </Typography>
            )}
            {full.details.length > 0 && (
              <EvidenceSection
                title={t('Details')}
                evidence={full.details}
                project={project}
                showDetails
              />
            )}
            {full.needsAttention.length > 0 && (
              <>
                {full.details.length > 0 && <Divider sx={{ my: 1 }} />}
                <EvidenceSection
                  title={`${t('Needs Attention')} ${t('(does not affect status)')}`}
                  evidence={full.needsAttention}
                  project={project}
                />
              </>
            )}
            {podStat && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography
                  variant="overline"
                  sx={{ fontWeight: 700, display: 'block', lineHeight: 1.6 }}
                >
                  {t('Runtime')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {podTruncated ? `${podStat.total}+ ` : `${podStat.total} `}
                  {podStat.total === 1 ? t('Pod') : t('Pods')}
                  {podStat.state ? ` — ${podStat.state}` : ''}
                </Typography>
              </>
            )}
            {(full.details.length > 0 || full.needsAttention.length > 0 || podStat) && (
              <Divider sx={{ my: 1 }} />
            )}
            <InventorySection
              stats={full.stats}
              t={t}
              totalItems={totalItems}
              open={inventoryOpen}
              onToggle={() => setInventoryOpen(value => !value)}
            />
          </>
        )}
      </Box>
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('Application health could not be determined.')}
      </Typography>
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
    </>
  );
}

// Kubernetes kind → Headlamp route name for the resource details page.
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

function EvidenceRow({
  evidence,
  project,
}: {
  evidence: LocalHealthEvidence;
  project: ProjectDefinition;
}) {
  const theme = useTheme();
  const label = `${evidence.kind}/${evidence.namespace || '-'}/${evidence.name}`;
  const routeName = KIND_TO_ROUTE[evidence.kind];
  const canLink = Boolean(routeName && evidence.name);
  const categoryIcon =
    evidence.category === 'workload'
      ? 'mdi:cog-outline'
      : evidence.category === 'reachability'
      ? 'mdi:lan-connect'
      : undefined;
  const severityColor =
    evidence.severity === 'error'
      ? theme.palette.error.main
      : evidence.severity === 'warning'
      ? theme.palette.warning.main
      : evidence.severity === 'progressing'
      ? theme.palette.info.main
      : theme.palette.text.secondary;

  const primary = canLink ? (
    <Link
      routeName="projectDetails"
      params={projectDetailsParams(project)}
      search={{
        tab: 'resources',
        ...(evidence.object && (evidence.object as any).jsonData
          ? { category: getKubeObjectCategory(evidence.object).label }
          : {}),
        resource: evidence.name,
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
    <Box component="li" sx={{ py: 0.35, lineHeight: 1.4, listStyle: 'none' }}>
      <Box display="flex" alignItems="baseline" gap={0.75}>
        {categoryIcon && <Icon icon={categoryIcon} width={14} color={severityColor} />}
        <Box>
          {primary}
          <Typography variant="caption" sx={{ display: 'block', color: severityColor }}>
            {evidence.message}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function InventorySection({
  stats,
  totalItems,
  t,
  open,
  onToggle,
}: {
  stats: LocalHealthStat[];
  totalItems: number;
  t: (k: string, opts?: any) => string;
  open: boolean;
  onToggle: () => void;
}) {
  if (!stats || stats.length === 0) return null;

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          width: '100%',
          p: 0,
          border: 0,
          background: 'none',
          color: 'text.secondary',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <Icon icon={open ? 'mdi:chevron-down' : 'mdi:chevron-right'} width={18} />
        <Typography variant="overline" sx={{ fontWeight: 700, lineHeight: 1.6 }}>
          {t('Inventory ({{count}} resources)', { count: totalItems })}
        </Typography>
      </Box>
      {open && <StatsSection stats={stats} t={t} />}
    </>
  );
}

function StatsSection({
  stats,
}: {
  stats: LocalHealthStat[];
  totalItems?: number;
  t: (k: string, opts?: any) => string;
}) {
  const theme = useTheme();
  if (!stats || stats.length === 0) return null;

  const toneColor = (tone: LocalHealthStat['tone']) => {
    switch (tone) {
      case 'error':
        return theme.palette.error.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'success':
        return theme.palette.success.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  return (
    <>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          '& td': { py: 0.35, verticalAlign: 'baseline' },
          '& td:first-of-type': { fontWeight: 500, pr: 1.5, whiteSpace: 'nowrap' },
          '& td:nth-of-type(2)': { color: theme.palette.text.secondary, pr: 1 },
        }}
      >
        <tbody>
          {stats.map(s => (
            <tr key={s.kind}>
              <td>
                <Typography component="span" variant="body2">
                  {s.total} {s.kind}
                  {s.total > 1 ? 's' : ''}
                </Typography>
              </td>
              <td>
                <Typography component="span" variant="body2" sx={{ color: toneColor(s.tone) }}>
                  {s.state}
                </Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
    </>
  );
}

// Cap the number of evidence rows rendered so a pathological namespace (e.g. 1000
// Pending Pods) can't render a 1000-row popover. The remainder is summarised.
const EVIDENCE_DISPLAY_CAP = 25;

function EvidenceSection({
  title,
  evidence,
  project,
  showDetails = false,
}: {
  title: string;
  evidence: LocalHealthEvidence[];
  project: ProjectDefinition;
  showDetails?: boolean;
}) {
  const { t } = useTranslation();
  const shown = evidence.slice(0, EVIDENCE_DISPLAY_CAP);
  const hidden = evidence.length - shown.length;
  return (
    <>
      <Typography variant="overline" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.6 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ pl: 2, m: 0 }}>
        {shown.map((e, i) => (
          <EvidenceRow
            key={`${e.kind}/${e.namespace}/${e.name}/${i}`}
            evidence={showDetails ? e : { ...e, severity: 'info' }}
            project={project}
          />
        ))}
        {hidden > 0 && (
          <Box component="li" sx={{ py: 0.35, listStyle: 'none' }}>
            <Typography variant="caption" color="text.secondary">
              {t('…and {{count}} more', { count: hidden })}
            </Typography>
          </Box>
        )}
      </Box>
    </>
  );
}
// ===== END local health Cell =====

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

  React.useEffect(() => {
    dispatchHeadlampEvent({ projects });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // Page-level cluster-wide LIVE observation (6 kinds × clusters). ONE shared
  // dataset drives every row's badge + Resources count. No per-row fetching.
  const clusters = useMemo(() => uniq(projects.flatMap(p => p.clusters)), [projects]);
  const appsHealth = useApplicationsHealth(clusters);

  // Compute every application's badge + count in memory (so sorting / pagination
  // never trigger a Kubernetes fetch, and every row has a real rank immediately).
  const healthByApp = useMemo(() => {
    const m = new Map<string, LocalHealthResult>();
    for (const p of filteredProjects) {
      const cluster = p.clusters[0] ?? '';
      const ns = p.namespaces[0] ?? '';
      const items = appsHealth.getItems(cluster, ns);
      const obs = appsHealth.getObservation(cluster);
      m.set(p.id, getApplicationBadge(items, obs));
    }
    return m;
  }, [filteredProjects, appsHealth]);

  const COUNTED_LIVE = useMemo(
    () => new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'PersistentVolumeClaim']),
    []
  );

  const projectRows = useMemo(
    () =>
      filteredProjects.map(project => {
        const cluster = project.clusters[0] ?? '';
        const ns = project.namespaces[0] ?? '';
        const items = appsHealth.getItems(cluster, ns);
        const obs = appsHealth.getObservation(cluster);
        const resourceCount = countApplicationResources(items);
        const resourceTruncated = (obs.truncatedKinds ?? []).some(k => COUNTED_LIVE.has(k));
        const health = healthByApp.get(project.id);
        return {
          ...project,
          liveItems: items,
          health,
          resourceCount,
          resourceTruncated,
          // -1 (not yet known) sorts last on descending Status sort.
          healthRank: health?.rank ?? -1,
        };
      }),
    [filteredProjects, appsHealth, healthByApp, COUNTED_LIVE]
  );

  const columns = useMemo(() => {
    const columns: TableColumn<(typeof projectRows)[number], any>[] = [
      {
        id: 'name',
        header: t('Name'),
        accessorFn: it => it.namespaces[0] ?? '',
        Cell: ({ row: { original } }) => (
          <Link routeName="projectDetails" params={projectDetailsParams(original)}>
            {original.namespaces[0] ?? ''}
          </Link>
        ),
      },
      {
        id: 'resources',
        header: t('Resources'),
        accessorFn: it => it.resourceCount,
        Cell: ({ row: { original } }) =>
          original.resourceTruncated ? `${original.resourceCount}+` : original.resourceCount,
        gridTemplate: 'min-content',
      },
      {
        id: 'localHealth',
        header: t('Status'),
        // Rank is resolved in memory for every row (not lazily per visible row), so
        // sorting by Status is correct and triggers no Kubernetes fetch.
        accessorFn: it => it.healthRank,
        Cell: ({ row: { original } }) =>
          original.health ? (
            <LocalHealthCell
              project={original}
              health={original.health}
              liveItems={original.liveItems}
            />
          ) : null,
        gridTemplate: 'min-content',
      },
      {
        id: 'cluster',
        header: t('Cluster'),
        accessorFn: it => it.clusters[0] ?? '',
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
