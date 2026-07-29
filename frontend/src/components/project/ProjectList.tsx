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
import { Box, Button, Typography } from '@mui/material';
import { groupBy, uniq } from 'lodash';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClustersConf } from '../../lib/k8s';
import { KubeObject } from '../../lib/k8s/KubeObject';
import Namespace from '../../lib/k8s/namespace';
import { useTypedSelector } from '../../redux/hooks';
import { ProjectDefinition } from '../../redux/projectsSlice';
import { StatusLabel } from '../common';
import Link from '../common/Link';
import Table, { TableColumn } from '../common/Table/Table';
import { NewProjectPopup } from './NewProjectPopup';
import { getHealthIcon, getResourcesHealth, PROJECT_ID_LABEL } from './projectUtils';
import { useAllProjectItems } from './useProjectResources';

// The labelSelector on Namespace.useList filters at the API level, but the
// returned list can still transiently include items without metadata.labels
// populated (multi-cluster fan-out, react-query cache during a label
// removal). Without the filter below an unguarded access crashed the
// Projects page. See issue #5254.
export function groupNamespacesIntoProjects(
  namespaces: ReadonlyArray<{
    metadata: { name: string; labels?: Record<string, string> };
    cluster: string;
  }>
): ProjectDefinition[] {
  const labelled = namespaces.filter(n => n.metadata.labels?.[PROJECT_ID_LABEL]);
  return Object.entries(groupBy(labelled, n => n.metadata.labels![PROJECT_ID_LABEL])).map(
    ([id, ns]) => ({
      id,
      namespaces: uniq(ns.map(it => it.metadata.name)),
      clusters: uniq(ns.map(it => it.cluster)),
    })
  );
}

const useProjects = (): ProjectDefinition[] => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces } = Namespace.useList({
    clusters: clusters.map(c => c.name),
    labelSelector: PROJECT_ID_LABEL,
  });

  return useMemo(() => groupNamespacesIntoProjects(namespaces ?? []), [namespaces]);
};

export const useProject = (name: string) => {
  const clusterConf = useClustersConf();
  const clusters = Object.values(clusterConf ?? {});

  const { items: namespaces, isLoading } = Namespace.useList({
    clusters: clusters.map(c => c.name),
    labelSelector: PROJECT_ID_LABEL + '=' + name,
  });

  return useMemo(
    () => ({
      isLoading,
      project: namespaces
        ? ({
            clusters: uniq(namespaces.map(it => it.cluster)),
            namespaces: uniq(namespaces.map(it => it.metadata.name)),
            id: name,
          } as ProjectDefinition)
        : undefined,
    }),
    [namespaces, name, isLoading]
  );
};

/** Health severity rank — worst first for sorting. */
const HEALTH_RANK: Record<string, number> = {
  Unhealthy: 0,
  Degraded: 1,
  Healthy: 2,
  'No Resources': 3,
};

/** A project with pre-computed health so the table can sort/filter. */
interface ProjectRow extends ProjectDefinition {
  resourceCount: number;
  healthLabel: string;
  healthStatus: 'error' | 'warning' | 'success';
  healthIcon: string;
}

export default function ProjectList() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const pluginApiResources = useTypedSelector(state => state.projects.apiResources);

  const projects = useProjects();

  // Fetch resources for all projects in one batch so health can be pre-computed
  // and the table can sort/filter by health without per-cell hooks.
  const { items: allItems } = useAllProjectItems(projects);

  // Group resources by project (namespace membership) and compute health.
  const tableData = useMemo<ProjectRow[]>(() => {
    const byNamespace = new Map<string, KubeObject[]>();
    for (const item of allItems) {
      const ns = item.metadata?.namespace;
      if (!ns) continue;
      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      byNamespace.get(ns)!.push(item);
    }

    return projects.map(project => {
      const items = project.namespaces.flatMap(ns => byNamespace.get(ns) ?? []);
      const projectHealth = getResourcesHealth(items);
      const healthLabel =
        items.length === 0
          ? t('No Resources')
          : projectHealth.error > 0
          ? t('Unhealthy')
          : projectHealth.warning > 0
          ? t('Degraded')
          : t('Healthy');
      const healthStatus: 'error' | 'warning' | 'success' =
        projectHealth.error > 0 ? 'error' : projectHealth.warning > 0 ? 'warning' : 'success';
      const healthIcon = getHealthIcon(
        projectHealth.success,
        projectHealth.error,
        projectHealth.warning
      );
      return {
        ...project,
        resourceCount: items.length,
        healthLabel,
        healthStatus,
        healthIcon,
      };
    });
  }, [projects, allItems, t]);

  const handleCreateProject = () => {
    setShowCreate(true);
  };

  const columns = useMemo<TableColumn<ProjectRow, any>[]>(() => {
    return [
      {
        id: 'name',
        header: t('Name'),
        accessorFn: it => it.id,
        Cell: ({ row: { original } }) => (
          <Link routeName="projectDetails" params={{ name: original.id }}>
            {original.id}
          </Link>
        ),
      },
      {
        id: 'resources',
        header: t('Resources'),
        accessorFn: it => it.resourceCount,
        enableColumnFilter: false,
        gridTemplate: 'min-content',
      },
      {
        id: 'health',
        header: t('Health'),
        accessorFn: it => it.healthLabel,
        filterVariant: 'multi-select',
        sortingFn: (rowA, rowB) =>
          (HEALTH_RANK[rowA.original.healthLabel] ?? 4) -
          (HEALTH_RANK[rowB.original.healthLabel] ?? 4),
        gridTemplate: 'min-content',
        muiTableHeadCellProps: {
          align: 'center',
        },
        muiTableBodyCellProps: {
          sx: { justifyContent: 'center' },
        },
        Cell: ({ row: { original } }) => (
          <StatusLabel status={original.healthStatus}>
            <Icon icon={original.healthIcon} style={{ fontSize: 24 }} />
            {original.healthLabel}
          </StatusLabel>
        ),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (projects.length === 0) {
    return (
      <>
        {showCreate && <NewProjectPopup open={showCreate} onClose={() => setShowCreate(false)} />}
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight="400px"
          textAlign="center"
        >
          <Icon
            icon="mdi:folder-multiple"
            style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }}
          />
          <Typography variant="h6" gutterBottom>
            {t('No projects found')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('Create your first project to organize your Kubernetes resources')}
          </Typography>
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={handleCreateProject}
          >
            {t('Create Project')}
          </Button>
        </Box>
      </>
    );
  }

  return (
    <>
      {showCreate && <NewProjectPopup open={showCreate} onClose={() => setShowCreate(false)} />}
      <Box display="flex" justifyContent="flex-end" mb={2} mt={2}>
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={handleCreateProject}
        >
          {t('Create Project')}
        </Button>
      </Box>

      <Table
        key={pluginApiResources.length}
        columns={columns}
        data={tableData}
        initialState={{
          sorting: [{ id: 'health', desc: false }],
        }}
      />
    </>
  );
}
