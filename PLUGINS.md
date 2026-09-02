# Headlamp Plugins — Reference for Copilots and Developers

This file is a local, offline-friendly cheat sheet so an AI copilot (or a new
developer) can help build and enhance features — especially **tables** —
using the Headlamp plugin system, without needing to open any external URL.

Anchor files to read first (all in this repo):

- Public plugin API: `frontend/src/plugin/registry.tsx`
- Table extension example: `plugins/examples/tables/src/index.tsx`
- Details-view example: `plugins/examples/details-view/`
- Sidebar example: `plugins/examples/sidebar/`
- App-menus example: `plugins/examples/app-menus/`
- Plugin scaffold template: `plugins/headlamp-plugin/template/`
- Plugin CLI: `plugins/headlamp-plugin/bin/headlamp-plugin.js`

---

## 1. What a plugin is

A plugin is a TypeScript/React package that runs inside the Headlamp
frontend. It imports register-style functions from
`@kinvolk/headlamp-plugin/lib` and calls them at module load time. Each
`register*` call attaches a component, processor, filter, or callback to a
specific extension point in the app. Plugins are shipped as separate
folders, built with the `headlamp-plugin` CLI, and loaded at runtime — no
core-code fork is needed.

## 2. How to scaffold a new plugin

```bash
# From the repo root
cd plugins/examples
npx @kinvolk/headlamp-plugin create my-plugin
cd my-plugin
npm install
npm start        # dev mode against a running Headlamp
npm run build    # production build
```

Or copy one of the `plugins/examples/*` folders as a starting point (the
`tables` example is the closest match for table work).

## 3. Extension points (from `frontend/src/plugin/registry.tsx`)

Grouped by what they let you do. Import all of these from
`@kinvolk/headlamp-plugin/lib`.

### Tables and lists
- `registerResourceTableColumnsProcessor(processor)` — add / remove / reorder / re-render columns on any resource list table. **This is the main API for table features.**

### Details views
- `registerDetailsViewHeaderAction(headerAction)` — add a button to a resource details page header.
- `registerDetailsViewHeaderActionsProcessor(processor)` — modify / remove default header actions.
- `registerDetailsViewSection(viewSection)` — add a new section below the details page.
- `registerDetailsViewSectionsProcessor(processor)` — modify / reorder / drop existing sections.

### Navigation and layout
- `registerSidebarEntry({...})` — add a sidebar entry.
- `registerSidebarEntryFilter(filter)` — hide/rewrite sidebar entries.
- `registerHomeSidebarEntryFilter(filter)` — same, for the home sidebar.
- `registerRoute(routeSpec)` — add a page at a URL.
- `registerRouteFilter(filter)` — hide/rewrite routes.
- `registerAppBarAction(action)` — add a component to the top app bar.
- `registerAppLogo(logo)` — replace the app logo.
- `registerAppTheme(theme)` — add a color theme.
- `registerUIPanel(panel)` — add a slide-in / docked UI panel.

### Cluster and multi-cluster
- `registerClusterChooser(chooser)` — replace the cluster-chooser widget.
- `registerClusterProviderMenuItem(item)` — add a menu item for a cluster provider.
- `registerClusterStatus(item)` — render custom cluster status.
- `registerClusterEmptyState(component)` — render when no clusters are configured.
- `registerClusterProviderDialog(item)` — provider-specific dialogs.
- `registerAddClusterProvider(item)` — register a whole "add cluster" flow.

### Auth
- `registerSetTokenFunction(fn)` — override how tokens are stored.
- `registerGetTokenFunction(fn)` — override how tokens are read.

### Events, settings, misc
- `registerHeadlampEventCallback(cb)` — listen to app-wide events.
- `registerPluginSettings(...)` — expose a settings panel for your plugin.
- `registerKubeObjectGlance(glance)` — glance/summary widget for a kube object.
- `registerOverviewChartsProcessor(processor)` — add/edit cluster-overview charts.
- `registerMapSource(source)` — add nodes/edges to the cluster map.
- `registerKindIcon(kind, def, apiGroup?)` — set the icon used for a resource kind.

### Projects (multi-resource logical groupings)
- `registerCustomCreateProject`, `registerProjectDetailsTab`,
  `registerProjectOverviewSection`, `registerProjectDeleteButton`,
  `registerProjectHeaderAction`, `registerProjectApiResource`.

### Relations
- `registerResourceRelationProvider(relation)` — declare relationships between resources.

Every function above is defined and JSDoc-commented in
`frontend/src/plugin/registry.tsx`. When a copilot needs the exact
signature or example, grep that file first.

---

## 4. Tables — the important part

### 4.1 Table IDs

Every table has a stable ID. Convention:

- Resource list views: `headlamp-<pluralResourceName>`
  - Pods: `headlamp-pods`
  - Namespaces: `headlamp-namespaces`
  - Deployments: `headlamp-deployments`
  - Nodes: `headlamp-nodes`
- Section tables: `headlamp-<area>.<section>` — e.g. cluster overview events: `headlamp-cluster.overview.events`
- Plugin-authored tables should prefix their own tables with the plugin name.

**Trick to find an unknown ID:** in your processor, `console.log(id)`
for every call and check the browser console for the table you care about.

### 4.2 The processor signature

```ts
import { registerResourceTableColumnsProcessor } from '@kinvolk/headlamp-plugin/lib';
import { ResourceTableColumn } from '@kinvolk/headlamp-plugin/lib/CommonComponents';

registerResourceTableColumnsProcessor(function myProcessor({ id, columns }) {
  // id: the table's ID string
  // columns: current ResourceTableColumn[] — mutate or replace, then return
  return columns;
});
```

A column looks like:

```ts
{
  label: string,                           // header text
  getValue: (item) => string | number,     // used for sort/filter/export
  render?: (item) => React.ReactNode,      // optional custom cell
  gridTemplate?: string | number,          // optional CSS grid width
  sort?: boolean | ((a, b) => number),     // optional custom sort
}
```

### 4.3 Recipes

**Add a column** (Pods → "Init Containers")

```tsx
import { registerResourceTableColumnsProcessor } from '@kinvolk/headlamp-plugin/lib';
import Pod from '@kinvolk/headlamp-plugin/lib/K8s/pod';

registerResourceTableColumnsProcessor(({ id, columns }) => {
  if (id === 'headlamp-pods') {
    columns.push({
      label: 'Init Containers',
      getValue: (pod: Pod) => pod.spec.initContainers?.length ?? 0,
    });
  }
  return columns;
});
```

**Custom cell rendering** (color the value)

```tsx
columns.push({
  label: 'Init Containers',
  getValue: (pod: Pod) => pod.spec.initContainers?.length ?? 0,
  render: (pod: Pod) => (
    <span style={{ color: 'red' }}>
      {pod.spec.initContainers?.length ?? 0}
    </span>
  ),
});
```

**Remove a column** (drop "Age" everywhere)

```ts
registerResourceTableColumnsProcessor(({ columns }) =>
  columns.filter(c => c.label !== 'Age'),
);
```

**Row-level context menu** (from `plugins/examples/tables/src/index.tsx`)

```tsx
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Menu, MenuItem, Typography } from '@mui/material';
import { useHistory } from 'react-router-dom';
import React from 'react';

function ContextMenu({ detailsLink }: { detailsLink: string }) {
  const [anchorEl, setAnchorEl] = React.useState<null | Element>(null);
  const history = useHistory();
  return (
    <>
      <ActionButton
        description="Open row menu"
        icon="mdi:dots-vertical"
        onClick={e => setAnchorEl(e.currentTarget)}
      />
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => history.push(detailsLink)}>
          <Typography>Details</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}

registerResourceTableColumnsProcessor(({ id, columns }) => {
  if (id === 'headlamp-pods') {
    columns.push({
      label: '',
      getValue: (pod) => pod.getDetailsLink(),
      render: (pod) => <ContextMenu detailsLink={pod.getDetailsLink()} />,
    });
  }
  return columns;
});
```

**Reorder columns** (put your column first)

```ts
registerResourceTableColumnsProcessor(({ id, columns }) => {
  if (id === 'headlamp-pods') {
    const mine = columns.pop();      // the one you just pushed
    if (mine) columns.unshift(mine);
  }
  return columns;
});
```

**Apply to every table**

Skip the `id` check — the processor runs for every resource table.

### 4.4 Things to remember

- `getValue` should return a plain value so built-in **filter, sort, and export** keep working. Use `render` only for visuals.
- Multiple processors compose — order depends on registration order.
- Table IDs are the contract. If a target table's ID changes upstream, your plugin silently no-ops. Log the ID during dev to catch this.
- To target a table shown inside a details view (e.g. a Pod's containers list), find its ID in the same way — it will not be `headlamp-pods`.

---

## 5. Useful imports cheat sheet

```ts
// Registration functions
import {
  registerResourceTableColumnsProcessor,
  registerDetailsViewHeaderAction,
  registerDetailsViewSection,
  registerSidebarEntry,
  registerRoute,
  registerAppBarAction,
} from '@kinvolk/headlamp-plugin/lib';

// Common UI building blocks
import {
  ActionButton,
  ResourceTableColumn,
  SectionBox,
  Loader,
  NameValueTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';

// Kubernetes resource classes (typed)
import Pod from '@kinvolk/headlamp-plugin/lib/K8s/pod';
import Deployment from '@kinvolk/headlamp-plugin/lib/K8s/deployment';
import Namespace from '@kinvolk/headlamp-plugin/lib/K8s/namespace';
// …one file per kind under lib/K8s/
```

## 6. How a copilot should approach a table task

Given a prompt like *"add a column showing the image pull policy on the pods
table"*, the expected steps are:

1. Open `plugins/examples/tables/src/index.tsx` as the template.
2. Confirm the target table ID (`headlamp-pods` for the pods list).
3. Choose the right `K8s/<kind>` import for typing.
4. Call `registerResourceTableColumnsProcessor` and push a column with a
   `getValue` (plain data) and, if needed, a `render` (custom cell).
5. Wire the plugin build with `npm start` from that folder.
6. If the ID is unclear, add a `console.log({ id })` in the processor to
   discover it at runtime.

## 7. Where to look when in doubt

- Full API signatures + JSDoc: `frontend/src/plugin/registry.tsx`
- Working table plugin: `plugins/examples/tables/`
- All other extension examples: `plugins/examples/*`
- Plugin scaffold: `plugins/headlamp-plugin/template/`
- Plugin CLI usage: `plugins/headlamp-plugin/README.md`
- Existing developer docs: `docs/development/`

If a needed detail is not here, grep the two anchor files above — they are
the source of truth in this repo.
