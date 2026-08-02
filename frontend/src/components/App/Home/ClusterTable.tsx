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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useHistory } from 'react-router-dom';
import { getClusterAppearanceFromMeta } from '../../../helpers/clusterAppearance';
import { isElectron } from '../../../helpers/isElectron';
import { setRecentCluster } from '../../../helpers/recentClusters';
import { loadTableSettings, storeTableSettings } from '../../../helpers/tableSettings';
import { formatClusterPathParam } from '../../../lib/cluster';
import { useClustersConf, useClustersVersion } from '../../../lib/k8s';
import { clusterRequest } from '../../../lib/k8s/api/v1/clusterRequests';
import { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import { Cluster, KubeMetrics, StringDict } from '../../../lib/k8s/cluster';
import { KubeObject } from '../../../lib/k8s/KubeObject';
import Node from '../../../lib/k8s/node';
import Pod from '../../../lib/k8s/pod';
import { useClusterOverviewStats } from '../../../lib/k8s/useClusterOverviewStats';
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
import {
  ClusterInventoryCondition,
  getClusterStatusAccessor,
  getClusterStatusInfo,
  getConditionTooltip,
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

  // Condition details from Cluster Inventory (reason / last transition).
  const conditionReason = condition?.reason || null;
  const conditionTime = condition?.lastTransitionTime
    ? new Date(condition.lastTransitionTime).toLocaleString()
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
        <Row label={t('translation|Reason')} value={conditionReason} multiline />
        <Row label={t('translation|Last transition')} value={conditionTime} />
      </Stack>
    </Box>
  );
}

/**
 * ClusterStatusDetails renders the popover body for an Active cluster. It shows
 * the API-server reachability, Kubernetes version, CPU %, Memory %, node and pod
 * counts.
 *
 * Fast path: reads the backend `/overview-stats` aggregate (see
 * `useClusterOverviewStats`) so opening the popover on a large cluster costs a
 * single ~300 byte request instead of full Pod/Node/Metrics list fetches.
 *
 * Legacy fallback (`ClusterStatusDetailsLegacy`) is used only when the backend
 * endpoint is unavailable or errors, mirroring `components/cluster/Overview.tsx`.
 *
 * The component is only mounted while the popover is open, so subscriptions are
 * torn down on close.
 */
function ClusterStatusDetails(props: {
  cluster: Cluster;
  version?: StringDict | null;
  error?: ApiError | null;
  statusText: string;
  statusIcon: string;
  statusColor: string;
  onClose?: () => void;
}) {
  const stats = useClusterOverviewStats(props.cluster.name);

  // Same fallback semantics as `Overview.tsx`: a single failed request (404 /
  // 5xx) drops back to the legacy client-side aggregation path so older backends
  // and misconfigured clusters keep working.
  if (stats.isError) {
    return <ClusterStatusDetailsLegacy {...props} />;
  }

  return <ClusterStatusDetailsAggregate stats={stats.data} {...props} />;
}

/**
 * Fast path popover body: renders values from the backend aggregate snapshot.
 * Deliberately does not call `Pod.useList` / `Node.useList` / `Node.useMetrics`
 * so opening the popover on a large cluster is ~300 bytes instead of megabytes.
 */
function ClusterStatusDetailsAggregate({
  stats,
  error,
  statusText,
  statusIcon,
  statusColor,
  onClose,
}: {
  stats: ReturnType<typeof useClusterOverviewStats>['data'];
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

  const apiServerLabel =
    error === null || error === undefined
      ? t('translation|Reachable (HTTP 200)')
      : error?.status
      ? t('translation|Unreachable (HTTP {{ code }})', { code: error.status })
      : t('translation|Unreachable');

  const synced = stats?.synced === true;
  const noMetrics = synced && stats?.metricsAvailable === false;

  function pctStr(used: number, available: number): string {
    if (available <= 0) return '0.0';
    return ((used / available) * 100).toFixed(1);
  }

  let podsLabel: string | null;
  let nodesLabel: string | null;
  let cpuValue: string | null;
  let memoryValue: string | null;

  if (!synced) {
    podsLabel = null;
    nodesLabel = null;
    cpuValue = null;
    memoryValue = null;
  } else {
    const { pods, nodes } = stats!;

    podsLabel =
      pods.total === 0
        ? `${t('translation|{{ numReady }} / {{ numItems }} Requested', {
            numReady: 0,
            numItems: 0,
          })} (0.0%)`
        : `${t('translation|{{ numReady }} / {{ numItems }} Requested', {
            numReady: pods.ready,
            numItems: pods.total,
          })} (${pctStr(pods.ready, pods.total)}%)`;

    nodesLabel =
      nodes.total === 0
        ? `0 / 0 Ready (0.0%)`
        : `${t('translation|{{ numReady }} / {{ numItems }} Ready', {
            numReady: nodes.ready,
            numItems: nodes.total,
          })} (${pctStr(nodes.ready, nodes.total)}%)`;

    if (noMetrics) {
      cpuValue = '—';
      memoryValue = '—';
    } else {
      // Backend serves CPU in nanocores, memory in bytes. Convert to the same
      // "CPU units" and GB scales the Overview page uses so numbers match.
      const cpuUsed = stats!.cpu.used / TO_ONE_CPU;
      const cpuCap = stats!.cpu.capacity / TO_ONE_CPU;
      const memUsed = stats!.memory.used / TO_GB;
      const memCap = stats!.memory.capacity / TO_GB;
      cpuValue = `${cpuUsed.toFixed(2)} / ${cpuCap} units (${pctStr(cpuUsed, cpuCap)}%)`;
      memoryValue = `${memUsed.toFixed(2)} / ${memCap.toFixed(2)} GB (${pctStr(memUsed, memCap)}%)`;
    }
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
        <Row label={t('glossary|CPU')} value={cpuValue} />
        <Row label={t('glossary|Memory')} value={memoryValue} />
        <Row label={t('glossary|Nodes')} value={nodesLabel} />
        <Row label={t('glossary|Pods')} value={podsLabel} />
      </Stack>
    </Box>
  );
}

/**
 * Legacy path: fetches full Pod / Node / Node.metrics lists and aggregates on
 * the client. Preserved as a fallback for backends without the
 * `/overview-stats` endpoint. See `ClusterStatusDetails` above.
 */
function ClusterStatusDetailsLegacy({
  cluster,
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

/**
 * Renders a table cell value, falling back to a small, muted "n/a" when the
 * value is empty, whitespace, or the historical "⋯" loading placeholder.
 * Scoped to this page only — blank/⋯ cells were confusing for users.
 */
function renderNaFallback(value: string | null | undefined) {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed === '⋯') {
    return (
      <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
        n/a
      </Typography>
    );
  }
  return <Typography variant="body2">{trimmed}</Typography>;
}

/**
 * Polls the OpenShift ClusterVersion custom resource for each connected cluster
 * and returns a map of cluster name -> OCP version string (e.g. "4.16.43").
 *
 * Reads `.items[0].status.desired.version` — the same field returned by
 * `oc get clusterversion -o jsonpath='{.items[0].status.desired.version}'`.
 *
 * Non-OpenShift clusters (endpoint returns 404) are simply omitted from the
 * map, so their cell renders empty. No values are ever fabricated.
 */
function useClustersOcpVersion(connectedClusterNames: string[]): {
  [clusterName: string]: string;
} {
  const [ocpVersions, setOcpVersions] = useState<{ [clusterName: string]: string }>({});
  const cancelledRef = useRef(false);

  // Stable key so the effect only re-runs when the connected set actually changes.
  const namesKey = useMemo(
    () => [...connectedClusterNames].sort().join(','),
    [connectedClusterNames]
  );

  useEffect(() => {
    cancelledRef.current = false;

    const fetchAll = () => {
      connectedClusterNames.forEach(name => {
        clusterRequest('/apis/config.openshift.io/v1/clusterversions', { cluster: name })
          .then((res: any) => {
            const version: string | undefined = res?.items?.[0]?.status?.desired?.version;
            if (cancelledRef.current) return;
            setOcpVersions(prev => {
              if (!version) {
                if (!(name in prev)) return prev;
                const next = { ...prev };
                delete next[name];
                return next;
              }
              if (prev[name] === version) return prev;
              return { ...prev, [name]: version };
            });
          })
          .catch(() => {
            // Non-OpenShift clusters or transient errors: leave the entry
            // absent so the UI shows nothing rather than a placeholder.
            if (cancelledRef.current) return;
            setOcpVersions(prev => {
              if (!(name in prev)) return prev;
              const next = { ...prev };
              delete next[name];
              return next;
            });
          });
      });
    };

    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  return ocpVersions;
}

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

  // Poll the OpenShift ClusterVersion CR for connected clusters so the
  // "OCP Version" column reflects live cluster state (never fabricated).
  const connectedNamesList = useMemo(
    () =>
      Object.values(customNameClusters)
        .map(c => c.name)
        .filter(isClusterConnected),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customNameClusters, connectedClusterNames]
  );
  const ocpVersions = useClustersOcpVersion(connectedNamesList);

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

  // getOrigin() intentionally removed with the Origin column (see below).
  // Reinstate together with the commented Origin column if that requirement returns.

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
        // Origin column intentionally hidden per product requirement.
        // Kept commented out for easy reinstatement if the info is ever
        // needed again — do not delete without confirming the requirement
        // has changed.
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
          // Mirror the visible cell text so the filter dropdown and sort order
          // read as "Not connected" / "Connecting…" / "Active" / "Unavailable"
          // instead of the cryptic "⋯".
          accessorFn: cluster => {
            const name = cluster?.name;
            if (!isClusterConnected(name) && errors[name] === undefined) {
              return t('translation|Not connected');
            }
            if (isClusterConnected(name) && errors[name] === undefined) {
              return t('translation|Connecting…');
            }
            return getClusterStatusAccessor(cluster, errors[name], t);
          },
          filterVariant: 'multi-select',
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
          // Warnings track connection status: list them for connected clusters,
          // "n/a" when the cluster isn't connected or the count hasn't loaded
          // yet — blank/⋯ cells were confusing for users.
          accessorFn: cluster =>
            isClusterConnected(cluster?.name) ? warningLabels[cluster?.name] ?? '' : '',
          enableColumnFilter: false,
          Cell: ({ cell }) => renderNaFallback(cell.getValue<string>()),
        },
        {
          id: 'ocpVersion',
          header: t('OCP Version'),
          // OCP version comes from the live OpenShift ClusterVersion CR — same
          // value as `oc get clusterversion -o jsonpath='{.items[0].status.desired.version}'`.
          // "n/a" for non-OpenShift clusters or while the fetch is pending.
          accessorFn: ({ name }) => (isClusterConnected(name) ? ocpVersions[name] ?? '' : ''),
          Cell: ({ cell }) => renderNaFallback(cell.getValue<string>()),
        },
        {
          id: 'version',
          header: t('glossary|Kubernetes Version'),
          accessorFn: ({ name }) =>
            isClusterConnected(name) ? versions[name]?.gitVersion ?? '' : '',
          Cell: ({ cell }) => renderNaFallback(cell.getValue<string>()),
        },
        // Actions column intentionally hidden per product requirement.
        // Kept commented out for easy reinstatement — do not delete without
        // confirming the requirement has changed.
        // {
        //   id: 'actions',
        //   header: t('Actions'),
        //   gridTemplate: 'min-content',
        //   muiTableBodyCellProps: {
        //     align: 'right',
        //   },
        //   accessorFn: cluster => getClusterStatusAccessor(cluster, errors[cluster?.name], t),
        //   Cell: ({ row: { original: cluster } }) => {
        //     return <ClusterContextMenu cluster={cluster} />;
        //   },
        //   enableSorting: false,
        //   enableColumnFilter: false,
        // },
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
