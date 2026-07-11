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

import { ActionButton, EditorDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { FluxKind } from '../flux/kinds';

/**
 * Starter manifests used when onboarding a new Flux resource from the UI.
 * They mirror what `flux create ...` would generate.
 */
function templateFor(kindDef: FluxKind): object {
  const apiVersion = `${kindDef.group}/${kindDef.versions[0]}`;
  const base = {
    apiVersion,
    kind: kindDef.kind,
    metadata: { name: `my-${kindDef.singular}`, namespace: 'flux-system' },
  };

  switch (kindDef.kind) {
    case 'GitRepository':
      return {
        ...base,
        spec: {
          interval: '1m0s',
          url: 'https://github.com/org/repo',
          ref: { branch: 'main' },
          // secretRef: { name: 'git-credentials' },
        },
      };
    case 'OCIRepository':
      return {
        ...base,
        spec: {
          interval: '5m0s',
          url: 'oci://ghcr.io/org/manifests',
          ref: { tag: 'latest' },
        },
      };
    case 'HelmRepository':
      return {
        ...base,
        spec: {
          interval: '10m0s',
          url: 'https://charts.example.com',
          // type: 'oci',
        },
      };
    case 'HelmChart':
      return {
        ...base,
        spec: {
          interval: '10m0s',
          chart: 'my-chart',
          version: '*',
          sourceRef: { kind: 'HelmRepository', name: 'my-helmrepository' },
        },
      };
    case 'Bucket':
      return {
        ...base,
        spec: {
          interval: '5m0s',
          bucketName: 'my-bucket',
          endpoint: 's3.amazonaws.com',
          provider: 'aws',
        },
      };
    case 'Kustomization':
      return {
        ...base,
        spec: {
          interval: '10m0s',
          path: './deploy',
          prune: true,
          sourceRef: { kind: 'GitRepository', name: 'my-gitrepository' },
          // dependsOn: [{ name: 'infra' }],
          // healthChecks: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'app', namespace: 'default' }],
        },
      };
    case 'HelmRelease':
      return {
        ...base,
        spec: {
          interval: '10m0s',
          chart: {
            spec: {
              chart: 'my-chart',
              version: '*',
              sourceRef: { kind: 'HelmRepository', name: 'my-helmrepository' },
            },
          },
          values: {},
          // dependsOn: [{ name: 'infra' }],
        },
      };
    case 'Alert':
      return {
        ...base,
        spec: {
          providerRef: { name: 'my-provider' },
          eventSeverity: 'error',
          eventSources: [{ kind: 'Kustomization', name: '*' }],
        },
      };
    case 'Provider':
      return {
        ...base,
        spec: {
          type: 'slack',
          channel: 'alerts',
          // secretRef: { name: 'slack-webhook' },
        },
      };
    case 'Receiver':
      return {
        ...base,
        spec: {
          type: 'github',
          events: ['ping', 'push'],
          secretRef: { name: 'webhook-token' },
          resources: [{ kind: 'GitRepository', name: 'my-gitrepository' }],
        },
      };
    case 'ImageRepository':
      return {
        ...base,
        spec: { interval: '5m0s', image: 'ghcr.io/org/app' },
      };
    case 'ImagePolicy':
      return {
        ...base,
        spec: {
          imageRepositoryRef: { name: 'my-imagerepository' },
          policy: { semver: { range: '>=1.0.0' } },
        },
      };
    case 'ImageUpdateAutomation':
      return {
        ...base,
        spec: {
          interval: '10m0s',
          sourceRef: { kind: 'GitRepository', name: 'my-gitrepository' },
          git: {
            checkout: { ref: { branch: 'main' } },
            commit: {
              author: { email: 'fluxcdbot@example.com', name: 'fluxcdbot' },
              messageTemplate: 'Automated image update',
            },
            push: { branch: 'main' },
          },
          update: { path: './deploy', strategy: 'Setters' },
        },
      };
    default:
      return { ...base, spec: {} };
  }
}

/**
 * Button that opens an editor pre-filled with a starter manifest for the
 * given Flux kind, so a new source/kustomization/release can be onboarded
 * without leaving the UI.
 */
export function CreateFluxButton(props: { kindDef: FluxKind }) {
  const { kindDef } = props;
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <ActionButton
        description={`Create ${kindDef.kind}`}
        longDescription={`Onboard a new ${kindDef.kind} by applying a manifest`}
        icon="mdi:plus-circle"
        onClick={() => setOpen(true)}
      />
      {open && (
        <EditorDialog
          item={templateFor(kindDef)}
          open={open}
          setOpen={setOpen}
          onClose={() => setOpen(false)}
          onSave="default"
          saveLabel="Apply"
          title={`Create ${kindDef.kind}`}
        />
      )}
    </>
  );
}
