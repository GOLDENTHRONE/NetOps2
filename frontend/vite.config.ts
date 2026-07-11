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

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import svgr from 'vite-plugin-svgr';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Aliases that let statically bundled plugins (src/staticPlugins.ts) keep
// their regular '@kinvolk/headlamp-plugin/lib' imports while resolving to the
// in-tree implementations. Order matters: more specific entries first.
const staticPluginAliases = [
  {
    find: '@kinvolk/headlamp-plugin/lib/CommonComponents',
    replacement: resolvePath('./src/components/common'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib/K8s/crd',
    replacement: resolvePath('./src/lib/k8s/crd.ts'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib/K8s',
    replacement: resolvePath('./src/lib/k8s'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib/ApiProxy',
    replacement: resolvePath('./src/lib/k8s/apiProxy.ts'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib/Utils',
    replacement: resolvePath('./src/lib/util.ts'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib/Router',
    replacement: resolvePath('./src/lib/router'),
  },
  {
    find: '@kinvolk/headlamp-plugin/lib',
    replacement: resolvePath('./src/plugin/staticPluginLib.ts'),
  },
];

// Bundled plugin sources live outside frontend/ and may have their own
// node_modules; dedupe shared libraries so only the frontend's copy is used.
const staticPluginDedupe = [
  'react',
  'react-dom',
  'react-router-dom',
  'react-redux',
  '@mui/material',
  '@mui/lab',
  '@emotion/react',
  '@emotion/styled',
  '@iconify/react',
  'notistack',
  'lodash',
];

// Use environment variable for backend port, defaulting to 4466
const backendPort = process.env.HEADLAMP_PORT || '4466';
const backendTarget = `http://localhost:${backendPort}`;
const underTest = process.env.UNDER_TEST === 'true' || process.env.VITEST === 'true';

export default defineConfig({
  define: {
    global: 'globalThis',
    'import.meta.env.UNDER_TEST': JSON.stringify(underTest),
  },
  envPrefix: 'REACT_APP_',
  base: process.env.PUBLIC_URL,
  resolve: {
    alias: staticPluginAliases,
    dedupe: staticPluginDedupe,
  },
  server: {
    port: 3000,
    fs: {
      // Allow serving the statically bundled plugin sources from ../plugins.
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/clusters': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/plugins': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/config': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/auth/': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/oidc': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/oidc-callback': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/wsMultiplexer': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      '/externalproxy': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/drain-node': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/drain-node-status': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/parseKubeConfig': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/cluster': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/metrics': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
    cors: true,
  },
  plugins: [
    svgr({
      svgrOptions: {
        prettier: false,
        svgo: false,
        svgoConfig: {
          plugins: [{ removeViewBox: false }],
        },
        titleProp: true,
        ref: true,
      },
    }),
    react(),
    nodePolyfills({
      include: ['process', 'buffer', 'stream'],
    }),
    // Make sure we copy the minified monaco-editor source into the static folder
    // since it's loaded dynamically and not bundled via ESM. We do it this way
    // to support setting the localization language
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/monaco-editor/min/vs',
          dest: 'assets', // copies to assets/vs
        },
      ],
    }),
  ],
  build: {
    outDir: 'build',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Exclude @axe-core from production bundle
      external: ['@axe-core/react'],
      output: {
        manualChunks(id: string) {
          // Build smaller chunks for @mui, lodash, xterm, recharts
          if (id.includes('node_modules')) {
            if (id.includes('lodash')) {
              return 'vendor-lodash';
            }

            if (id.includes('@mui/material')) {
              return 'vendor-mui';
            }

            if (id.includes('xterm')) {
              return 'vendor-xterm';
            }

            if (id.includes('recharts')) {
              return 'vendor-recharts';
            }
          }
        },
      },
    },
  },
});
