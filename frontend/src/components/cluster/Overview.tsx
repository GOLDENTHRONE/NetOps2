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
import { Theme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import Deployment from '../../lib/k8s/deployment';
import Event from '../../lib/k8s/event';
import Node from '../../lib/k8s/node';
import Pod from '../../lib/k8s/pod';
import { PodMetrics } from '../../lib/k8s/PodMetrics';
import { useFilterFunc } from '../../lib/util';
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
import SectionHeader from '../common/SectionHeader';
import ShowHideLabel from '../common/ShowHideLabel';
import TileChart from '../common/TileChart/TileChart';
import { LightTooltip } from '../common/Tooltip';
import {
  CpuCircularChart,
  MemoryCircularChart,
  NamespaceCpuChart,
  NamespaceMemoryChart,
  NodesStatusCircleChart,
  PodsStatusCircleChart,
  WorkloadsStatusChart,
} from './Charts';
import { ClusterGroupErrorMessage } from './ClusterGroupErrorMessage';

/** Cluster-wide polling: larger payloads (3000+ pods, 76 nodes) — keep moderate */
const CLUSTER_REFETCH_INTERVAL_MS = 30_000;
/** Namespace-scoped polling: small payloads — refresh fast for responsiveness */
const NAMESPACE_REFETCH_INTERVAL_MS = 10_000;

export default function Overview() {
  const { t } = useTranslation(['translation']);
  const selectedNamespaces = useNamespaces();
  const chartProcessors = useTypedSelector(state => state.overviewCharts.processors);

  const isNamespaceScoped = selectedNamespaces.length > 0;

  return (
    <PageGrid>
      <SectionBox
        title={
          <SectionHeader
            title={t('translation|Overview')}
            actions={[
              <Box key="namespace-filter" sx={{ minWidth: '25rem' }}>
                <NamespacesAutocomplete width="100%" />
              </Box>,
            ]}
          />
        }
        py={2}
        mt={[4, 0, 0]}
      >
        {isNamespaceScoped ? (
          <NamespaceChartsSection
            namespaces={selectedNamespaces}
            chartProcessors={chartProcessors}
          />
        ) : (
          <ClusterChartsSection chartProcessors={chartProcessors} />
        )}
      </SectionBox>
      <EventsSection />
    </PageGrid>
  );
}

function ClusterChartsSection({
  chartProcessors,
}: {
  chartProcessors: Array<{ processor: (charts: OverviewChart[]) => OverviewChart[] }>;
}) {
  const [pods] = Pod.useList({ refetchInterval: CLUSTER_REFETCH_INTERVAL_MS });
  const [nodes] = Node.useList({ refetchInterval: CLUSTER_REFETCH_INTERVAL_MS });
  const [nodeMetrics, metricsError] = Node.useMetrics();

  const noMetrics = metricsError?.status === 404;
  const noPermissions = metricsError?.status === 403;

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

function NamespaceChartsSection({
  namespaces,
  chartProcessors,
}: {
  namespaces: string[];
  chartProcessors: Array<{ processor: (charts: OverviewChart[]) => OverviewChart[] }>;
}) {
  const [pods] = Pod.useList({
    namespace: namespaces,
    refetchInterval: NAMESPACE_REFETCH_INTERVAL_MS,
  });
  const [podMetricsList] = PodMetrics.useList({
    namespace: namespaces,
    refetchInterval: NAMESPACE_REFETCH_INTERVAL_MS,
  });
  const [deployments] = Deployment.useList({
    namespace: namespaces,
    refetchInterval: NAMESPACE_REFETCH_INTERVAL_MS,
  });

  const defaultCharts: OverviewChart[] = [
    {
      id: 'cpu',
      component: () => <NamespaceCpuChart pods={pods} podMetrics={podMetricsList} />,
    },
    {
      id: 'memory',
      component: () => <NamespaceMemoryChart pods={pods} podMetrics={podMetricsList} />,
    },
    {
      id: 'pods',
      component: () =>
        pods !== null && pods.length === 0 ? (
          <TileChart
            data={null}
            total={0}
            label="N/A"
            title="Pods"
            legend="No pods in this namespace"
          />
        ) : (
          <PodsStatusCircleChart items={pods} />
        ),
    },
    {
      id: 'workloads',
      component: () => <WorkloadsStatusChart items={deployments} />,
    },
  ];
  const charts = chartProcessors.reduce(
    (currentCharts, p) => p.processor(currentCharts),
    defaultCharts
  );

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
    refetchInterval:
      namespace.length > 0 ? NAMESPACE_REFETCH_INTERVAL_MS : CLUSTER_REFETCH_INTERVAL_MS,
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
