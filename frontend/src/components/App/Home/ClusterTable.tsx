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
import {
  MRT_ColumnFiltersState,
  MRT_SortingState,
  MRT_VisibilityState,
} from 'material-react-table';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { Cluster, StringDict } from '../../../lib/k8s/cluster';
import { createRouteURL } from '../../../lib/router/createRouteURL';
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
 * Context providing a per-cluster map of epoch-ms of the most recent /version
 * response (success or error). Consumed by `ClusterStatusDetails` directly to
 * avoid stale closures from TanStack Table cell rendering.
 */
export const LastPollTsContext = createContext<Record<string, number>>({});

const OcpVersionsContext = createContext<OcpVersionMap>({});

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
        statusLoading={error === undefined}
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
  statusLoading,
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
  statusLoading?: boolean;
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
              statusLoading={statusLoading}
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
 * the API-server reachability and Kubernetes version. Live CPU/Memory/Pod/Node
 * counts are intentionally not shown here — users should click through to the
 * cluster Overview page for those (which uses the standard client-side
 * `Pod.useList` / `Node.useList` / `Node.useMetrics` path, same as headlamp).
 */
function ClusterStatusDetails({
  cluster,
  version,
  error,
  statusText,
  statusIcon,
  statusColor,
  statusLoading,
  onClose,
}: {
  cluster: Cluster;
  version?: StringDict | null;
  error?: ApiError | null;
  statusText: string;
  statusIcon: string;
  statusColor: string;
  statusLoading?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();
  // Per-cluster stamp: reflects when THIS cluster last responded, not some global tick.
  const lastPollByCluster = useContext(LastPollTsContext);
  const lastStatusUpdate = lastPollByCluster[cluster.name];

  const apiServerLabel =
    error === null || error === undefined
      ? t('translation|Reachable (HTTP 200)')
      : error?.status
      ? t('translation|Unreachable (HTTP {{ code }})', { code: error.status })
      : t('translation|Unreachable');

  const versionLabel = version?.gitVersion ?? null;

  // Live "Last updated Xs ago" — ticks every 1s while popover is open.
  const [agoText, setAgoText] = useState<string>('');
  useEffect(() => {
    if (statusLoading || !lastStatusUpdate) {
      setAgoText('');
      return;
    }
    function compute() {
      const secs = Math.max(0, Math.round((Date.now() - lastStatusUpdate!) / 1000));
      if (secs < 1) return t('translation|Just now');
      if (secs < 60) return t('translation|{{ count }}s ago', { count: secs });
      const mins = Math.floor(secs / 60);
      return t('translation|{{ count }}m ago', { count: mins });
    }
    setAgoText(compute());
    const id = setInterval(() => setAgoText(compute()), 1000);
    return () => clearInterval(id);
  }, [lastStatusUpdate, statusLoading, t]);

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
        <Row label={t('glossary|Version')} value={versionLabel} />
        <Row
          label={t('translation|Last updated')}
          value={statusLoading ? t('translation|Checking…') : agoText}
        />
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
  const normalized = trimmed.toLowerCase();
  if (trimmed === '' || trimmed === '⋯' || normalized === 'n/a' || normalized === 'na') {
    return (
      <Typography
        component="span"
        variant="body2"
        sx={{ color: '#9CA3AF', fontStyle: 'italic', fontWeight: 400 }}
      >
        N/A
      </Typography>
    );
  }
  return <Typography variant="body2">{trimmed}</Typography>;
}

function OcpVersionCell({ name, isConnected }: { name: string; isConnected: boolean }) {
  const { t } = useTranslation(['translation']);
  // Read from Context so TanStack Table cell memoization can't serve a stale closure.
  const ocpVersions = useContext(OcpVersionsContext);
  if (!isConnected) return renderNaFallback('');
  const entry = ocpVersions[name];
  if (!entry || entry.state === 'loading') {
    return (
      <Typography
        component="span"
        variant="body2"
        sx={{ color: '#9CA3AF', fontStyle: 'italic', fontWeight: 400 }}
      >
        {t('translation|Loading…')}
      </Typography>
    );
  }
  if (entry.state === 'ok' && entry.version) {
    return <Typography variant="body2">{entry.version}</Typography>;
  }
  const tooltip = entry.errorText ?? '';
  const body = (
    <Typography
      component="span"
      variant="body2"
      sx={{ color: '#9CA3AF', fontStyle: 'italic', fontWeight: 400 }}
    >
      N/A
    </Typography>
  );
  return tooltip ? <LightTooltip title={tooltip}>{body}</LightTooltip> : body;
}

/**
 * Reads OpenShift ClusterVersion for each connected cluster and returns a map
 * of cluster name -> {state, version, errorText}.
 *
 * Fetches `.items[0].status.desired.version` from
 * `/apis/config.openshift.io/v1/clusterversions` — same value as
 * `oc get clusterversion -o jsonpath='{.items[0].status.desired.version}'`.
 *
 * Design notes (do not change without reading the perf notes):
 * - Per-cluster localStorage cache with 1h TTL — OCP version doesn't change
 *   minute-to-minute, and repeated Home mounts must not re-hit the API.
 * - No setInterval poll — refresh only on mount if cache is stale, or when a
 *   new cluster joins the connected set.
 * - 5s request timeout via clusterRequest's `timeout` param so a slow cluster
 *   cannot hold an HTTP slot for the default 2 minutes.
 * - Concurrency cap of 3 so many clusters cannot saturate the browser's
 *   per-origin HTTP pool and delay `/version`/status calls.
 * - Dispatch is deferred by 250ms so the Status column's `/version` calls
 *   grab the first free HTTP slots.
 * - 404 = non-OpenShift cluster, 403 = forbidden, 408 = timeout, other =
 *   unavailable. Errors are cached too so we don't re-probe every mount.
 */
type OcpVersionState = 'loading' | 'ok' | 'unavailable' | 'not-openshift';
interface OcpVersionEntry {
  state: OcpVersionState;
  version: string | null;
  errorText?: string;
}
type OcpVersionMap = { [clusterName: string]: OcpVersionEntry };

const OCP_CACHE_KEY_PREFIX = 'ocp_version_cache.v1.';
const OCP_CACHE_TTL_MS = 60 * 60 * 1000;
const OCP_REQUEST_TIMEOUT_MS = 5000;
const OCP_CONCURRENCY = 3;
const OCP_DISPATCH_DELAY_MS = 250;

interface CachedOcpEntry extends OcpVersionEntry {
  ts: number;
}

function readOcpCache(name: string): CachedOcpEntry | null {
  try {
    const raw = localStorage.getItem(OCP_CACHE_KEY_PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.ts !== 'number' || typeof parsed?.state !== 'string') return null;
    // Never serve a failed entry from cache: pre-fix versions persisted 502s,
    // and stale 'unavailable' entries would block re-fetch for the TTL window.
    if (parsed.state === 'unavailable') {
      try {
        localStorage.removeItem(OCP_CACHE_KEY_PREFIX + name);
      } catch {
        // ignore
      }
      return null;
    }
    return parsed as CachedOcpEntry;
  } catch {
    return null;
  }
}

function writeOcpCache(name: string, entry: CachedOcpEntry) {
  try {
    localStorage.setItem(OCP_CACHE_KEY_PREFIX + name, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private mode / quota): in-memory state stays.
  }
}

function isCacheFresh(entry: CachedOcpEntry | null): boolean {
  return !!entry && Date.now() - entry.ts < OCP_CACHE_TTL_MS;
}

function useClustersOcpVersion(connectedClusterNames: string[]): OcpVersionMap {
  const [ocpVersions, setOcpVersions] = useState<OcpVersionMap>(() => {
    const initial: OcpVersionMap = {};
    for (const name of connectedClusterNames) {
      const cached = readOcpCache(name);
      if (isCacheFresh(cached)) {
        initial[name] = {
          state: cached!.state,
          version: cached!.version,
          errorText: cached!.errorText,
        };
      } else {
        initial[name] = { state: 'loading', version: null };
      }
    }
    return initial;
  });
  const cancelledRef = useRef(false);

  const namesKey = useMemo(
    () => [...connectedClusterNames].sort().join(','),
    [connectedClusterNames]
  );

  useEffect(() => {
    cancelledRef.current = false;

    // Reconcile in-memory state with current connected set + cache.
    setOcpVersions(prev => {
      const next: OcpVersionMap = {};
      for (const name of connectedClusterNames) {
        const cached = readOcpCache(name);
        if (isCacheFresh(cached)) {
          next[name] = {
            state: cached!.state,
            version: cached!.version,
            errorText: cached!.errorText,
          };
        } else {
          // Keep in-memory result (incl. non-persisted 'unavailable' from 502)
          // rather than flashing back to 'loading' on every effect re-run.
          next[name] = prev[name] ?? { state: 'loading', version: null };
        }
      }
      return next;
    });

    const toFetch = connectedClusterNames.filter(name => !isCacheFresh(readOcpCache(name)));
    if (toFetch.length === 0) {
      return () => {
        cancelledRef.current = true;
      };
    }

    const applyEntry = (name: string, entry: CachedOcpEntry) => {
      setOcpVersions(prev => {
        const cur = prev[name];
        if (
          cur &&
          cur.state === entry.state &&
          cur.version === entry.version &&
          cur.errorText === entry.errorText
        ) {
          return prev;
        }
        return {
          ...prev,
          [name]: { state: entry.state, version: entry.version, errorText: entry.errorText },
        };
      });
    };

    const fetchOne = async (name: string) => {
      try {
        const res: any = await clusterRequest('/apis/config.openshift.io/v1/clusterversions', {
          cluster: name,
          timeout: OCP_REQUEST_TIMEOUT_MS,
        });
        const version: string | undefined = res?.items?.[0]?.status?.desired?.version;
        const entry: CachedOcpEntry = version
          ? { state: 'ok', version, ts: Date.now() }
          : {
              state: 'not-openshift',
              version: null,
              errorText: 'No ClusterVersion resource on this cluster',
              ts: Date.now(),
            };
        writeOcpCache(name, entry);
        if (cancelledRef.current) return;
        applyEntry(name, entry);
      } catch (err: any) {
        const status: number | undefined = err?.status;
        let entry: CachedOcpEntry;
        // Only 404 (definitely not OCP) and 403 (definite perm denial) are cached.
        // Transient failures (502/408/5xx/no-status) apply in-memory only so a
        // reload or remount retries instead of showing N/A for the full TTL.
        let persist = false;
        if (status === 404) {
          entry = {
            state: 'not-openshift',
            version: null,
            errorText: 'Not an OpenShift cluster',
            ts: Date.now(),
          };
          persist = true;
        } else if (status === 403) {
          entry = {
            state: 'unavailable',
            version: null,
            errorText: 'Permission denied reading ClusterVersion',
            ts: Date.now(),
          };
          persist = true;
        } else if (status === 408) {
          entry = {
            state: 'unavailable',
            version: null,
            errorText: 'Request timed out',
            ts: Date.now(),
          };
        } else if (typeof status === 'number') {
          entry = {
            state: 'unavailable',
            version: null,
            errorText: `Request failed (HTTP ${status})`,
            ts: Date.now(),
          };
        } else {
          entry = {
            state: 'unavailable',
            version: null,
            errorText: 'Cluster not reachable',
            ts: Date.now(),
          };
        }
        if (persist) writeOcpCache(name, entry);
        if (cancelledRef.current) return;
        applyEntry(name, entry);
      }
    };

    // Yield to /version dispatch so status/K8s-version calls get the first HTTP slots.
    const dispatchTimer = setTimeout(() => {
      const queue = [...toFetch];
      const worker = async (): Promise<void> => {
        while (queue.length > 0 && !cancelledRef.current) {
          const name = queue.shift()!;
          await fetchOne(name);
        }
      };
      const workerCount = Math.min(OCP_CONCURRENCY, queue.length);
      const workers = Array.from({ length: workerCount }, () => worker());
      Promise.all(workers).catch(() => {
        // Per-request errors are already handled in fetchOne.
      });
    }, OCP_DISPATCH_DELAY_MS);

    return () => {
      cancelledRef.current = true;
      clearTimeout(dispatchTimer);
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
    <Box
      sx={{
        '& .MuiTable-root a, & .MuiTable-root a:visited': {
          textDecoration: 'none !important',
        },
        '& .MuiTable-root a *': {
          textDecoration: 'none !important',
        },
        '& .MuiTable-root a:hover, & .MuiTable-root a:focus-visible': {
          textDecoration: 'underline !important',
        },
        '& .MuiTable-root a:hover *, & .MuiTable-root a:focus-visible *': {
          textDecoration: 'underline !important',
        },
        '& .MuiTable-root th, & .MuiTable-root td': {
          border: '1px solid #e6e6e6 !important',
        },
        '& .MuiTable-root th': {
          backgroundColor: '#f5f5f5 !important',
        },
      }}
    >
      <OcpVersionsContext.Provider value={ocpVersions}>
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
              // Sort/filter on the version string; the Cell renders loading /
              // unavailable / not-openshift states with a tooltip.
              accessorFn: ({ name }) => {
                if (!isClusterConnected(name)) return '';
                return ocpVersions[name]?.version ?? '';
              },
              Cell: ({ row: { original } }) => (
                <OcpVersionCell
                  name={original.name}
                  isConnected={isClusterConnected(original.name)}
                />
              ),
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
      </OcpVersionsContext.Provider>
    </Box>
  );
}
