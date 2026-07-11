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

import {
  ActionButton,
  ConfirmDialog,
  DeleteButton,
  EditButton,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useSnackbar } from 'notistack';
import React from 'react';
import { fluxClass, kindByName } from './kinds';
import { FORCE_ANNOTATION, getSourceRef, isSuspended, RECONCILE_ANNOTATION } from './utils';

/**
 * A KubeObject instance of one of the Flux kinds. Typed loosely because the
 * classes are created dynamically with makeCustomResourceClass.
 */
export type FluxKubeObject = any;

/** Asks the responsible Flux controller to reconcile the object now. */
export async function requestReconcile(item: FluxKubeObject, options?: { force?: boolean }) {
  const requestedAt = new Date().toISOString();
  const annotations: Record<string, string> = { [RECONCILE_ANNOTATION]: requestedAt };
  if (options?.force) {
    annotations[FORCE_ANNOTATION] = requestedAt;
  }
  return item.patch({ metadata: { annotations } });
}

/**
 * Reconciles the object's source first (like `flux reconcile ... --with-source`),
 * then the object itself.
 */
export async function requestReconcileWithSource(item: FluxKubeObject) {
  const sourceRef = getSourceRef(item.jsonData);
  if (sourceRef) {
    const kindDef = kindByName(sourceRef.kind);
    if (kindDef) {
      const cls = fluxClass(kindDef);
      const source = new cls(
        {
          apiVersion: `${kindDef.group}/${kindDef.versions[0]}`,
          kind: kindDef.kind,
          metadata: { name: sourceRef.name, namespace: sourceRef.namespace },
        } as any,
        item.cluster
      );
      await requestReconcile(source);
    }
  }
  return requestReconcile(item);
}

/** Suspends or resumes reconciliation of the object. */
export async function setSuspended(item: FluxKubeObject, suspend: boolean) {
  return item.patch({ spec: { suspend } });
}

export interface FluxActionButtonsProps {
  item: FluxKubeObject | null;
  /** Show edit/delete buttons too (used on details pages). */
  withEditDelete?: boolean;
}

/**
 * The row of Flux operations for a resource: sync, sync with source,
 * force reconcile (HelmRelease), suspend/resume, and optionally edit/delete.
 */
export function FluxActionButtons(props: FluxActionButtonsProps) {
  const { item, withEditDelete } = props;
  const { enqueueSnackbar } = useSnackbar();
  const [confirmForce, setConfirmForce] = React.useState(false);

  if (!item) {
    return null;
  }

  const name = item.metadata?.name;
  const suspended = isSuspended(item.jsonData);
  const hasSource = !!getSourceRef(item.jsonData);
  const isHelmRelease = item.jsonData?.kind === 'HelmRelease';

  const run = (op: string, promise: Promise<any>) => {
    promise
      .then(() => enqueueSnackbar(`${op} requested for ${name}`, { variant: 'success' }))
      .catch(err => enqueueSnackbar(`${op} failed for ${name}: ${err}`, { variant: 'error' }));
  };

  return (
    <>
      <ActionButton
        description="Sync (reconcile now)"
        longDescription="Ask Flux to reconcile this resource immediately"
        icon="mdi:sync"
        onClick={() => run('Sync', requestReconcile(item))}
        iconButtonProps={{ disabled: suspended }}
      />
      {hasSource && (
        <ActionButton
          description="Sync with source"
          longDescription="Reconcile the source first, then this resource (flux reconcile --with-source)"
          icon="mdi:database-sync"
          onClick={() => run('Sync with source', requestReconcileWithSource(item))}
          iconButtonProps={{ disabled: suspended }}
        />
      )}
      {isHelmRelease && (
        <ActionButton
          description="Force reconcile"
          longDescription="Force a one-off Helm upgrade even if the release has failed (flux reconcile --force)"
          icon="mdi:sync-alert"
          onClick={() => setConfirmForce(true)}
          iconButtonProps={{ disabled: suspended }}
        />
      )}
      {suspended ? (
        <ActionButton
          description="Resume"
          longDescription="Resume reconciliation of this resource"
          icon="mdi:play-circle-outline"
          onClick={() => run('Resume', setSuspended(item, false))}
        />
      ) : (
        <ActionButton
          description="Suspend"
          longDescription="Suspend reconciliation of this resource (flux suspend)"
          icon="mdi:pause-circle-outline"
          onClick={() => run('Suspend', setSuspended(item, true))}
        />
      )}
      {withEditDelete && (
        <>
          <EditButton item={item} />
          <DeleteButton item={item} />
        </>
      )}
      {isHelmRelease && (
        <ConfirmDialog
          open={confirmForce}
          title="Force reconcile"
          description={`This will force a one-off Helm upgrade of "${name}", ignoring the failure state of the release. Continue?`}
          handleClose={() => setConfirmForce(false)}
          onConfirm={() => {
            setConfirmForce(false);
            run('Force reconcile', requestReconcile(item, { force: true }));
          }}
        />
      )}
    </>
  );
}
