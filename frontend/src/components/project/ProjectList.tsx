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
import { Box, Typography } from '@mui/material';
import { groupBy, uniq } from 'lodash';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClustersConf } from '../../lib/k8s';
import Namespace from '../../lib/k8s/namespace';
import { HeadlampEventType, useEventCallback } from '../../redux/headlampEventSlice';
import { useTypedSelector } from '../../redux/hooks';
import { ProjectDefinition } from '../../redux/projectsSlice';
import AllowedNamespacesSelectorGate from '../App/AllowedNamespacesSelectorGate';
import { StatusLabel } from '../common';
import Link from '../common/Link';
import { PureNamespacesAutocomplete } from '../common/NamespacesAutocomplete';
import Table, { TableColumn } from '../common/Table/Table';
import { getHealthIcon, getResourcesHealth, isSystemNamespace } from './projectUtils';
import { useProjectItems } from './useProjectResources';

// Applications are auto-discovered: every namespace the user's token can see
// becomes an application (application name = namespace name), except system /
// infrastructure namespaces (see isSystemNamespace). Namespaces with the same
// name across multiple clusters are collapsed into a single application that
// spans those clusters.
//
// metadata.name is guarded because the multi-cluster fan-out / react-query
// cache can transiently yield items without it. See issue #5254.
export function discoverProjectsFromNamespaces(
  namespaces: ReadonlyArray<{
    metadata: { name: string };
    cluster: string;
  }>
): ProjectDefinition[] {
  const visible = namespaces.filter(n => n.metadata?.name && !isSystemNamespace(n.metadata.name));
  return Object.entries(groupBy(visible, n => n.metadata.name)).map(([name, ns]) => ({
    id: name,
    namespaces: [name],
    clusters: uniq(ns.map(it => it.cluster)),
  }));
}

/**
 * Filters the application (project) list by a set of selected namespaces.
 *
 * An empty selection means "no filter" and returns every project unchanged, so
 * the default view (nothing selected) shows all applications.
 *
 * @param projects - The full list of discovered applications.
 * @param selectedNamespaces - Namespaces chosen in the dropdown.
 * @returns The projects that include at least one of the selected namespaces.
 */
export function filterProjectsByNamespaces(
  projects: ProjectDefinition[],
  selectedNamespaces: string[]
): ProjectDefinition[] {
  if (!selectedNamespaces || selectedNamespaces.length === 0) {
    return projects;
  }
  const selected = new Set(selectedNamespaces);
  return projects.filter(project => project.namespaces.some(ns => selected.has(ns)));
}

const useProjects = (): ProjectDefinition[] => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces } = Namespace.useList({
    clusters: clusters.map(c => c.name),
  });

  return useMemo(() => discoverProjectsFromNamespaces(namespaces ?? []), [namespaces]);
};

export const useProject = (name: string) => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces, isLoading } = Namespace.useList({
    clusters: clusters.map(c => c.name),
  });

  return useMemo(
    () => ({
      isLoading,
      project: namespaces
        ? discoverProjectsFromNamespaces(namespaces).find(project => project.id === name) ?? {
            id: name,
            clusters: [],
            namespaces: [],
          }
        : undefined,
    }),
    [namespaces, name, isLoading]
  );
};

function ProjectListContent() {
  const { t } = useTranslation();
  const pluginApiResources = useTypedSelector(state => state.projects.apiResources);

  const projects = useProjects();
  const dispatchHeadlampEvent = useEventCallback(HeadlampEventType.PROJECT_LIST_VIEW);

  // No namespace is selected by default, so the table shows every application.
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);

  const namespaceOptions = useMemo(
    () => uniq(projects.flatMap(project => project.namespaces)).sort(),
    [projects]
  );

  const filteredProjects = useMemo(
    () => filterProjectsByNamespaces(projects, selectedNamespaces),
    [projects, selectedNamespaces]
  );

  useEffect(() => {
    dispatchHeadlampEvent({ projects });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // MRT can only sort a column when it has a value on the row data (accessorFn/accessorKey),
  // and it only recomputes that value when the *data array reference* passed to the table
  // changes. The "Resources" and "Health" columns are rendered purely from a per-row Cell
  // hook (useProjectItems), so the counts/ranks below are collected as they're computed and
  // then baked directly onto the row objects (see `projectRows`) so a new data array is
  // produced whenever they change, without altering what each Cell renders.
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({});
  const [healthRanks, setHealthRanks] = useState<Record<string, number>>({});

  const reportResourceCount = useCallback((id: string, count: number) => {
    setResourceCounts(prev => (prev[id] === count ? prev : { ...prev, [id]: count }));
  }, []);

  const reportHealthRank = useCallback((id: string, rank: number) => {
    setHealthRanks(prev => (prev[id] === rank ? prev : { ...prev, [id]: rank }));
  }, []);

  // -1 (not yet loaded) sorts before any loaded count/rank.
  const projectRows = useMemo(
    () =>
      filteredProjects.map(project => ({
        ...project,
        resourceCount: resourceCounts[project.id] ?? -1,
        healthRank: healthRanks[project.id] ?? -1,
      })),
    [filteredProjects, resourceCounts, healthRanks]
  );

  const columns = useMemo(() => {
    const columns: TableColumn<(typeof projectRows)[number], any>[] = [
      {
        id: 'name',
        header: t('Name'),
        accessorFn: it => it.id,
        Cell: ({ row: { original } }) => (
          <>
            <Link routeName="projectDetails" params={{ name: original.id }}>
              {original.id}
            </Link>
          </>
        ),
      },
      {
        id: 'resources',
        header: t('Resources'),
        accessorFn: it => it.resourceCount,
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          useEffect(() => {
            reportResourceCount(original.id, items.length);
          }, [original.id, items.length]);
          return items.length;
        },
        gridTemplate: 'min-content',
      },
      {
        id: 'health',
        header: t('Health'),
        // Rank used purely for sorting: 0 = no resources, 1 = healthy, 2 = degraded, 3 = unhealthy.
        accessorFn: it => it.healthRank,
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          const projectHealth = getResourcesHealth(items);
          useEffect(() => {
            const rank =
              items.length === 0
                ? 0
                : projectHealth.error > 0
                ? 3
                : projectHealth.warning > 0
                ? 2
                : 1;
            reportHealthRank(original.id, rank);
          }, [original.id, items.length, projectHealth.error, projectHealth.warning]);
          return (
            <StatusLabel
              status={
                projectHealth.error > 0
                  ? 'error'
                  : projectHealth.warning > 0
                  ? 'warning'
                  : 'success'
              }
            >
              <Icon
                icon={getHealthIcon(
                  projectHealth.success,
                  projectHealth.error,
                  projectHealth.warning
                )}
                style={{
                  fontSize: 24,
                }}
              />
              {items.length === 0
                ? t('No Resources')
                : projectHealth.error > 0
                ? t('Unhealthy')
                : projectHealth.warning > 0
                ? t('Degraded')
                : t('Healthy')}
            </StatusLabel>
          );
        },
        gridTemplate: 'min-content',
      },
      {
        id: 'clusters',
        header: t('Clusters'),
        accessorFn: it => it.clusters.join(', '),
      },
      {
        id: 'namespaces',
        header: t('Namespaces'),
        accessorFn: it => it.namespaces.join(', '),
      },
    ];

    return columns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  if (projects.length === 0) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="400px"
        textAlign="center"
      >
        <Icon icon="mdi:apps" style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }} />
        <Typography variant="h6" gutterBottom>
          {t('No applications found')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('No namespaces are visible to your account, or they are all system namespaces.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        '& .MuiTable-root': {
          mt: '8px',
        },
      }}
    >
      <Table
        key={pluginApiResources.length}
        columns={columns}
        data={projectRows}
        // Render the namespace filter on the left of the table's top toolbar so
        // it sits on the same line as the search and column/filter buttons.
        // Reuses the app's standard namespace selector (checkboxes + Filter box)
        // for a consistent look and feel.
        renderTopToolbarCustomActions={() => (
          <PureNamespacesAutocomplete
            namespaceNames={namespaceOptions}
            filter={{ namespaces: new Set(selectedNamespaces) }}
            onChange={(_event, newValue) => setSelectedNamespaces(newValue)}
          />
        )}
      />
    </Box>
  );
}

/**
 * Resolves configured namespace selectors before querying the project list.
 *
 * @returns The gated project list.
 */
export default function ProjectList() {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {}).map(cluster => cluster.name);

  return (
    <AllowedNamespacesSelectorGate clusters={clusters}>
      <ProjectListContent />
    </AllowedNamespacesSelectorGate>
  );
}
