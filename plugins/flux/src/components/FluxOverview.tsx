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
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Link as HeadlampLink,
  Loader,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Typography, useTheme } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { FLUX_ICON, ICONS } from '../flux/icon';
import { FLUX_KINDS, FluxCategory, fluxClass, FluxKind } from '../flux/kinds';
import { FluxHealth, getStatusInfo } from '../flux/utils';
import { ReadySummary, SectionEmpty } from './common';
import { ErrorState, InlineError, pickMostRelevantError } from './errors';
import { PageHeader, Pill, RADII, Section, Surface } from './ui';

const { ResourceClasses } = K8s;
const { createRouteURL } = Router;

const CATEGORY_PAGES: { category: FluxCategory; label: string; route: string; icon: string }[] = [
  { category: 'sources', label: 'Sources', route: 'fluxSources', icon: ICONS.sources },
  {
    category: 'kustomizations',
    label: 'Kustomizations',
    route: 'fluxKustomizations',
    icon: ICONS.kustomization,
  },
  {
    category: 'helmreleases',
    label: 'Helm Releases',
    route: 'fluxHelmReleases',
    icon: ICONS.helmRelease,
  },
  {
    category: 'notifications',
    label: 'Notifications',
    route: 'fluxNotifications',
    icon: ICONS.notifications,
  },
  {
    category: 'imageautomation',
    label: 'Image Automation',
    route: 'fluxImageAutomation',
    icon: ICONS.imageAutomation,
  },
];

/** Lists one Flux kind and reports the result up. */
function useKindList(
  kindDef: FluxKind,
  cluster?: string
): {
  items: any[] | null;
  error: any;
} {
  const [items, error] = (fluxClass(kindDef) as any).useList(cluster ? { cluster } : {});
  return { items, error };
}

/** A compact labeled statistic tile used in the overview header. */
function StatTile(props: {
  icon: string;
  label: string;
  value: React.ReactNode;
  color?: string;
  sub?: React.ReactNode;
}) {
  const { icon, label, value, color, sub } = props;
  const theme = useTheme();
  const c = color ?? theme.palette.text.primary;
  return (
    <Surface sx={{ flex: '1 1 180px', minWidth: 170, p: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: RADII.control,
            width: 44,
            height: 44,
            backgroundColor: alpha(c, 0.12),
            flexShrink: 0,
          }}
        >
          <Icon icon={icon} width="1.5rem" color={c} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ lineHeight: 1.1, fontWeight: 700 }}>
            {value}
          </Typography>
          <Typography variant="body2" color="textSecondary" noWrap>
            {label}
          </Typography>
          {sub}
        </Box>
      </Box>
    </Surface>
  );
}

/**
 * The at-a-glance health banner: overall state, Flux version, controllers and
 * a tally of what Flux manages — designed to be understandable without any
 * prior Flux knowledge.
 */
function FluxHealthHero(props: { cluster?: string }) {
  const theme = useTheme();
  const [deployments, deploymentsError] = ResourceClasses.Deployment.useList({
    labelSelector: 'app.kubernetes.io/part-of=flux',
    ...(props.cluster ? { cluster: props.cluster } : {}),
  });

  const results = FLUX_KINDS.map(kindDef => useKindList(kindDef, props.cluster));
  const objects = results.flatMap(r => (r.items ?? []).map((i: any) => i.jsonData));

  const counts: Record<FluxHealth, number> = {
    Ready: 0,
    NotReady: 0,
    Reconciling: 0,
    Suspended: 0,
    Unknown: 0,
  };
  objects.forEach(o => (counts[getStatusInfo(o).health] += 1));

  const controllersTotal = deployments?.length ?? 0;
  const controllersReady = (deployments ?? []).filter((d: any) => {
    const wanted = d.jsonData.spec?.replicas ?? 1;
    return (d.jsonData.status?.readyReplicas ?? 0) >= wanted;
  }).length;
  const version =
    (deployments ?? [])
      .map(
        (d: any) =>
          d.jsonData.metadata?.labels?.['app.kubernetes.io/version'] ||
          (d.jsonData.spec?.template?.spec?.containers?.[0]?.image ?? '').split(':')[1]
      )
      .find((v: string) => !!v) ?? undefined;

  const controllersHealthy = controllersTotal > 0 && controllersReady === controllersTotal;
  const nothingFailing = counts.NotReady === 0;

  const loadingControllers = deployments === null && !deploymentsError;
  const notInstalled = !loadingControllers && controllersTotal === 0 && objects.length === 0;

  let overall: { label: string; color: string; icon: string; detail: string };
  if (notInstalled) {
    overall = {
      label: 'Flux not detected',
      color: theme.palette.text.disabled,
      icon: ICONS.statusUnknown,
      detail: 'No Flux controllers or resources were found in this cluster.',
    };
  } else if (controllersHealthy && nothingFailing) {
    overall = {
      label: 'Healthy',
      color: theme.palette.success.main,
      icon: ICONS.statusReady,
      detail: 'All controllers are running and every resource is reconciled.',
    };
  } else if (!controllersHealthy && controllersTotal > 0) {
    overall = {
      label: 'Controllers degraded',
      color: theme.palette.error.main,
      icon: ICONS.statusError,
      detail: `${controllersReady} of ${controllersTotal} Flux controllers are ready.`,
    };
  } else if (!nothingFailing) {
    overall = {
      label: 'Attention needed',
      color: theme.palette.error.main,
      icon: ICONS.statusError,
      detail: `${counts.NotReady} resource${
        counts.NotReady === 1 ? '' : 's'
      } failing to reconcile.`,
    };
  } else {
    overall = {
      label: 'Reconciling',
      color: theme.palette.warning.main,
      icon: ICONS.statusReconciling,
      detail: 'Flux is applying changes.',
    };
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
      {/* Overall status hero */}
      <Surface accent={overall.color} tinted sx={{ flex: '2 1 320px', minWidth: 280, p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Icon icon={overall.icon} width="2.6rem" color={overall.color} />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {overall.label}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {overall.detail}
            </Typography>
          </Box>
        </Box>
      </Surface>

      <StatTile
        icon={FLUX_ICON}
        label="Flux version"
        value={loadingControllers ? '…' : version ?? 'unknown'}
        color={theme.palette.primary.main}
      />
      <StatTile
        icon={ICONS.controllers}
        label="Controllers ready"
        value={loadingControllers ? '…' : `${controllersReady}/${controllersTotal}`}
        color={controllersHealthy ? theme.palette.success.main : theme.palette.error.main}
      />
      <StatTile
        icon={ICONS.resources}
        label="Managed resources"
        value={objects.length}
        color={theme.palette.info.main}
        sub={
          counts.NotReady > 0 ? (
            <Typography variant="caption" color="error">
              {counts.NotReady} failing
            </Typography>
          ) : counts.Suspended > 0 ? (
            <Typography variant="caption" color="textSecondary">
              {counts.Suspended} suspended
            </Typography>
          ) : null
        }
      />
    </Box>
  );
}

function CategoryCard(props: { category: (typeof CATEGORY_PAGES)[number] }) {
  const { category } = props;
  const theme = useTheme();
  const history = useHistory();
  const kinds = FLUX_KINDS.filter(k => k.category === category.category);

  // Hooks in a loop are fine here: FLUX_KINDS is a constant list.
  const results = kinds.map(kindDef => useKindList(kindDef));
  const loaded = results.filter(r => r.items !== null);
  const objects = loaded.flatMap(r => (r.items ?? []).map((i: any) => i.jsonData));
  const allFailed = results.length > 0 && results.every(r => r.error && r.items === null);
  const failing = objects.filter(o => getStatusInfo(o).health === 'NotReady').length;
  const accent = failing > 0 ? theme.palette.error.main : theme.palette.primary.main;

  return (
    <Surface
      interactive
      accent={accent}
      onClick={() => history.push(createRouteURL(category.route))}
      sx={{ minWidth: 230, flex: '1 1 230px', p: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon={category.icon} width="1.4rem" color={accent} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {category.label}
        </Typography>
      </Box>
      {allFailed ? (
        // Show the actual reason (not installed, forbidden, unreachable,
        // ...) instead of assuming missing CRDs for every failure.
        <InlineError
          error={pickMostRelevantError(results.map(r => r.error))}
          what={category.label.toLowerCase()}
          fluxKind={category.label}
        />
      ) : loaded.length === 0 ? (
        <Loader title={`Loading ${category.label}`} size={20} />
      ) : (
        <>
          <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
            {objects.length}
          </Typography>
          <ReadySummary objects={objects} />
        </>
      )}
    </Surface>
  );
}

const CONTROLLER_ICON: Record<string, string> = {
  'source-controller': ICONS.sources,
  'kustomize-controller': ICONS.kustomization,
  'helm-controller': ICONS.helmRelease,
  'notification-controller': ICONS.notifications,
  'image-reflector-controller': ICONS.imageRepository,
  'image-automation-controller': ICONS.imageAutomation,
};

/** Health of the Flux controllers (source-controller, kustomize-controller, ...). */
export function FluxControllersSection(props: { cluster?: string } = {}) {
  const [deployments, error] = ResourceClasses.Deployment.useList({
    labelSelector: 'app.kubernetes.io/part-of=flux',
    ...(props.cluster ? { cluster: props.cluster } : {}),
  });

  const rows = (deployments ?? []).map((d: any) => {
    const spec = d.jsonData.spec ?? {};
    const status = d.jsonData.status ?? {};
    const wanted = spec.replicas ?? 1;
    const ready = status.readyReplicas ?? 0;
    const version =
      d.jsonData.metadata?.labels?.['app.kubernetes.io/version'] ||
      (spec.template?.spec?.containers?.[0]?.image ?? '').split(':')[1] ||
      '-';
    return { deployment: d, name: d.jsonData.metadata.name, wanted, ready, version };
  });

  const content = error ? (
    <Surface sx={{ p: 2 }}>
      <ErrorState error={error} what="the Flux controller deployments" />
    </Surface>
  ) : deployments === null ? (
    <Surface sx={{ p: 2 }}>
      <Loader title="Loading Flux controllers" />
    </Surface>
  ) : rows.length === 0 ? (
    <Surface sx={{ p: 2 }}>
      <SectionEmpty
        message={
          'No Flux controllers found (looked for Deployments labeled ' +
          'app.kubernetes.io/part-of=flux). Flux may not be installed in this cluster.'
        }
      />
    </Surface>
  ) : (
    <Surface sx={{ px: 2, py: 0.5 }}>
      <SimpleTable
        columns={[
          {
            label: 'Controller',
            getter: (row: any) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon icon={CONTROLLER_ICON[row.name] ?? ICONS.controllers} width="1.2rem" />
                <HeadlampLink kubeObject={row.deployment}>{row.name}</HeadlampLink>
              </Box>
            ),
          },
          { label: 'Namespace', getter: (row: any) => row.deployment.metadata.namespace },
          { label: 'Version', getter: (row: any) => row.version },
          {
            label: 'Pods',
            getter: (row: any) => `${row.ready}/${row.wanted}`,
          },
          {
            label: 'Status',
            getter: (row: any) =>
              row.ready >= row.wanted ? (
                <Pill tone="success" icon={ICONS.statusReady}>
                  Running
                </Pill>
              ) : (
                <Pill tone="error" icon={ICONS.statusError}>
                  Degraded
                </Pill>
              ),
          },
        ]}
        data={rows}
      />
    </Surface>
  );

  return (
    <Section title="Controllers" icon={ICONS.controllers}>
      {content}
    </Section>
  );
}

export default function FluxOverview() {
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <PageHeader
        icon={FLUX_ICON}
        title="Flux"
        description="A live view of everything Flux manages in this cluster — sources, kustomizations, Helm releases and automation."
        crumbs={[{ label: 'Flux' }, { label: 'Overview' }]}
      />
      <FluxHealthHero />
      <Section title="What Flux manages" sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {CATEGORY_PAGES.map(category => (
            <CategoryCard key={category.category} category={category} />
          ))}
        </Box>
      </Section>
      <FluxControllersSection />
    </Box>
  );
}

/** Ready/total summary counts for one cluster, used by the Home page tab. */
export function useFluxSummary(cluster?: string) {
  const results = FLUX_KINDS.map(kindDef => useKindList(kindDef, cluster));
  const objects = results.flatMap(r => (r.items ?? []).map((i: any) => i.jsonData));
  const loaded = results.some(r => r.items !== null);
  const failed = objects.filter(o => getStatusInfo(o).health === 'NotReady').length;
  return { total: objects.length, failed, loaded };
}
