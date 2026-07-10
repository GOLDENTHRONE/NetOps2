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

import { Box } from '@mui/material';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DaemonSet from '../../lib/k8s/daemonSet';
import Deployment from '../../lib/k8s/deployment';
import { KubeObject } from '../../lib/k8s/KubeObject';
import Namespace from '../../lib/k8s/namespace';
import Pod from '../../lib/k8s/pod';
import ResourceQuota from '../../lib/k8s/resourceQuota';
import Service from '../../lib/k8s/service';
import StatefulSet from '../../lib/k8s/statefulSet';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import { DateLabel, StatusLabel } from '../common/Label';
import Link from '../common/Link';
import NameValueTable from '../common/NameValueTable';
import { MetadataDictGrid } from '../common/Resource/MetadataDisplay';
import SectionBox from '../common/SectionBox';
import Table, { TableColumn } from '../common/Table/Table';
import { makePodStatusLabel } from '../pod/List';
import {
  APP_DEPLOYMENT_TYPE_KEY,
  APP_VERSION_KEY,
  getAppMetadataValue,
  NOT_AVAILABLE,
} from './applicationUtils';

// The panel is transient, so poll instead of holding watch connections open.
const REFETCH_INTERVAL_MS = 60_000;

export interface ApplicationDetailsProps {
  /** The application (display) name. */
  appName: string;
  /** The namespace backing this application. */
  namespace: string;
  /** The cluster the namespace lives in. */
  cluster: string;
}

/**
 * Rich details for one application (a namespace in a specific cluster),
 * shown in a side panel. Every resource listed links to its own details
 * page in the right cluster.
 */
export default function ApplicationDetails({
  appName,
  namespace,
  cluster,
}: ApplicationDetailsProps) {
  const { t } = useTranslation(['translation', 'glossary']);

  const [namespaceObj, namespaceError] = Namespace.useGet(namespace, undefined, { cluster });

  const listParams = { clusters: [cluster], namespace, refetchInterval: REFETCH_INTERVAL_MS };
  const deployments = Deployment.useList(listParams);
  const statefulSets = StatefulSet.useList(listParams);
  const daemonSets = DaemonSet.useList(listParams);
  const pods = Pod.useList(listParams);
  const services = Service.useList(listParams);
  const resourceQuotas = ResourceQuota.useList(listParams);

  const workloads = useMemo(
    () => [
      ...(deployments.items ?? []),
      ...(statefulSets.items ?? []),
      ...(daemonSets.items ?? []),
    ],
    [deployments.items, statefulSets.items, daemonSets.items]
  );

  const errors = useMemo(
    () =>
      [
        ...(deployments.errors ?? []),
        ...(statefulSets.errors ?? []),
        ...(daemonSets.errors ?? []),
        ...(pods.errors ?? []),
        ...(services.errors ?? []),
        ...(resourceQuotas.errors ?? []),
      ].filter(Boolean),
    [
      deployments.errors,
      statefulSets.errors,
      daemonSets.errors,
      pods.errors,
      services.errors,
      resourceQuotas.errors,
    ]
  );

  const status = namespaceObj?.status?.phase;

  const mainRows = [
    { name: t('translation|Application'), value: appName },
    {
      name: t('glossary|Namespace'),
      value: (
        <Link routeName="namespace" params={{ name: namespace }} activeCluster={cluster}>
          {namespace}
        </Link>
      ),
    },
    { name: t('glossary|Cluster'), value: cluster },
    {
      name: t('translation|Status'),
      value: status ? (
        <StatusLabel status={status === 'Active' ? 'success' : 'error'}>{status}</StatusLabel>
      ) : (
        NOT_AVAILABLE
      ),
    },
    {
      name: t('translation|Version'),
      value: namespaceObj ? getAppMetadataValue(namespaceObj, APP_VERSION_KEY) : NOT_AVAILABLE,
    },
    {
      name: t('translation|Deployment Type'),
      value: namespaceObj
        ? getAppMetadataValue(namespaceObj, APP_DEPLOYMENT_TYPE_KEY)
        : NOT_AVAILABLE,
    },
    {
      name: t('translation|Creation'),
      value: namespaceObj?.metadata?.creationTimestamp ? (
        <DateLabel date={namespaceObj.metadata.creationTimestamp} format="brief" />
      ) : (
        NOT_AVAILABLE
      ),
    },
    {
      name: t('translation|Labels'),
      value: namespaceObj?.metadata?.labels ? (
        <MetadataDictGrid dict={namespaceObj.metadata.labels} />
      ) : (
        NOT_AVAILABLE
      ),
    },
  ];

  const workloadColumns = useMemo<TableColumn<KubeObject>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        accessorFn: item => item.getName(),
        Cell: ({ row: { original } }) => <Link kubeObject={original} />,
      },
      {
        id: 'kind',
        header: t('translation|Kind'),
        accessorFn: item => item.kind,
        gridTemplate: 'min-content',
      },
      {
        id: 'age',
        header: t('translation|Age'),
        gridTemplate: 'min-content',
        accessorFn: item => item.metadata.creationTimestamp,
        Cell: ({ row: { original } }) => <DateLabel date={original.metadata.creationTimestamp} />,
      },
    ],
    [t]
  );

  const podColumns = useMemo<TableColumn<Pod>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        accessorFn: item => item.getName(),
        Cell: ({ row: { original } }) => <Link kubeObject={original} />,
      },
      {
        id: 'status',
        header: t('translation|Status'),
        accessorFn: item => item.status?.phase,
        gridTemplate: 'min-content',
        Cell: ({ row: { original } }) => makePodStatusLabel(original, false, t),
      },
      {
        id: 'age',
        header: t('translation|Age'),
        gridTemplate: 'min-content',
        accessorFn: item => item.metadata.creationTimestamp,
        Cell: ({ row: { original } }) => <DateLabel date={original.metadata.creationTimestamp} />,
      },
    ],
    [t]
  );

  const serviceColumns = useMemo<TableColumn<Service>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        accessorFn: item => item.getName(),
        Cell: ({ row: { original } }) => <Link kubeObject={original} />,
      },
      {
        id: 'type',
        header: t('translation|Type'),
        accessorFn: item => item.spec?.type ?? NOT_AVAILABLE,
        gridTemplate: 'min-content',
      },
      {
        id: 'clusterIp',
        header: t('glossary|Cluster IP'),
        accessorFn: item => item.spec?.clusterIP ?? NOT_AVAILABLE,
      },
    ],
    [t]
  );

  const quotaColumns = useMemo<TableColumn<ResourceQuota>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        accessorFn: item => item.getName(),
        Cell: ({ row: { original } }) => <Link kubeObject={original} />,
      },
      {
        id: 'age',
        header: t('translation|Age'),
        gridTemplate: 'min-content',
        accessorFn: item => item.metadata.creationTimestamp,
        Cell: ({ row: { original } }) => <DateLabel date={original.metadata.creationTimestamp} />,
      },
    ],
    [t]
  );

  return (
    <Box sx={{ p: 2, overflowY: 'auto', height: '100%' }}>
      <SectionBox title={appName} headerProps={{ headerStyle: 'main' }}>
        {namespaceError && (
          <ClusterGroupErrorMessage errors={namespaceError ? [namespaceError] : []} />
        )}
        <NameValueTable rows={mainRows} />
      </SectionBox>

      <ClusterGroupErrorMessage errors={errors} />

      <SectionBox title={t('glossary|Workloads')}>
        <Table
          columns={workloadColumns}
          data={workloads}
          loading={deployments.items === null && workloads.length === 0}
          emptyMessage={NOT_AVAILABLE}
        />
      </SectionBox>

      <SectionBox title={t('glossary|Pods')}>
        <Table
          columns={podColumns}
          data={pods.items ?? []}
          loading={pods.items === null}
          emptyMessage={NOT_AVAILABLE}
        />
      </SectionBox>

      <SectionBox title={t('glossary|Services')}>
        <Table
          columns={serviceColumns}
          data={services.items ?? []}
          loading={services.items === null}
          emptyMessage={NOT_AVAILABLE}
        />
      </SectionBox>

      <SectionBox title={t('glossary|Resource Quotas')}>
        <Table
          columns={quotaColumns}
          data={resourceQuotas.items ?? []}
          loading={resourceQuotas.items === null}
          emptyMessage={NOT_AVAILABLE}
        />
      </SectionBox>
    </Box>
  );
}
