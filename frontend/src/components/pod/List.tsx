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
import Fade from '@mui/material/Fade';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import { alpha, Theme, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { KubeContainerStatus } from '../../lib/k8s/cluster';
import Event, { KubeEvent } from '../../lib/k8s/event';
import Pod from '../../lib/k8s/pod';
import { METRIC_REFETCH_INTERVAL_MS, PodMetrics } from '../../lib/k8s/PodMetrics';
import { parseCpu, parseRam, unparseCpu, unparseRam } from '../../lib/units';
import { localeDate, timeAgo } from '../../lib/util';
import { useNamespaces } from '../../redux/filterSlice';
import { HeadlampEventType, useEventCallback } from '../../redux/headlampEventSlice';
import { CreateResourceButton } from '../common';
import { StatusLabel, StatusLabelProps } from '../common/Label';
import Link from '../common/Link';
import ResourceListView from '../common/Resource/ResourceListView';
import { SimpleTableProps } from '../common/SimpleTable';
import { TooltipIcon } from '../common/Tooltip';
import LightTooltip from '../common/Tooltip/TooltipLight';

function getPodStatus(pod: Pod) {
  const phase = pod.status?.phase;
  let status: StatusLabelProps['status'] = '';

  if (phase === 'Failed') {
    status = 'error';
  } else if (phase === 'Succeeded' || phase === 'Running') {
    const readyCondition = (pod.status?.conditions || []).find(
      condition => condition.type === 'Ready'
    );
    if (readyCondition?.status === 'True' || phase === 'Succeeded') {
      status = 'success';
    } else {
      status = 'warning';
    }
  }

  return status;
}

export function makePodStatusLabel(pod: Pod, showContainerStatus: boolean, t: TFunction) {
  const status = getPodStatus(pod);
  const { reason, message: tooltip } = pod.getDetailedStatus();

  const containerStatuses = pod.status?.containerStatuses || [];
  const containerIndicators = containerStatuses.map((cs, index) => {
    const { color, tooltip } = getContainerDisplayStatus(cs, t);
    return (
      <LightTooltip
        title={tooltip}
        key={index}
        TransitionComponent={Fade}
        TransitionProps={{ timeout: 0 }}
        slotProps={{
          popper: {
            modifiers: [{ name: 'computeStyles', options: { gpuAcceleration: false } }],
          },
          tooltip: { sx: { maxWidth: 'none', willChange: 'opacity' } },
        }}
      >
        <Icon icon="mdi:circle" style={{ color }} width="1rem" height="1rem" />
      </LightTooltip>
    );
  });

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <LightTooltip
        title={tooltip}
        interactive
        TransitionComponent={Fade}
        TransitionProps={{ timeout: 0 }}
        slotProps={{
          popper: {
            modifiers: [{ name: 'computeStyles', options: { gpuAcceleration: false } }],
          },
          tooltip: { sx: { maxWidth: 'none', willChange: 'opacity' } },
        }}
      >
        <Box display="inline">
          <StatusLabel status={status}>
            {(status === 'warning' || status === 'error') && (
              <Icon aria-label="hidden" icon="mdi:alert-outline" width="1.2rem" height="1.2rem" />
            )}
            {reason}
          </StatusLabel>
        </Box>
      </LightTooltip>
      {showContainerStatus && containerIndicators.length > 0 && (
        <Box display="flex" gap={0.5}>
          {containerIndicators}
        </Box>
      )}
    </Box>
  );
}

function getReadinessGatesStatus(pods: Pod) {
  const readinessGates = pods?.spec?.readinessGates?.map(gate => gate.conditionType) || [];
  const readinessGatesMap: { [key: string]: string } = {};
  if (readinessGates.length === 0) {
    return readinessGatesMap;
  }

  pods?.status?.conditions?.forEach(condition => {
    if (readinessGates.includes(condition.type)) {
      readinessGatesMap[condition.type] = condition.status;
    }
  });

  return readinessGatesMap;
}

function getContainerDisplayStatus(container: KubeContainerStatus, t: TFunction) {
  const state = container.state || {};
  let color = 'grey';
  let label = '';
  const tooltipLines: string[] = [t('translation|Name: {{ name }}', { name: container.name })];

  if (state.waiting) {
    color = 'orange';
    label = t('translation|Waiting');
    if (state.waiting.reason) {
      tooltipLines.push(t('translation|Reason: {{ reason }}', { reason: state.waiting.reason }));
    }
  } else if (state.terminated) {
    color = 'green';
    label = t('translation|Terminated');
    if (state.terminated.reason === 'Error') {
      color = 'red';
    }
    if (state.terminated.reason) {
      tooltipLines.push(t('translation|Reason: {{ reason }}', { reason: state.terminated.reason }));
    }
    if (state.terminated.exitCode !== undefined) {
      tooltipLines.push(
        t('translation|Exit Code: {{ code }}', { code: state.terminated.exitCode })
      );
    }
    if (state.terminated.startedAt) {
      tooltipLines.push(
        t('translation|Started: {{ date }}', { date: localeDate(state.terminated.startedAt) })
      );
    }
    if (state.terminated.finishedAt) {
      tooltipLines.push(
        t('translation|Finished: {{ date }}', { date: localeDate(state.terminated.finishedAt) })
      );
    }
    if (container.restartCount > 0) {
      tooltipLines.push(t('translation|Restarts: {{ count }}', { count: container.restartCount }));
    }
  } else if (state.running) {
    color = 'green';
    label = t('translation|Running');
    if (state.running.startedAt) {
      tooltipLines.push(
        t('translation|Started: {{ date }}', { date: localeDate(state.running.startedAt) })
      );
    }
    if (container.restartCount > 0) {
      tooltipLines.push(t('translation|Restarts: {{ count }}', { count: container.restartCount }));
    }
  }

  tooltipLines.splice(1, 0, t('translation|Status: {{ status }}', { status: label }));

  return {
    color,
    label,
    tooltip: <span style={{ whiteSpace: 'pre-line' }}>{tooltipLines.join('\n')}</span>,
  };
}

type PodStatusCategory = 'success' | 'warning' | 'error' | 'neutral';

const POD_STATUS_PRESENTATION: Record<
  PodStatusCategory,
  { icon: string; color: (theme: Theme) => string }
> = {
  success: { icon: 'mdi:check-circle', color: theme => theme.palette.success.main },
  warning: { icon: 'mdi:alert', color: theme => theme.palette.warning.main },
  error: { icon: 'mdi:alert-circle', color: theme => theme.palette.error.main },
  neutral: { icon: 'mdi:help-circle-outline', color: theme => theme.palette.text.secondary },
};

/**
 * The user-facing pod status: a single label whose wording matches its color.
 * A Running-but-not-Ready pod keeps a warning color, so the bare "Running"
 * reason is relabeled "Not Ready" — otherwise the word contradicts the color.
 */
export function getPodStatusDisplay(
  pod: Pod,
  t: TFunction
): {
  category: PodStatusCategory;
  label: string;
  description: string;
  message: string;
  phase: string;
  ready: boolean;
} {
  const { reason, message } = pod.getDetailedStatus();
  const phase = pod.status?.phase || '';
  const readyCondition = (pod.status?.conditions || []).find(c => c.type === 'Ready');
  const ready = readyCondition?.status === 'True';
  const base = getPodStatus(pod);
  const category: PodStatusCategory = base === '' ? 'neutral' : (base as PodStatusCategory);

  let label = reason;
  if (
    category === 'warning' &&
    phase === 'Running' &&
    !ready &&
    (reason === 'Running' || reason === 'NotReady' || reason === phase)
  ) {
    label = t('translation|Not Ready');
  }

  // Short one-line description derived from real phase/ready/reason — not fabricated.
  let description = '';
  if (phase === 'Succeeded') {
    description = t('translation|Pod completed successfully.');
  } else if (phase === 'Pending') {
    description = t('translation|Pod is waiting to start.');
  } else if (category === 'success') {
    description = t('translation|All containers are running and ready to receive traffic.');
  } else if (category === 'warning' && phase === 'Running' && !ready) {
    description = t(
      'translation|Containers are running, but the pod is not ready to receive traffic.'
    );
  } else if (category === 'error' && phase === 'Failed') {
    description = t('translation|Pod has failed.');
  } else if (category === 'error') {
    description = t('translation|Pod is in an error state.');
  }

  return { category, label, description, message: message || '', phase, ready };
}

/**
 * Real, per-container reason derived from `containerStatuses[].state` (and
 * `lastState` / pod Ready condition as fallback for the running-but-not-ready
 * case). Never fabricated — returns empty string if no reason exists.
 */
export function getContainerReason(cs: KubeContainerStatus, pod: Pod): string {
  const state = cs.state || {};
  if (state.waiting?.reason) {
    return state.waiting.message
      ? `${state.waiting.reason} — ${state.waiting.message}`
      : state.waiting.reason;
  }
  if (state.terminated?.reason) {
    const parts = [state.terminated.reason];
    if (state.terminated.exitCode !== undefined) {
      parts.push(`exit ${state.terminated.exitCode}`);
    }
    return state.terminated.message
      ? `${parts.join(' · ')} — ${state.terminated.message}`
      : parts.join(' · ');
  }
  // Running: no per-state reason. If not ready, fall back to pod Ready condition
  // (real K8s data), then to last terminated state if present.
  if (state.running && !cs.ready) {
    const readyCond = (pod.status?.conditions || []).find(c => c.type === 'Ready');
    if (readyCond?.status === 'False') {
      return readyCond.message || readyCond.reason || '';
    }
    if (cs.lastState?.terminated?.reason) {
      return `Last exit: ${cs.lastState.terminated.reason}`;
    }
  }
  return '';
}

/**
 * Latest Warning event tied to `containerName` via `involvedObject.fieldPath`
 * (K8s emits e.g. `spec.containers{cbur}` for probe/pull failures). Real event
 * data — this is where the exact "Readiness probe failed: ..." text lives.
 */
export function getContainerEventReason(events: KubeEvent[], containerName: string): string {
  if (!events.length) return '';
  const suffix = `{${containerName}}`;
  const matches = events.filter(
    e => e.type === 'Warning' && (e.involvedObject?.fieldPath || '').endsWith(suffix)
  );
  if (!matches.length) return '';
  const latest = matches.reduce((a, b) => (getEventTime(a) >= getEventTime(b) ? a : b));
  const reason = latest.reason || '';
  const msg = (latest.message || '').trim();
  if (reason && msg) return `${reason}: ${msg}`;
  return reason || msg;
}

/**
 * Latest Warning event on the pod itself (fieldPath empty) — surfaces reasons
 * like `FailedScheduling`, `FailedMount`, `NetworkNotReady`.
 */
export function getPodEventReason(events: KubeEvent[]): string {
  if (!events.length) return '';
  const matches = events.filter(
    e => e.type === 'Warning' && !(e.involvedObject?.fieldPath || '').includes('{')
  );
  if (!matches.length) return '';
  const latest = matches.reduce((a, b) => (getEventTime(a) >= getEventTime(b) ? a : b));
  const reason = latest.reason || '';
  const msg = (latest.message || '').trim();
  if (reason && msg) return `${reason}: ${msg}`;
  return reason || msg;
}

function getEventTime(e: KubeEvent): number {
  const ts =
    e.series?.lastObservedTime ||
    e.lastTimestamp ||
    e.eventTime ||
    e.firstTimestamp ||
    e.metadata?.creationTimestamp;
  return ts ? new Date(ts).getTime() : 0;
}

/**
 * Status pill for the Pods list: color matches wording, and a click opens a
 * popover that names each container's own state — so the per-container status
 * (previously bare colored dots) is labeled instead of a mystery indicator.
 */
function PodStatusChip({ pod, t }: { pod: Pod; t: TFunction }) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [events, setEvents] = React.useState<KubeEvent[]>([]);
  const { category, label, description, message } = getPodStatusDisplay(pod, t);
  const p = POD_STATUS_PRESENTATION[category];
  const color = p.color(theme);
  const containerStatuses = pod.status?.containerStatuses || [];

  // Fetch pod events lazily on popover open so we can surface the exact reason
  // (e.g. "Readiness probe failed: HTTP 503") which only exists in Events,
  // never in containerStatus.state.
  React.useEffect(() => {
    if (!anchorEl) return;
    let cancelled = false;
    Event.objectEvents(pod)
      .then((items: KubeEvent[]) => {
        if (!cancelled) setEvents(items || []);
      })
      .catch(() => {
        // Silent: events are optional enrichment; popover still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [anchorEl, pod]);

  return (
    <>
      <LightTooltip title={anchorEl ? '' : t('translation|Click to see')}>
        <Box
          component="button"
          type="button"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-label={t('translation|Show pod status details')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
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
          {label}
        </Box>
      </LightTooltip>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              p: 1.75,
              maxWidth: 420,
              minWidth: 300,
              border: '1.5px solid',
              borderColor: alpha(color, 0.5),
              borderRadius: 1.5,
              boxShadow: 6,
              backgroundImage: 'none',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Icon icon={p.icon} width={20} height={20} color={color} />
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 700, color, flexGrow: 1, lineHeight: 1.2 }}
          >
            {label}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setAnchorEl(null)}
            aria-label={t('translation|Close')}
            sx={{ p: 0.25 }}
          >
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        </Box>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: message ? 0.5 : 1 }}>
            {description}
          </Typography>
        )}
        {message && message !== description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', fontStyle: 'italic', mb: 1 }}
          >
            {message}
          </Typography>
        )}
        {(() => {
          const podEvent = getPodEventReason(events);
          return podEvent ? (
            <Box
              sx={{
                display: 'flex',
                gap: 0.75,
                alignItems: 'flex-start',
                p: 0.75,
                mb: 1,
                borderRadius: 1,
                border: '1px solid',
                borderColor: alpha(theme.palette.warning.main, 0.4),
                backgroundColor: alpha(theme.palette.warning.main, 0.08),
              }}
            >
              <Icon
                icon="mdi:alert-outline"
                width={16}
                height={16}
                color={theme.palette.warning.main}
                style={{ marginTop: 2 }}
              />
              <Typography variant="caption" sx={{ color: 'text.primary', lineHeight: 1.4 }}>
                {podEvent}
              </Typography>
            </Box>
          ) : null;
        })()}
        {containerStatuses.length > 0 && (
          <>
            <Box
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                pt: 1,
                mt: 0.5,
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3 }}
              >
                {t('translation|Containers ({{ count }})', { count: containerStatuses.length })}
              </Typography>
            </Box>
            <Box
              component="ul"
              sx={{
                listStyle: 'none',
                m: 0,
                mt: 1,
                p: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              {containerStatuses.map((cs, i) => {
                const { color: dotColorName, label: cLabel } = getContainerDisplayStatus(cs, t);
                // Map named color from getContainerDisplayStatus to a real hex/rgb
                // so MUI's `alpha()` doesn't throw "Unsupported color".
                const dotColor =
                  dotColorName === 'green'
                    ? theme.palette.success.main
                    : dotColorName === 'orange'
                    ? theme.palette.warning.main
                    : dotColorName === 'red'
                    ? theme.palette.error.main
                    : theme.palette.text.secondary;
                const stateReason = getContainerReason(cs, pod);
                const eventReason = getContainerEventReason(events, cs.name);
                // Prefer the more specific event reason (e.g. "Unhealthy:
                // Readiness probe failed: HTTP 503") over pod-level condition
                // fallback ("containers with unready status: [x]").
                const reason = eventReason || stateReason;
                return (
                  <Box
                    component="li"
                    key={i}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1,
                      backgroundColor: alpha(dotColor, 0.06),
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                      <Icon icon="mdi:circle" style={{ color: dotColor }} width={10} height={10} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {cs.name}
                      </Typography>
                    </Box>
                    <Box
                      component="ul"
                      sx={{
                        listStyle: 'none',
                        m: 0,
                        p: 0,
                        pl: 1.75,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.25,
                      }}
                    >
                      <ContainerDetailRow
                        label={t('translation|Status')}
                        value={cLabel || t('translation|Unknown')}
                        valueColor={dotColor}
                      />
                      <ContainerDetailRow
                        label={t('translation|Ready')}
                        value={cs.ready ? t('translation|Yes') : t('translation|No')}
                        valueColor={
                          cs.ready ? theme.palette.success.main : theme.palette.warning.main
                        }
                      />
                      {reason && (
                        <ContainerDetailRow label={t('translation|Reason')} value={reason} />
                      )}
                      {cs.restartCount > 0 && (
                        <ContainerDetailRow
                          label={t('translation|Restarts')}
                          value={String(cs.restartCount)}
                        />
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </>
        )}
      </Popover>
    </>
  );
}

function ContainerDetailRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Box
      component="li"
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, fontSize: '0.8125rem' }}
    >
      <Box component="span" sx={{ color: 'text.secondary', mr: 0.25 }}>
        •
      </Box>
      <Typography
        component="span"
        variant="body2"
        sx={{ color: 'text.secondary', fontWeight: 600, minWidth: 62 }}
      >
        {label}:
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={{ color: valueColor || 'text.primary', wordBreak: 'break-word', flex: 1 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export interface PodListProps {
  pods: Pod[] | null;
  metrics: PodMetrics[] | null;
  hideColumns?: ('namespace' | 'restarts')[];
  reflectTableInURL?: SimpleTableProps['reflectInURL'];
  noNamespaceFilter?: boolean;
  errors?: ApiError[] | null;
  hideCreateButton?: boolean;
  enableRowActions?: boolean;
  enableRowSelection?: boolean;
}

export function PodListRenderer(props: PodListProps) {
  const {
    pods,
    metrics,
    hideColumns = [],
    reflectTableInURL = 'pods',
    noNamespaceFilter,
    errors,
    hideCreateButton,
    enableRowActions,
    enableRowSelection,
  } = props;
  const { t } = useTranslation(['glossary', 'translation']);

  const metricsMap = React.useMemo(() => {
    const map = new Map<string, PodMetrics>();
    (metrics || []).forEach(m => {
      map.set(`${m.cluster}/${m.getNamespace()}/${m.getName()}`, m);
    });
    return map;
  }, [metrics]);

  const getCpuUsage = (pod: Pod) => {
    const metric = metricsMap.get(`${pod.cluster}/${pod.getNamespace()}/${pod.getName()}`);
    if (!metric) return;

    return (
      metric?.jsonData.containers.map(it => parseCpu(it.usage.cpu)).reduce((a, b) => a + b, 0) ?? 0
    );
  };

  const getMemoryUsage = (pod: Pod) => {
    const metric = metricsMap.get(`${pod.cluster}/${pod.getNamespace()}/${pod.getName()}`);

    if (!metric) return;

    return (
      metric?.jsonData.containers.map(it => parseRam(it.usage.memory)).reduce((a, b) => a + b, 0) ??
      0
    );
  };

  return (
    <ResourceListView
      title={t('Pods')}
      headerProps={{
        noNamespaceFilter,
        titleSideActions: hideCreateButton
          ? []
          : [<CreateResourceButton resourceClass={Pod} key="create-pod-button" />],
      }}
      hideColumns={hideColumns}
      errors={errors}
      columns={[
        'name',
        'namespace',
        'cluster',
        {
          label: t('Restarts'),
          gridTemplate: 'min-content',
          disableFiltering: true,
          getValue: pod => {
            const { restarts, lastRestartDate } = pod.getDetailedStatus();
            return lastRestartDate.getTime() !== 0
              ? t('{{ restarts }} ({{ abbrevTime }} ago)', {
                  restarts: restarts,
                  abbrevTime: timeAgo(lastRestartDate, { format: 'mini' }),
                })
              : restarts;
          },
        },
        {
          id: 'ready',
          gridTemplate: 'min-content',
          label: t('translation|Ready'),
          disableFiltering: true,
          getValue: pod => {
            const podRow = pod.getDetailedStatus();
            return `${podRow.readyContainers}/${podRow.totalContainers}`;
          },
        },
        {
          id: 'status',
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          label: t('translation|Status'),
          // Human-readable label (e.g. "Not Ready") so the filter dropdown and
          // sort key match what the pill shows, not an internal joined string.
          getValue: pod => getPodStatusDisplay(pod, t).label,
          render: pod => <PodStatusChip pod={pod} t={t} />,
        },
        ...(metrics?.length
          ? [
              {
                id: 'cpu',
                label: t('CPU'),
                gridTemplate: 'min-content',
                disableFiltering: true,
                render: (pod: Pod) => {
                  const cpu = getCpuUsage(pod);
                  if (cpu === undefined) return;

                  const { value: aValue, unit: aUnit } = unparseCpu(String(cpu));

                  const request = pod.spec.containers
                    .map(c => parseCpu(c.resources?.requests?.cpu || '0'))
                    .reduce((a, b) => a + b, 0);

                  const limit = pod.spec.containers
                    .map(c => parseCpu(c.resources?.limits?.cpu || '0'))
                    .reduce((a, b) => a + b, 0);

                  const tooltipLines = [];
                  if (request > 0) {
                    const { value: rValue, unit: rUnit } = unparseCpu(String(request));
                    const percentOfRequest = ((cpu / request) * 100).toFixed(1);
                    tooltipLines.push(
                      t('Request') +
                        `: ${percentOfRequest}% (${aValue} ${aUnit}/${rValue} ${rUnit})`
                    );
                  }
                  if (limit > 0) {
                    const { value: lValue, unit: lUnit } = unparseCpu(String(limit));
                    const percentOfLimit = ((cpu / limit) * 100).toFixed(1);
                    tooltipLines.push(
                      t('Limit') + `: ${percentOfLimit}% (${aValue} ${aUnit}/${lValue} ${lUnit})`
                    );
                  }

                  return (
                    <Box display="flex" alignItems="center" width="100%">
                      <span style={{ whiteSpace: 'nowrap' }}>{`${aValue} ${aUnit}`}</span>
                      {tooltipLines.length > 0 && (
                        <Box component="span" sx={{ display: 'inline-flex', ml: 'auto' }}>
                          <TooltipIcon>
                            <span style={{ whiteSpace: 'pre-line' }}>
                              {tooltipLines.join('\n')}
                            </span>
                          </TooltipIcon>
                        </Box>
                      )}
                    </Box>
                  );
                },
                getValue: (pod: Pod) => getCpuUsage(pod) ?? 0,
              },
              {
                id: 'memory',
                label: t('Memory'),
                gridTemplate: 'min-content',
                disableFiltering: true,
                render: (pod: Pod) => {
                  const memory = getMemoryUsage(pod);
                  if (memory === undefined) return;
                  const { value: aValue, unit: aUnit } = unparseRam(memory);

                  const request = pod.spec.containers
                    .map(c => parseRam(c.resources?.requests?.memory || '0'))
                    .reduce((a, b) => a + b, 0);

                  const limit = pod.spec.containers
                    .map(c => parseRam(c.resources?.limits?.memory || '0'))
                    .reduce((a, b) => a + b, 0);

                  const tooltipLines = [];
                  if (request > 0) {
                    const { value: rValue, unit: rUnit } = unparseRam(request);
                    const percentOfRequest = ((memory / request) * 100).toFixed(1);
                    tooltipLines.push(
                      t('Request') +
                        `: ${percentOfRequest}% (${aValue} ${aUnit}/${rValue} ${rUnit})`
                    );
                  }
                  if (limit > 0) {
                    const { value: lValue, unit: lUnit } = unparseRam(limit);
                    const percentOfLimit = ((memory / limit) * 100).toFixed(1);
                    tooltipLines.push(
                      t('Limit') + `: ${percentOfLimit}% (${aValue} ${aUnit}/${lValue} ${lUnit})`
                    );
                  }

                  return (
                    <Box display="flex" alignItems="center" width="100%">
                      <span style={{ whiteSpace: 'nowrap' }}>{`${aValue} ${aUnit}`}</span>
                      {tooltipLines.length > 0 && (
                        <Box component="span" sx={{ display: 'inline-flex', ml: 'auto' }}>
                          <TooltipIcon>
                            <span style={{ whiteSpace: 'pre-line' }}>
                              {tooltipLines.join('\n')}
                            </span>
                          </TooltipIcon>
                        </Box>
                      )}
                    </Box>
                  );
                },
                getValue: (pod: Pod) => getMemoryUsage(pod) ?? 0,
              },
            ]
          : []),
        {
          id: 'ip',
          gridTemplate: 'min-content',
          label: t('glossary|IP'),
          getValue: pod => pod.status?.podIP ?? '',
        },
        {
          id: 'node',
          label: t('glossary|Node'),
          gridTemplate: 'auto',
          filterVariant: 'multi-select',
          getValue: pod => pod?.spec?.nodeName,
          render: pod =>
            pod?.spec?.nodeName && (
              <Link
                routeName="node"
                params={{ name: pod.spec.nodeName }}
                activeCluster={pod.cluster}
                tooltip
              >
                {pod.spec.nodeName}
              </Link>
            ),
        },
        {
          id: 'nominatedNode',
          label: t('glossary|Nominated Node'),
          getValue: pod => pod?.status?.nominatedNodeName,
          render: pod =>
            !!pod?.status?.nominatedNodeName && (
              <Link
                routeName="node"
                params={{ name: pod?.status?.nominatedNodeName }}
                activeCluster={pod.cluster}
                tooltip
              >
                {pod?.status?.nominatedNodeName}
              </Link>
            ),
          show: false,
        },
        {
          id: 'readinessGates',
          label: t('glossary|Readiness Gates'),
          disableFiltering: true,
          getValue: pod => {
            const readinessGatesStatus = getReadinessGatesStatus(pod);
            const total = Object.keys(readinessGatesStatus).length;

            if (total === 0) {
              return '';
            }

            const statusTrueCount = Object.values(readinessGatesStatus).filter(
              status => status === 'True'
            ).length;

            return statusTrueCount;
          },
          render: pod => {
            const readinessGatesStatus = getReadinessGatesStatus(pod);
            const total = Object.keys(readinessGatesStatus).length;

            if (total === 0) {
              return null;
            }

            const statusTrueCount = Object.values(readinessGatesStatus).filter(
              status => status === 'True'
            ).length;

            return (
              <LightTooltip
                title={Object.keys(readinessGatesStatus)
                  .map(conditionType => `${conditionType}: ${readinessGatesStatus[conditionType]}`)
                  .join('\n')}
                interactive
              >
                <span>{`${statusTrueCount}/${total}`}</span>
              </LightTooltip>
            );
          },
          sort: (p1: Pod, p2: Pod) => {
            const readinessGatesStatus1 = getReadinessGatesStatus(p1);
            const readinessGatesStatus2 = getReadinessGatesStatus(p2);
            const total1 = Object.keys(readinessGatesStatus1).length;
            const total2 = Object.keys(readinessGatesStatus2).length;

            if (total1 !== total2) {
              return total1 - total2;
            }

            const statusTrueCount1 = Object.values(readinessGatesStatus1).filter(
              status => status === 'True'
            ).length;
            const statusTrueCount2 = Object.values(readinessGatesStatus2).filter(
              status => status === 'True'
            ).length;

            return statusTrueCount1 - statusTrueCount2;
          },
          show: false,
        },
        'labels',
        'age',
      ]}
      data={pods}
      reflectInURL={reflectTableInURL}
      id="headlamp-pods"
      enableRowActions={enableRowActions}
      enableRowSelection={enableRowSelection}
    />
  );
}

export default function PodList() {
  const { items, errors } = Pod.useList({ namespace: useNamespaces() });
  const { items: podMetrics } = PodMetrics.useList({
    namespace: useNamespaces(),
    refetchInterval: METRIC_REFETCH_INTERVAL_MS,
  });

  const dispatchHeadlampEvent = useEventCallback(HeadlampEventType.LIST_VIEW);

  React.useEffect(() => {
    dispatchHeadlampEvent({
      resources: items ?? [],
      resourceKind: 'Pod',
      error: errors?.[0] || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, errors]);

  return <PodListRenderer pods={items} errors={errors} metrics={podMetrics} reflectTableInURL />;
}
