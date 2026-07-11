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

import * as headlampLib from '@kinvolk/headlamp-plugin/lib';
import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import FluxHomeTab from './components/FluxHomeTab';
import FluxOverview from './components/FluxOverview';
import FluxResourceDetails from './components/FluxResourceDetails';
import {
  FluxHelmReleasesPage,
  FluxImageAutomationPage,
  FluxKustomizationsPage,
  FluxNotificationsPage,
  FluxSourcesPage,
} from './components/pages';
import { FLUX_ICON, registerFluxIcon } from './flux/icon';
import { FLUX_KINDS } from './flux/kinds';

// Make the official Flux logo available offline before it is referenced.
registerFluxIcon();

// -- Sidebar ----------------------------------------------------------------
// A top-level "Flux" item placed right above Workloads. `insertBefore` is
// supported by newer Headlamp cores; older ones simply append the entry.
registerSidebarEntry({
  name: 'flux',
  label: 'Flux',
  icon: FLUX_ICON,
  url: '/flux',
  insertBefore: 'workloads',
} as any);

const SUB_ENTRIES = [
  { name: 'fluxOverview', label: 'Overview', url: '/flux' },
  { name: 'fluxSources', label: 'Sources', url: '/flux/sources' },
  { name: 'fluxKustomizations', label: 'Kustomizations', url: '/flux/kustomizations' },
  { name: 'fluxHelmReleases', label: 'Helm Releases', url: '/flux/helmreleases' },
  { name: 'fluxNotifications', label: 'Notifications', url: '/flux/notifications' },
  { name: 'fluxImageAutomation', label: 'Image Automation', url: '/flux/image-automation' },
];

for (const entry of SUB_ENTRIES) {
  registerSidebarEntry({ parent: 'flux', ...entry });
}

// -- Routes -----------------------------------------------------------------
registerRoute({
  path: '/flux',
  name: 'flux',
  sidebar: 'fluxOverview',
  exact: true,
  component: () => <FluxOverview />,
});

registerRoute({
  path: '/flux/sources',
  name: 'fluxSources',
  sidebar: 'fluxSources',
  exact: true,
  component: () => <FluxSourcesPage />,
});

registerRoute({
  path: '/flux/kustomizations',
  name: 'fluxKustomizations',
  sidebar: 'fluxKustomizations',
  exact: true,
  component: () => <FluxKustomizationsPage />,
});

registerRoute({
  path: '/flux/helmreleases',
  name: 'fluxHelmReleases',
  sidebar: 'fluxHelmReleases',
  exact: true,
  component: () => <FluxHelmReleasesPage />,
});

registerRoute({
  path: '/flux/notifications',
  name: 'fluxNotifications',
  sidebar: 'fluxNotifications',
  exact: true,
  component: () => <FluxNotificationsPage />,
});

registerRoute({
  path: '/flux/image-automation',
  name: 'fluxImageAutomation',
  sidebar: 'fluxImageAutomation',
  exact: true,
  component: () => <FluxImageAutomationPage />,
});

// Details route per Flux kind. The route name equals the kind, so
// KubeObject.getDetailsLink() and createRouteURL(kind, ...) resolve to these.
const CATEGORY_SIDEBAR: Record<string, string> = {
  sources: 'fluxSources',
  kustomizations: 'fluxKustomizations',
  helmreleases: 'fluxHelmReleases',
  notifications: 'fluxNotifications',
  imageautomation: 'fluxImageAutomation',
};

for (const kindDef of FLUX_KINDS) {
  registerRoute({
    path: `/flux/${kindDef.plural}/:namespace/:name`,
    name: kindDef.kind,
    sidebar: CATEGORY_SIDEBAR[kindDef.category],
    exact: true,
    component: () => <FluxResourceDetails kindDef={kindDef} />,
  });
}

// -- Home page tab ----------------------------------------------------------
// Available on newer Headlamp cores; degrades gracefully on older ones.
const registerHomeTab = (headlampLib as any).registerHomeTab;
if (typeof registerHomeTab === 'function') {
  registerHomeTab({
    id: 'flux',
    label: 'Flux',
    icon: FLUX_ICON,
    component: FluxHomeTab,
  });
}
