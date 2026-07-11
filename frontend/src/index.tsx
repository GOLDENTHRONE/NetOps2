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

import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);

// Register the plugins that are built into Headlamp (e.g. Flux) once the app
// module graph is fully initialized. This must be a dynamic import: a static
// one would change the evaluation order of the lib/k8s modules and crash the
// whole app with "Cannot access 'KubeObject' before initialization". The
// catch also keeps a broken built-in plugin from taking the app down.
import('./staticPlugins').catch(err => {
  console.error('Failed to load built-in plugins:', err);
});

/**
 * We used to have axe a11y check here
 * TODO: Integrate a11y check in e2e tests
 * https://playwright.dev/docs/accessibility-testing
 */
