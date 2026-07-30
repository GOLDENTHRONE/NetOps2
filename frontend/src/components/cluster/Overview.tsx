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

import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import { Theme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useCluster } from '../../lib/k8s';
import Event from '../../lib/k8s/event';
import Node from '../../lib/k8s/node';
import Pod from '../../lib/k8s/pod';
import {
  ClusterOverviewStats,
  useClusterOverviewStats,
} from '../../lib/k8s/useClusterOverviewStats';
import { TO_GB, TO_ONE_CPU } from '../../lib/units';
import { useFilterFunc } from '../../lib/util';
import { useNamespaces } from '../../redux/filterSlice';
import { useTypedSelector } from '../../redux/hooks';
import { OverviewChart } from '../../redux/overviewChartsSlice';
import EventsLifetimeInfo from '../common/EventsLifetimeInfo';
import { DateLabel } from '../common/Label';
import { StatusLabel } from '../common/Label';
import Link from '../common/Link';
import { PageGrid } from '../common/Resource';
import ResourceListView from '../common/Resource/ResourceListView';
import { SectionBox } from '../common/SectionBox';
import ShowHideLabel from '../common/ShowHideLabel';
import { LightTooltip } from '../common/Tooltip';
import {
  CpuCircularChart,
  MemoryCircularChart,
  NodesStatusCircleChart,
  PodsStatusCircleChart,
} from './Charts';
import { ClusterGroupErrorMessage } from './ClusterGroupErrorMessage';

const OVERVIEW_REFETCH_INTERVAL_MS = 60_000;

/**
 * Cluster Overview page.
 *
 * Prefers the backend `overviewstats` aggregate endpoint (see
 * `useClusterOverviewStats`) to avoid fetching full Pod/Node/Metrics lists on
 * large clusters. Falls back to the legacy client-side aggregation path only
 * when the backend endpoint is unavailable or errors (older backends,
 * misconfigured clusters, etc.).
 */
export default function Overview() {
  const cluster = useCluster();
  const stats = useClusterOverviewStats(cluster);

  // `useClusterOverviewStats` uses `retry: false`, so a single failed request
  // (e.g. backend returns 404 because the endpoint is not deployed, or 5xx
  // because the watcher failed to start) surfaces immediately as `isError`.
  // In that case we render the legacy path which does client-side aggregation.
  if (stats.isError) {
    return <OverviewLegacy />;
  }

  return <OverviewAggregate stats={stats.data} />;
}

/**
 * Fast path: renders charts from the backend-provided aggregate snapshot.
 * Deliberately does not call `Pod.useList` / `Node.useList` / `Node.useMetrics`,
 * so on large clusters the Overview page pays only the ~260 byte
 * `/overview-stats` request instead of hauling megabytes of pod/node JSON.
 */
function OverviewAggregate({ stats }: { stats: ClusterOverviewStats | undefined }) {
  const { t } = useTranslation(['translation']);
  const chartProcessors = useTypedSelector(state => state.overviewCharts.processors);

  const synced = stats?.synced === true;
  const noMetrics = synced && stats?.metricsAvailable === false;

  const podAggregate = synced ? { ready: stats!.pods.ready, total: stats!.pods.total } : undefined;
  const nodeAggregate = synced
    ? { ready: stats!.nodes.ready, total: stats!.nodes.total }
    : undefined;

  // Backend returns CPU in nanocores and memory in bytes. Convert to the same
  // "CPU units" and GB scales the legacy `CpuCircularChart` / `MemoryCircularChart`
  // getters produce so the display formatting is identical.
  const cpuAggregate =
    synced && stats!.metricsAvailable
      ? { used: stats!.cpu.used / TO_ONE_CPU, capacity: stats!.cpu.capacity / TO_ONE_CPU }
      : synced
      ? { used: 0, capacity: stats!.cpu.capacity / TO_ONE_CPU }
      : undefined;
  const memoryAggregate =
    synced && stats!.metricsAvailable
      ? { used: stats!.memory.used / TO_GB, capacity: stats!.memory.capacity / TO_GB }
      : synced
      ? { used: 0, capacity: stats!.memory.capacity / TO_GB }
      : undefined;

  const defaultCharts: OverviewChart[] = [
    {
      id: 'cpu',
      component: () => <CpuCircularChart aggregate={cpuAggregate} noMetrics={noMetrics} />,
    },
    {
      id: 'memory',
      component: () => <MemoryCircularChart aggregate={memoryAggregate} noMetrics={noMetrics} />,
    },
    {
      id: 'pods',
      component: () => <PodsStatusCircleChart aggregate={podAggregate} />,
    },
    {
      id: 'nodes',
      // TODO: expose `hasAKS` on the backend `overviewstats` aggregate so we
      // can restore the AKS upgrade indicator without fetching the node list.
      component: () => <NodesStatusCircleChart aggregate={nodeAggregate} isAKS={false} />,
    },
  ];
  const charts = chartProcessors.reduce(
    (currentCharts, p) => p.processor(currentCharts),
    defaultCharts
  );

  return (
    <PageGrid>
      <SectionBox title={t('translation|Overview')} py={2} mt={[4, 0, 0]}>
        <Grid container justifyContent="flex-start" alignItems="stretch" spacing={4}>
          {charts.map(chart => (
            <Grid key={chart.id} item xs sx={{ maxWidth: '300px' }}>
              <chart.component />
            </Grid>
          ))}
        </Grid>
      </SectionBox>
      <EventsSection />
    </PageGrid>
  );
}

/**
 * Legacy path: fetches full Pod/Node/Metrics lists and aggregates on the client.
 * Used only when the backend `overviewstats` endpoint is unavailable.
 */
function OverviewLegacy() {
  const { t } = useTranslation(['translation']);
  // The overview only needs periodic snapshots for aggregate charts. Avoid long-lived
  // watches here because large clusters can stream enough events to exhaust the tab.
  const [pods] = Pod.useList({ refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS });
  const [nodes] = Node.useList({ refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS });
  const [nodeMetrics, metricsError] = Node.useMetrics();
  const chartProcessors = useTypedSelector(state => state.overviewCharts.processors);

  const noPermissions = metricsError?.status === 403;
  const noMetrics = metricsError !== null && !noPermissions;

  // Process the default charts through any registered processors
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

  return (
    <PageGrid>
      <SectionBox title={t('translation|Overview')} py={2} mt={[4, 0, 0]}>
        {noPermissions ? (
          <ClusterGroupErrorMessage errors={[metricsError]} />
        ) : (
          <Grid container justifyContent="flex-start" alignItems="stretch" spacing={4}>
            {charts.map(chart => (
              <Grid key={chart.id} item xs sx={{ maxWidth: '300px' }}>
                <chart.component />
              </Grid>
            ))}
          </Grid>
        )}
      </SectionBox>
      <EventsSection />
    </PageGrid>
  );
}

function EventsSection() {
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
  const namespace = useNamespaces();
  const { items: events, errors: eventsErrors } = Event.useList({
    limit: Event.maxLimit,
    namespace,
    refetchInterval: OVERVIEW_REFETCH_INTERVAL_MS,
  });

  // Dedicated warning-only fetch. Without this the mixed fetch above hits the
  // limit=Event.maxLimit cap and warnings get truncated in busy clusters (see
  // response.metadata.continue / remainingItemCount). Using a server-side
  // fieldSelector guarantees the count and the "Only warnings" table reflect
  // every Warning event the server holds up to Event.maxLimit warnings.
  const { items: warningEvents } = Event.useList({
    limit: Event.maxLimit,
    namespace,
    fieldSelector: 'type!=Normal',
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

  const numWarnings = React.useMemo(() => warningEvents?.length ?? '?', [warningEvents]);

  // When the "Only warnings" toggle is on, feed the dedicated warning list
  // into the table so the visible rows aren't limited by CSR/Normal churn.
  const displayedEvents = isWarningEventSwitchChecked ? warningEvents : events;

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
        noNamespaceFilter: false,
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
      data={displayedEvents}
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
          disableFiltering: true,
          getValue: event => event.count ?? null,
          render: event => event.count ?? '-',
        },
        {
          id: 'last-seen',
          label: t('Last Seen'),
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          disableFiltering: true,
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
