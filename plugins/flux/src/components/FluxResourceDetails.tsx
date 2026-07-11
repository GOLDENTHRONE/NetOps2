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

import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { localeDate } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Chip } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { FluxActionButtons } from '../flux/actions';
import { fluxClass, FluxKind, kindsInCategory, SOURCE_KINDS } from '../flux/kinds';
import {
  getCommitWebUrl,
  getLastSyncTime,
  getNextSyncTime,
  getSourceRef,
  getStatusInfo,
  isSuspended,
  parseRevision,
} from '../flux/utils';
import {
  CommitAuthorLabel,
  FluxLink,
  FluxStatusLabel,
  healthToStatus,
  RevisionLabel,
  SectionEmpty,
  SourceUrlLink,
} from './common';
import { ErrorState, pickMostRelevantError } from './errors';
import { HelmReleaseInventorySection, KustomizationInventorySection } from './Inventory';

function commonInfoRows(item: any) {
  const json = item.jsonData;
  const next = getNextSyncTime(json);
  const last = getLastSyncTime(json);
  return [
    {
      name: 'Status',
      value: <FluxStatusLabel object={json} />,
    },
    {
      name: 'Status message',
      value: getStatusInfo(json).message ?? '-',
    },
    {
      name: 'Suspended',
      value: isSuspended(json) ? 'Yes (spec.suspend=true)' : 'No',
    },
    {
      name: 'Interval',
      value: json?.spec?.interval ?? '-',
    },
    {
      name: 'Last sync',
      value: last ? localeDate(last) : '-',
    },
    {
      name: 'Next scheduled sync (approx.)',
      value: next ? localeDate(next) : '-',
    },
    {
      name: 'Last manual sync request',
      value: json?.metadata?.annotations?.['reconcile.fluxcd.io/requestedAt']
        ? localeDate(json.metadata.annotations['reconcile.fluxcd.io/requestedAt'])
        : '-',
      hide: !json?.metadata?.annotations?.['reconcile.fluxcd.io/requestedAt'],
    },
  ];
}

function kindInfoRows(kindDef: FluxKind, item: any) {
  const spec = item.jsonData?.spec ?? {};
  const status = item.jsonData?.status ?? {};
  switch (kindDef.kind) {
    case 'GitRepository': {
      const parsed = parseRevision(status.artifact?.revision);
      const commitUrl = getCommitWebUrl(spec.url, parsed.hash);
      return [
        { name: 'URL', value: <SourceUrlLink url={spec.url} /> },
        {
          name: 'Reference',
          value:
            spec.ref?.branch !== undefined
              ? `branch: ${spec.ref.branch}`
              : spec.ref?.tag !== undefined
              ? `tag: ${spec.ref.tag}`
              : spec.ref?.semver !== undefined
              ? `semver: ${spec.ref.semver}`
              : spec.ref?.commit !== undefined
              ? `commit: ${spec.ref.commit}`
              : spec.ref?.name !== undefined
              ? `ref: ${spec.ref.name}`
              : '-',
        },
        { name: 'Current revision', value: <RevisionLabel object={item.jsonData} /> },
        {
          name: 'Last change',
          value: <CommitAuthorLabel object={item.jsonData} />,
          hide: !status.artifact?.metadata,
        },
        {
          name: 'Last fetched',
          value: status.artifact?.lastUpdateTime ? localeDate(status.artifact.lastUpdateTime) : '-',
        },
        {
          name: 'Commit on Git host',
          value: commitUrl ? (
            <a href={commitUrl} target="_blank" rel="noreferrer">
              {commitUrl}
            </a>
          ) : (
            '-'
          ),
          hide: !commitUrl,
        },
        { name: 'Credentials secret', value: spec.secretRef?.name ?? '-' },
        { name: 'Timeout', value: spec.timeout ?? '-' },
      ];
    }
    case 'OCIRepository':
      return [
        { name: 'URL', value: <SourceUrlLink url={spec.url} /> },
        {
          name: 'Reference',
          value: spec.ref?.tag ?? spec.ref?.semver ?? spec.ref?.digest ?? '-',
        },
        { name: 'Provider', value: spec.provider ?? 'generic' },
        { name: 'Current revision', value: <RevisionLabel object={item.jsonData} /> },
      ];
    case 'HelmRepository':
      return [
        { name: 'URL', value: <SourceUrlLink url={spec.url} /> },
        { name: 'Type', value: spec.type ?? 'default' },
      ];
    case 'HelmChart':
      return [
        { name: 'Chart', value: spec.chart },
        { name: 'Version constraint', value: spec.version ?? '*' },
        {
          name: 'Source',
          value: sourceLink(item),
        },
        { name: 'Current revision', value: <RevisionLabel object={item.jsonData} /> },
      ];
    case 'Bucket':
      return [
        { name: 'Endpoint', value: <SourceUrlLink url={spec.endpoint} /> },
        { name: 'Bucket', value: spec.bucketName },
        { name: 'Provider', value: spec.provider ?? 'generic' },
      ];
    case 'Kustomization':
      return [
        { name: 'Source', value: sourceLink(item) },
        { name: 'Path', value: spec.path ?? './' },
        { name: 'Prune', value: spec.prune ? 'Yes' : 'No' },
        { name: 'Target namespace', value: spec.targetNamespace ?? '-' },
        { name: 'Service account', value: spec.serviceAccountName ?? '-' },
        { name: 'Wait for health checks', value: spec.wait ? 'Yes' : 'No' },
        { name: 'Timeout', value: spec.timeout ?? '-' },
        { name: 'Last applied revision', value: status.lastAppliedRevision ?? '-' },
        {
          name: 'Last attempted revision',
          value: status.lastAttemptedRevision ?? '-',
          hide: status.lastAttemptedRevision === status.lastAppliedRevision,
        },
      ];
    case 'HelmRelease': {
      const latest = Array.isArray(status.history) ? status.history[0] : undefined;
      return [
        {
          name: 'Chart',
          value: spec.chart?.spec?.chart ?? spec.chartRef?.name ?? '-',
        },
        { name: 'Version constraint', value: spec.chart?.spec?.version ?? '*' },
        { name: 'Source', value: sourceLink(item) },
        { name: 'Release name', value: spec.releaseName ?? item.metadata?.name },
        { name: 'Target namespace', value: spec.targetNamespace ?? item.metadata?.namespace },
        { name: 'Deployed chart version', value: latest?.chartVersion ?? '-' },
        { name: 'Deployed app version', value: latest?.appVersion ?? '-' },
        { name: 'Helm status', value: latest?.status ?? '-' },
      ];
    }
    case 'Alert':
      return [
        { name: 'Provider', value: spec.providerRef?.name ?? '-' },
        { name: 'Severity', value: spec.eventSeverity ?? 'info' },
        {
          name: 'Event sources',
          value: (spec.eventSources ?? []).map((s: any) => `${s.kind}/${s.name}`).join(', '),
        },
      ];
    case 'Provider':
      return [
        { name: 'Type', value: spec.type },
        { name: 'Channel', value: spec.channel ?? '-' },
        { name: 'Address secret', value: spec.secretRef?.name ?? '-' },
      ];
    case 'Receiver':
      return [
        { name: 'Type', value: spec.type },
        { name: 'Events', value: (spec.events ?? []).join(', ') || '-' },
        { name: 'Webhook path', value: status.webhookPath ?? '-' },
      ];
    case 'ImageRepository':
      return [
        { name: 'Image', value: spec.image },
        { name: 'Tags scanned', value: status.lastScanResult?.tagCount ?? '-' },
        {
          name: 'Last scan',
          value: status.lastScanResult?.scanTime ? localeDate(status.lastScanResult.scanTime) : '-',
        },
      ];
    case 'ImagePolicy':
      return [
        { name: 'Image repository', value: spec.imageRepositoryRef?.name ?? '-' },
        { name: 'Policy', value: JSON.stringify(spec.policy ?? {}) },
        { name: 'Latest image', value: status.latestImage ?? '-' },
      ];
    case 'ImageUpdateAutomation':
      return [
        { name: 'Source', value: sourceLink(item) },
        { name: 'Update path', value: spec.update?.path ?? '-' },
        { name: 'Push branch', value: spec.git?.push?.branch ?? '-' },
        {
          name: 'Last automation run',
          value: status.lastAutomationRunTime ? localeDate(status.lastAutomationRunTime) : '-',
        },
      ];
    default:
      return [];
  }
}

function sourceLink(item: any) {
  const ref = getSourceRef(item.jsonData);
  if (!ref) {
    return '-';
  }
  return (
    <FluxLink kind={ref.kind} name={ref.name} namespace={ref.namespace}>
      {ref.kind}/{ref.namespace}/{ref.name}
    </FluxLink>
  );
}

/** Chip linking to another Flux object, colored by its live status. */
function ObjectChip(props: { kind: string; object: any }) {
  const { kind, object } = props;
  const info = getStatusInfo(object.jsonData);
  return (
    <FluxLink kind={kind} name={object.metadata.name} namespace={object.metadata.namespace}>
      <Chip
        size="small"
        clickable
        label={`${kind}/${object.metadata.name}`}
        color={
          healthToStatus(info.health) === 'success'
            ? 'success'
            : healthToStatus(info.health) === 'error'
            ? 'error'
            : healthToStatus(info.health) === 'warning'
            ? 'warning'
            : 'default'
        }
        variant="outlined"
      />
    </FluxLink>
  );
}

/**
 * For a source: everything Flux discovered/derived from it — the
 * Kustomizations, HelmCharts, HelmReleases and image automations that
 * reference this source, shown as clickable tags.
 */
function ReferencedBySection(props: { item: any; kindDef: FluxKind }) {
  const { item, kindDef } = props;
  const consumers = [
    ...kindsInCategory('kustomizations'),
    ...kindsInCategory('helmreleases'),
    ...SOURCE_KINDS.filter(k => k.kind === 'HelmChart'),
    ...kindsInCategory('imageautomation').filter(k => k.kind === 'ImageUpdateAutomation'),
  ];

  const found: { kind: string; object: any }[] = [];
  const errors: any[] = [];
  let loading = false;
  for (const consumer of consumers) {
    // Constant list of kinds, so the hook order is stable.
    const [objs, err] = (fluxClass(consumer) as any).useList();
    if (err) {
      errors.push(err);
      continue;
    }
    if (objs === null) {
      loading = true;
      continue;
    }
    for (const obj of objs) {
      const ref = getSourceRef(obj.jsonData);
      if (
        ref &&
        ref.kind === kindDef.kind &&
        ref.name === item.metadata?.name &&
        (ref.namespace ?? obj.metadata?.namespace) === item.metadata?.namespace
      ) {
        found.push({ kind: consumer.kind, object: obj });
      }
    }
  }

  const allFailed = errors.length === consumers.length;

  return (
    <SectionBox title={`Used by (${found.length})`}>
      {allFailed ? (
        <ErrorState error={pickMostRelevantError(errors)} what="the objects that use this source" />
      ) : found.length === 0 ? (
        <SectionEmpty
          message={
            loading
              ? 'Looking for objects using this source…'
              : 'Nothing references this source yet'
          }
        />
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {found.map(({ kind, object }) => (
            <ObjectChip key={`${kind}-${object.metadata.uid}`} kind={kind} object={object} />
          ))}
        </Box>
      )}
    </SectionBox>
  );
}

/** dependsOn relations of a Kustomization/HelmRelease, both directions. */
function DependenciesSection(props: { item: any; kindDef: FluxKind }) {
  const { item, kindDef } = props;
  const [objs, error] = (fluxClass(kindDef) as any).useList();

  const myName = item.metadata?.name;
  const myNamespace = item.metadata?.namespace;
  const dependsOn: { name: string; namespace?: string }[] = item.jsonData?.spec?.dependsOn ?? [];

  const byId = new Map<string, any>();
  for (const o of objs ?? []) {
    byId.set(`${o.metadata.namespace}/${o.metadata.name}`, o);
  }

  const dependents = (objs ?? []).filter((o: any) =>
    (o.jsonData?.spec?.dependsOn ?? []).some(
      (d: any) => d?.name === myName && (d?.namespace ?? o.metadata.namespace) === myNamespace
    )
  );

  if (dependsOn.length === 0 && dependents.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Dependencies">
      <NameValueTable
        rows={[
          {
            name: 'Depends on (deployed before this)',
            value: (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {dependsOn.length === 0
                  ? '-'
                  : dependsOn.map(dep => {
                      const id = `${dep.namespace ?? myNamespace}/${dep.name}`;
                      const obj = byId.get(id);
                      if (obj) {
                        return <ObjectChip key={id} kind={kindDef.kind} object={obj} />;
                      }
                      // Only claim a dependency is missing when we could
                      // actually list the resources; on error just show it.
                      return error || objs === null ? (
                        <Chip key={id} size="small" label={id} variant="outlined" />
                      ) : (
                        <Chip key={id} size="small" label={`${id} (missing)`} color="warning" />
                      );
                    })}
              </Box>
            ),
          },
          {
            name: 'Required by (deployed after this)',
            value: (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {dependents.length === 0
                  ? '-'
                  : dependents.map((obj: any) => (
                      <ObjectChip key={obj.metadata.uid} kind={kindDef.kind} object={obj} />
                    ))}
              </Box>
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

/** Kubernetes conditions as a table, newest transition first. */
function ConditionsSection(props: { conditions: any[] }) {
  const conditions = [...props.conditions].sort((a, b) =>
    (b.lastTransitionTime ?? '').localeCompare(a.lastTransitionTime ?? '')
  );
  return (
    <SectionBox title="Conditions">
      <SimpleTable
        columns={[
          { label: 'Type', getter: (c: any) => c.type },
          {
            label: 'Status',
            getter: (c: any) => (
              <StatusLabel
                status={
                  c.status === 'True'
                    ? c.type === 'Stalled'
                      ? 'error'
                      : 'success'
                    : c.status === 'False'
                    ? c.type === 'Ready'
                      ? 'error'
                      : ''
                    : 'warning'
                }
              >
                {c.status}
              </StatusLabel>
            ),
          },
          { label: 'Reason', getter: (c: any) => c.reason ?? '-' },
          { label: 'Message', getter: (c: any) => c.message ?? '-' },
          {
            label: 'Last transition',
            getter: (c: any) => (c.lastTransitionTime ? localeDate(c.lastTransitionTime) : '-'),
          },
        ]}
        data={conditions}
      />
    </SectionBox>
  );
}

/** The artifact a source currently advertises. */
function ArtifactSection(props: { item: any }) {
  const artifact = props.item?.jsonData?.status?.artifact;
  if (!artifact) {
    return (
      <SectionBox title="Artifact">
        <SectionEmpty message="No artifact stored yet" />
      </SectionBox>
    );
  }
  return (
    <SectionBox title="Artifact">
      <NameValueTable
        rows={[
          { name: 'Revision', value: artifact.revision },
          { name: 'Digest', value: artifact.digest ?? artifact.checksum ?? '-' },
          {
            name: 'Size',
            value: artifact.size ? `${(artifact.size / 1024).toFixed(1)} KiB` : '-',
          },
          { name: 'Last update', value: localeDate(artifact.lastUpdateTime) },
          { name: 'Path', value: artifact.path ?? '-' },
        ]}
      />
    </SectionBox>
  );
}

/** Helm release history (rollbacks, upgrades). */
function HelmHistorySection(props: { item: any }) {
  const history = props.item?.jsonData?.status?.history;
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  return (
    <SectionBox title="Release history">
      <SimpleTable
        columns={[
          { label: 'Version', getter: (h: any) => h.version },
          { label: 'Chart version', getter: (h: any) => h.chartVersion },
          { label: 'App version', getter: (h: any) => h.appVersion ?? '-' },
          {
            label: 'Status',
            getter: (h: any) => (
              <StatusLabel
                status={h.status === 'deployed' ? 'success' : h.status === 'failed' ? 'error' : ''}
              >
                {h.status}
              </StatusLabel>
            ),
          },
          { label: 'Deployed', getter: (h: any) => localeDate(h.lastDeployed) },
        ]}
        data={history}
      />
    </SectionBox>
  );
}

export default function FluxResourceDetails(props: { kindDef: FluxKind }) {
  const { kindDef } = props;
  const { namespace, name } = useParams<{ namespace: string; name: string }>();

  return (
    <DetailsGrid
      resourceType={fluxClass(kindDef) as any}
      name={name}
      namespace={namespace}
      withEvents
      actions={(item: any) =>
        item ? [<FluxActionButtons key="flux-actions" item={item} variant="buttons" />] : []
      }
      extraInfo={(item: any) =>
        item ? [...commonInfoRows(item), ...kindInfoRows(kindDef, item)] : []
      }
      extraSections={(item: any) => {
        if (!item) {
          return [];
        }
        const sections: React.ReactNode[] = [];
        const conditions = item.jsonData?.status?.conditions;
        if (Array.isArray(conditions) && conditions.length > 0) {
          sections.push(<ConditionsSection key="flux-conditions" conditions={conditions} />);
        }
        if (kindDef.category === 'sources') {
          sections.push(<ArtifactSection key="flux-artifact" item={item} />);
          sections.push(
            <ReferencedBySection key="flux-referenced-by" item={item} kindDef={kindDef} />
          );
        }
        if (kindDef.kind === 'Kustomization' || kindDef.kind === 'HelmRelease') {
          sections.push(
            <DependenciesSection key="flux-dependencies" item={item} kindDef={kindDef} />
          );
        }
        if (kindDef.kind === 'Kustomization') {
          sections.push(<KustomizationInventorySection key="flux-inventory" item={item} />);
        }
        if (kindDef.kind === 'HelmRelease') {
          sections.push(<HelmHistorySection key="flux-history" item={item} />);
          sections.push(<HelmReleaseInventorySection key="flux-helm-inventory" item={item} />);
        }
        return sections;
      }}
    />
  );
}
