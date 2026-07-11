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
 * Plugins compiled into Headlamp itself. Unlike regular plugins these are
 * always present — they don't depend on any plugins folder, cannot be
 * disabled from the plugin settings, and ship with every build (browser,
 * desktop app and container image alike).
 *
 * Their sources live in the top-level plugins/ folder and keep the regular
 * plugin API imports; the build aliases '@kinvolk/headlamp-plugin/lib*' to
 * the in-tree implementations (see vite.config.ts / rsbuild.config.ts and
 * src/plugin/staticPluginLib.ts).
 */
import '../../plugins/flux/src/index';
