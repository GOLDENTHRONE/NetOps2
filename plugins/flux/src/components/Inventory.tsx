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
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link as HeadlampLink,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { ICONS, kindIcon } from '../flux/icon';
import { K8sRefLink, SectionEmpty } from './common';
import { ErrorState, InlineError, pickMostRelevantError } from './errors';
import { Pill, Surface } from './ui';

const { ResourceClasses } = K8s;

/** One object managed by a Kustomization or Helm release. */
export interface ManagedEntry {
  kind: string;
  group: string;
  name: string;
  namespace?: string;
}

/** Kinds that own pods; these get an expander that lists their live pods. */
const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'];

/**
 * Parses Kustomization status.inventory entries.
 * The id format is "<namespace>_<name>_<group>_<kind>" ("_" leading for
 * cluster-scoped objects). K8s names cannot contain underscores, so a plain
 * split is safe.
 */
export function parseInventoryEntries(
  entries?: { id: string; v?: string }[] | null
): ManagedEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const result: ManagedEntry[] = [];
  for (const entry of entries) {
    const parts = (entry?.id ?? '').split('_');
    if (parts.length !== 4) {
      continue;
    }
    const [namespace, name, group, kind] = parts;
    result.push({ kind, group, name, namespace: namespace || undefined });
  }
  return result;
}

/**
 * Link for a managed object: Flux kinds (HelmRelease, Kustomization, ...)
 * go to their rich Flux pages; everything else — built-in kinds and custom
 * resources alike — opens in Headlamp's split-right details panel.
 */
function entryLink(entry: ManagedEntry): React.ReactNode {
  return (
    <K8sRefLink
      kind={entry.kind}
      group={entry.group}
      name={entry.name}
      namespace={entry.namespace}
    />
  );
}

/** Live pods of a workload, resolved through the workload's label selector. */
function WorkloadPods(props: { entry: ManagedEntry }) {
  const { entry } = props;
  const cls = (ResourceClasses as Record<string, any>)[entry.kind];
  const [workload, workloadError] = cls.useGet(entry.name, entry.namespace);
  const selector = workload?.jsonData?.spec?.selector;
  const matchLabels: Record<string, string> | undefined =
    selector?.matchLabels ?? (entry.kind === 'CronJob' ? undefined : selector);
  const labelSelector = matchLabels
    ? Object.entries(matchLabels)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : undefined;

  // The hook must run unconditionally; without a selector we use one that
  // matches nothing.
  const [pods, podsError] = ResourceClasses.Pod.useList({
    namespace: entry.namespace,
    labelSelector: labelSelector ?? 'headlamp.dev/flux-no-match',
  });

  if (workloadError) {
    return <InlineError error={workloadError} what={`the ${entry.kind} ${entry.name}`} />;
  }
  if (!labelSelector) {
    return (
      <Typography variant="caption" color="textSecondary">
        {workload === null ? 'Loading…' : 'No pod selector found'}
      </Typography>
    );
  }
  if (podsError) {
    return <InlineError error={podsError} what="the pods of this workload" />;
  }
  if (pods === null) {
    return (
      <Typography variant="caption" color="textSecondary">
        Loading pods…
      </Typography>
    );
  }
  if (pods.length === 0) {
    return (
      <Typography variant="caption" color="textSecondary">
        No pods
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, py: 0.25 }}>
      {pods.map((pod: any) => (
        <PodRow key={pod.metadata.uid} pod={pod} />
      ))}
    </Box>
  );
}

/** One live pod, compact but complete: status, ready containers, restarts, age, node. */
function PodRow(props: { pod: any }) {
  const { pod } = props;
  const json = pod.jsonData ?? {};
  const phase = json.status?.phase;
  const containerStatuses: any[] = json.status?.containerStatuses ?? [];
  const readyCount = containerStatuses.filter(c => c?.ready).length;
  const totalCount = json.spec?.containers?.length ?? containerStatuses.length;
  const restarts = containerStatuses.reduce(
    (sum, c) => sum + (typeof c?.restartCount === 'number' ? c.restartCount : 0),
    0
  );
  const node = json.spec?.nodeName;
  const created = json.metadata?.creationTimestamp;
  const tone =
    phase === 'Running' || phase === 'Succeeded'
      ? 'success'
      : phase === 'Pending'
      ? 'warning'
      : 'error';

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Icon icon={ICONS.pod} width="0.95rem" style={{ opacity: 0.6, flexShrink: 0 }} />
        <HeadlampLink kubeObject={pod}>{pod.metadata.name}</HeadlampLink>
        <Pill tone={tone} icon={tone === 'success' ? ICONS.statusReady : undefined}>
          {phase ?? 'Unknown'}
        </Pill>
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ pl: '1.6rem' }}>
        {readyCount}/{totalCount || '?'} ready
        {restarts > 0 && ` · ${restarts} restart${restarts === 1 ? '' : 's'}`}
        {created && (
          <>
            {' · '}
            <DateLabel date={created} format="mini" /> old
          </>
        )}
        {node && ` · on ${node}`}
      </Typography>
    </Box>
  );
}

/**
 * The objects managed by a Flux applier as one table, consistent with every
 * other table in the Flux UI: kind (with a recognizable icon — Vault, Helm,
 * ConfigMap, Secret, ...), a link to the real object, its namespace, and
 * live pods for workloads.
 */
export function ManagedResourcesTable(props: { entries: ManagedEntry[] }) {
  const { entries } = props;

  const sorted = React.useMemo(
    () => [...entries].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    [entries]
  );

  if (entries.length === 0) {
    return <SectionEmpty message="No managed objects reported yet" />;
  }

  return (
    <Surface sx={{ px: 2, py: 0.5 }}>
      <SimpleTable
        columns={[
          {
            label: 'Kind',
            gridTemplate: 'min-content',
            getter: (entry: ManagedEntry) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon icon={kindIcon(entry.kind, entry.group)} width="1.2rem" />
                <span>{entry.kind}</span>
              </Box>
            ),
          },
          { label: 'Name', gridTemplate: '1fr', getter: (entry: ManagedEntry) => entryLink(entry) },
          {
            label: 'Namespace',
            gridTemplate: 'min-content',
            getter: (entry: ManagedEntry) => entry.namespace ?? '-',
          },
          {
            label: 'API group',
            gridTemplate: 'min-content',
            getter: (entry: ManagedEntry) => entry.group || 'core',
          },
          {
            label: 'Pods',
            gridTemplate: '1.6fr',
            getter: (entry: ManagedEntry) =>
              WORKLOAD_KINDS.includes(entry.kind) && entry.namespace ? (
                <WorkloadPods entry={entry} />
              ) : (
                '-'
              ),
          },
        ]}
        data={sorted}
      />
    </Surface>
  );
}

/** Inventory of a Kustomization (status.inventory). */
export function KustomizationInventorySection(props: { item: any }) {
  const entries = parseInventoryEntries(props.item?.jsonData?.status?.inventory?.entries);
  return (
    <SectionBox title={`Managed objects (${entries.length})`}>
      <ManagedResourcesTable entries={entries} />
    </SectionBox>
  );
}

/** The kinds we scan for Helm-managed objects (via Flux's Helm labels). */
const HELM_SCAN_KINDS = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Service',
  'ConfigMap',
  'Secret',
  'Ingress',
  'ServiceAccount',
  'Job',
  'CronJob',
  'PersistentVolumeClaim',
] as const;

/**
 * Objects created by a HelmRelease, discovered through the labels the Flux
 * helm-controller adds to rendered manifests.
 */
export function HelmReleaseInventorySection(props: { item: any }) {
  const { item } = props;
  const name = item.metadata?.name;
  const namespace = item.metadata?.namespace;
  const targetNamespace = item.jsonData?.spec?.targetNamespace;
  const labelSelector = `helm.toolkit.fluxcd.io/name=${name},helm.toolkit.fluxcd.io/namespace=${namespace}`;

  const entries: ManagedEntry[] = [];
  const errors: any[] = [];
  let loading = false;
  for (const kind of HELM_SCAN_KINDS) {
    const cls = (ResourceClasses as Record<string, any>)[kind];
    // Constant list of kinds, so the hook order is stable.
    const [objs, err] = cls.useList({
      labelSelector,
      ...(targetNamespace ? { namespace: targetNamespace } : {}),
    });
    if (objs === null && !err) {
      loading = true;
    }
    if (err) {
      errors.push(err);
    }
    for (const obj of objs ?? []) {
      entries.push({
        kind,
        group: cls.apiGroupName ?? '',
        name: obj.metadata.name,
        namespace: obj.metadata.namespace,
      });
    }
  }

  const allFailed = errors.length === HELM_SCAN_KINDS.length;

  return (
    <SectionBox title={`Managed objects (${entries.length})`}>
      {allFailed ? (
        <ErrorState
          error={pickMostRelevantError(errors)}
          what="the objects created by this Helm release"
        />
      ) : entries.length === 0 && loading ? (
        <SectionEmpty message="Looking for objects labeled by the helm-controller…" />
      ) : (
        <>
          <ManagedResourcesTable entries={entries} />
          {errors.length > 0 && (
            <InlineError
              error={pickMostRelevantError(errors)}
              what={`some resource kinds (${errors.length} of ${HELM_SCAN_KINDS.length} checks failed)`}
            />
          )}
        </>
      )}
    </SectionBox>
  );
}
