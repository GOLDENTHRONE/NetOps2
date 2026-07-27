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

import { useTheme } from '@mui/material/styles';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Deployment from '../../../lib/k8s/deployment';
import Pod from '../../../lib/k8s/pod';
import { PodMetrics } from '../../../lib/k8s/PodMetrics';
import { parseCpu, parseRam, TO_GB, TO_ONE_CPU } from '../../../lib/units';
import TileChart from '../../common/TileChart';

interface NamespaceResourceChartProps {
  pods: Pod[] | null;
  podMetrics: PodMetrics[] | null;
}

/**
 * Compute CPU usage and requests across all pods/metrics in a namespace.
 * Used = sum of actual container CPU usage from PodMetrics.
 * Available = sum of container CPU requests from Pod specs.
 */
function useCpuAggregates(pods: Pod[] | null, podMetrics: PodMetrics[] | null) {
  return useMemo(() => {
    if (podMetrics === null || pods === null) {
      return { used: -1, available: -1 };
    }

    let used = 0;
    for (const pm of podMetrics) {
      for (const container of pm.jsonData.containers ?? []) {
        used += parseCpu(container.usage.cpu) / TO_ONE_CPU;
      }
    }

    let available = 0;
    for (const pod of pods) {
      for (const container of pod.spec?.containers ?? []) {
        const cpuReq = container.resources?.requests?.cpu;
        if (cpuReq) {
          available += parseCpu(cpuReq) / TO_ONE_CPU;
        }
      }
    }

    return { used, available };
  }, [pods, podMetrics]);
}

/**
 * Compute memory usage and requests across all pods/metrics in a namespace.
 * Used = sum of actual container memory usage from PodMetrics.
 * Available = sum of container memory requests from Pod specs.
 */
function useMemoryAggregates(pods: Pod[] | null, podMetrics: PodMetrics[] | null) {
  return useMemo(() => {
    if (podMetrics === null || pods === null) {
      return { used: -1, available: -1 };
    }

    let used = 0;
    for (const pm of podMetrics) {
      for (const container of pm.jsonData.containers ?? []) {
        used += parseRam(container.usage.memory) / TO_GB;
      }
    }

    let available = 0;
    for (const pod of pods) {
      for (const container of pod.spec?.containers ?? []) {
        const memReq = container.resources?.requests?.memory;
        if (memReq) {
          available += parseRam(memReq) / TO_GB;
        }
      }
    }

    return { used, available };
  }, [pods, podMetrics]);
}

export function NamespaceCpuChart(props: NamespaceResourceChartProps) {
  const { pods, podMetrics } = props;
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();
  const { used, available } = useCpuAggregates(pods, podMetrics);

  const isLoading = pods === null || podMetrics === null;
  const isEmpty = !isLoading && pods!.length === 0;
  const hasRequests = available > 0;
  const isOverCommitted = hasRequests && used > available;

  function getLabel() {
    if (isLoading) return '…';
    if (isEmpty) return 'N/A';
    if (!hasRequests) return `${used.toFixed(2)}`;
    const pct = (used / available) * 100;
    return `${Math.min(pct, 100).toFixed(1)} %`;
  }

  function getLegend() {
    if (isLoading) return '';
    if (isEmpty) return t('translation|No pods in this namespace');
    if (!hasRequests) {
      return t('translation|{{ used }} cores used — no requests set', {
        used: used.toFixed(2),
      });
    }
    if (isOverCommitted) {
      return `${used.toFixed(2)} / ${available.toFixed(2)} ${t(
        'translation|cores (over-committed)'
      )}`;
    }
    return `${used.toFixed(2)} / ${available.toFixed(2)} ${t('translation|requested')}`;
  }

  function getData(): { name: string; value: number; fill?: string }[] | null {
    if (isLoading) return [];
    if (isEmpty || !hasRequests) return null;
    return [
      {
        name: 'used',
        value: Math.min(used, available),
        ...(isOverCommitted ? { fill: theme.palette.warning.main } : {}),
      },
    ];
  }

  return (
    <TileChart
      data={getData()}
      total={isLoading ? -1 : hasRequests ? available : 0}
      label={getLabel()}
      title={t('translation|CPU Usage')}
      legend={getLegend()}
    />
  );
}

export function NamespaceMemoryChart(props: NamespaceResourceChartProps) {
  const { pods, podMetrics } = props;
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();
  const { used, available } = useMemoryAggregates(pods, podMetrics);

  const isLoading = pods === null || podMetrics === null;
  const isEmpty = !isLoading && pods!.length === 0;
  const hasRequests = available > 0;
  const isOverCommitted = hasRequests && used > available;

  function getLabel() {
    if (isLoading) return '…';
    if (isEmpty) return 'N/A';
    if (!hasRequests) return `${used.toFixed(2)}`;
    const pct = (used / available) * 100;
    return `${Math.min(pct, 100).toFixed(1)} %`;
  }

  function getLegend() {
    if (isLoading) return '';
    if (isEmpty) return t('translation|No pods in this namespace');
    if (!hasRequests) {
      return t('translation|{{ used }} GB used — no requests set', {
        used: used.toFixed(2),
      });
    }
    if (isOverCommitted) {
      return `${used.toFixed(2)} / ${available.toFixed(2)} GB ${t('translation|(over-committed)')}`;
    }
    return `${used.toFixed(2)} / ${available.toFixed(2)} GB ${t('translation|requested')}`;
  }

  function getData(): { name: string; value: number; fill?: string }[] | null {
    if (isLoading) return [];
    if (isEmpty || !hasRequests) return null;
    return [
      {
        name: 'used',
        value: Math.min(used, available),
        ...(isOverCommitted ? { fill: theme.palette.warning.main } : {}),
      },
    ];
  }

  return (
    <TileChart
      data={getData()}
      total={isLoading ? -1 : hasRequests ? available : 0}
      label={getLabel()}
      title={t('translation|Memory Usage')}
      legend={getLegend()}
    />
  );
}

export function WorkloadsStatusChart(props: { items: Deployment[] | null }) {
  const theme = useTheme();
  const { items } = props;
  const { t } = useTranslation(['translation', 'glossary']);

  const { availableCount, desiredCount } = useMemo(() => {
    if (items === null) return { availableCount: -1, desiredCount: -1 };

    let available = 0;
    let desired = 0;
    for (const dep of items) {
      desired += dep.spec?.replicas ?? 0;
      available += dep.status?.availableReplicas ?? 0;
    }
    return { availableCount: available, desiredCount: desired };
  }, [items]);

  const isLoading = availableCount === -1;
  const isEmpty = items !== null && items.length === 0;

  function getLabel() {
    if (isLoading) return '…';
    if (isEmpty) return 'N/A';
    if (desiredCount === 0) return '0';
    return `${((availableCount / desiredCount) * 100).toFixed(1)} %`;
  }

  function getLegend() {
    if (isLoading) return '';
    if (isEmpty) return t('translation|No deployments in this namespace');
    return t('translation|{{ numReady }} / {{ numItems }} Available', {
      numReady: availableCount,
      numItems: desiredCount,
    });
  }

  function getData(): { name: string; value: number; fill?: string }[] | null {
    if (isLoading) return [];
    if (isEmpty) return null;
    return [
      { name: 'available', value: availableCount },
      {
        name: 'unavailable',
        value: desiredCount - availableCount,
        fill: theme.palette.error.main,
      },
    ];
  }

  return (
    <TileChart
      data={getData()}
      total={isLoading ? -1 : isEmpty ? 0 : desiredCount}
      label={getLabel()}
      title={t('glossary|Workloads')}
      legend={getLegend()}
    />
  );
}
