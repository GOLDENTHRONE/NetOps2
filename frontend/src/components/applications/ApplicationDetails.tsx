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
import {
  Box,
  Card,
  CardContent,
  Grid,
  Link as MuiLink,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { KubeObject } from '../../lib/k8s/KubeObject';
import ResourceQuota from '../../lib/k8s/resourceQuota';
import { SelectedClustersContext } from '../../lib/k8s/SelectedClustersContext';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import { DateLabel, EditButton, Loader, StatusLabel } from '../common';
import Link from '../common/Link';
import SectionBox from '../common/SectionBox';
import Table, { TableColumn } from '../common/Table/Table';
import { ProjectResourcesTab, useResourceCategoriesList } from '../project/ProjectResourcesTab';
import { ResourceCategoriesList } from '../project/ResourceCategoriesList';
import { GraphFilter } from '../resourceMap/graph/graphFiltering';
import { GraphView } from '../resourceMap/GraphView';
import { ResourceQuotaTable } from '../resourceQuota/Details';
import { evaluateApplicationHealth } from './applicationHealth';
import { ApplicationHealthChip, buildWorkloadObjectsMap } from './ApplicationHealthChip';
import { ApplicationDefinition, NOT_AVAILABLE } from './applicationUtils';
import { useAllApplicationResources } from './useApplicationResources';
import { useApplication } from './useApplications';

// Tab IDs, mirroring the Project details page this page is modeled on.
const TAB_IDS = {
  OVERVIEW: 'headlamp-applications.tabs.overview',
  RESOURCES: 'headlamp-applications.tabs.resources',
  ACCESS: 'headlamp-applications.tabs.access',
  MAP: 'headlamp-applications.tabs.map',
} as const;

interface ApplicationDetailsParams {
  name: string;
}

/**
 * Application details page at /application/:name — the same layout as the
 * Project details page (Overview, Resources, Access and Map tabs), for one
 * application, i.e. one business namespace across every cluster it exists in.
 *
 * Unlike the Projects page, everything clickable here redirects to the actual
 * object's own page (the way clicking a cluster on the Home page enters the
 * cluster) instead of opening details in a drawer on top of this page.
 */
export default function ApplicationDetails() {
  const { t } = useTranslation(['translation', 'glossary']);
  const { name } = useParams<ApplicationDetailsParams>();
  const { application, errors, isLoading } = useApplication(name);

  if (isLoading && !application) {
    return <Loader title={t('translation|Loading')} />;
  }

  if (!application) {
    return (
      <SectionBox backLink title={name}>
        <ClusterGroupErrorMessage errors={errors} />
        <Typography sx={{ my: 2 }}>{t('translation|No applications found')}</Typography>
      </SectionBox>
    );
  }

  // Key forces a remount when switching applications, which is required
  // because useProjectItems calls hooks per resource in a loop (the array
  // length must stay stable per mount).
  return <ApplicationDetailsContent key={application.id} application={application} />;
}

/** Small subdued value for metadata that is not available (yet). */
function MetadataValue({ value }: { value: string }) {
  if (value === NOT_AVAILABLE) {
    return (
      <Typography component="span" variant="caption" color="text.secondary">
        {NOT_AVAILABLE}
      </Typography>
    );
  }
  return <Typography component="span">{value}</Typography>;
}

function ApplicationDetailsContent({ application }: { application: ApplicationDefinition }) {
  const { t } = useTranslation(['translation', 'glossary']);
  const [selectedTab, setSelectedTab] = useState<string>(TAB_IDS.OVERVIEW);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>();

  // The exact same shared, watched queries the Applications table uses: the
  // counts here always match the table, and navigating from the table to this
  // page is instant because the data is already in the cache.
  const { items: allResources, errors, isLoading } = useAllApplicationResources();
  // Filter by namespace only — exactly how the Applications table groups its
  // counts — so this page can never disagree with the table.
  const items = useMemo(
    () => allResources.filter(it => it.metadata.namespace === application.id),
    [allResources, application.id]
  );

  const tabs = [
    { id: TAB_IDS.OVERVIEW, icon: 'mdi:view-dashboard', label: t('translation|Overview') },
    { id: TAB_IDS.RESOURCES, icon: 'mdi:format-list-bulleted', label: t('translation|Resources') },
    { id: TAB_IDS.ACCESS, icon: 'mdi:account-lock', label: t('translation|Access') },
    { id: TAB_IDS.MAP, icon: 'mdi:map', label: t('translation|Map') },
  ];

  // Only block on a loader when nothing has arrived yet (a direct deep link);
  // coming from the Applications table the data is already cached, so the
  // page renders immediately with the final numbers.
  if (isLoading && items.length === 0) {
    return <Loader title={t('translation|Loading')} />;
  }

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'flex-start' }}
    >
      <SectionBox
        outterBoxProps={{
          sx: { flexGrow: 1, display: 'flex', flexDirection: 'column', width: '100%' },
        }}
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          mb: 3,
        }}
        backLink
        title={
          <Box display="flex" alignItems="center" gap={1} sx={{ py: 2 }}>
            <Typography variant="h5" component="span" sx={{ mr: 'auto' }}>
              {application.id}
            </Typography>
          </Box>
        }
      >
        <ClusterGroupErrorMessage errors={errors} />
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={selectedTab} onChange={(event, newValue) => setSelectedTab(newValue)}>
            {tabs.map(tab => (
              <Tab
                key={tab.id}
                value={tab.id}
                label={
                  <>
                    <Icon icon={tab.icon} />
                    <Typography>{tab.label}</Typography>
                  </>
                }
                sx={{
                  flexDirection: 'row',
                  gap: 1,
                  fontSize: '1.25rem',
                }}
              />
            ))}
          </Tabs>
        </Box>
        {selectedTab === TAB_IDS.OVERVIEW && (
          <ApplicationOverview
            application={application}
            applicationResources={items}
            onCategoryClick={category => {
              setSelectedCategoryName(category);
              setSelectedTab(TAB_IDS.RESOURCES);
            }}
          />
        )}
        {selectedTab === TAB_IDS.RESOURCES && (
          <ProjectResourcesTab
            projectResources={items}
            showClusterColumn={application.clusters.length > 1}
            selectedCategoryName={selectedCategoryName}
            setSelectedCategoryName={setSelectedCategoryName}
            directObjectLinks
          />
        )}
        {selectedTab === TAB_IDS.ACCESS && (
          <ApplicationAccess application={application} applicationResources={items} />
        )}
        {selectedTab === TAB_IDS.MAP && <ApplicationMap application={application} />}
      </SectionBox>
    </Box>
  );
}

/** Overview tab: status, resource categories and resource quotas. */
export function ApplicationOverview({
  application,
  applicationResources,
  onCategoryClick,
}: {
  application: ApplicationDefinition;
  applicationResources: KubeObject[];
  onCategoryClick: (categoryName: string) => void;
}) {
  const { t } = useTranslation(['translation', 'glossary']);

  // ResourceQuotas are deliberately not part of the shared cluster-wide
  // application fetch (their lists are skipped for cost, see
  // useAllApplicationResources), so fetch just this namespace's quotas here —
  // a tiny, namespace-scoped request per cluster.
  const { items: resourceQuotas } = ResourceQuota.useList({
    clusters: application.clusters,
    namespace: application.id,
  });

  const categoryList = useResourceCategoriesList(applicationResources);

  // The exact same workload-readiness verdict the Applications table's Health
  // column shows (evaluateApplicationHealth), so this page can never disagree
  // with the table row the user just clicked.
  const health = useMemo(
    () => evaluateApplicationHealth(applicationResources.map(it => it.jsonData)),
    [applicationResources]
  );
  const workloadObjects = useMemo(
    () => buildWorkloadObjectsMap(applicationResources, health),
    [applicationResources, health]
  );

  return (
    <Grid container spacing={3} sx={{ pt: 2 }}>
      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6">{t('translation|Status')}</Typography>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t('translation|Application Status')}
                </Typography>
                <Box display="flex" alignItems="center" gap={1} sx={{ mt: 0.5 }}>
                  {/* Same chip as the table's Health column: click it to see
                      why, with each problem workload linked to its own page. */}
                  <ApplicationHealthChip
                    health={health}
                    loading={false}
                    workloadObjects={workloadObjects}
                    size="medium"
                  />
                </Box>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t('translation|Workloads')}
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1} sx={{ mt: 0.5 }}>
                  {health.totalWorkloads === 0 ? (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {NOT_AVAILABLE}
                    </Typography>
                  ) : (
                    <StatusLabel
                      status={
                        health.status === 'unhealthy'
                          ? 'error'
                          : health.status === 'degraded' || health.status === 'progressing'
                          ? 'warning'
                          : 'success'
                      }
                    >
                      {t('translation|{{ ready }}/{{ total }} ready', {
                        ready: health.readyWorkloads,
                        total: health.totalWorkloads,
                      })}
                    </StatusLabel>
                  )}
                </Box>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t('translation|Resources')}
                </Typography>
                <Typography sx={{ mt: 0.5 }}>{applicationResources.length}</Typography>
              </Box>
            </Box>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {application.clusters.length === 1
                  ? t('translation|Cluster')
                  : t('translation|Clusters')}
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} sx={{ mt: 0.5 }}>
                {application.clusters.map(cluster => (
                  <Link key={cluster} routeName="cluster" params={{ cluster }}>
                    {cluster}
                  </Link>
                ))}
              </Box>
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 4 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t('translation|Version')}
                </Typography>
                <MetadataValue value={application.version} />
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t('translation|Deployment Type')}
                </Typography>
                <MetadataValue value={application.deploymentType} />
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6">{t('translation|Resources')}</Typography>
            <ResourceCategoriesList categoryList={categoryList} onCategoryClick={onCategoryClick} />
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6">{t('translation|Resource Quotas')}</Typography>
            <Box>
              {(resourceQuotas ?? []).map(it => (
                <Box sx={{ mb: 2 }} key={it.metadata.uid}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="h6" sx={{ mr: 'auto' }}>
                      {it.metadata.name}
                    </Typography>
                    <EditButton item={it} />
                  </Box>
                  {/* The original table design, but in a horizontally
                      scrollable container so wide values (e.g. large memory
                      limits) scroll instead of being clipped by the card. */}
                  <Box sx={{ overflowX: 'auto' }}>
                    <ResourceQuotaTable resourceStats={it.resourceStats} />
                  </Box>
                </Box>
              ))}

              {(resourceQuotas ?? []).length === 0 && (
                // Say what the absence means instead of a bare "n/a": no
                // ResourceQuota object exists in this namespace, so nothing
                // caps its resource usage.
                <Typography variant="body2" color="text.secondary" sx={{ my: 2 }}>
                  {t(
                    'translation|No ResourceQuota is defined in this namespace, so its resource usage is not capped.'
                  )}
                </Typography>
              )}
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/**
 * Access tab: the application's Roles and RoleBindings. Names redirect to the
 * object's own details page rather than opening a drawer here.
 */
function ApplicationAccess({
  application,
  applicationResources,
}: {
  application: ApplicationDefinition;
  applicationResources: KubeObject[];
}) {
  const { t } = useTranslation(['translation', 'glossary']);

  const roles = useMemo(
    () => applicationResources.filter(it => it.kind === 'Role'),
    [applicationResources]
  );
  const roleBindings = useMemo(
    () => applicationResources.filter(it => it.kind === 'RoleBinding'),
    [applicationResources]
  );

  const columns = useMemo<TableColumn<KubeObject>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        accessorFn: item => item.metadata.name,
        Cell: ({ row: { original } }) => (
          <MuiLink component={RouterLink} to={original.getDetailsLink()}>
            {original.metadata.name}
          </MuiLink>
        ),
      },
      {
        id: 'cluster',
        header: t('glossary|Cluster'),
        gridTemplate: 'min-content',
        accessorFn: item => item.cluster,
        // The cluster is an object of its own: link it to the cluster view.
        Cell: ({ row: { original } }) => (
          <Link routeName="cluster" params={{ cluster: original.cluster }}>
            {original.cluster}
          </Link>
        ),
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
    <Box sx={{ my: 3 }}>
      <SelectedClustersContext.Provider value={application.clusters}>
        <Typography variant="h6">{t('glossary|Roles')}</Typography>
        <Table columns={columns} data={roles} emptyMessage={NOT_AVAILABLE} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          {t('glossary|Role Bindings')}
        </Typography>
        <Table columns={columns} data={roleBindings} emptyMessage={NOT_AVAILABLE} />
      </SelectedClustersContext.Provider>
    </Box>
  );
}

/** Map tab: the resource map filtered down to the application's namespace. */
function ApplicationMap({ application }: { application: ApplicationDefinition }) {
  const filters = useMemo(
    () =>
      [
        application.namespaces.length > 0
          ? {
              type: 'namespace',
              namespaces: new Set(application.namespaces),
            }
          : undefined,
      ].filter(Boolean) as GraphFilter[],
    [application.namespaces]
  );
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderTop: 0,
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SelectedClustersContext.Provider value={application.clusters}>
        <GraphView defaultFilters={filters} />
      </SelectedClustersContext.Provider>
    </Box>
  );
}
