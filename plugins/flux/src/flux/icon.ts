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

import { addIcon } from '@iconify/react';

/**
 * The official Flux logo (Simple Icons, https://simpleicons.org, CC0-1.0).
 */
export const FLUX_ICON = 'flux:logo';

/**
 * The official Helm logo (Material Icon Theme, https://github.com/PKief/vscode-material-icon-theme,
 * MIT), recolored to currentColor so it follows the surrounding text/accent color.
 */
export const HELM_ICON = 'flux:helm';

const HELM_LOGO_PATH =
  'M148.014 286.552c-1.986-1.376-4.331-5.94-5.67-11.019-1.19-4.517-1.64-16.429-.845-22.27.297-2.175.467-4.026.374-4.116-.088-.092-1.934-.38-4.102-.64-12.481-1.506-25.802-5.747-35.943-11.447-2.15-1.21-4.167-2.199-4.477-2.199-.312 0-1.407 1.62-2.436 3.6-4.777 9.198-13.122 18.332-19.465 21.305-2.315 1.086-5.402 1.35-6.829.585-2.152-1.152-2.79-5.72-1.503-10.777.879-3.463 4.416-10.749 7.283-15.005 1.267-1.88 3.768-5.068 5.562-7.086l3.254-3.667-1.697-1.623c-4.472-4.273-12.874-14.16-12.874-15.152 0-.354 11.463-8.317 12.298-8.543.424-.114 1.451.901 2.843 2.814 3.012 4.14 11.067 12.105 15.807 15.627 36.132 26.861 87.06 20.116 114.48-15.165 1.456-1.873 2.874-3.408 3.15-3.408.55 0 11.897 7.695 12.29 8.332.356.574-4.603 7-8.838 11.459-2.011 2.117-3.656 4.021-3.651 4.23 0 .211 1.582 2.045 3.508 4.078 6.121 6.453 12.145 16.528 13.818 23.109 1.284 5.056.646 9.625-1.504 10.777-.466.25-1.697.45-2.74.448-6.595-.015-17.532-10.605-24.022-23.26-1.253-2.44-2.46-4.437-2.687-4.437s-1.5.7-2.83 1.55c-9.43 6.044-23.51 11.257-35.69 13.213-2.59.418-4.922.924-5.182 1.124-.336.261-.294 1.482.15 4.22.791 4.893.486 16.505-.556 21.201-1.078 4.848-2.73 8.605-4.771 10.834-2.344 2.564-4.166 2.93-6.508 1.308zm-129.646-98.84c-.116-.308-.163-16.387-.099-35.734l.112-35.176h18.437l.116 12.949c.088 9.689.255 13.037.66 13.294.299.19 4.914.348 10.256.352 7.565.004 9.82-.123 10.199-.58.323-.392.525-4.815.602-13.301l.114-12.714h18.437v71.231H58.766l-.117-13.593c-.077-9.135-.275-13.785-.602-14.18-.379-.458-2.645-.587-10.256-.587s-9.876.13-10.256.587c-.326.395-.524 5.045-.603 14.18l-.116 13.593-9.12.119c-7.057.092-9.167-.007-9.33-.44zm74.624-.004c-.117-.306-.16-16.383-.097-35.73l.112-35.176h45.654l.121 7.798.119 7.798-13.508.116-13.51.117-.123 5.241c-.092 3.898.02 5.334.44 5.6.308.198 5.556.36 11.656.365l11.094.006-.119 7.805-.12 7.805-11.413.22-11.412.22v12.311l14.046.22 14.048.22v15.39l-23.39.111c-18.476.09-23.431 0-23.598-.44zm61.457 0c-.117-.306-.16-16.383-.097-35.73l.112-35.176h18.437l.22 27.7.22 27.702 13.388.22 13.39.22v15.39l-22.729.113c-17.95.088-22.776-.004-22.94-.44zm58.38-.005c-.114-.303-.158-16.378-.096-35.725l.114-35.176 9.658-.11c5.312-.057 9.876.042 10.142.22.65.442 10.399 26.997 12.551 34.186 2.236 7.48 2.062 7.036 2.57 6.53.238-.238 1.275-3.188 2.307-6.56 2.273-7.425 11.26-33.167 11.854-33.945.325-.427 2.69-.528 10.13-.44l9.707.119v71.231l-8.22.121-8.22.119-.29-1.165c-.607-2.417.206-27.862 1.12-35.132 1.44-11.435 1.223-11.613-2.172-1.76-3.671 10.661-10.968 30.259-11.665 31.33-.598.923-.958.989-5.188.989-3.115 0-4.68-.172-4.975-.55-.543-.695-9.505-25.085-11.954-32.531-1.728-5.255-2.666-7.145-2.636-5.307.007.44.411 4.06.897 8.05.908 7.476 1.713 32.53 1.12 34.9l-.29 1.154h-8.127c-6.098 0-8.178-.137-8.336-.55zm5.807-81.212c-1.728-2.933-6.079-8.407-9.761-12.281-11.855-12.477-26.13-20.363-43.656-24.118-5.02-1.075-6.351-1.176-15.585-1.196-10.872-.024-13.266.247-21.686 2.452-11.397 2.985-21.79 8.282-30.992 15.796-4.424 3.612-11.47 11.043-14.48 15.27-1.853 2.604-2.787 3.567-3.275 3.382-1.599-.607-12.312-7.811-12.308-8.273.016-1.042 7.233-10.091 12.13-15.211l5.063-5.294-3.349-3.632c-6.12-6.64-11.988-16.529-13.624-22.961-1.284-5.057-.646-9.625 1.506-10.78.464-.248 1.697-.45 2.74-.448 6.595.015 17.53 10.608 24.023 23.262 1.25 2.44 2.429 4.435 2.616 4.435.191 0 1.906-.89 3.814-1.979 9.805-5.595 25.545-10.584 36.26-11.487 1.849-.156 3.595-.427 3.878-.603.39-.241.33-1.42-.235-4.808-1.042-6.243-.717-18.472.624-23.552 2.126-8.051 5.54-12.56 9.014-11.907 3.243.609 6.387 5.898 8.025 13.498 1.066 4.958 1.092 18.903.044 23.472-.387 1.692-.576 3.214-.418 3.38.158.168 2.264.617 4.676.995 13.991 2.198 24.601 6.105 37.603 13.837.886.528 1.717.78 1.851.565s1.333-2.574 2.665-5.241c5.144-10.294 13.426-19.648 20.215-22.832 2.317-1.086 5.402-1.35 6.829-.584 2.154 1.154 2.792 5.72 1.506 10.777-.94 3.693-4.549 10.983-7.783 15.719-1.51 2.212-4.577 5.872-6.815 8.134l-4.068 4.112 4.002 4.256c4.047 4.302 11.194 13.426 12.503 15.961.593 1.145.613 1.466.123 1.917-1.005.926-11.8 7.264-12.371 7.264-.297 0-.884-.583-1.304-1.297';

/**
 * The HashiCorp Vault logo (Simple Icons, https://simpleicons.org, CC0-1.0),
 * used for Vault operator CRDs (VaultStaticSecret, VaultAuth, ...).
 */
export const VAULT_ICON = 'flux:vault';

const VAULT_LOGO_PATH =
  'M0 0l11.955 24L24 0zm13.366 4.827h1.393v1.38h-1.393zm-2.77 5.569H9.22V8.993h1.389zm0-2.087H9.22V6.906h1.389zm0-2.086H9.22V4.819h1.389zm2.087 6.263h-1.377V11.08h1.388zm0-2.09h-1.377V8.993h1.388zm0-2.087h-1.377V6.906h1.388zm0-2.086h-1.377V4.819h1.388zm.683.683h1.393v1.389h-1.393zm0 3.475V8.993h1.389v1.388Z';

const FLUX_LOGO_PATH =
  'M11.402 23.747c.154.075.306.154.454.238.181.038.37.004.525-.097l.386-.251c-1.242-.831-2.622-1.251-3.998-1.602l2.633 1.712Zm-7.495-5.783a8.088 8.088 0 0 1-.222-.236.696.696 0 0 0 .112 1.075l2.304 1.498c1.019.422 2.085.686 3.134.944 1.636.403 3.2.79 4.554 1.728l.697-.453c-1.541-1.158-3.327-1.602-5.065-2.03-2.039-.503-3.965-.977-5.514-2.526Zm1.414-1.322-.665.432c.023.024.044.049.068.073 1.702 1.702 3.825 2.225 5.877 2.731 1.778.438 3.469.856 4.9 1.982l.682-.444c-1.612-1.357-3.532-1.834-5.395-2.293-2.019-.497-3.926-.969-5.467-2.481Zm7.502 2.084c1.596.412 3.096.904 4.367 2.036l.67-.436c-1.484-1.396-3.266-1.953-5.037-2.403v.803Zm.698-2.337a64.695 64.695 0 0 1-.698-.174v.802l.512.127c2.039.503 3.965.978 5.514 2.526l.007.009.663-.431c-.041-.042-.079-.086-.121-.128-1.702-1.701-3.824-2.225-5.877-2.731Zm-.698-1.928v.816c.624.19 1.255.347 1.879.501 2.039.502 3.965.977 5.513 2.526.077.077.153.157.226.239a.704.704 0 0 0-.238-.911l-3.064-1.992c-.744-.245-1.502-.433-2.251-.618a31.436 31.436 0 0 1-2.065-.561Zm-1.646 3.049c-1.526-.4-2.96-.888-4.185-1.955l-.674.439c1.439 1.326 3.151 1.88 4.859 2.319v-.803Zm0-1.772a8.543 8.543 0 0 1-2.492-1.283l-.686.446c.975.804 2.061 1.293 3.178 1.655v-.818Zm0-1.946a7.59 7.59 0 0 1-.776-.453l-.701.456c.462.337.957.627 1.477.865v-.868Zm3.533.269-1.887-1.226v.581c.614.257 1.244.473 1.887.645Zm5.493-8.863L12.381.112a.705.705 0 0 0-.762 0L3.797 5.198a.698.698 0 0 0 0 1.171l7.38 4.797V7.678a.414.414 0 0 0-.412-.412h-.543a.413.413 0 0 1-.356-.617l1.777-3.079a.412.412 0 0 1 .714 0l1.777 3.079a.413.413 0 0 1-.356.617h-.543a.414.414 0 0 0-.412.412v3.488l7.38-4.797a.7.7 0 0 0 0-1.171Z';

/**
 * Curated set of Lucide icons (https://lucide.dev, ISC license) used across the
 * Flux UI, registered so they render offline without any network fetch. Lucide
 * gives a clean, consistent, modern line-icon look.
 */
const LUCIDE_ICONS: [string, string][] = [
  [
    'lucide:layout-dashboard',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></g>`,
  ],
  [
    'lucide:git-branch',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></g>`,
  ],
  [
    'lucide:package',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zm1 .27V12"/><path d="M3.29 7L12 12l8.71-5M7.5 4.27l9 5.15"/></g>`,
  ],
  [
    'lucide:database',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></g>`,
  ],
  [
    'lucide:package-open',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 22v-9m3.17-10.79a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.66 1.66 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"/><path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"/><path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.64 1.64 0 0 0 1.63 0z"/></g>`,
  ],
  [
    'lucide:archive',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8m-10 4h4"/></g>`,
  ],
  [
    'lucide:layers',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></g>`,
  ],
  [
    'lucide:ship',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 10.189V14m0-12v3m7 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/></g>`,
  ],
  [
    'lucide:bell',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.268 21a2 2 0 0 0 3.464 0m-10.47-5.674A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>`,
  ],
  [
    'lucide:bell-ring',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.268 21a2 2 0 0 0 3.464 0M22 8c0-2.3-.8-4.3-2-6M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326M4 2C2.8 3.7 2 5.7 2 8"/>`,
  ],
  [
    'lucide:send',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939"/>`,
  ],
  [
    'lucide:webhook',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17l3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6l3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/></g>`,
  ],
  [
    'lucide:image',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></g>`,
  ],
  [
    'lucide:scan-line',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2m4-5h10"/>`,
  ],
  [
    'lucide:refresh-cw',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></g>`,
  ],
  [
    'lucide:cpu',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 20v2m0-20v2m5 16v2m0-20v2M2 12h2m-2 5h2M2 7h2m16 5h2m-2 5h2M20 7h2M7 20v2M7 2v2"/><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="8" height="8" x="8" y="8" rx="1"/></g>`,
  ],
  [
    'lucide:server-cog',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m10.852 14.772l-.383.923m2.679-.923a3 3 0 1 0-2.296-5.544l-.383-.923m2.679.923l.383-.923"/><path d="m13.53 15.696l-.382-.924a3 3 0 1 1-2.296-5.544m3.92 1.624l.923-.383m-.923 2.679l.923.383"/><path d="M4.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5m-15 4H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-.5M6 18h.01M6 6h.01m3.218 4.852l-.923-.383m.923 2.679l-.923.383"/></g>`,
  ],
  [
    'lucide:circle-check',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12l2 2l4-4"/></g>`,
  ],
  [
    'lucide:circle-alert',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></g>`,
  ],
  [
    'lucide:circle-pause',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M10 15V9m4 6V9"/></g>`,
  ],
  [
    'lucide:loader-circle',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 1 1-6.219-8.56"/>`,
  ],
  [
    'lucide:circle-question-mark',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"/></g>`,
  ],
  [
    'lucide:arrow-down-up',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m3 16l4 4l4-4m-4 4V4m14 4l-4-4l-4 4m4-4v16"/>`,
  ],
  [
    'lucide:zap',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>`,
  ],
  [
    'lucide:pause',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/></g>`,
  ],
  [
    'lucide:play',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>`,
  ],
  [
    'lucide:square-pen',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></g>`,
  ],
  [
    'lucide:trash-2',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  ],
  [
    'lucide:ellipsis-vertical',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></g>`,
  ],
  [
    'lucide:external-link',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
  ],
  [
    'lucide:timer',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 2h4m-2 12l3-3"/><circle cx="12" cy="14" r="8"/></g>`,
  ],
  [
    'lucide:clock',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></g>`,
  ],
  [
    'lucide:git-commit-horizontal',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M3 12h6m6 0h6"/></g>`,
  ],
  [
    'lucide:user-round',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></g>`,
  ],
  [
    'lucide:chevron-right',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18l6-6l-6-6"/>`,
  ],
  [
    'lucide:chevron-down',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/>`,
  ],
  [
    'lucide:plus',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-7-7v14"/>`,
  ],
  [
    'lucide:boxes',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3zM7 16.5l-4.74-2.85M7 16.5l5-3m-5 3v5.17m5-8.17V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5zm5 3l-5-3m5 3l4.74-2.85M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3l5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0zM12 8L7.26 5.15M12 8l4.74-2.85M12 13.5V8"/></g>`,
  ],
  [
    'lucide:box',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7l8.7 5l8.7-5M12 22V12"/></g>`,
  ],
  [
    'lucide:lock',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></g>`,
  ],
  [
    'lucide:puzzle',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.39 4.39a1 1 0 0 0 1.68-.474a2.5 2.5 0 1 1 3.014 3.015a1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474a2.5 2.5 0 1 0-3.014 3.015a1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474a2.5 2.5 0 1 1-3.014-3.015a1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474a2.5 2.5 0 1 0 3.014-3.015a1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>`,
  ],
  [
    'lucide:cloud-off',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057m-2.926 2.753A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78M2 2l20 20"/>`,
  ],
  [
    'lucide:triangle-alert',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>`,
  ],
  [
    'lucide:move-right',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 8l4 4l-4 4M2 12h20"/>`,
  ],
  [
    'lucide:workflow',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></g>`,
  ],
  [
    'lucide:info',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></g>`,
  ],
  [
    'lucide:calendar',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M8 2v4m8-4v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></g>`,
  ],
  [
    'lucide:folder',
    `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`,
  ],
  [
    'lucide:search',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></g>`,
  ],
  [
    'lucide:file-text',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8"/></g>`,
  ],
  [
    'lucide:circle-dot',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></g>`,
  ],
  [
    'lucide:settings',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g>`,
  ],
  [
    'lucide:key-round',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></g>`,
  ],
  [
    'lucide:file-cog',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 8a1 1 0 0 1-1-1V2a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8z"/><path d="M20 8v12a2 2 0 0 1-2 2h-4.182"/><path d="m3.305 19.53.923-.382"/><path d="M4 10.592V4a2 2 0 0 1 2-2h8"/><path d="m4.228 16.852-.924-.383"/><path d="m5.852 15.228-.383-.923"/><path d="m5.852 20.772-.383.924"/><path d="m8.148 15.228.383-.923"/><path d="m8.53 21.696-.382-.924"/><path d="m9.773 16.852.922-.383"/><path d="m9.773 19.148.922.383"/><circle cx="7" cy="18" r="3"/></g>`,
  ],
  [
    'lucide:network',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></g>`,
  ],
  [
    'lucide:globe',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></g>`,
  ],
  [
    'lucide:hard-drive',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></g>`,
  ],
  [
    'lucide:shield-check',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></g>`,
  ],
  [
    'lucide:calendar-clock',
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 14v2.2l1.6 1"/><path d="M16 2v4"/><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M3 10h5"/><path d="M8 2v4"/><circle cx="16" cy="16" r="6"/></g>`,
  ],
];

/** Semantic icon names mapped to concrete icon strings, for consistent usage. */
export const ICONS = {
  flux: FLUX_ICON,
  overview: 'lucide:layout-dashboard',
  sources: 'lucide:git-branch',
  gitRepository: 'lucide:git-branch',
  ociRepository: 'lucide:package',
  helmRepository: 'lucide:database',
  helmChart: HELM_ICON,
  bucket: 'lucide:archive',
  kustomization: 'lucide:layers',
  helmRelease: 'lucide:ship',
  notifications: 'lucide:bell',
  alert: 'lucide:bell-ring',
  provider: 'lucide:send',
  receiver: 'lucide:webhook',
  imageAutomation: 'lucide:image',
  imageRepository: 'lucide:image',
  imagePolicy: 'lucide:scan-line',
  imageUpdate: 'lucide:refresh-cw',
  controllers: 'lucide:cpu',
  controller: 'lucide:server-cog',
  statusReady: 'lucide:circle-check',
  statusError: 'lucide:circle-alert',
  statusSuspended: 'lucide:circle-pause',
  statusReconciling: 'lucide:loader-circle',
  statusUnknown: 'lucide:circle-question-mark',
  sync: 'lucide:refresh-cw',
  syncSource: 'lucide:arrow-down-up',
  force: 'lucide:zap',
  suspend: 'lucide:pause',
  resume: 'lucide:play',
  edit: 'lucide:square-pen',
  delete: 'lucide:trash-2',
  more: 'lucide:ellipsis-vertical',
  externalLink: 'lucide:external-link',
  timer: 'lucide:timer',
  clock: 'lucide:clock',
  commit: 'lucide:git-commit-horizontal',
  author: 'lucide:user-round',
  chevronRight: 'lucide:chevron-right',
  chevronDown: 'lucide:chevron-down',
  create: 'lucide:plus',
  resources: 'lucide:boxes',
  cluster: 'lucide:box',
  lock: 'lucide:lock',
  notInstalled: 'lucide:puzzle',
  unreachable: 'lucide:cloud-off',
  warning: 'lucide:triangle-alert',
  arrowRight: 'lucide:move-right',
  graph: 'lucide:workflow',
  info: 'lucide:info',
  calendar: 'lucide:calendar',
  namespace: 'lucide:folder',
  pod: 'lucide:box',
  search: 'lucide:search',
  document: 'lucide:file-text',
  wave: 'lucide:circle-dot',
  gear: 'lucide:settings',
  secret: 'lucide:key-round',
  configMap: 'lucide:file-cog',
  service: 'lucide:network',
  ingress: 'lucide:globe',
  storage: 'lucide:hard-drive',
  rbac: 'lucide:shield-check',
  cronJob: 'lucide:calendar-clock',
  vault: VAULT_ICON,
  helm: HELM_ICON,
} as const;

/** Icons for the Kubernetes kinds that appear in Flux inventories. */
const K8S_KIND_ICONS: Record<string, string> = {
  Deployment: ICONS.resources,
  StatefulSet: ICONS.resources,
  DaemonSet: ICONS.resources,
  ReplicaSet: ICONS.resources,
  Pod: ICONS.pod,
  Job: ICONS.resume,
  CronJob: ICONS.cronJob,
  Service: ICONS.service,
  Ingress: ICONS.ingress,
  ConfigMap: ICONS.configMap,
  Secret: ICONS.secret,
  ServiceAccount: ICONS.author,
  Role: ICONS.rbac,
  RoleBinding: ICONS.rbac,
  ClusterRole: ICONS.rbac,
  ClusterRoleBinding: ICONS.rbac,
  PersistentVolumeClaim: ICONS.storage,
  PersistentVolume: ICONS.storage,
  StorageClass: ICONS.storage,
  Namespace: ICONS.namespace,
  CustomResourceDefinition: ICONS.notInstalled,
  NetworkPolicy: ICONS.service,
  HelmRelease: ICONS.helmRelease,
  HelmChart: HELM_ICON,
  Kustomization: ICONS.kustomization,
  GitRepository: ICONS.gitRepository,
};

/**
 * The best icon for a Kubernetes kind, using vendor logos where they are
 * unmistakable (HashiCorp Vault, Helm) and semantic Lucide icons otherwise.
 */
export function kindIcon(kind: string, group?: string): string {
  if (group?.includes('hashicorp.com') || kind.startsWith('Vault')) {
    return VAULT_ICON;
  }
  if (group?.includes('helm')) {
    return HELM_ICON;
  }
  return K8S_KIND_ICONS[kind] ?? ICONS.cluster;
}

let registered = false;

/** Registers the Flux logo and the curated Lucide set. Safe to call repeatedly. */
export function registerFluxIcon() {
  if (registered) {
    return;
  }
  addIcon(FLUX_ICON, {
    body: `<path fill="currentColor" d="${FLUX_LOGO_PATH}"/>`,
    width: 24,
    height: 24,
  });
  addIcon(HELM_ICON, {
    body: `<path fill="currentColor" d="${HELM_LOGO_PATH}"/>`,
    width: 300,
    height: 300,
  });
  addIcon(VAULT_ICON, {
    body: `<path fill="currentColor" d="${VAULT_LOGO_PATH}"/>`,
    width: 24,
    height: 24,
  });
  for (const [name, body] of LUCIDE_ICONS) {
    addIcon(name, { body, width: 24, height: 24 });
  }
  registered = true;
}
