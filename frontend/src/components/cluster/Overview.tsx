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

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import { Theme, useTheme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import CronJob from '../../lib/k8s/cronJob';
import DaemonSet from '../../lib/k8s/daemonSet';
import Deployment from '../../lib/k8s/deployment';
import Event from '../../lib/k8s/event';
import Job from '../../lib/k8s/job';
import JobSet from '../../lib/k8s/jobSet';
import Namespace from '../../lib/k8s/namespace';
import Node from '../../lib/k8s/node';
import Pod from '../../lib/k8s/pod';
import { PodMetrics } from '../../lib/k8s/PodMetrics';
import ReplicaSet from '../../lib/k8s/replicaSet';
import ResourceQuota from '../../lib/k8s/resourceQuota';
import StatefulSet from '../../lib/k8s/statefulSet';
import type { Workload } from '../../lib/k8s/Workload';
import { parseCpu, parseRam, TO_GB, TO_ONE_CPU } from '../../lib/units';
import { useFilterFunc } from '../../lib/util';
import { getReadyReplicas, getTotalReplicas } from '../../lib/util';
import { useNamespaces } from '../../redux/filterSlice';
import { useTypedSelector } from '../../redux/hooks';
import { OverviewChart } from '../../redux/overviewChartsSlice';
import EventsLifetimeInfo from '../common/EventsLifetimeInfo';
import { DateLabel } from '../common/Label';
import { StatusLabel } from '../common/Label';
import Link from '../common/Link';
import { NamespacesAutocomplete } from '../common/NamespacesAutocomplete';
import { PageGrid } from '../common/Resource';
import ResourceListView from '../common/Resource/ResourceListView';
import { SectionBox } from '../common/SectionBox';
import ShowHideLabel from '../common/ShowHideLabel';
import TileChart from '../common/TileChart';
import { LightTooltip } from '../common/Tooltip';
import {
  CpuCircularChart,
  MemoryCircularChart,
  NodesStatusCircleChart,
  PodsStatusCircleChart,
} from './Charts';
import { ClusterGroupErrorMessage } from './ClusterGroupErrorMessage';

const OVERVIEW_REFETCH_INTERVAL_MS = 60_000;

export default function Overview() {
  const namespaces = useNamespaces();
  const hasNamespaceSelection = namespaces.length > 0;
  const { t } = useTranslation(['translation']);

  return (
    <PageGrid>
      <SectionBox
        title={t('translation|Overview')}
        py={2}
        mt={[4, 0, 0]}
        headerProps={{
          actions: [<NamespacesAutocomplete key="overview-namespaces-filter" width="20rem" />],
        }}
      >
        {hasNamespaceSelection ? (
          <NamespaceScopedOverviewCharts namespaces={namespaces} />
        ) : (
          <ClusterScopedOverviewCharts />
        )}
      </SectionBox>
      <EventsSection namespaces={namespaces} />
    </PageGrid>
  );
}

function ClusterScopedOverviewCharts() {
  // The overview only needs periodic snapshots for aggregate charts. Avoid long-lived
  // watches here because large clusters can stream enough events to exhaust the tab.
  const [pods] = Pod.useList({ refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS });
  const [nodes] = Node.useList({ refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS });
  const [nodeMetrics, metricsError] = Node.useMetrics();
  const chartProcessors = useTypedSelector(state => state.overviewCharts.processors);

  const noPermissions = metricsError?.status === 403;
  const noMetrics = metricsError !== null && !noPermissions;

  // Process the default charts through any registered processors.
  const defaultCharts: OverviewChart[] = [
    {
      id: 'cpu',
      component: () => (
        <CpuCircularChart items={nodes} itemsMetrics={nodeMetrics} noMetrics={noMetrics} />
      ),
    },
    {
      id: 'memory',
      component: () => (
        <MemoryCircularChart items={nodes} itemsMetrics={nodeMetrics} noMetrics={noMetrics} />
      ),
    },
    {
      id: 'pods',
      component: () => <PodsStatusCircleChart items={pods} />,
    },
    {
      id: 'nodes',
      component: () => <NodesStatusCircleChart items={nodes} />,
    },
  ];
  const charts = chartProcessors.reduce(
    (currentCharts, p) => p.processor(currentCharts),
    defaultCharts
  );

  if (noPermissions) {
    return <ClusterGroupErrorMessage errors={[metricsError]} />;
  }

  return (
    <Grid container justifyContent="flex-start" alignItems="stretch" spacing={4}>
      {charts.map(chart => (
        <Grid key={chart.id} item xs sx={{ maxWidth: '300px' }}>
          <chart.component />
        </Grid>
      ))}
    </Grid>
  );
}

function NamespaceScopedOverviewCharts({ namespaces }: { namespaces: string[] }) {
  const { t } = useTranslation(['translation', 'glossary']);

  const [allNamespaces] = Namespace.useList({ refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS });
  const [pods] = Pod.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  const { items: podMetrics, error: podMetricsError } = PodMetrics.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  const [resourceQuotas] = ResourceQuota.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  const [deployments] = Deployment.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [statefulSets] = StatefulSet.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [daemonSets] = DaemonSet.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [replicaSets] = ReplicaSet.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [jobs] = Job.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [cronJobs] = CronJob.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });
  const [jobSets] = JobSet.useList({
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  const selectedNamespaces = React.useMemo(() => {
    if (!allNamespaces) {
      return null;
    }

    const selected = new Set(namespaces);
    return allNamespaces.filter(ns => selected.has(ns.metadata.name));
  }, [allNamespaces, namespaces]);

  const activeNamespacesCount = React.useMemo(
    () => selectedNamespaces?.filter(ns => ns.status?.phase === 'Active').length ?? null,
    [selectedNamespaces]
  );

  const cpuUsage = React.useMemo(() => {
    if (!podMetrics) {
      return null;
    }

    return podMetrics.reduce((sum, metric) => {
      const podCpu = (metric.jsonData.containers || []).reduce(
        (podSum, container) => podSum + parseCpu(container.usage?.cpu || '0') / TO_ONE_CPU,
        0
      );
      return sum + podCpu;
    }, 0);
  }, [podMetrics]);

  const memoryUsageGB = React.useMemo(() => {
    if (!podMetrics) {
      return null;
    }

    return podMetrics.reduce((sum, metric) => {
      const podMemory = (metric.jsonData.containers || []).reduce(
        (podSum, container) => podSum + parseRam(container.usage?.memory || '0') / TO_GB,
        0
      );
      return sum + podMemory;
    }, 0);
  }, [podMetrics]);

  const quotas = React.useMemo(() => getQuotaTotals(resourceQuotas), [resourceQuotas]);
  const workloadCounts = React.useMemo(
    () =>
      getWorkloadCounts({
        deployments,
        statefulSets,
        daemonSets,
        replicaSets,
        jobs,
        cronJobs,
        jobSets,
      }),
    [deployments, statefulSets, daemonSets, replicaSets, jobs, cronJobs, jobSets]
  );

  return (
    <Grid container justifyContent="flex-start" alignItems="stretch" spacing={4}>
      <Grid item xs sx={{ maxWidth: '300px' }}>
        <TileChart
          title={t('glossary|Namespaces')}
          data={
            selectedNamespaces === null
              ? []
              : [
                  {
                    name: 'active',
                    value: activeNamespacesCount ?? 0,
                  },
                ]
          }
          total={selectedNamespaces === null ? -1 : selectedNamespaces.length}
          label={
            selectedNamespaces === null
              ? '…'
              : `${
                  selectedNamespaces.length === 0
                    ? 0
                    : (((activeNamespacesCount || 0) / selectedNamespaces.length) * 100).toFixed(1)
                } %`
          }
          legend={
            selectedNamespaces === null
              ? ''
              : t('translation|{{ count }} Selected Namespaces', {
                  count: selectedNamespaces.length,
                })
          }
          extraContent={
            activeNamespacesCount === null
              ? null
              : t('translation|{{ count }} Active Namespaces', { count: activeNamespacesCount })
          }
        />
      </Grid>

      <Grid item xs sx={{ maxWidth: '300px' }}>
        <NamespaceScopedUsageChart
          title={t('translation|CPU Usage')}
          usage={cpuUsage}
          quota={quotas.cpu}
          valueFormatter={value => t('translation|{{ value }} units', { value: value.toFixed(2) })}
          noMetrics={Boolean(podMetricsError)}
        />
      </Grid>

      <Grid item xs sx={{ maxWidth: '300px' }}>
        <NamespaceScopedUsageChart
          title={t('translation|Memory Usage')}
          usage={memoryUsageGB}
          quota={quotas.memory}
          valueFormatter={value => `${value.toFixed(2)} GB`}
          noMetrics={Boolean(podMetricsError)}
        />
      </Grid>

      <Grid item xs sx={{ maxWidth: '300px' }}>
        <PodsStatusCircleChart items={pods} />
      </Grid>

      <Grid item xs={12}>
        <WorkloadsBreakdownCard counts={workloadCounts} />
      </Grid>
    </Grid>
  );
}

function NamespaceScopedUsageChart(props: {
  title: string;
  usage: number | null;
  quota: number | null;
  noMetrics: boolean;
  valueFormatter: (value: number) => string;
}) {
  const { t } = useTranslation(['translation']);
  const { title, usage, quota, noMetrics, valueFormatter } = props;

  const hasQuota = quota !== null && quota > 0;
  const label =
    usage === null
      ? '…'
      : hasQuota
      ? `${((usage / (quota || 1)) * 100).toFixed(1)} %`
      : t('translation|Quota not configured');
  const legend =
    usage === null
      ? ''
      : hasQuota
      ? `${valueFormatter(usage)} / ${valueFormatter(quota)}`
      : valueFormatter(usage);

  return (
    <TileChart
      title={title}
      data={usage !== null && hasQuota ? [{ name: 'used', value: usage }] : null}
      total={usage !== null && hasQuota ? quota : -1}
      label={label}
      legend={legend}
      infoTooltip={
        noMetrics ? t('translation|Install the metrics-server to get usage data.') : null
      }
    />
  );
}

function getWorkloadCounts(workloads: {
  deployments: Workload[] | null;
  statefulSets: Workload[] | null;
  daemonSets: Workload[] | null;
  replicaSets: Workload[] | null;
  jobs: Job[] | null;
  cronJobs: CronJob[] | null;
  jobSets: JobSet[] | null;
}): WorkloadCounts {
  const { deployments, statefulSets, daemonSets, replicaSets, jobs, cronJobs, jobSets } = workloads;

  // Core kinds (must be present to trust the total). JobSet is treated as
  // optional because its CRD is often absent; a null there just hides the row.
  const coreLoading =
    deployments === null ||
    statefulSets === null ||
    daemonSets === null ||
    replicaSets === null ||
    jobs === null ||
    cronJobs === null;

  if (coreLoading) {
    return { loading: true, total: null, healthy: 0, failed: 0, rows: [] };
  }

  const ownedByDeployment = (rs: Workload) =>
    (rs.jsonData?.metadata?.ownerReferences || []).some(o => o?.kind === 'Deployment');
  const ownedByCronJob = (job: Job) =>
    (job.jsonData?.metadata?.ownerReferences || []).some(o => o?.kind === 'CronJob');

  const ownedReplicaSetCount = (replicaSets || []).filter(ownedByDeployment).length;
  const ownedJobCount = (jobs || []).filter(ownedByCronJob).length;
  const standaloneReplicaSets = (replicaSets || []).filter(rs => !ownedByDeployment(rs));
  const standaloneJobs = (jobs || []).filter(j => !ownedByCronJob(j));

  // Replica-based rows share the same health rule: ready === total → healthy,
  // otherwise the row is "not fully ready". We treat non-ready replica-based
  // rows as progressing here (Phase 3 will split rollout-stuck as failed).
  const replicaHealth = (items: Workload[]) => {
    let healthy = 0;
    for (const item of items) {
      if (getReadyReplicas(item) === getTotalReplicas(item)) {
        healthy += 1;
      }
    }
    return { count: items.length, healthy, failed: 0 };
  };

  const controllerHealth = <T extends { getHealth(): string }>(items: T[]) => {
    let healthy = 0;
    let failed = 0;
    for (const item of items) {
      const h = item.getHealth();
      if (h === 'healthy') healthy += 1;
      else if (h === 'failed') failed += 1;
    }
    return { count: items.length, healthy, failed };
  };

  const depH = replicaHealth(deployments || []);
  const ssetH = replicaHealth(statefulSets || []);
  const dsH = replicaHealth(daemonSets || []);
  const rsH = replicaHealth(replicaSets || []);
  const jobH = controllerHealth(jobs || []);
  const cronH = controllerHealth(cronJobs || []);
  const jsH = jobSets === null ? null : controllerHealth(jobSets);

  // Deduped stats — evaluated on standalone-only items so ownership never
  // consumes the wrong health/failed budget.
  const standaloneRsH = replicaHealth(standaloneReplicaSets);
  const standaloneJobH = controllerHealth(standaloneJobs);

  const rows: WorkloadRow[] = [
    { kind: 'Deployments', count: depH.count, ready: depH.healthy, failed: depH.failed },
    { kind: 'Stateful Sets', count: ssetH.count, ready: ssetH.healthy, failed: ssetH.failed },
    { kind: 'Daemon Sets', count: dsH.count, ready: dsH.healthy, failed: dsH.failed },
    {
      kind: 'Replica Sets',
      count: rsH.count,
      ready: rsH.healthy,
      failed: rsH.failed,
      ownedBy: ownedReplicaSetCount === rsH.count && rsH.count > 0 ? 'Deployments' : undefined,
    },
    {
      kind: 'Jobs',
      count: jobH.count,
      ready: jobH.healthy,
      failed: jobH.failed,
      ownedBy: ownedJobCount === jobH.count && jobH.count > 0 ? 'CronJobs' : undefined,
    },
    { kind: 'CronJobs', count: cronH.count, ready: cronH.healthy, failed: cronH.failed },
    jsH === null
      ? { kind: 'Job Sets', count: 0, absent: true }
      : { kind: 'Job Sets', count: jsH.count, ready: jsH.healthy, failed: jsH.failed },
  ];

  // Total = distinct controllers only. Owned ReplicaSets and Jobs are rolled
  // up under their parents (Deployment / CronJob).
  const total =
    depH.count +
    ssetH.count +
    dsH.count +
    standaloneRsH.count +
    standaloneJobH.count +
    cronH.count +
    (jsH?.count ?? 0);

  const healthy =
    depH.healthy +
    ssetH.healthy +
    dsH.healthy +
    standaloneRsH.healthy +
    standaloneJobH.healthy +
    cronH.healthy +
    (jsH?.healthy ?? 0);

  const failed =
    depH.failed +
    ssetH.failed +
    dsH.failed +
    standaloneRsH.failed +
    standaloneJobH.failed +
    cronH.failed +
    (jsH?.failed ?? 0);

  return { loading: false, total, healthy, failed, rows };
}

export interface WorkloadRow {
  kind: string;
  /** Raw k8s count for this kind, matches the sidebar page. */
  count: number;
  /** Ready count; omitted for rows where count is 0 or CRD absent. */
  ready?: number;
  failed?: number;
  /** Present when every item is owned by another controller (mirror row). */
  ownedBy?: string;
  /** True when the CRD is not installed on the cluster. */
  absent?: boolean;
}

export interface WorkloadCounts {
  loading: boolean;
  /** Deduped controller total (excludes RS owned by Deployment, Jobs owned by CronJob). */
  total: number | null;
  healthy: number;
  failed: number;
  rows: WorkloadRow[];
}

function WorkloadsBreakdownCard({ counts }: { counts: WorkloadCounts }) {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();

  if (counts.loading || counts.total === null) {
    return (
      <Paper
        variant="outlined"
        sx={{
          background: theme.palette.background.muted,
          padding: theme.spacing(2, 2.5),
          maxWidth: '440px',
          margin: '0 auto',
        }}
      >
        <Typography sx={{ fontSize: theme.typography.pxToRem(16), fontWeight: 600 }}>
          {t('glossary|Workloads')}
        </Typography>
        <Typography sx={{ fontSize: theme.typography.pxToRem(14) }}>…</Typography>
      </Paper>
    );
  }

  const failedColor = theme.palette.error.main;
  const warningColor = theme.palette.warning.main;
  const mutedColor = theme.palette.text.disabled;
  const notReady = counts.total - counts.healthy - counts.failed;

  return (
    <Paper
      variant="outlined"
      sx={{
        background: theme.palette.background.muted,
        padding: theme.spacing(2, 2.5),
        maxWidth: '440px',
        margin: '0 auto',
      }}
    >
      <Typography sx={{ fontSize: theme.typography.pxToRem(16), fontWeight: 600 }} gutterBottom>
        {t('glossary|Workloads')}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: theme.typography.pxToRem(20), fontWeight: 700 }}>
          {t('translation|{{ healthy }} / {{ total }} Ready', {
            healthy: counts.healthy,
            total: counts.total,
          })}
        </Typography>
        {counts.failed > 0 && (
          <Typography
            sx={{ fontSize: theme.typography.pxToRem(14), color: failedColor, fontWeight: 600 }}
          >
            {t('translation|· {{ count }} Failed', { count: counts.failed })}
          </Typography>
        )}
        {counts.failed === 0 && notReady > 0 && (
          <Typography
            sx={{ fontSize: theme.typography.pxToRem(14), color: warningColor, fontWeight: 600 }}
          >
            {t('translation|· {{ count }} Not Ready', { count: notReady })}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 0.35, columnGap: 1.5 }}>
        {counts.rows.map(row => {
          const isEmpty = row.absent || row.count === 0;
          const isOwned = Boolean(row.ownedBy);
          const rowColor = isEmpty || isOwned ? mutedColor : theme.palette.text.primary;
          const failedInRow = row.failed ?? 0;
          const readyInRow = row.ready ?? 0;
          return (
            <React.Fragment key={row.kind}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  sx={{ color: rowColor, fontWeight: 500, whiteSpace: 'nowrap' }}
                >
                  {row.kind}
                </Typography>
                {isOwned && (
                  <Typography
                    variant="caption"
                    sx={{ color: mutedColor, fontStyle: 'italic', whiteSpace: 'nowrap' }}
                  >
                    {t('translation|· owned by {{ parent }}', { parent: row.ownedBy })}
                  </Typography>
                )}
                {row.absent && (
                  <Typography variant="caption" sx={{ color: mutedColor, fontStyle: 'italic' }}>
                    {t('translation|· CRD not installed')}
                  </Typography>
                )}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  color: failedInRow > 0 ? failedColor : rowColor,
                  fontWeight: failedInRow > 0 ? 700 : 500,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {isEmpty
                  ? '—'
                  : isOwned
                  ? row.count
                  : failedInRow > 0
                  ? t('translation|{{ ready }} / {{ count }} · {{ failed }} failed', {
                      ready: readyInRow,
                      count: row.count,
                      failed: failedInRow,
                    })
                  : `${readyInRow} / ${row.count}`}
              </Typography>
            </React.Fragment>
          );
        })}
      </Box>
      <Typography variant="caption" sx={{ color: mutedColor, display: 'block', mt: 1.25 }}>
        {t(
          'translation|Total counts distinct controllers (owned Replica Sets and Jobs are not double-counted).'
        )}
      </Typography>
    </Paper>
  );
}

function getQuotaTotals(resourceQuotas: ResourceQuota[] | null) {
  if (!resourceQuotas) {
    return { cpu: null as number | null, memory: null as number | null };
  }

  const cpu = getBestQuotaTotal(resourceQuotas, [
    { key: 'limits.cpu', parse: (value: string) => parseCpu(value) / TO_ONE_CPU },
    { key: 'requests.cpu', parse: (value: string) => parseCpu(value) / TO_ONE_CPU },
    { key: 'cpu', parse: (value: string) => parseCpu(value) / TO_ONE_CPU },
  ]);

  const memory = getBestQuotaTotal(resourceQuotas, [
    { key: 'limits.memory', parse: (value: string) => parseRam(value) / TO_GB },
    { key: 'requests.memory', parse: (value: string) => parseRam(value) / TO_GB },
    { key: 'memory', parse: (value: string) => parseRam(value) / TO_GB },
  ]);

  return {
    cpu: cpu > 0 ? cpu : null,
    memory: memory > 0 ? memory : null,
  };
}

function getBestQuotaTotal(
  resourceQuotas: ResourceQuota[],
  candidates: { key: string; parse: (value: string) => number }[]
) {
  for (const candidate of candidates) {
    const total = resourceQuotas.reduce((sum, quota) => {
      const hard = quota.status?.hard || quota.spec?.hard || {};
      const rawValue = hard[candidate.key];
      if (!rawValue) {
        return sum;
      }

      return sum + candidate.parse(rawValue);
    }, 0);

    if (total > 0) {
      return total;
    }
  }

  return 0;
}

function EventsSection({ namespaces }: { namespaces: string[] }) {
  const EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY = 'EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY';
  const EVENT_WARNING_SWITCH_DEFAULT = true;
  const { t } = useTranslation(['translation', 'glossary']);
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const eventsFilter = queryParams.get('eventsFilter');
  const filterFunc = useFilterFunc<Event>(['.jsonData.involvedObject.kind']);
  const [isWarningEventSwitchChecked, setIsWarningEventSwitchChecked] = React.useState(
    Boolean(
      JSON.parse(
        localStorage.getItem(EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY) ||
          EVENT_WARNING_SWITCH_DEFAULT.toString()
      )
    )
  );
  const { items: events, errors: eventsErrors } = Event.useList({
    limit: Event.maxLimit,
    namespace: namespaces,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  const warningActionFilterFunc = (event: Event, search?: string) => {
    if (!filterFunc(event, search)) {
      return false;
    }

    if (isWarningEventSwitchChecked) {
      return event.jsonData.type === 'Warning';
    }

    // Return true because if we reach this point, it means we're only filtering by
    // the default filterFunc (and its result was 'true').
    return true;
  };

  const numWarnings = React.useMemo(
    () => events?.filter(e => e.type === 'Warning').length ?? '?',
    [events]
  );

  function makeStatusLabel(event: Event) {
    return (
      <StatusLabel
        status={event.type === 'Normal' ? '' : 'warning'}
        sx={(theme: Theme) => ({
          [theme.breakpoints.up('md')]: {
            display: 'unset',
          },
        })}
      >
        {event.reason}
      </StatusLabel>
    );
  }

  function makeObjectLink(event: Event) {
    const obj = event.involvedObjectInstance;
    if (!!obj) {
      return <Link kubeObject={obj} />;
    }

    return event.involvedObject.name;
  }

  return (
    <ResourceListView
      title={t('glossary|Events')}
      headerProps={{
        noNamespaceFilter: true,
        titleSideActions: [
          <EventsLifetimeInfo key="event-lifetime-info" />,
          <FormControlLabel
            checked={isWarningEventSwitchChecked}
            label={t('Only warnings ({{ numWarnings }})', { numWarnings })}
            control={<Switch color="primary" />}
            onChange={(event, checked) => {
              localStorage.setItem(EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY, checked.toString());
              setIsWarningEventSwitchChecked(checked);
            }}
            key="warning-toggle"
          />,
        ],
      }}
      defaultGlobalFilter={eventsFilter ?? undefined}
      data={events}
      errors={eventsErrors}
      columns={[
        {
          id: 'type',
          label: t('Type'),
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => event.involvedObject.kind,
        },
        {
          id: 'name',
          label: t('Name'),
          getValue: event => event.involvedObjectInstance?.getName() ?? event.involvedObject.name,
          render: event => makeObjectLink(event),
          gridTemplate: 'auto',
        },
        'namespace',
        'cluster',
        {
          id: 'node',
          label: t('glossary|Node'),
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => event.source?.host ?? '',
        },
        {
          id: 'reason',
          label: t('Reason'),
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => event.reason,
          render: event => (
            <LightTooltip title={event.reason} interactive>
              {makeStatusLabel(event)}
            </LightTooltip>
          ),
        },
        {
          id: 'message',
          label: t('Message'),
          getValue: event => event.message ?? '',
          render: event => (
            <ShowHideLabel labelId={event.metadata?.uid || ''}>{event.message || ''}</ShowHideLabel>
          ),
          gridTemplate: 'auto',
        },
        {
          id: 'count',
          label: t('Count'),
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => event.count ?? null,
          render: event => event.count ?? '-',
        },
        {
          id: 'last-seen',
          label: t('Last Seen'),
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => -new Date(event.lastOccurrence).getTime(),
          render: event => <DateLabel date={event.lastOccurrence} format="mini" />,
        },
      ]}
      filterFunction={warningActionFilterFunc}
      defaultSortingColumn={{ id: 'last-seen', desc: false }}
      id="headlamp-cluster.overview.events"
    />
  );
}
