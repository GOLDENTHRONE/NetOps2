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
  Link as HeadlampLink,
  SectionBox,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, IconButton, Link as MuiLink, Typography } from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { SectionEmpty } from './common';
import { ErrorState, InlineError, pickMostRelevantError } from './errors';

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

/** Details page link for a managed object; plain text when the kind is unknown. */
function entryLink(entry: ManagedEntry): React.ReactNode {
  const cls = (ResourceClasses as Record<string, any>)[entry.kind];
  const nameText = entry.namespace ? `${entry.namespace}/${entry.name}` : entry.name;
  if (!cls || (cls.apiGroupName ?? '') !== entry.group) {
    return <span>{nameText}</span>;
  }
  let url = '';
  try {
    const obj = new cls({
      kind: entry.kind,
      apiVersion: entry.group ? `${entry.group}/v1` : 'v1',
      metadata: { name: entry.name, namespace: entry.namespace },
    });
    url = obj.getDetailsLink();
  } catch (e) {
    url = '';
  }
  if (!url) {
    return <span>{nameText}</span>;
  }
  return (
    <MuiLink component={RouterLink} to={url}>
      {nameText}
    </MuiLink>
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {pods.map((pod: any) => {
        const phase = pod.jsonData?.status?.phase;
        return (
          <Box key={pod.metadata.uid} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:subdirectory-arrow-right" width="1rem" />
            <HeadlampLink kubeObject={pod}>{pod.metadata.name}</HeadlampLink>
            <StatusLabel
              status={
                phase === 'Running' || phase === 'Succeeded'
                  ? 'success'
                  : phase === 'Pending'
                  ? 'warning'
                  : 'error'
              }
            >
              {phase ?? 'Unknown'}
            </StatusLabel>
          </Box>
        );
      })}
    </Box>
  );
}

function EntryRow(props: { entry: ManagedEntry }) {
  const { entry } = props;
  const [expanded, setExpanded] = React.useState(false);
  const expandable = WORKLOAD_KINDS.includes(entry.kind) && !!entry.namespace;

  return (
    <Box sx={{ pl: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {expandable ? (
          <IconButton
            size="small"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Hide pods' : 'Show pods'}
          >
            <Icon icon={expanded ? 'mdi:chevron-down' : 'mdi:chevron-right'} width="1.1rem" />
          </IconButton>
        ) : (
          <Box sx={{ width: '1.85rem' }} />
        )}
        {entryLink(entry)}
      </Box>
      {expanded && (
        <Box sx={{ pl: 5, pb: 1 }}>
          <WorkloadPods entry={entry} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Hierarchical view of the objects managed by a Flux applier, grouped by
 * kind. Workloads can be expanded down to their live pods, and every entry
 * links to the regular Headlamp details view (logs, shell, edit, ...).
 */
export function ManagedResourcesTree(props: { entries: ManagedEntry[] }) {
  const { entries } = props;
  const groups = React.useMemo(() => {
    const map = new Map<string, ManagedEntry[]>();
    for (const entry of entries) {
      const key = entry.group ? `${entry.kind} (${entry.group})` : entry.kind;
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  if (entries.length === 0) {
    return <SectionEmpty message="No managed objects reported yet" />;
  }

  return (
    <Box>
      {groups.map(([kindLabel, kindEntries]) => (
        <Box key={kindLabel} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {kindLabel} ({kindEntries.length})
          </Typography>
          {kindEntries
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(entry => (
              <EntryRow key={`${entry.namespace ?? ''}/${entry.name}`} entry={entry} />
            ))}
        </Box>
      ))}
    </Box>
  );
}

/** Inventory of a Kustomization (status.inventory). */
export function KustomizationInventorySection(props: { item: any }) {
  const entries = parseInventoryEntries(props.item?.jsonData?.status?.inventory?.entries);
  return (
    <SectionBox title={`Managed objects (${entries.length})`}>
      <ManagedResourcesTree entries={entries} />
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
          <ManagedResourcesTree entries={entries} />
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
