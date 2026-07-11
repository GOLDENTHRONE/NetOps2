# Flux plugin for Headlamp

A GitOps dashboard for [Flux CD](https://fluxcd.io/) that is **built into
Headlamp**: observe, sync, suspend, onboard and debug everything Flux manages
without running a single `flux` command.

The sources live here in plugin form, but they are compiled directly into the
Headlamp frontend (see `frontend/src/staticPlugins.ts`), so the Flux UI is
always present — in the browser, the desktop app and the container image —
with nothing to install or enable.

## What you get

- **Sidebar "Flux" item** (placed above Workloads) with Overview, Sources,
  Kustomizations, Helm Releases, Notifications and Image Automation pages.
- **Home page "Flux" tab** showing Flux health per cluster (controllers ready,
  resource counts, failures) next to the Applications tab.
- **Overview page**: Flux controller Deployments (source-controller,
  kustomize-controller, helm-controller, ...) with their live health and version,
  plus per-category summary cards.
- **Sources**: Git/OCI/Helm repositories, Helm charts and Buckets with the watched
  URL, branch/tag, current revision (linked to the commit on the Git host when
  possible), artifact details, last sync and the approximate next scheduled sync.
  Each source's details page shows the Kustomizations, Helm charts/releases and
  image automations discovered to use it, as clickable tags.
- **Kustomizations & Helm Releases**: a graphical *deployment order* view derived
  from `spec.dependsOn` — items in the same wave deploy in parallel, failed items
  carry their failure message in the tooltip, and dependency cycles are called out.
  Details pages show dependencies in both directions, Helm release history, and the
  managed objects as a hierarchy (workloads expand to their live pods, and every
  object links to the regular Headlamp view with logs, shell, editor, ...).
- **Actions everywhere** (list rows and details headers): Sync (reconcile now),
  Sync with source, Force reconcile (Helm releases), Suspend/Resume, Edit and
  Delete — equivalents of `flux reconcile/suspend/resume/delete`.
- **Onboarding**: every list has a "+" button that opens the editor pre-filled
  with a starter manifest (like `flux create ...`) so new sources, kustomizations
  and releases can be applied from the UI.

Flux does not store the commit message/author in the cluster; for Git sources the
plugin links the current commit hash to the repository's web UI (GitHub/GitLab
style hosts) so those details are one click away.

## Compatibility

Works with the Flux v2 APIs and falls back across API versions
(`source.toolkit.fluxcd.io` v1/v1beta2/v1beta1, `kustomize.toolkit.fluxcd.io`
v1/v1beta2/v1beta1, `helm.toolkit.fluxcd.io` v2/v2beta2/v2beta1,
`notification.toolkit.fluxcd.io`, `image.toolkit.fluxcd.io`).

The sidebar placement (`insertBefore`) and the Home page tab use newer Headlamp
plugin APIs; on older Headlamp versions the plugin still works, with the Flux
sidebar entry appended at the end and no Home tab.

## Development

The plugin is part of the frontend build, so the regular frontend workflow
picks up changes here automatically:

```bash
make run-backend    # terminal 1
make run-frontend   # terminal 2 — Flux UI is included, with hot reload
```

Unit tests and standalone checks still work from this folder:

```bash
cd plugins/flux
npm install
npm test           # unit tests
npm run tsc        # typecheck against the published plugin API
npm run build      # produce dist/main.js (standalone plugin bundle)
```

The standalone bundle is only needed if you want to load this plugin into an
unmodified upstream Headlamp; in this repository it is already compiled in.
