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
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import {
  MRT_ColumnFiltersState,
  MRT_SortingState,
  MRT_VisibilityState,
} from 'material-react-table';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useHistory } from 'react-router-dom';
import { getClusterAppearanceFromMeta } from '../../../helpers/clusterAppearance';
import { isElectron } from '../../../helpers/isElectron';
import { setRecentCluster } from '../../../helpers/recentClusters';
import { loadTableSettings, storeTableSettings } from '../../../helpers/tableSettings';
import { formatClusterPathParam } from '../../../lib/cluster';
import { useClustersConf, useClustersVersion } from '../../../lib/k8s';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import { Cluster, KubeMetrics } from '../../../lib/k8s/cluster';
import Node from '../../../lib/k8s/node';
import { createRouteURL } from '../../../lib/router/createRouteURL';
import { parseCpu, parseRam } from '../../../lib/units';
import { getClusterPrefixedPath } from '../../../lib/util';
import { useTypedSelector } from '../../../redux/hooks';
import { Loader } from '../../common';
import Link from '../../common/Link';
import Table from '../../common/Table';
import { LightTooltip } from '../../common/Tooltip';
import { useLocalStorageState } from '../../globalSearch/useLocalStorageState';
import ClusterBadge from '../../Sidebar/ClusterBadge';
import ClusterContextMenu from './ClusterContextMenu';
import {
  getClusterStatusAccessor,
  getClusterStatusInfo,
  // isClusterInventoryCluster is only used by the commented-out getOrigin below.
  // isClusterInventoryCluster,
  STATUS_VARIANTS,
} from './ClusterInventory';
import { canSelectCluster } from './clusterStatus';
import { CONNECT_ON_CLUSTER_LINK, MULTI_HOME_ENABLED } from './config';
import { getCustomClusterNames } from './customClusterNames';

/**
 * ClusterStatus component displays the status of a cluster.
 * It shows an icon and a message indicating whether the cluster is active, loading, unavailable,
 * requires authentication, has insufficient permissions, or has an unhealthy control plane.
 *
 * @param {Object} props - The component props.
 * @param {ApiError|null} [props.error] - The error object if there is an error with the cluster.
 */
/**
 * The key health indicators behind a cluster status, as compact
 * label → value facts (the way kubectl would show them), not prose. Only
 * facts that were actually probed are listed.
 */
function clusterStatusFacts(
  t: (key: string, options?: any) => string,
  error: ApiError | null | undefined,
  condition: ReturnType<typeof getClusterStatusInfo>['condition'],
  version?: string
): { label: string; value: string; bad?: boolean }[] {
  const facts: { label: string; value: string; bad?: boolean }[] = [];

  // API reachability + authn/authz, from the real /version health probe.
  if (error === null || error === undefined) {
    facts.push({
      label: t('translation|API server'),
      value: t('translation|Reachable (HTTP 200)'),
    });
  } else if (error.status === 401) {
    facts.push({
      label: t('translation|API server'),
      value: t('translation|Responding (HTTP 401)'),
    });
    facts.push({
      label: t('translation|Authentication'),
      value: t('translation|Failed — credentials rejected'),
      bad: true,
    });
  } else if (error.status === 403) {
    facts.push({
      label: t('translation|API server'),
      value: t('translation|Responding (HTTP 403)'),
    });
    facts.push({
      label: t('translation|Authorization'),
      value: t('translation|Denied — RBAC forbids access'),
      bad: true,
    });
  } else {
    facts.push({
      label: t('translation|API server'),
      value: error.status
        ? t('translation|Unreachable (HTTP {{ status }})', { status: error.status })
        : t('translation|Unreachable — no response'),
      bad: true,
    });
  }

  if (version) {
    facts.push({ label: t('translation|Kubernetes version'), value: version });
  }

  // Control plane health, when the fleet inventory reports it.
  if (condition) {
    facts.push({
      label: t('translation|Control plane'),
      value:
        condition.status === 'True'
          ? t('translation|Healthy')
          : condition.reason || condition.status || t('translation|Unknown'),
      bad: condition.status === 'False',
    });
    if (condition.status === 'False' && condition.message) {
      facts.push({ label: t('translation|Reason'), value: condition.message, bad: true });
    }
  }

  return facts;
}

/**
 * Fetched lazily when the active-cluster popover is open.
 * Shows node count, ready nodes, CPU %, and Memory %.
 */

/** Pulsing dots that signal "data incoming" instead of a static ellipsis. */
const loadingDotsKeyframes = `
@keyframes hlPulseDots {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}`;

function LoadingDots() {
  return (
    <>
      <style>{loadingDotsKeyframes}</style>
      <Box component="span" sx={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <Box
            key={i}
            component="span"
            sx={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              bgcolor: 'text.secondary',
              animation: 'hlPulseDots 1.2s infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </Box>
    </>
  );
}

function ActiveClusterExtraFacts({
  clusterName,
  t,
}: {
  clusterName: string;
  t: (key: string, opts?: any) => string;
}) {
  // One-shot fetch (refetchInterval disables the watch websocket): opening the
  // popover should not open a long-lived socket per cluster.
  const [nodes] = Node.useList({ cluster: clusterName, refetchInterval: 0 });
  const [nodeMetrics, metricsError] = Node.useMetrics(clusterName);

  const loading = <LoadingDots />;

  const rows = useMemo<{ label: string; value: React.ReactNode }[]>(() => {
    const totalNodes = nodes !== null ? nodes.length : null;
    const readyNodes =
      nodes !== null
        ? nodes.filter(n =>
            n.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True')
          ).length
        : null;

    const metricsUnavailable = !!metricsError;

    let cpuPercent: number | null = null;
    let memPercent: number | null = null;

    if (nodes && nodeMetrics && !metricsUnavailable) {
      const totalCpuCapacity = nodes.reduce(
        (sum, n) => sum + parseCpu((n.status?.capacity as any)?.cpu ?? '0'),
        0
      );
      const usedCpu = (nodeMetrics as KubeMetrics[]).reduce(
        (sum, m) => sum + parseCpu(m.usage.cpu),
        0
      );
      if (totalCpuCapacity > 0) {
        cpuPercent = Math.round((usedCpu / totalCpuCapacity) * 100);
      }

      const totalMemCapacity = nodes.reduce(
        (sum, n) => sum + parseRam((n.status?.capacity as any)?.memory ?? '0'),
        0
      );
      const usedMem = (nodeMetrics as KubeMetrics[]).reduce(
        (sum, m) => sum + parseRam(m.usage.memory),
        0
      );
      if (totalMemCapacity > 0) {
        memPercent = Math.round((usedMem / totalMemCapacity) * 100);
      }
    }

    return [
      {
        label: t('translation|Nodes'),
        value:
          totalNodes === null
            ? loading
            : readyNodes !== null
            ? `${totalNodes} (${readyNodes} Ready)`
            : `${totalNodes}`,
      },
      {
        label: t('translation|CPU'),
        value: metricsUnavailable
          ? t('translation|N/A')
          : cpuPercent === null
          ? loading
          : `${cpuPercent}%`,
      },
      {
        label: t('translation|Memory'),
        value: metricsUnavailable
          ? t('translation|N/A')
          : memPercent === null
          ? loading
          : `${memPercent}%`,
      },
    ];
  }, [nodes, nodeMetrics, metricsError, t, loading]);

  return (
    <>
      {rows.map(row => (
        <React.Fragment key={row.label}>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {row.label}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
            {row.value}
          </Typography>
        </React.Fragment>
      ))}
    </>
  );
}

function ClusterStatus({
  error,
  cluster,
  isConnected,
  onConnect,
  version,
}: {
  error?: ApiError | null;
  cluster: Cluster;
  /** Whether the cluster is in the auto-connect set (i.e. being polled). */
  isConnected: boolean;
  /** Connect to the cluster on demand so its status is loaded. */
  onConnect: (clusterName: string) => void;
  /** The cluster's Kubernetes gitVersion, when known (evidence for Active). */
  version?: string;
}) {
  const { t } = useTranslation(['translation']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const customStatuses = useTypedSelector(state => state.clusterProvider.clusterStatuses);
  const renderedCustomStatus = useMemo(() => {
    for (const Status of customStatuses) {
      const renderedStatus = <Status cluster={cluster} error={error} />;
      if (renderedStatus !== null) {
        return renderedStatus;
      }
    }
    return null;
  }, [customStatuses, cluster, error]);

  if (renderedCustomStatus !== null) {
    return renderedCustomStatus;
  }

  // Not in the auto-connect set and not yet contacted: show an explicit
  // "not connected" state with a connect action instead of the ambiguous "⋯".
  if (!isConnected && error === undefined) {
    return (
      <LightTooltip title={t('translation|Not connected. Connect to load this cluster.')}>
        <Box display="flex" alignItems="center" justifyContent="center" width="fit-content">
          <Icon icon="mdi:cloud-off-outline" width={16} color={theme.palette.text.secondary} />
          <Button
            size="small"
            onClick={() => onConnect(cluster.name)}
            sx={{ ml: 0.5, textTransform: 'none' }}
          >
            {t('translation|Connect')}
          </Button>
        </Box>
      </LightTooltip>
    );
  }

  // Connected but no response yet: show a connecting indicator rather than the
  // ambiguous "⋯".
  if (isConnected && error === undefined) {
    return (
      <LightTooltip title={t('translation|Waiting for the first health probe to answer.')}>
        <Box display="flex" alignItems="center" justifyContent="center" width="fit-content">
          <CircularProgress size={14} />
          <Typography variant="body2" sx={{ ml: 1, color: theme.palette.text.secondary }}>
            {t('translation|Connecting…')}
          </Typography>
        </Box>
      </LightTooltip>
    );
  }

  const { kind, text, condition } = getClusterStatusInfo(cluster, error, t);
  const variant = STATUS_VARIANTS[kind];
  const color = theme.palette.home.status[variant.colorKey];
  const facts = clusterStatusFacts(t, error, condition, version);

  return (
    <>
      <LightTooltip title={t('translation|Click to see')}>
        <Box
          component="button"
          type="button"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-label={t('translation|Show status details')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            width: 'fit-content',
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Icon icon={variant.icon} width={16} color={color} />
          <Typography
            variant="body2"
            style={{
              marginLeft: theme.spacing(1),
              color: variant.coloredText ? color : undefined,
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </Typography>
        </Box>
      </LightTooltip>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 360, minWidth: 240 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Icon icon={variant.icon} width={18} color={color} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>
            {text}
          </Typography>
        </Box>
        {/* Compact label → value facts, the indicators behind the verdict. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: 1.5,
            rowGap: 0.25,
          }}
        >
          {facts.map(fact => (
            <React.Fragment key={fact.label + fact.value}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {fact.label}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontFamily: 'monospace',
                  overflowWrap: 'anywhere',
                  color: fact.bad ? theme.palette.error.main : undefined,
                  fontWeight: fact.bad ? 600 : undefined,
                }}
              >
                {fact.value}
              </Typography>
            </React.Fragment>
          ))}
          {kind === 'active' && !!anchorEl && (
            <ActiveClusterExtraFacts clusterName={cluster.name} t={t} />
          )}
        </Box>
      </Popover>
    </>
  );
}

export interface ClusterTableProps {
  /** Some clusters have custom names. */
  customNameClusters: ReturnType<typeof getCustomClusterNames>;
  /** Versions for each cluster. */
  versions: ReturnType<typeof useClustersVersion>[0];
  /** Errors for each cluster. */
  errors: ReturnType<typeof useClustersVersion>[1];
  /** Clusters configuration. */
  clusters: ReturnType<typeof useClustersConf>;
  /** Warnings for each cluster. */
  warningLabels: { [cluster: string]: string };
  /**
   * Names of clusters that are currently being connected to / polled. When
   * omitted, all clusters are treated as connected (no "Not connected" state).
   */
  connectedClusterNames?: Set<string>;
  /** Connect to a cluster on demand (adds it to the auto-connect set). */
  onConnectCluster?: (clusterName: string) => void;
}

/**
 * ClusterTable component displays a table of clusters with their status, origin, and version.
 */
const CLUSTER_TABLE_ID = 'home-clusters';

export default function ClusterTable({
  customNameClusters,
  versions,
  errors,
  clusters,
  warningLabels,
  connectedClusterNames,
  onConnectCluster,
}: ClusterTableProps) {
  const history = useHistory();
  const { t } = useTranslation(['translation']);

  const isClusterConnected = (clusterName: string) =>
    connectedClusterNames ? connectedClusterNames.has(clusterName) : true;

  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(() => {
    const visibility: Record<string, boolean> = {};
    const stored = loadTableSettings(CLUSTER_TABLE_ID);
    stored.forEach(({ id, show }) => (visibility[id] = show));
    return visibility;
  });

  const [sorting, setSorting] = useLocalStorageState<MRT_SortingState>(
    `table_sorting.${CLUSTER_TABLE_ID}`,
    [{ id: 'name', desc: false }]
  );

  const [columnFilters, setColumnFilters] = useLocalStorageState<MRT_ColumnFiltersState>(
    `table_filters.${CLUSTER_TABLE_ID}`,
    []
  );

  const handleColumnVisibilityChange = useCallback(
    (updater: MRT_VisibilityState | ((old: MRT_VisibilityState) => MRT_VisibilityState)) => {
      setColumnVisibility(oldCols => {
        const newCols = typeof updater === 'function' ? updater(oldCols) : updater;
        const colsToStore = Object.entries(newCols).map(([id, show]) => ({
          id,
          show: (show ?? true) as boolean,
        }));
        storeTableSettings(CLUSTER_TABLE_ID, colsToStore);
        return newCols;
      });
    },
    []
  );

  const handleSortingChange = useCallback(
    (updater: MRT_SortingState | ((old: MRT_SortingState) => MRT_SortingState)) => {
      setSorting(old => (typeof updater === 'function' ? updater(old) : updater));
    },
    [setSorting]
  );

  const handleColumnFiltersChange = useCallback(
    (
      updater: MRT_ColumnFiltersState | ((old: MRT_ColumnFiltersState) => MRT_ColumnFiltersState)
    ) => {
      setColumnFilters(old => (typeof updater === 'function' ? updater(old) : updater));
    },
    [setColumnFilters]
  );

  /*
   * Gets the origin of a cluster. Kept for when the Origin column is restored
   * (the column is commented out above).
   *
   * @param cluster
   * @returns A description of where the cluster is picked up from: dynamic, in-cluster, or from a kubeconfig file.
  function getOrigin(cluster: Cluster): string {
    if (cluster?.meta_data?.source === 'kubeconfig') {
      const sourcePath = cluster?.meta_data?.origin?.kubeconfig;
      return sourcePath ? `Kubeconfig: ${sourcePath}` : 'Kubeconfig';
    } else if (cluster?.meta_data?.source === 'dynamic_cluster') {
      return t('translation|Plugin');
    } else if (cluster?.meta_data?.source === 'incluster') {
      return t('translation|In-cluster');
    } else if (isClusterInventoryCluster(cluster)) {
      return t('translation|Cluster Inventory');
    }
    return t('translation|Unknown');
  }
  */

  const viewClusters = t('View Clusters');

  const loading = clusters === null;
  if (loading) {
    return <Loader title={t('Loading...')} />;
  }

  const clustersList = Object.values(customNameClusters);
  if (clustersList.length === 0) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="400px"
        textAlign="center"
      >
        <Icon
          icon="mdi:hexagon-multiple-outline"
          style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }}
        />
        <Typography variant="h6" gutterBottom>
          {t('No clusters found')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('Add a cluster to get started.')}
        </Typography>
        {isElectron() && (
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => {
              history.push(createRouteURL('addCluster'));
            }}
          >
            {t('Add Cluster')}
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Table
      columns={[
        {
          id: 'name',
          header: t('Name'),
          accessorKey: 'name',
          gridTemplate: 2,
          Cell: ({ row: { original } }) => {
            const appearance = getClusterAppearanceFromMeta(original.name);
            return (
              <LightTooltip title={original.name}>
                {/* Record as recently-used on open so it auto-connects on return.
                    onClickCapture on the wrapper keeps the Link's native
                    navigation (and works for keyboard activation) while the Link
                    would disable navigation if given an onClick. */}
                <span
                  onClickCapture={() => {
                    setRecentCluster(original.name);
                    if (CONNECT_ON_CLUSTER_LINK) {
                      onConnectCluster?.(original.name);
                    }
                  }}
                >
                  <Link routeName="cluster" params={{ cluster: original.name }}>
                    <ClusterBadge
                      name={original.name}
                      icon={appearance.icon}
                      accentColor={appearance.accentColor}
                    />
                  </Link>
                </span>
              </LightTooltip>
            );
          },
        },
        // Origin column intentionally hidden for now (kept for easy restore).
        // {
        //   id: 'origin',
        //   header: t('Origin'),
        //   accessorFn: cluster => getOrigin(cluster),
        //   Cell: ({ row: { original } }) => (
        //     <Typography variant="body2">{getOrigin((clusters || {})[original.name])}</Typography>
        //   ),
        // },
        {
          id: 'status',
          header: t('Status'),
          accessorFn: cluster =>
            // When the cluster is not yet connected (no polling), the cell shows
            // "Not connected". Match the accessor so sorting/filtering is consistent.
            !isClusterConnected(cluster?.name) && errors[cluster?.name] === undefined
              ? t('translation|Not connected')
              : getClusterStatusAccessor(cluster, errors[cluster?.name], t),
          Cell: ({ row: { original } }) => (
            <ClusterStatus
              error={errors[original.name]}
              cluster={original}
              isConnected={isClusterConnected(original.name)}
              onConnect={onConnectCluster ?? (() => {})}
              version={versions[original.name]?.gitVersion}
            />
          ),
        },
        {
          id: 'warnings',
          header: t('Warnings'),
          // Warnings track connection status: list them for connected clusters,
          // blank for clusters that aren't connected. '⋯' = still loading,
          // 'n/a' = the events query failed (see renderWarningsText).
          accessorFn: cluster =>
            isClusterConnected(cluster?.name) ? warningLabels[cluster?.name] ?? '⋯' : '',
          Cell: ({ cell }) => {
            const value = cell.getValue<string>();
            if (value === '⋯') {
              // A quiet pill-shaped skeleton while the (now small, capped)
              // events query is in flight — not a mystery glyph.
              return <Skeleton variant="rounded" width={28} height={18} />;
            }
            if (value === 'n/a') {
              return (
                <LightTooltip
                  title={t('translation|Warning events could not be read from this cluster.')}
                >
                  <Typography component="span" variant="caption" color="text.secondary">
                    {value}
                  </Typography>
                </LightTooltip>
              );
            }
            return value;
          },
        },
        {
          id: 'version',
          header: t('glossary|Kubernetes Version'),
          accessorFn: ({ name }) =>
            isClusterConnected(name) ? versions[name]?.gitVersion || '⋯' : '',
          Cell: ({ cell }) => {
            const value = cell.getValue<string>();
            if (value === '⋯') {
              return <Skeleton variant="rounded" width={64} height={18} />;
            }
            return value;
          },
        },
        {
          id: 'actions',
          header: t('Actions'),
          gridTemplate: 'min-content',
          muiTableBodyCellProps: {
            align: 'right',
          },
          accessorFn: cluster => getClusterStatusAccessor(cluster, errors[cluster?.name], t),
          Cell: ({ row: { original: cluster } }) => {
            return <ClusterContextMenu cluster={cluster} />;
          },
          enableSorting: false,
          enableColumnFilter: false,
        },
      ]}
      data={clustersList}
      enableRowSelection={
        MULTI_HOME_ENABLED
          ? row => {
              // Only allow selection if the cluster is working
              return canSelectCluster(errors[row.original.name]);
            }
          : false
      }
      state={{
        columnVisibility,
        sorting,
        columnFilters,
      }}
      onColumnVisibilityChange={handleColumnVisibilityChange}
      onSortingChange={handleSortingChange}
      onColumnFiltersChange={handleColumnFiltersChange}
      muiToolbarAlertBannerProps={{
        sx: theme => ({
          background: theme.palette.background.muted,
        }),
      }}
      renderToolbarAlertBannerContent={({ table }) => (
        <Button
          variant="contained"
          sx={{
            marginLeft: 1,
          }}
          onClick={() => {
            const selectedClusterNames = table
              .getSelectedRowModel()
              .rows.map(it => it.original.name);
            // Opening clusters counts as using them; record as recently-used.
            selectedClusterNames.forEach(name => setRecentCluster(name));
            history.push({
              pathname: generatePath(getClusterPrefixedPath(), {
                cluster: formatClusterPathParam(selectedClusterNames),
              }),
            });
          }}
        >
          {viewClusters}
        </Button>
      )}
    />
  );
}
