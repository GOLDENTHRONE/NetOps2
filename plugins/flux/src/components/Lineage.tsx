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

/**
 * The deployment lineage: one strip that answers "where did this come from
 * and where did it land?"; from the Git/OCI source, through the Flux object
 * that defines it, to the namespaces and workloads it ultimately deploys.
 * Namespaces are shown as metadata along the way, never as a navigation
 * boundary: every step is clickable regardless of where it lives.
 */

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link as HeadlampLink, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Typography, useTheme } from '@mui/material';
import React from 'react';
import { ICONS } from '../flux/icon';
import { getTargetNamespaces } from '../flux/insights';
import { fluxClass, FluxKind, kindByName } from '../flux/kinds';
import { FluxObject, getSourceRef, getStatusInfo, parseRevision } from '../flux/utils';
import { FluxLink, healthPresentation, NA } from './common';
import { parseInventoryEntries } from './Inventory';
import { Pill, RADII, Surface, useAccents } from './ui';

/** Labels Flux's kustomize-controller stamps on everything it applies. */
const KUSTOMIZE_NAME_LABEL = 'kustomize.toolkit.fluxcd.io/name';
const KUSTOMIZE_NAMESPACE_LABEL = 'kustomize.toolkit.fluxcd.io/namespace';

const KIND_ICON: Record<string, string> = {
  GitRepository: ICONS.gitRepository,
  OCIRepository: ICONS.ociRepository,
  HelmRepository: ICONS.helmRepository,
  HelmChart: ICONS.helmChart,
  Bucket: ICONS.bucket,
  Kustomization: ICONS.kustomization,
  HelmRelease: ICONS.helmRelease,
};

interface LineageStep {
  /** The role this step plays in the story, e.g. "Pulls from". */
  role: string;
  icon: string;
  content: React.ReactNode;
  /** Extra line under the main content. */
  detail?: React.ReactNode;
  /** Mark the current resource's own step. */
  current?: boolean;
}

function StepCard(props: { step: LineageStep }) {
  const { step } = props;
  const theme = useTheme();
  const accents = useAccents();
  const border = step.current
    ? `1.5px solid ${alpha(accents.primary, 0.7)}`
    : `1px solid ${alpha(theme.palette.divider, 0.6)}`;
  return (
    <Box
      sx={{
        borderRadius: RADII.card,
        border,
        backgroundColor: step.current
          ? alpha(accents.primary, theme.palette.mode === 'dark' ? 0.12 : 0.06)
          : theme.palette.background.paper,
        px: 1.5,
        py: 1,
        minWidth: 170,
        flexShrink: 0,
      }}
    >
      <Typography
        variant="overline"
        sx={{ lineHeight: 1.4, color: 'text.secondary', display: 'block' }}
      >
        {step.role}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Icon icon={step.icon} width="1.1rem" />
        <Box sx={{ minWidth: 0, fontSize: '0.875rem', fontWeight: 600 }}>{step.content}</Box>
      </Box>
      {step.detail && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {step.detail}
        </Typography>
      )}
    </Box>
  );
}

function LineageFlow(props: { steps: LineageStep[] }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, overflowX: 'auto', py: 0.5 }}>
      {props.steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.disabled', px: 0.25 }}>
              <Icon icon={ICONS.arrowRight} width="1.4rem" />
            </Box>
          )}
          <StepCard step={step} />
        </React.Fragment>
      ))}
    </Box>
  );
}

/** Small live-status pill for another Flux object, resolved via useGet. */
function LiveStatusPill(props: { kindDef: FluxKind; name: string; namespace?: string }) {
  const { kindDef, name, namespace } = props;
  const [obj] = (fluxClass(kindDef) as any).useGet(name, namespace);
  if (!obj) {
    return null;
  }
  const info = getStatusInfo(obj.jsonData);
  const p = healthPresentation(info.health);
  return (
    <Pill
      tone={p.tone}
      icon={p.icon}
      title={[info.reason, info.message].filter(Boolean).join(': ')}
    >
      {p.label}
    </Pill>
  );
}

/**
 * Live readiness of the workloads this applier created, found through the
 * labels the Flux controllers stamp on everything they apply: "3/4
 * workloads ready" tells the operator the real state of the deployment,
 * not just whether the manifests were applied.
 */
function WorkloadsHealthPill(props: { labelSelector: string }) {
  const kinds = ['Deployment', 'StatefulSet', 'DaemonSet'] as const;
  let total = 0;
  let ready = 0;
  let loading = false;
  for (const kind of kinds) {
    const cls = (K8s.ResourceClasses as Record<string, any>)[kind];
    // Constant kind list, so the hook order is stable.
    const [objs] = cls.useList({ labelSelector: props.labelSelector });
    if (objs === null) {
      loading = true;
    }
    for (const o of objs ?? []) {
      total += 1;
      const wanted =
        kind === 'DaemonSet'
          ? o.jsonData?.status?.desiredNumberScheduled ?? 0
          : o.jsonData?.spec?.replicas ?? 1;
      const readyReplicas =
        kind === 'DaemonSet'
          ? o.jsonData?.status?.numberReady ?? 0
          : o.jsonData?.status?.readyReplicas ?? 0;
      if (readyReplicas >= wanted) {
        ready += 1;
      }
    }
  }
  if (total === 0 || loading) {
    return null;
  }
  return ready === total ? (
    <Pill tone="success" icon={ICONS.statusReady}>
      {total} workload{total === 1 ? '' : 's'} ready
    </Pill>
  ) : (
    <Pill tone="warning" icon={ICONS.statusReconciling}>
      {ready}/{total} workloads ready
    </Pill>
  );
}

export function NamespaceChips(props: { namespaces: string[] }) {
  const accents = useAccents();
  if (props.namespaces.length === 0) {
    return <NA />;
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {props.namespaces.map(namespace => (
        <HeadlampLink
          key={namespace}
          routeName="namespace"
          params={{ name: namespace }}
          underline="none"
        >
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.4,
              px: 0.9,
              py: '2px',
              borderRadius: RADII.pill,
              fontSize: '0.75rem',
              fontWeight: 600,
              color: accents.primary,
              backgroundColor: alpha(accents.primary, 0.1),
              whiteSpace: 'nowrap',
            }}
          >
            <Icon icon={ICONS.namespace} width="0.8rem" />
            {namespace}
          </Box>
        </HeadlampLink>
      ))}
    </Box>
  );
}

/** Kinds that run pods; counted separately in the "deploys" summary. */
const WORKLOAD_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
]);

/**
 * Lineage for a Kustomization or HelmRelease: the source it pulls from, the
 * Kustomization that defines it (when Flux applied it from Git), itself, and
 * the namespaces/workloads it deploys; crossing namespaces transparently.
 */
export function LineageSection(props: { item: any; kindDef: FluxKind }) {
  const { item, kindDef } = props;
  const object: FluxObject = item.jsonData;
  const steps: LineageStep[] = [];

  // Who defined this object? kustomize-controller labels everything it applies.
  const labels = (object.metadata as any)?.labels ?? {};
  const definedBy: { name: string; namespace: string } | undefined = labels[KUSTOMIZE_NAME_LABEL]
    ? { name: labels[KUSTOMIZE_NAME_LABEL], namespace: labels[KUSTOMIZE_NAMESPACE_LABEL] ?? '' }
    : undefined;
  const isSelfReference =
    kindDef.kind === 'Kustomization' &&
    definedBy?.name === object.metadata?.name &&
    definedBy?.namespace === object.metadata?.namespace;
  const kustomizationKindDef = kindByName('Kustomization');
  if (definedBy && !isSelfReference) {
    steps.push({
      role: 'Defined by',
      icon: ICONS.kustomization,
      content: (
        <FluxLink kind="Kustomization" name={definedBy.name} namespace={definedBy.namespace}>
          {definedBy.name}
        </FluxLink>
      ),
      detail: (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <span>Kustomization · {definedBy.namespace || 'n/a'}</span>
          {kustomizationKindDef && definedBy.namespace && (
            <LiveStatusPill
              kindDef={kustomizationKindDef}
              name={definedBy.name}
              namespace={definedBy.namespace}
            />
          )}
        </Box>
      ),
    });
  }

  const sourceRef = getSourceRef(object);
  if (sourceRef) {
    const sourceKindDef = kindByName(sourceRef.kind);
    const revision = object?.status?.lastAppliedRevision ?? object?.status?.artifact?.revision;
    const parsed = parseRevision(revision);
    steps.push({
      role: kindDef.kind === 'HelmRelease' ? 'Chart from' : 'Pulls from',
      icon: KIND_ICON[sourceRef.kind] ?? ICONS.sources,
      content: (
        <FluxLink kind={sourceRef.kind} name={sourceRef.name} namespace={sourceRef.namespace}>
          {sourceRef.name}
        </FluxLink>
      ),
      detail: (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <span>{sourceRef.kind}</span>
          {(parsed.ref || parsed.shortHash) && (
            <Pill tone="neutral" icon={ICONS.commit} title={revision}>
              {[parsed.ref, parsed.shortHash].filter(Boolean).join(' @ ')}
            </Pill>
          )}
          {sourceKindDef && (
            <LiveStatusPill
              kindDef={sourceKindDef}
              name={sourceRef.name}
              namespace={sourceRef.namespace}
            />
          )}
        </Box>
      ),
    });
  }

  const info = getStatusInfo(object);
  const p = healthPresentation(info.health);
  steps.push({
    role: 'This resource',
    icon: KIND_ICON[kindDef.kind] ?? ICONS.resources,
    content: <span>{object.metadata?.name}</span>,
    detail: (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <span>
          {kindDef.kind} · {object.metadata?.namespace}
        </span>
        <Pill tone={p.tone} icon={p.icon}>
          {p.label}
        </Pill>
      </Box>
    ),
    current: true,
  });

  const namespaces = getTargetNamespaces(object);
  const entries = parseInventoryEntries(object?.status?.inventory?.entries);
  const workloads = entries.filter(e => WORKLOAD_KINDS.has(e.kind)).length;
  const appliedLabelSelector =
    kindDef.kind === 'HelmRelease'
      ? `helm.toolkit.fluxcd.io/name=${object.metadata?.name},helm.toolkit.fluxcd.io/namespace=${object.metadata?.namespace}`
      : `${KUSTOMIZE_NAME_LABEL}=${object.metadata?.name},${KUSTOMIZE_NAMESPACE_LABEL}=${object.metadata?.namespace}`;
  steps.push({
    role: 'Deploys to',
    icon: ICONS.namespace,
    content: <NamespaceChips namespaces={namespaces} />,
    detail: (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        {entries.length > 0 && (
          <span>
            {entries.length} object{entries.length === 1 ? '' : 's'}
            {workloads > 0 ? `, ${workloads} workload${workloads === 1 ? '' : 's'}` : ''}
            {' (see "Managed objects" below)'}
          </span>
        )}
        <WorkloadsHealthPill labelSelector={appliedLabelSelector} />
      </Box>
    ),
  });

  return (
    <SectionBox title="Deployment lineage">
      <Surface sx={{ p: 1.5 }}>
        <LineageFlow steps={steps} />
      </Surface>
    </SectionBox>
  );
}
