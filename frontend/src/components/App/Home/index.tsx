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
import { Box, Tab, Tabs, Typography } from '@mui/material';
import { isEqual } from 'lodash';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { setupBackstageMessageReceiver } from '../../../helpers/backstageMessageReceiver';
import { useAutoConnectClusters } from '../../../helpers/clusterAutoConnect';
import { isBackstage } from '../../../helpers/isBackstage';
import { useClustersConf, useClustersVersion } from '../../../lib/k8s';
import { Cluster } from '../../../lib/k8s/cluster';
import { useEventWarningList } from '../../../lib/k8s/event';
import { useTypedSelector } from '../../../redux/hooks';
// The Projects tab is currently disabled in favor of the Applications tab.
// import ProjectList from '../../project/ProjectList';
import ApplicationList from '../../applications/ApplicationList';
import { PageGrid } from '../../common/Resource';
import SectionBox from '../../common/SectionBox';
import { useLocalStorageState } from '../../globalSearch/useLocalStorageState';
import ClusterTable from './ClusterTable';
import { ENABLE_RECENT_CLUSTERS } from './config';
import { getCustomClusterNames } from './customClusterNames';
import { HomeTabsState } from './homeTabsSlice';
import RecentClusters from './RecentClusters';

export default function Home() {
  const clusters = useClustersConf();

  // Note: even with a single cluster we render the Home page (instead of
  // redirecting into the cluster like upstream Headlamp does) because it
  // hosts the Applications tab and is reachable via the sidebar Home item.
  return (
    <HomeComponent
      clusters={clusters}
      // Key forces a remount when the cluster list changes so HomeComponent
      // re-evaluates which clusters to connect. On-demand connected clusters
      // are preserved across remounts via sessionStorage in useAutoConnectClusters.
      key={
        'home-component-' +
        Object.keys(clusters || {})
          .sort()
          .join(',')
      }
    />
  );
}

interface HomeComponentProps {
  clusters: { [name: string]: Cluster } | null;
}

const maxWarnings = 50;

function renderWarningsText(warnings: ReturnType<typeof useEventWarningList>, clusterName: string) {
  // '⋯' means "still loading"; 'n/a' means the events query failed. The two
  // used to share '⋯', which left a permanent fake loading indicator on
  // clusters whose events cannot be read.
  if (warnings[clusterName]?.error) {
    return 'n/a';
  }
  const numWarnings = warnings[clusterName]?.warnings?.length ?? -1;

  if (numWarnings === -1) {
    return '⋯';
  }
  if (numWarnings >= maxWarnings) {
    return `${maxWarnings}+`;
  }
  return numWarnings.toString();
}

function useWarningSettingsPerCluster(clusterNames: string[]) {
  // The cell only ever shows a count capped at maxWarnings ("50+"), so fetch
  // at most that many warning events per cluster. The default limit (2000)
  // pulled megabytes of event payloads per cluster just to render a number,
  // which is what kept this column on its loading indicator for so long.
  const warningsMap = useEventWarningList(clusterNames, {
    queryParams: { limit: maxWarnings },
  });
  const [warningLabels, setWarningLabels] = React.useState<{ [cluster: string]: string }>({});

  React.useEffect(() => {
    setWarningLabels(currentWarningLabels => {
      const newWarningLabels: { [cluster: string]: string } = {};
      for (const cluster of clusterNames) {
        // Keep the last known count while the warnings query has no result yet
        // ('⋯' means loading or error), e.g. when it re-initialises as another
        // cluster connects, so connecting a cluster doesn't blank a loaded one.
        const newLabel = renderWarningsText(warningsMap, cluster);
        const previousLabel = currentWarningLabels[cluster];
        // Preserve the previous count only while loading (no result yet), so
        // connecting a cluster doesn't blank an already-loaded one. On error,
        // show '⋯' rather than leaving a stale count.
        const isLoading = warningsMap[cluster] === undefined;
        const preserve = newLabel === '⋯' && isLoading && previousLabel !== undefined;
        newWarningLabels[cluster] = preserve ? previousLabel : newLabel;
      }
      if (!isEqual(newWarningLabels, currentWarningLabels)) {
        return newWarningLabels;
      }
      return currentWarningLabels;
    });
  }, [warningsMap, clusterNames]);

  return warningLabels;
}

const NO_PLUGIN_TABS: HomeTabsState['tabs'] = {};

/** Shared styling for the Home tab buttons: compact, modern, no shouting. */
const homeTabSx = {
  flexDirection: 'row',
  gap: 1,
  fontSize: '1rem',
  fontWeight: 600,
  textTransform: 'none',
  minHeight: 48,
  borderRadius: '8px 8px 0 0',
} as const;

function HomeComponent(props: HomeComponentProps) {
  const [view, setView] = useLocalStorageState<string>('home-tab-view', 'clusters');
  // Optional chaining keeps stories/tests with partial mock stores working.
  const pluginTabs = useTypedSelector(state => state.homeTabs?.tabs) ?? NO_PLUGIN_TABS;
  // Users may still have the removed 'projects' tab (or any other stale
  // value) persisted from an earlier version; fall back to 'clusters' so the
  // Tabs component always gets a valid value.
  const effectiveView =
    view === 'applications' || (!!view && !!pluginTabs[view]) ? view : 'clusters';
  const selectedPluginTab =
    effectiveView === 'clusters' || effectiveView === 'applications'
      ? undefined
      : pluginTabs[effectiveView];
  const { clusters } = props;
  const [customNameClusters, setCustomNameClusters] = React.useState(
    getCustomClusterNames(clusters)
  );
  const { t } = useTranslation(['translation', 'glossary']);
  // Only poll versions/warnings for auto-connect clusters (recently-used by
  // default, plus any connected on demand) to avoid a credential/exec process
  // per cluster on load.
  const allClusterNames = React.useMemo(
    () => Object.values(customNameClusters).map(c => c.name),
    [customNameClusters]
  );
  const { connect: handleConnectCluster, connectedClusters } =
    useAutoConnectClusters(allClusterNames);

  const autoConnectClusters = React.useMemo(
    () => Object.values(clusters || {}).filter(c => connectedClusters.has(c.name)),
    [clusters, connectedClusters]
  );

  const [versions, errors] = useClustersVersion(autoConnectClusters);

  const clusterNames = React.useMemo(
    () => allClusterNames.filter(name => connectedClusters.has(name)),
    [allClusterNames, connectedClusters]
  );

  const warningLabels = useWarningSettingsPerCluster(clusterNames);

  React.useEffect(() => {
    if (isBackstage()) {
      window.parent.postMessage({ type: 'HEADLAMP_READY' }, '*');
      return setupBackstageMessageReceiver();
    }
  }, []);

  React.useEffect(() => {
    setCustomNameClusters(currentNames => {
      if (isEqual(currentNames, getCustomClusterNames(clusters))) {
        return currentNames;
      }
      return getCustomClusterNames(clusters);
    });
  }, [clusters]);

  const memoizedComponent = React.useMemo(
    () => (
      <>
        {ENABLE_RECENT_CLUSTERS && (
          <RecentClusters clusters={Object.values(customNameClusters)} onButtonClick={() => {}} />
        )}
        <ClusterTable
          customNameClusters={customNameClusters}
          versions={versions}
          errors={errors}
          warningLabels={warningLabels}
          clusters={clusters}
          connectedClusterNames={connectedClusters}
          onConnectCluster={handleConnectCluster}
        />
      </>
    ),
    [
      customNameClusters,
      errors,
      versions,
      warningLabels,
      clusters,
      connectedClusters,
      handleConnectCluster,
    ]
  );

  return (
    <PageGrid>
      {/* No page title: the Home view is already reached via the sidebar, so a
          redundant "Home" heading only wastes vertical space. */}
      <SectionBox headerProps={{ headerStyle: 'main' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs
            value={effectiveView}
            onChange={(_, newView) => setView(() => newView)}
            TabIndicatorProps={{
              sx: { height: 3, borderRadius: '3px 3px 0 0' },
            }}
          >
            <Tab
              value="clusters"
              label={
                <>
                  <Icon icon="mdi:hexagon-multiple-outline" />
                  <Typography>{t('All Clusters')}</Typography>
                </>
              }
              sx={homeTabSx}
            />
            {/* Projects tab disabled in favor of Applications; code kept for potential re-enablement. */}
            {/* <Tab
              value="projects"
              label={
                <>
                  <Icon icon="mdi:folder-multiple" />
                  <Typography>{t('Projects')}</Typography>
                </>
              }
              sx={homeTabSx}
            /> */}
            <Tab
              value="applications"
              label={
                <>
                  <Icon icon="mdi:grid-large" />
                  <Typography>{t('Applications')}</Typography>
                </>
              }
              sx={homeTabSx}
            />
            {Object.values(pluginTabs).map(tab => (
              <Tab
                key={tab.id}
                value={tab.id}
                label={
                  <>
                    {tab.icon && <Icon icon={tab.icon} />}
                    <Typography>{tab.label}</Typography>
                  </>
                }
                sx={homeTabSx}
              />
            ))}
          </Tabs>
        </Box>

        {effectiveView === 'clusters' && memoizedComponent}
        {/* {view === 'projects' && <ProjectList />} */}
        {effectiveView === 'applications' && <ApplicationList />}
        {selectedPluginTab && <selectedPluginTab.component />}
      </SectionBox>
    </PageGrid>
  );
}
