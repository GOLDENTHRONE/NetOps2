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
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import _, { List } from 'lodash';
import {
  MRT_ColumnFiltersState,
  MRT_SortingState,
  MRT_VisibilityState,
} from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useHistory } from 'react-router-dom';
import { getClusterAppearanceFromMeta } from '../../../helpers/clusterAppearance';
import { isElectron } from '../../../helpers/isElectron';
import { setRecentCluster } from '../../../helpers/recentClusters';
import { loadTableSettings, storeTableSettings } from '../../../helpers/tableSettings';
import { formatClusterPathParam } from '../../../lib/cluster';
import { useClustersConf, useClustersVersion } from '../../../lib/k8s';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import { Cluster, KubeMetrics, StringDict } from '../../../lib/k8s/cluster';
import { KubeObject } from '../../../lib/k8s/KubeObject';
import Node from '../../../lib/k8s/node';
import Pod from '../../../lib/k8s/pod';
import { createRouteURL } from '../../../lib/router/createRouteURL';
import { parseCpu, parseRam, TO_GB, TO_ONE_CPU } from '../../../lib/units';
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
  ClusterInventoryCondition,
  getClusterStatusAccessor,
  getClusterStatusInfo,
  getConditionTooltip,
  isClusterInventoryCluster,
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
  /** Cluster version info (git version + platform). Used by the active-status
   * popover so the Kubernetes version row matches the Cluster Overview page. */
  version?: StringDict | null;
}) {
  const { t } = useTranslation(['translation']);
  const theme = useTheme();
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
      <Box display="flex" alignItems="center" justifyContent="center" width="fit-content">
        <CircularProgress size={14} />
        <Typography variant="body2" sx={{ ml: 1, color: theme.palette.text.secondary }}>
          {t('translation|Connecting…')}
        </Typography>
      </Box>
    );
  }

  const { kind, text, condition } = getClusterStatusInfo(cluster, error, t);
  const variant = STATUS_VARIANTS[kind];
  const color = theme.palette.home.status[variant.colorKey];
  const tooltip = condition ? getConditionTooltip(condition) : '';
  const statusContent = (
    <Box display="flex" alignItems="center" justifyContent="center" width="fit-content">
      <Icon icon={variant.icon} width={16} color={color} />
      <Typography
        variant="body2"
        style={{
          marginLeft: theme.spacing(1),
          color: variant.coloredText ? color : undefined,
        }}
      >
        {text}
      </Typography>
    </Box>
  );

  // Active + error clusters: click the pill to open a details popover. Hover
  // shows a small "Click to see" hint. Active pops fetch live pod/node/metrics;
  // error pops explain the failure without touching the unreachable API.
  // Unknown/loading kinds keep their transient condition tooltip.
  if (kind === 'active' || kind === 'error') {
    return (
      <StatusPopoverTrigger
        kind={kind}
        cluster={cluster}
        version={version}
        error={error}
        condition={condition}
        statusText={text}
        statusIcon={variant.icon}
        statusColor={color}
      >
        {statusContent}
      </StatusPopoverTrigger>
    );
  }

  return tooltip ? (
    <LightTooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
      {statusContent}
    </LightTooltip>
  ) : (
    statusContent
  );
}

/**
 * StatusPopoverTrigger wraps the status pill so it behaves like a button:
 * hovering shows a "Click to see" hint, clicking opens the details popover
 * anchored to the pill. Body is picked by `kind`: active clusters get the
 * live-stats popover (`ClusterStatusDetails`) that mirrors the Cluster Overview
 * page; error clusters get an explanation popover (`ClusterStatusErrorDetails`)
 * with the HTTP status, human-readable reason and condition text — no fetches.
 */
function StatusPopoverTrigger({
  kind,
  cluster,
  version,
  error,
  condition,
  statusText,
  statusIcon,
  statusColor,
  children,
}: {
  kind: 'active' | 'error';
  cluster: Cluster;
  version?: StringDict | null;
  error?: ApiError | null;
  condition: ClusterInventoryCondition | null;
  statusText: string;
  statusIcon: string;
  statusColor: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation(['translation']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => setAnchorEl(null);
  const handleKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setAnchorEl(event.currentTarget);
    }
  };

  return (
    <>
      <LightTooltip title={open ? '' : t('translation|Click to see')}>
        <Box
          role="button"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={handleKey}
          sx={{
            display: 'inline-flex',
            cursor: 'pointer',
            borderRadius: 1,
            '&:hover': { opacity: 0.85 },
            '&:focus-visible': {
              outline: theme => `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          }}
        >
          {children}
        </Box>
      </LightTooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              p: 1.5,
              maxWidth: 360,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              boxShadow: 4,
            },
          },
        }}
      >
        {open &&
          (kind === 'active' ? (
            <ClusterStatusDetails
              cluster={cluster}
              version={version}
              error={error}
              statusText={statusText}
              statusIcon={statusIcon}
              statusColor={statusColor}
              onClose={handleClose}
            />
          ) : (
            <ClusterStatusErrorDetails
              version={version}
              error={error}
              condition={condition}
              statusText={statusText}
              statusIcon={statusIcon}
              statusColor={statusColor}
              onClose={handleClose}
            />
          ))}
      </Popover>
    </>
  );
}

/**
 * ClusterStatusErrorDetails renders the popover body for a cluster whose API
 * server is not reachable (Unavailable / auth error / permission error /
 * control plane unhealthy). It shows the HTTP status code, human-readable
 * reason, error message and any Cluster Inventory condition details — no
 * pod/node/metrics fetches are made because the API cannot answer.
 */
function ClusterStatusErrorDetails({
  version,
  error,
  condition,
  statusText,
  statusIcon,
  statusColor,
  onClose,
}: {
  version?: StringDict | null;
  error?: ApiError | null;
  condition: ClusterInventoryCondition | null;
  statusText: string;
  statusIcon: string;
  statusColor: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();

  // Map common HTTP status codes to short human-readable descriptions.
  function httpCodeText(code: number): string {
    switch (code) {
      case 400:
        return t('translation|Bad Request');
      case 401:
        return t('translation|Unauthorized — authentication required');
      case 403:
        return t('translation|Forbidden — insufficient permissions');
      case 404:
        return t('translation|Not Found');
      case 408:
        return t('translation|Request Timeout');
      case 500:
        return t('translation|Internal Server Error');
      case 502:
        return t('translation|Bad Gateway');
      case 503:
        return t('translation|Service Unavailable');
      case 504:
        return t('translation|Gateway Timeout');
      default:
        return '';
    }
  }

  let apiServerLabel: string;
  if (error === undefined) {
    apiServerLabel = t('translation|Not contacted');
  } else if (error === null) {
    apiServerLabel = t('translation|Reachable (HTTP 200)');
  } else if (typeof error.status === 'number' && error.status > 0) {
    const desc = httpCodeText(error.status);
    apiServerLabel = desc
      ? `${t('translation|Unreachable')} (HTTP ${error.status} — ${desc})`
      : `${t('translation|Unreachable')} (HTTP ${error.status})`;
  } else {
    apiServerLabel = t('translation|Unreachable — network error');
  }

  const versionLabel = version?.gitVersion || '—';

  // Condition details from Cluster Inventory (reason / message / last transition).
  const conditionReason = condition?.reason || null;
  const conditionMessage = condition?.message || null;
  const conditionTime = condition?.lastTransitionTime
    ? new Date(condition.lastTransitionTime).toLocaleString()
    : null;

  // Only show a Message row when it adds something beyond the API-server line.
  // If the HTTP code already carries the text (e.g. "Bad Gateway"), skip the
  // duplicate. Prefer Cluster Inventory condition.message when present since it
  // usually explains the failure at the cluster level.
  const httpCodeDesc =
    error && typeof error.status === 'number' && error.status > 0 ? httpCodeText(error.status) : '';
  const rawMessage = conditionMessage || error?.message || '';
  const normalize = (s: string) => s.trim().toLowerCase();
  const messageValue =
    rawMessage &&
    normalize(rawMessage) !== normalize(httpCodeDesc) &&
    normalize(rawMessage) !== normalize(apiServerLabel)
      ? rawMessage
      : null;

  function Row({
    label,
    value,
    multiline,
  }: {
    label: string;
    value: string | null;
    multiline?: boolean;
  }) {
    if (!value) return null;
    return (
      <Stack direction="row" spacing={1.5} alignItems={multiline ? 'flex-start' : 'baseline'}>
        <Typography
          variant="caption"
          sx={{
            color: theme.palette.text.secondary,
            minWidth: 130,
            flexShrink: 0,
            pt: multiline ? '2px' : 0,
          }}
        >
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: theme.palette.text.primary,
            whiteSpace: multiline ? 'pre-wrap' : 'normal',
            wordBreak: 'break-word',
          }}
        >
          {value}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ minWidth: 260, maxWidth: 340 }}>
      <Box display="flex" alignItems="center" mb={1}>
        <Icon icon={statusIcon} width={16} color={statusColor} />
        <Typography
          variant="subtitle2"
          sx={{ ml: 0.75, color: statusColor, fontWeight: 600, flexGrow: 1 }}
        >
          {statusText}
        </Typography>
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('translation|Close')}
            sx={{ ml: 1, p: 0.25 }}
          >
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        )}
      </Box>
      <Divider sx={{ mb: 1 }} />
      <Stack spacing={0.75}>
        <Row label={t('translation|API server')} value={apiServerLabel} />
        <Row label={t('translation|Kubernetes version')} value={versionLabel} />
        <Row label={t('translation|Reason')} value={conditionReason} multiline />
        <Row label={t('translation|Message')} value={messageValue} multiline />
        <Row label={t('translation|Last transition')} value={conditionTime} />
      </Stack>
    </Box>
  );
}

/**
 * ClusterStatusDetails renders the popover body for an Active cluster. It shows
 * the API-server reachability, Kubernetes version, CPU %, Memory %, node and pod
 * counts. All numeric fields are computed from the same hooks and formulas that
 * the Cluster Overview page (`components/cluster/Overview.tsx`) and its charts
 * use, so the numbers agree with what the user sees on that page.
 *
 * The component is only mounted while the popover is open, so the underlying
 * Pod/Node lists and metrics are only fetched during that window and torn down
 * on close.
 */
function ClusterStatusDetails({
  cluster,
  version,
  error,
  statusText,
  statusIcon,
  statusColor,
  onClose,
}: {
  cluster: Cluster;
  version?: StringDict | null;
  error?: ApiError | null;
  statusText: string;
  statusIcon: string;
  statusColor: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();

  // Copied from `components/cluster/Overview.tsx`: snapshot pod/node lists at
  // the same 60 s cadence and pull node metrics for CPU / memory sums.
  const OVERVIEW_REFETCH_INTERVAL_MS = 60_000;
  const [pods] = Pod.useList({
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
    cluster: cluster.name,
  });
  const [nodes] = Node.useList({
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
    cluster: cluster.name,
  });
  const [nodeMetrics, metricsError] = Node.useMetrics(cluster.name);

  const noPermissions = metricsError?.status === 403;
  const noMetrics = metricsError !== null && !noPermissions;

  // API server line: error === null means the version probe returned 200, any
  // other value means the probe failed (status code may be present).
  const apiServerLabel =
    error === null || error === undefined
      ? t('translation|Reachable (HTTP 200)')
      : error?.status
      ? t('translation|Unreachable (HTTP {{ code }})', { code: error.status })
      : t('translation|Unreachable');

  const versionLabel = version?.gitVersion ?? '—';

  // Copied from `PodsStatusCircleChart` in
  // `components/cluster/Charts/StatusCharts.tsx` — a pod counts as "ready" if
  // it Succeeded or has a Ready=True condition.
  const podsReady = (pods || []).filter((pod: Pod) => {
    if (pod.status?.phase === 'Succeeded') {
      return true;
    }
    const readyCondition = pod.status?.conditions?.find(c => c.type === 'Ready');
    return readyCondition?.status === 'True';
  });
  const podsLabel =
    pods === null
      ? null
      : pods.length === 0
      ? t('translation|{{ numReady }} / {{ numItems }} Requested', {
          numReady: 0,
          numItems: 0,
        }) + ' (0.0%)'
      : `${t('translation|{{ numReady }} / {{ numItems }} Requested', {
          numReady: podsReady.length,
          numItems: pods.length,
        })} (${((podsReady.length / pods.length) * 100).toFixed(1)}%)`;

  // Copied from `NodesStatusCircleChart` — Ready=True condition.
  const nodesReady = (nodes || []).filter((node: Node) => {
    const readyCondition = node.status?.conditions?.find(c => c.type === 'Ready');
    return readyCondition?.status === 'True';
  });
  const nodesLabel =
    nodes === null
      ? null
      : nodes.length === 0
      ? `0 / 0 Ready (0.0%)`
      : `${t('translation|{{ numReady }} / {{ numItems }} Ready', {
          numReady: nodesReady.length,
          numItems: nodes.length,
        })} (${((nodesReady.length / nodes.length) * 100).toFixed(1)}%)`;

  // Copied from `CircularChart` (`components/common/Resource/CircularChart.tsx`)
  // + `CpuCircularChart` / `MemoryCircularChart`. Filter node metrics by name
  // presence in the cluster's node list, then sum used vs. capacity.
  function filterMetrics(items: KubeObject[] | null, metrics: KubeMetrics[] | null) {
    if (!items || !metrics) return [];
    const names = items.map(({ metadata }) => metadata.name);
    return metrics.filter(item => names.includes(item.metadata.name));
  }

  // Match the Overview page cards:
  //  CPU     : `<used>.2f / <capacity> units (<pct>.1f%)`
  //  Memory  : `<used>.2f / <capacity>.2f GB (<pct>.1f%)`
  function pctStr(used: number, available: number): string {
    if (available <= 0) return '0.0';
    return ((used / available) * 100).toFixed(1);
  }

  let cpuValue: string | null = null;
  let memoryValue: string | null = null;
  if (nodes === null) {
    cpuValue = null;
    memoryValue = null;
  } else if (noMetrics || noPermissions) {
    cpuValue = '—';
    memoryValue = '—';
  } else if (nodeMetrics === null) {
    // Still loading metrics — leave as null to show spinner.
    cpuValue = null;
    memoryValue = null;
  } else {
    const filtered = filterMetrics(nodes as KubeObject[], nodeMetrics);
    const cpuUsed = _.sumBy(filtered, (m: KubeMetrics) => parseCpu(m.usage.cpu) / TO_ONE_CPU);
    const cpuCap = _.sumBy(
      nodes as List<Node>,
      (n: Node) => parseCpu(n.status?.capacity?.cpu) / TO_ONE_CPU
    );
    const memUsed = _.sumBy(filtered, (m: KubeMetrics) => parseRam(m.usage.memory) / TO_GB);
    const memCap = _.sumBy(
      nodes as List<Node>,
      (n: Node) => parseRam(n.status?.capacity?.memory) / TO_GB
    );
    cpuValue = `${cpuUsed.toFixed(2)} / ${cpuCap} units (${pctStr(cpuUsed, cpuCap)}%)`;
    memoryValue = `${memUsed.toFixed(2)} / ${memCap.toFixed(2)} GB (${pctStr(memUsed, memCap)}%)`;
  }

  function Row({ label, value }: { label: string; value: string | null }) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="baseline">
        <Typography
          variant="caption"
          sx={{
            color: theme.palette.text.secondary,
            minWidth: 130,
            flexShrink: 0,
          }}
        >
          {label}
        </Typography>
        {value === null ? (
          <CircularProgress size={12} />
        ) : (
          <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
            {value}
          </Typography>
        )}
      </Stack>
    );
  }

  return (
    <Box sx={{ minWidth: 260 }}>
      <Box display="flex" alignItems="center" mb={1}>
        <Icon icon={statusIcon} width={16} color={statusColor} />
        <Typography
          variant="subtitle2"
          sx={{ ml: 0.75, color: statusColor, fontWeight: 600, flexGrow: 1 }}
        >
          {statusText}
        </Typography>
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('translation|Close')}
            sx={{ ml: 1, p: 0.25 }}
          >
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        )}
      </Box>
      <Divider sx={{ mb: 1 }} />
      <Stack spacing={0.75}>
        <Row label={t('translation|API server')} value={apiServerLabel} />
        <Row label={t('translation|Kubernetes version')} value={versionLabel} />
        <Row label={t('glossary|CPU')} value={cpuValue} />
        <Row label={t('glossary|Memory')} value={memoryValue} />
        <Row label={t('glossary|Nodes')} value={nodesLabel} />
        <Row label={t('glossary|Pods')} value={podsLabel} />
      </Stack>
    </Box>
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

  /**
   * Gets the origin of a cluster.
   *
   * @param cluster
   * @returns A description of where the cluster is picked up from: dynamic, in-cluster, or from a kubeconfig file.
   */
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
        {
          id: 'origin',
          header: t('Origin'),
          accessorFn: cluster => getOrigin(cluster),
          Cell: ({ row: { original } }) => (
            <Typography variant="body2">{getOrigin((clusters || {})[original.name])}</Typography>
          ),
        },
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
              version={versions[original.name]}
            />
          ),
        },
        {
          id: 'warnings',
          header: t('Warnings'),
          // Warnings track connection status: list them for connected clusters
          // (⋯ while loading), blank for clusters that aren't connected.
          accessorFn: cluster =>
            isClusterConnected(cluster?.name) ? warningLabels[cluster?.name] ?? '⋯' : '',
        },
        {
          id: 'version',
          header: t('glossary|Kubernetes Version'),
          accessorFn: ({ name }) =>
            isClusterConnected(name) ? versions[name]?.gitVersion || '⋯' : '',
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
