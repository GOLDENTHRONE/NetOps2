# AT&T Logo Plugin

Replaces the default Headlamp logo with the AT&T logo, everywhere the app logo
appears (sidebar button, top bar, and the "Choose a cluster" screen). It works
in both the light and dark themes.

It is implemented the supported way, using the `registerAppLogo` plugin API, so
it does **not** modify any Headlamp core code.

## The logo asset

The AT&T mark lives in [`src/att-globe.svg`](./src/att-globe.svg). It currently
contains a **placeholder** blue globe. Replace the whole file with the real
AT&T logo SVG from Iconify:

1. Open the icon `thesvg-color:atandt` (the colored blue globe) on
   https://icon-sets.iconify.design/thesvg-color/atandt/
2. Copy its SVG (the "SVG" / "Copy SVG" option).
3. Paste it as the full contents of `src/att-globe.svg`, keeping
   `viewBox="0 0 24 24"`.

The colored (blue) globe reads well on both themes, so a single SVG is enough.
`src/index.tsx` renders it for both the small (mobile) and large (desktop)
logo slots.

## Develop (live, against a running Headlamp)

```bash
cd plugins/att-logo
npm install
npm start        # hot-reloads the logo into the running Headlamp at :3000
```

## Build & deploy (production)

```bash
cd plugins/att-logo
npm install
npm run build        # produces dist/main.js
npm run package      # produces att-logo-0.1.0.tar.gz
```

Then place it in Headlamp's plugins directory (`-plugins-dir`, default
`/headlamp/plugins` in-cluster):

```bash
# in-cluster / server
tar xvzf att-logo-0.1.0.tar.gz -C /headlamp/plugins

# or extract directly from a built plugins folder
npx @kinvolk/headlamp-plugin extract . /headlamp/plugins
```

Desktop app plugin directories:

| OS | Directory |
|----|-----------|
| macOS / Linux | `$HOME/.config/Headlamp/plugins` |
| Windows | `%APPDATA%/Headlamp/Config/plugins` |

## Scope

`registerAppLogo` changes the logo **image**. The literal product name text
("Headlamp", e.g. in the version dialog) comes from a separate product-name
setting and is out of scope for this plugin.
