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

import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { FluxActionButtons } from '../flux/actions';
import { fluxClass, FluxKind } from '../flux/kinds';
import {
  computeDependencyWaves,
  getLastSyncTime,
  getSourceRef,
  getStatusInfo,
  makeDependencyNodes,
} from '../flux/utils';
import {
  CommitAuthorLabel,
  FluxLink,
  FluxStatusLabel,
  LastSyncLabel,
  NextSyncLabel,
  RevisionLabel,
  SourceUrlLink,
} from './common';
import { CreateFluxButton } from './CreateFluxButton';
import { ErrorState } from './errors';
import { Section, Surface } from './ui';

type Column = any;

function refToString(ref?: Record<string, any>): string {
  if (!ref) {
    return '-';
  }
  return ref.branch ?? ref.tag ?? ref.semver ?? ref.digest ?? ref.commit ?? ref.name ?? '-';
}

/** Columns specific to each Flux kind, shown between Namespace and Status. */
function kindColumns(kindDef: FluxKind): Column[] {
  switch (kindDef.kind) {
    case 'GitRepository':
    case 'OCIRepository':
      return [
        urlColumn(),
        {
          id: 'ref',
          label: 'Ref',
          getValue: (item: any) => refToString(item.jsonData?.spec?.ref),
        },
        revisionColumn(),
        {
          id: 'lastChange',
          label: 'Last change',
          getValue: (item: any) => item.jsonData?.status?.artifact?.metadata?.['author'] ?? '',
          render: (item: any) => <CommitAuthorLabel object={item.jsonData} />,
        },
      ];
    case 'HelmRepository':
      return [
        urlColumn(),
        {
          id: 'type',
          label: 'Type',
          getValue: (item: any) => item.jsonData?.spec?.type ?? 'default',
        },
      ];
    case 'HelmChart':
      return [
        {
          id: 'chart',
          label: 'Chart',
          getValue: (item: any) => item.jsonData?.spec?.chart,
        },
        {
          id: 'version',
          label: 'Version',
          getValue: (item: any) => item.jsonData?.spec?.version ?? '*',
        },
        sourceColumn('From repository'),
        revisionColumn(),
      ];
    case 'Bucket':
      return [
        {
          id: 'endpoint',
          label: 'Endpoint',
          getValue: (item: any) => item.jsonData?.spec?.endpoint,
          render: (item: any) => <SourceUrlLink url={item.jsonData?.spec?.endpoint} />,
        },
        {
          id: 'bucket',
          label: 'Bucket',
          getValue: (item: any) => item.jsonData?.spec?.bucketName,
        },
        revisionColumn(),
      ];
    case 'Kustomization':
      return [
        sourceColumn(),
        {
          id: 'path',
          label: 'Path',
          getValue: (item: any) => item.jsonData?.spec?.path ?? './',
        },
        dependsOnColumn(),
        revisionColumn(),
      ];
    case 'HelmRelease':
      return [
        {
          id: 'chart',
          label: 'Chart',
          getValue: (item: any) =>
            item.jsonData?.spec?.chart?.spec?.chart ?? item.jsonData?.spec?.chartRef?.name ?? '-',
        },
        sourceColumn(),
        dependsOnColumn(),
        {
          id: 'version',
          label: 'Deployed version',
          getValue: (item: any) =>
            item.jsonData?.status?.history?.[0]?.chartVersion ??
            item.jsonData?.status?.lastAppliedRevision ??
            '-',
        },
      ];
    case 'Alert':
      return [
        {
          id: 'severity',
          label: 'Severity',
          getValue: (item: any) => item.jsonData?.spec?.eventSeverity ?? 'info',
        },
        {
          id: 'provider',
          label: 'Provider',
          getValue: (item: any) => item.jsonData?.spec?.providerRef?.name,
        },
      ];
    case 'Provider':
      return [
        {
          id: 'type',
          label: 'Type',
          getValue: (item: any) => item.jsonData?.spec?.type,
        },
      ];
    case 'Receiver':
      return [
        {
          id: 'type',
          label: 'Type',
          getValue: (item: any) => item.jsonData?.spec?.type,
        },
        {
          id: 'webhookPath',
          label: 'Webhook path',
          getValue: (item: any) => item.jsonData?.status?.webhookPath ?? '-',
        },
      ];
    case 'ImageRepository':
      return [
        {
          id: 'image',
          label: 'Image',
          getValue: (item: any) => item.jsonData?.spec?.image,
        },
        {
          id: 'tags',
          label: 'Tags scanned',
          getValue: (item: any) => item.jsonData?.status?.lastScanResult?.tagCount ?? '-',
        },
      ];
    case 'ImagePolicy':
      return [
        {
          id: 'imageRepository',
          label: 'Image repository',
          getValue: (item: any) => item.jsonData?.spec?.imageRepositoryRef?.name,
        },
        {
          id: 'latestImage',
          label: 'Latest image',
          getValue: (item: any) => item.jsonData?.status?.latestImage ?? '-',
        },
      ];
    case 'ImageUpdateAutomation':
      return [sourceColumn()];
    default:
      return [];
  }
}

function revisionColumn(): Column {
  return {
    id: 'revision',
    label: 'Revision',
    getValue: (item: any) =>
      item.jsonData?.status?.artifact?.revision ?? item.jsonData?.status?.lastAppliedRevision ?? '',
    render: (item: any) => <RevisionLabel object={item.jsonData} />,
  };
}

function urlColumn(): Column {
  return {
    id: 'url',
    label: 'URL',
    getValue: (item: any) => item.jsonData?.spec?.url ?? '',
    render: (item: any) => <SourceUrlLink url={item.jsonData?.spec?.url} />,
    gridTemplate: 2,
  };
}

function sourceColumn(label = 'Source'): Column {
  return {
    id: 'source',
    label,
    getValue: (item: any) => getSourceRef(item.jsonData)?.name ?? '',
    render: (item: any) => {
      const ref = getSourceRef(item.jsonData);
      if (!ref) {
        return '-';
      }
      return (
        <FluxLink kind={ref.kind} name={ref.name} namespace={ref.namespace}>
          {ref.kind}/{ref.name}
        </FluxLink>
      );
    },
  };
}

function dependsOnColumn(): Column {
  return {
    id: 'dependsOn',
    label: 'Depends on',
    getValue: (item: any) =>
      (item.jsonData?.spec?.dependsOn ?? []).map((d: any) => d.name).join(', ') || '-',
  };
}

export interface FluxKindListSectionProps {
  kindDef: FluxKind;
  /** Optional title override; defaults to the plural kind. */
  title?: string;
  /** Optional one-line caption rendered under the section title. */
  description?: string;
  /** Optional icon shown next to the section title. */
  icon?: string;
}

/** A list view (with live status, sync info and actions) for one Flux kind. */
export function FluxKindListSection(props: FluxKindListSectionProps) {
  const { kindDef, title, description, icon } = props;

  const sectionTitle = title ?? `${kindDef.kind}s`;
  const [items, error] = (fluxClass(kindDef) as any).useList();

  // Kustomizations and Helm releases are ordered by their deployment order
  // (dependsOn waves) so the list reads top-to-bottom in the order Flux
  // applies them, matching the graph above.
  const ordersById = React.useMemo(() => {
    if (kindDef.kind !== 'Kustomization' && kindDef.kind !== 'HelmRelease') {
      return null;
    }
    const nodes = makeDependencyNodes((items ?? []).map((i: any) => i.jsonData));
    const { waves } = computeDependencyWaves(nodes);
    const map = new Map<string, number>();
    waves.forEach((wave, i) => wave.forEach(n => map.set(n.id, i)));
    return map;
  }, [items, kindDef.kind]);

  const orderOf = (item: any): number => {
    if (!ordersById) {
      return 0;
    }
    const id = `${item.jsonData?.metadata?.namespace}/${item.jsonData?.metadata?.name}`;
    return ordersById.get(id) ?? 999;
  };

  const columns: Column[] = [
    ...(ordersById
      ? [
          {
            id: 'order',
            label: 'Wave',
            getValue: (item: any) => orderOf(item) + 1,
            gridTemplate: 'min-content',
            sort: (a: any, b: any) => orderOf(a) - orderOf(b),
          },
        ]
      : []),
    'name',
    'namespace',
    ...kindColumns(kindDef),
    {
      id: 'status',
      label: 'Status',
      getValue: (item: any) => getStatusInfo(item.jsonData).health,
      render: (item: any) => <FluxStatusLabel object={item.jsonData} />,
      gridTemplate: 'min-content',
    },
    {
      id: 'message',
      label: 'Message',
      getValue: (item: any) => getStatusInfo(item.jsonData).message ?? '',
      show: false,
    },
    {
      id: 'interval',
      label: 'Interval',
      getValue: (item: any) => item.jsonData?.spec?.interval ?? '-',
      gridTemplate: 'min-content',
    },
    {
      id: 'lastSync',
      label: 'Last sync',
      getValue: (item: any) => getLastSyncTime(item.jsonData) ?? '',
      render: (item: any) => <LastSyncLabel date={getLastSyncTime(item.jsonData)} />,
      gridTemplate: 'min-content',
    },
    {
      id: 'nextSync',
      label: 'Next sync',
      getValue: () => '',
      render: (item: any) => <NextSyncLabel object={item.jsonData} />,
      gridTemplate: 'min-content',
      sort: false,
      disableFiltering: true,
    },
    {
      id: 'fluxActions',
      label: 'Actions',
      getValue: () => '',
      render: (item: any) => <FluxActionButtons item={item} />,
      sort: false,
      disableFiltering: true,
      gridTemplate: 'min-content',
    },
    'age',
  ];

  // When the list failed and there is nothing to show, explain the real
  // reason (Flux not installed, no permission, cluster unreachable, ...)
  // instead of an empty table with a cryptic error.
  if (error && !items?.length) {
    return (
      <Section title={sectionTitle} icon={icon} description={description}>
        <Surface sx={{ p: 2 }}>
          <ErrorState
            error={error}
            what={sectionTitle.toLowerCase()}
            fluxKind={kindDef.kind}
            group={kindDef.group}
          />
        </Surface>
      </Section>
    );
  }

  return (
    <Section title={sectionTitle} icon={icon} description={description}>
      <Surface sx={{ px: 2, pb: 1, pt: 0.5 }}>
        <ResourceListView
          title=""
          data={items}
          errors={error ? [error] : null}
          columns={columns}
          defaultSortingColumn={ordersById ? { id: 'order', desc: false } : undefined}
          // enableColumnOrdering is available at runtime (compiled against the app),
          // but not in the published plugin types; pass it untyped.
          {...({ enableColumnOrdering: false } as any)}
          headerProps={{
            titleSideActions: [<CreateFluxButton key="create" kindDef={kindDef} />],
            // We pass data directly (not a resourceClass), so re-enable the
            // namespace filter that ResourceListView would otherwise hide.
            noNamespaceFilter: false,
          }}
          id={`headlamp-flux-${kindDef.plural}`}
        />
      </Surface>
    </Section>
  );
}
