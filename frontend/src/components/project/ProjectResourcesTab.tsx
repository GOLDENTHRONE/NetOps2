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
  alpha,
  Box,
  Link as MuiLink,
  Popover,
  Theme,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useHistory } from 'react-router-dom';
import Deployment from '../../lib/k8s/deployment';
import { KubeObject } from '../../lib/k8s/KubeObject';
import Pod from '../../lib/k8s/pod';
import ReplicaSet from '../../lib/k8s/replicaSet';
import { getKubeObjectCategory, ResourceCategory } from '../../lib/k8s/ResourceCategory';
import StatefulSet from '../../lib/k8s/statefulSet';
import { Activity } from '../activity/Activity';
import { evaluateWorkload } from '../applications/applicationHealth';
import ActionButton from '../common/ActionButton/ActionButton';
import Link from '../common/Link';
import AuthVisible from '../common/Resource/AuthVisible';
import DeleteButton from '../common/Resource/DeleteButton';
import ScaleButton from '../common/Resource/ScaleButton';
import { TableColumn } from '../common/Table';
import Table from '../common/Table';
import Terminal from '../common/Terminal';
import { LightTooltip } from '../common/Tooltip';
import { PodLogViewer } from '../pod/Details';
import { KubeObjectStatus } from '../resourceMap/nodes/KubeObjectStatus';
import { getResourcesHealth } from './projectUtils';
import { categoryHasHealthSignal, ResourceCategoriesList } from './ResourceCategoriesList';

export const useResourceCategoriesList = (resources: KubeObject[]) => {
  return React.useMemo(() => {
    const groups = new Map<
      ResourceCategory,
      {
        items: KubeObject[];
        health: Record<KubeObjectStatus, number>;
      }
    >();

    // Place items per group
    resources.forEach(r => {
      const category = getKubeObjectCategory(r);
      if (!groups.has(category)) {
        groups.set(category, { items: [], health: {} as any });
      }
      const group = groups.get(category)!;
      group.items.push(r);
    });

    // Calculate health per group
    groups.forEach(value => {
      value.health = getResourcesHealth(value.items);
    });

    return [...groups.entries()].map(it => ({
      category: it[0],
      items: it[1].items,
      health: it[1].health,
    }));
  }, [resources]);
};

/** One resource's health verdict for the resources table. */
interface ResourceRowHealth {
  /** Sortable/filterable state; 'none' = kind carries no health signal. */
  state: 'down' | 'degraded' | 'progressing' | 'ready' | 'scaledZero' | 'none';
  /** Chip label, e.g. "Unhealthy". */
  label: string;
  /** Plain-language reason, e.g. "0/3 replicas ready". */
  reason?: string;
}

/** The kinds whose health is judged by real workload readiness. */
const WORKLOAD_HEALTH_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
]);

/**
 * Judges one resource the way an operator would. Workload kinds use the same
 * readiness evaluation as the Applications tab's Health column
 * ({@link evaluateWorkload}), Pods use phase/readiness/container states, and
 * kinds with no health signal (ConfigMaps, Services, …) honestly say so
 * instead of claiming "Healthy".
 */
export function getResourceRowHealth(resource: KubeObject): ResourceRowHealth {
  const kind = resource.kind;

  if (WORKLOAD_HEALTH_KINDS.has(kind)) {
    const w = evaluateWorkload(resource.jsonData);
    switch (w.state) {
      case 'down':
        return { state: 'down', label: 'Unhealthy', reason: w.reason };
      case 'degraded':
        return { state: 'degraded', label: 'Degraded', reason: w.reason };
      case 'progressing':
        return { state: 'progressing', label: 'Progressing', reason: w.reason };
      case 'scaledZero':
        return { state: 'scaledZero', label: 'Scaled to zero', reason: w.reason };
      default:
        return { state: 'ready', label: 'Healthy', reason: w.reason };
    }
  }

  if (kind === 'Pod') {
    const pod = resource as Pod;
    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions || [];
    const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
    // A waiting container (CrashLoopBackOff, ImagePullBackOff, …) is the
    // reason an operator actually wants to see on the chip.
    const waitingReason = (pod.status?.containerStatuses || []).find(
      (c: any) => c?.state?.waiting?.reason
    )?.state?.waiting?.reason;

    if (phase === 'Failed') {
      return { state: 'down', label: 'Failed', reason: pod.status?.reason };
    }
    if (waitingReason === 'CrashLoopBackOff' || waitingReason === 'ImagePullBackOff') {
      return { state: 'down', label: 'Unhealthy', reason: waitingReason };
    }
    if (phase === 'Succeeded') {
      return { state: 'ready', label: 'Completed' };
    }
    if (phase === 'Pending') {
      return { state: 'progressing', label: 'Pending', reason: waitingReason };
    }
    if (!ready) {
      return { state: 'progressing', label: 'Not ready', reason: waitingReason };
    }
    return { state: 'ready', label: 'Healthy', reason: 'Running and ready' };
  }

  if (kind === 'CronJob' && (resource.jsonData as any)?.spec?.suspend === true) {
    return { state: 'scaledZero', label: 'Suspended' };
  }

  return { state: 'none', label: '' };
}

/** Worst first, so "sort by health" (the default) surfaces problems on top. */
const ROW_HEALTH_RANK: Record<ResourceRowHealth['state'], number> = {
  down: 0,
  degraded: 1,
  progressing: 2,
  ready: 3,
  scaledZero: 4,
  none: 5,
};

/** Color/icon presentation for each row-health state. */
const ROW_HEALTH_PRESENTATION: Record<
  Exclude<ResourceRowHealth['state'], 'none'>,
  { icon: string; color: (t: Theme) => string }
> = {
  down: { icon: 'mdi:alert-circle', color: t => t.palette.error.main },
  degraded: { icon: 'mdi:alert', color: t => t.palette.warning.main },
  progressing: { icon: 'mdi:progress-clock', color: t => t.palette.info.main },
  ready: { icon: 'mdi:check-circle', color: t => t.palette.success.main },
  scaledZero: { icon: 'mdi:pause-circle-outline', color: t => t.palette.text.secondary },
};

/**
 * The health chip for one resource row: color-coded, and on click opens a
 * popover that says *why* the resource is in this state (readiness counts,
 * failure reason) with a link straight to the resource's own details page —
 * the browser's Back button returns here.
 */
function ResourceHealthChip({
  resource,
  health,
  directObjectLinks,
}: {
  resource: KubeObject;
  health: ResourceRowHealth;
  directObjectLinks?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (health.state === 'none') {
    // No health signal for this kind (a CronJob between runs, config, …):
    // say so, with the reason a hover away — never an unexplained blank.
    return (
      <LightTooltip title={t('This kind does not report a readiness status in Kubernetes.')}>
        <Typography component="span" variant="caption" color="text.secondary">
          {t('No status')}
        </Typography>
      </LightTooltip>
    );
  }

  const p = ROW_HEALTH_PRESENTATION[health.state];
  const color = p.color(theme);

  return (
    <>
      <Tooltip title={t('Click to see')}>
        <Box
          component="button"
          type="button"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-label={t('Show health details')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            // Same fixed pill width as the Applications Health column.
            width: '8.25rem',
            px: 1,
            py: '3px',
            border: 'none',
            borderRadius: '999px',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            color,
            backgroundColor: alpha(color, 0.12),
            '&:hover': { backgroundColor: alpha(color, 0.22) },
          }}
        >
          <Icon icon={p.icon} width={16} height={16} />
          {health.label}
        </Box>
      </Tooltip>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 360, minWidth: 240 } } }}
      >
        {/* Close on link click: in drawer mode the link opens a side panel
            without a route change, and a still-open modal popover would keep
            its scroll lock + backdrop over the panel (frozen scrolling and
            clicks). Capture phase, so the link still navigates. */}
        <Box
          onClickCapture={e => {
            if ((e.target as HTMLElement).closest('a')) {
              setAnchorEl(null);
            }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Icon icon={p.icon} width={18} height={18} color={color} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>
              {health.label}
            </Typography>
          </Box>
          {health.reason && (
            <Typography variant="body2" color="text.secondary">
              {health.reason}
            </Typography>
          )}
          <Typography variant="caption" component="div" sx={{ mt: 1 }}>
            {directObjectLinks ? (
              <MuiLink component={RouterLink} to={resource.getDetailsLink()}>
                {t('Open {{ kind }} {{ name }}', {
                  kind: resource.kind,
                  name: resource.metadata?.name,
                })}
              </MuiLink>
            ) : (
              <Link kubeObject={resource}>
                {t('Open {{ kind }} {{ name }}', {
                  kind: resource.kind,
                  name: resource.metadata?.name,
                })}
              </Link>
            )}
          </Typography>
        </Box>
      </Popover>
    </>
  );
}

/**
 * A one-line, kind-specific summary for the Details column, so the column is
 * meaningful for every kind instead of blank outside workloads. Falls back to
 * the apiVersion — every resource at least says what API it comes from.
 */
export function getResourceDetails(resource: KubeObject): string {
  const kind = resource.kind;
  const json: any = resource.jsonData ?? {};
  const spec: any = json.spec ?? {};
  const status: any = json.status ?? {};

  if (resource.isScalable) {
    return `Replicas: ${status.readyReplicas || status.availableReplicas || 0}/${
      spec.replicas || 0
    }`;
  }
  switch (kind) {
    case 'DaemonSet':
      return `Ready: ${status.numberReady || 0}/${status.desiredNumberScheduled || 0}`;
    case 'Pod':
      return `Phase: ${status.phase ?? 'Unknown'}`;
    case 'Job':
      return `Succeeded: ${status.succeeded || 0}/${spec.completions ?? 1}`;
    case 'CronJob':
      return `Schedule: ${spec.schedule ?? '?'}${spec.suspend ? ' (suspended)' : ''}`;
    case 'Service': {
      const ports = (spec.ports ?? [])
        .map((p: any) => `${p.port}${p.protocol && p.protocol !== 'TCP' ? '/' + p.protocol : ''}`)
        .slice(0, 4)
        .join(', ');
      return `${spec.type || 'ClusterIP'}${ports ? ` · ${ports}` : ''}`;
    }
    case 'Ingress': {
      const hosts = (spec.rules ?? []).map((r: any) => r.host).filter(Boolean);
      const shown = hosts.slice(0, 2).join(', ');
      return hosts.length > 0
        ? `${shown}${hosts.length > 2 ? ` +${hosts.length - 2}` : ''}`
        : `${(spec.rules ?? []).length} rule(s)`;
    }
    case 'NetworkPolicy':
      return `Applies: ${(spec.policyTypes ?? []).join(', ') || 'Ingress'}`;
    case 'PersistentVolumeClaim':
      return `${status.phase ?? '?'} · ${
        status.capacity?.storage ?? spec.resources?.requests?.storage ?? '?'
      }${spec.storageClassName ? ` · ${spec.storageClassName}` : ''}`;
    case 'ConfigMap':
      return `${
        Object.keys(json.data ?? {}).length + Object.keys(json.binaryData ?? {}).length
      } key(s)`;
    case 'Secret':
      return `${json.type ?? 'Opaque'} · ${Object.keys(json.data ?? {}).length} key(s)`;
    case 'HorizontalPodAutoscaler':
      return `Replicas: ${status.currentReplicas ?? status.desiredReplicas ?? '?'} (min ${
        spec.minReplicas ?? 1
      }, max ${spec.maxReplicas ?? '?'})`;
    case 'Role':
    case 'ClusterRole':
      return `${(json.rules ?? []).length} rule(s)`;
    case 'RoleBinding':
    case 'ClusterRoleBinding':
      return `${(json.subjects ?? []).length} subject(s) → ${json.roleRef?.kind ?? ''} ${
        json.roleRef?.name ?? ''
      }`;
    case 'ServiceAccount':
      return `${(json.secrets ?? []).length} secret(s)`;
    case 'ResourceQuota':
      return `${Object.keys(spec.hard ?? {}).length} limit(s)`;
    case 'LimitRange':
      return `${(spec.limits ?? []).length} limit(s)`;
    case 'Endpoints':
      return `${(json.subsets ?? []).reduce(
        (n: number, s: any) => n + (s.addresses?.length ?? 0),
        0
      )} address(es)`;
    default:
      return json.apiVersion ?? '';
  }
}

interface ProjectResourcesTabProps {
  projectResources: KubeObject[];
  showClusterColumn?: boolean;
  selectedCategoryName?: string;
  setSelectedCategoryName: (name: string) => void;
  /**
   * When set, resource names navigate straight to the resource's own details
   * page (like clicking a cluster on the Home page) instead of going through
   * the generic Link, which opens the details drawer in place when drawer
   * mode is enabled. Used by the Applications details page.
   */
  directObjectLinks?: boolean;
}

export function ProjectResourcesTab({
  projectResources,
  showClusterColumn,
  selectedCategoryName,
  setSelectedCategoryName,
  directObjectLinks,
}: ProjectResourcesTabProps) {
  const { t } = useTranslation();
  const history = useHistory();

  const resourceCategories = useResourceCategoriesList(projectResources);

  const { selectedCategory, selectedResources } = useMemo(() => {
    const group =
      selectedCategoryName &&
      resourceCategories.find(({ category }) => category.label === selectedCategoryName);
    if (group) {
      return { selectedCategory: group.category, selectedResources: group.items };
    }

    return { selectedCategory: undefined, selectedResources: undefined };
  }, [resourceCategories, selectedCategoryName]);

  // Kinds that report no health (ConfigMaps, Services, …) would fill the
  // Health column with meaningless placeholders — hide it for categories
  // where nothing reports health.
  const showHealthColumn = useMemo(
    () => categoryHasHealthSignal(selectedResources ?? []),
    [selectedResources]
  );

  const columns = React.useMemo<TableColumn<KubeObject>[]>(
    () => [
      {
        id: 'kind',
        accessorFn: item => item.kind,
        header: t('Kind'),
        gridTemplate: 'min-content',
      },
      {
        id: 'name',
        accessorFn: item => item.metadata.name,
        header: t('Name'),
        Cell: ({ row }) => {
          const resource = row.original;
          if (directObjectLinks) {
            return (
              <MuiLink component={RouterLink} to={resource.getDetailsLink()}>
                {resource.metadata?.name}
              </MuiLink>
            );
          }
          return <Link kubeObject={resource}>{resource.metadata?.name}</Link>;
        },
      },
      {
        id: 'health',
        gridTemplate: 'min-content',
        // The verdict text, so the column filter matches what the user reads
        // in the cell; severity ordering comes from the sortingFn below.
        accessorFn: resource => {
          const health = getResourceRowHealth(resource);
          return health.state === 'none' ? t('No status') : health.label;
        },
        filterVariant: 'select',
        sortingFn: (rowA, rowB) =>
          ROW_HEALTH_RANK[getResourceRowHealth(rowA.original).state] -
          ROW_HEALTH_RANK[getResourceRowHealth(rowB.original).state],
        header: t('Health'),
        // Chips centered under a centered header, same as the Applications
        // table's Health column.
        muiTableHeadCellProps: {
          align: 'center',
        },
        muiTableBodyCellProps: {
          sx: { justifyContent: 'center' },
        },
        Cell: ({ row }) => (
          <ResourceHealthChip
            resource={row.original}
            health={getResourceRowHealth(row.original)}
            directObjectLinks={directObjectLinks}
          />
        ),
      },
      {
        id: 'namespace',
        accessorFn: item => item.metadata.namespace || 'default',
        header: t('Namespace'),
        gridTemplate: 'min-content',
      },
      {
        id: 'cluster',
        accessorFn: item => item.cluster,
        header: t('Cluster'),
        gridTemplate: 'min-content',
        // The cluster is an object of its own: link it to the cluster view.
        Cell: ({ row }) => (
          <Link routeName="cluster" params={{ cluster: row.original.cluster }}>
            {row.original.cluster}
          </Link>
        ),
      },
      {
        id: 'details',
        gridTemplate: 'min-content',
        // One line of kind-specific facts (replicas, schedule, ports, keys…)
        // for EVERY kind — never a blank cell.
        accessorFn: resource => getResourceDetails(resource),
        header: t('Details'),
        Cell: ({ cell }) => (
          <Typography variant="body2" color="text.secondary" whiteSpace="nowrap">
            {cell.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: 'age',
        accessorFn: item => item.metadata.creationTimestamp,
        header: t('Age'),
        gridTemplate: 'min-content',
        // Filtering on a raw ISO timestamp is meaningless in a text box.
        enableColumnFilter: false,
        Cell: ({ row }) => {
          const resource = row.original;
          const createdDate = resource.metadata?.creationTimestamp
            ? new Date(resource.metadata.creationTimestamp)
            : null;
          const ageText = createdDate
            ? Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)) + 'd'
            : 'Unknown';
          return (
            <Typography variant="caption" color="text.secondary">
              {ageText}
            </Typography>
          );
        },
      },
      {
        id: 'actions',
        header: t('Actions'),
        gridTemplate: 'min-content',
        accessorFn: item => item.metadata.uid,
        enableColumnFilter: false,
        enableSorting: false,
        Cell: ({ row }) => {
          const resource = row.original;
          const isPod = resource.kind === 'Pod';

          // Labeled pills, so no action has to be guessed from an icon. Every
          // kind gets at least "View"; pods and scalables add their own.
          return (
            <Box display="flex" alignItems="center" gap={1} justifyContent="flex-end">
              <ActionButton
                description={t('View')}
                icon="mdi:open-in-app"
                buttonStyle="pill"
                onClick={() => history.push(resource.getDetailsLink())}
              />
              {resource.isScalable && (
                <ScaleButton
                  item={resource as Deployment | StatefulSet | ReplicaSet}
                  buttonStyle="pill"
                />
              )}
              {isPod && (
                <>
                  <AuthVisible item={resource} authVerb="get" subresource="log">
                    <ActionButton
                      description={t('Logs')}
                      icon="mdi:file-document-box-outline"
                      buttonStyle="pill"
                      onClick={() => {
                        const id = 'logs-' + resource.metadata.uid;
                        Activity.launch({
                          id,
                          title: t('Logs: {{ itemName }}', { itemName: resource.metadata.name }),
                          cluster: resource.cluster,
                          icon: (
                            <Icon icon="mdi:file-document-box-outline" width="100%" height="100%" />
                          ),
                          location: 'full',
                          content: (
                            <PodLogViewer
                              noDialog
                              open
                              item={resource as Pod}
                              onClose={() => Activity.close(id)}
                            />
                          ),
                        });
                      }}
                    />
                  </AuthVisible>
                  <AuthVisible item={resource} authVerb="create" subresource="exec">
                    <ActionButton
                      description={t('Shell')}
                      icon="mdi:console"
                      buttonStyle="pill"
                      onClick={() => {
                        const id = 'terminal-' + resource.metadata.uid;
                        Activity.launch({
                          id,
                          title: resource.metadata.name,
                          cluster: resource.cluster,
                          icon: <Icon icon="mdi:console" width="100%" height="100%" />,
                          location: 'full',
                          content: (
                            <Terminal
                              open
                              item={resource as Pod}
                              onClose={() => Activity.close(id)}
                            />
                          ),
                        });
                      }}
                    />
                  </AuthVisible>
                  <DeleteButton item={resource as Pod} buttonStyle="pill" />
                </>
              )}
            </Box>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, showClusterColumn, directObjectLinks, history]
  );

  return (
    <>
      <Box
        sx={theme => ({
          display: 'flex',
          border: '1px solid',
          borderColor: theme.palette.divider,
          borderTop: 0,
          flexGrow: 1,
          minHeight: 0,
          flexBasis: 0,
        })}
      >
        <ResourceCategoriesList
          categoryList={resourceCategories}
          selectedCategoryName={selectedCategoryName}
          onCategoryClick={setSelectedCategoryName}
        />
        <Box
          sx={theme => ({
            flexGrow: 1,
            p: 1,
            overflowY: 'auto',
            borderLeft: '1px solid',
            borderColor: theme.palette.divider,
          })}
        >
          {selectedCategory && (
            <Box>
              {selectedResources.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('No {{category}} resources found for this project.', {
                    category: selectedCategory.label.toLowerCase(),
                  })}
                </Typography>
              ) : (
                <Table
                  columns={columns}
                  data={selectedResources}
                  // Worst health first by default, so a broken workload is
                  // on page one instead of behind a search or a next-arrow.
                  initialState={{
                    sorting: [{ id: 'health', desc: false }],
                  }}
                  state={{
                    columnVisibility: {
                      cluster: !!showClusterColumn,
                      health: showHealthColumn,
                    },
                  }}
                />
              )}
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
}
