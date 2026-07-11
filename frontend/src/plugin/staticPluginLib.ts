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

/**
 * Stand-in for the '@kinvolk/headlamp-plugin/lib' module used by plugins that
 * are compiled directly into Headlamp (see src/staticPlugins.ts). The build
 * aliases '@kinvolk/headlamp-plugin/lib' to this file, so bundled plugin
 * sources can keep their normal plugin imports while resolving to the real
 * in-tree implementations instead of window.pluginLib.
 */
import * as K8s from '../lib/k8s';
import * as Router from '../lib/router';

export * from './registry';
export { K8s, Router };
