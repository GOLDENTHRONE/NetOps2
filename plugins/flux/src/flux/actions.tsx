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

import { Icon } from '@iconify/react';
import { DeleteButton, EditButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  alpha,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Theme,
  Tooltip,
  useTheme,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { accentsFor, RADII } from '../components/ui';
import { ICONS } from '../flux/icon';
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

type Severity = 'default' | 'warning' | 'danger';

interface FluxAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  severity: Severity;
  disabled?: boolean;
  /** When set, ask for confirmation with this body before running. */
  confirm?: { title: string; body: React.ReactNode; confirmLabel: string };
  run: () => Promise<any>;
}

/** Maps an action's severity to a vibrant accent color (mode-aware). */
function severityColor(theme: Theme, severity: Severity): string {
  const a = accentsFor(theme);
  if (severity === 'danger') {
    return a.error;
  }
  if (severity === 'warning') {
    return a.warning;
  }
  return a.info;
}

/** Builds the list of Flux operations available for a resource. */
function useFluxActions(item: FluxKubeObject): FluxAction[] {
  const name = item?.metadata?.name;
  const suspended = isSuspended(item?.jsonData);
  const hasSource = !!getSourceRef(item?.jsonData);
  const isHelmRelease = item?.jsonData?.kind === 'HelmRelease';

  const actions: FluxAction[] = [];

  actions.push({
    id: 'sync',
    label: 'Sync now',
    description: 'Reconcile this resource immediately',
    icon: ICONS.sync,
    severity: 'default',
    disabled: suspended,
    run: () => requestReconcile(item),
  });

  if (hasSource) {
    actions.push({
      id: 'sync-source',
      label: 'Sync with source',
      description: 'Reconcile the source first, then this resource',
      icon: ICONS.syncSource,
      severity: 'default',
      disabled: suspended,
      run: () => requestReconcileWithSource(item),
    });
  }

  if (isHelmRelease) {
    actions.push({
      id: 'force',
      label: 'Force reconcile',
      description: 'Force a one-off Helm upgrade even if the release has failed',
      icon: ICONS.force,
      severity: 'warning',
      disabled: suspended,
      confirm: {
        title: 'Force reconcile Helm release',
        body: (
          <>
            This forces a one-off Helm upgrade of <b>{name}</b>, ignoring the current failure state
            of the release. It can restart or replace running workloads. Continue?
          </>
        ),
        confirmLabel: 'Force reconcile',
      },
      run: () => requestReconcile(item, { force: true }),
    });
  }

  if (suspended) {
    actions.push({
      id: 'resume',
      label: 'Resume',
      description: 'Resume reconciliation of this resource',
      icon: ICONS.resume,
      severity: 'default',
      run: () => setSuspended(item, false),
    });
  } else {
    actions.push({
      id: 'suspend',
      label: 'Suspend',
      description: 'Pause reconciliation until resumed',
      icon: ICONS.suspend,
      severity: 'warning',
      confirm: {
        title: 'Suspend reconciliation',
        body: (
          <>
            Flux will stop reconciling <b>{name}</b> until you resume it. Changes in the source will
            not be applied while suspended. Continue?
          </>
        ),
        confirmLabel: 'Suspend',
      },
      run: () => setSuspended(item, true),
    });
  }

  return actions;
}

/** Confirmation dialog with severity-based coloring. */
function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  severity: Severity;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { open, title, body, confirmLabel, severity, onClose, onConfirm } = props;
  const theme = useTheme();
  const color = severityColor(theme, severity === 'default' ? 'warning' : severity);
  const icon =
    severity === 'danger'
      ? ICONS.warning
      : severity === 'warning'
      ? ICONS.warning
      : ICONS.statusUnknown;

  return (
    // A blocking confirmation: the backdrop and Escape key do NOT dismiss it,
    // so the only way out is an explicit Cancel or confirm click. Nothing else
    // in the UI is interactive while it is open.
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          return;
        }
        onClose();
      }}
      disableEscapeKeyDown
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={icon} color={color} width="1.4rem" />
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{body}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          sx={{
            backgroundColor: color,
            '&:hover': { backgroundColor: alpha(color, 0.85) },
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export interface FluxActionButtonsProps {
  item: FluxKubeObject | null;
  /** Show edit/delete buttons too (used on details pages). */
  withEditDelete?: boolean;
  /**
   * How the actions are rendered:
   * - 'menu' (default): a single overflow button that opens a labeled menu.
   * - 'buttons': a labeled outlined-button row for the details header.
   * - 'inline': compact, always-visible pill buttons (icon + label, color
   *   coded) for table rows; no hover/overflow menu.
   */
  variant?: 'menu' | 'buttons' | 'inline';
  /** Trigger icon for the 'menu' variant (defaults to the ellipsis). */
  menuIcon?: string;
}

/** Short labels for the compact inline (table row) buttons. */
const INLINE_LABELS: Record<string, string> = {
  sync: 'Sync',
  force: 'Force',
  suspend: 'Suspend',
  resume: 'Resume',
};

/** The subset of actions shown inline in table rows (the rest live on the details page). */
const INLINE_ACTION_IDS = new Set(Object.keys(INLINE_LABELS));

/**
 * The Flux operations for a resource: sync, sync with source, force reconcile
 * (HelmRelease), suspend/resume, edit and delete. Every action is clearly
 * labeled and color-coded, and risky ones ask for confirmation, so nothing
 * destructive happens on a single stray click.
 */
export function FluxActionButtons(props: FluxActionButtonsProps) {
  const { item, withEditDelete, variant = 'menu', menuIcon } = props;
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const actions = useFluxActions(item);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [pending, setPending] = React.useState<FluxAction | null>(null);

  if (!item) {
    return null;
  }

  const name = item.metadata?.name;

  const execute = (action: FluxAction) => {
    action
      .run()
      .then(() => enqueueSnackbar(`${action.label} requested for ${name}`, { variant: 'success' }))
      .catch(err =>
        enqueueSnackbar(`${action.label} failed for ${name}: ${err}`, { variant: 'error' })
      );
  };

  const trigger = (action: FluxAction) => {
    setAnchorEl(null);
    if (action.confirm) {
      setPending(action);
    } else {
      execute(action);
    }
  };

  const confirmDialog = pending ? (
    <ConfirmDialog
      open
      title={pending.confirm!.title}
      body={pending.confirm!.body}
      confirmLabel={pending.confirm!.confirmLabel}
      severity={pending.severity}
      onClose={() => setPending(null)}
      onConfirm={() => {
        const action = pending;
        setPending(null);
        execute(action);
      }}
    />
  ) : null;

  if (variant === 'buttons') {
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {actions.map(action => (
          <Button
            key={action.id}
            size="small"
            variant="outlined"
            disabled={action.disabled}
            startIcon={<Icon icon={action.icon} />}
            onClick={() => trigger(action)}
            sx={{
              color: severityColor(theme, action.severity),
              borderColor: alpha(severityColor(theme, action.severity), 0.5),
            }}
          >
            {action.label}
          </Button>
        ))}
        {withEditDelete && (
          <>
            <EditButton item={item} />
            <DeleteButton item={item} />
          </>
        )}
        {confirmDialog}
      </Box>
    );
  }

  if (variant === 'inline') {
    const dark = theme.palette.mode === 'dark';
    const inlineActions = actions.filter(a => INLINE_ACTION_IDS.has(a.id));
    return (
      <Box
        sx={{ display: 'inline-flex', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'nowrap' }}
      >
        {inlineActions.map(action => {
          const color = severityColor(theme, action.severity);
          return (
            <Tooltip key={action.id} title={action.description}>
              <Box
                component="button"
                type="button"
                disabled={action.disabled}
                aria-label={`${action.label} ${name}`}
                onClick={() => trigger(action)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: '4px',
                  border: 'none',
                  borderRadius: RADII.pill,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  whiteSpace: 'nowrap',
                  color,
                  backgroundColor: alpha(color, dark ? 0.2 : 0.13),
                  cursor: action.disabled ? 'default' : 'pointer',
                  opacity: action.disabled ? 0.45 : 1,
                  transition: 'background-color 0.15s ease',
                  '&:hover': action.disabled
                    ? {}
                    : { backgroundColor: alpha(color, dark ? 0.32 : 0.22) },
                }}
              >
                <Icon icon={action.icon} width="0.9rem" height="0.9rem" />
                {INLINE_LABELS[action.id] ?? action.label}
              </Box>
            </Tooltip>
          );
        })}
        {confirmDialog}
      </Box>
    );
  }

  return (
    <>
      <Tooltip title="Flux actions">
        <IconButton
          size="small"
          aria-label={`Flux actions for ${name}`}
          onClick={e => setAnchorEl(e.currentTarget)}
        >
          <Icon icon={menuIcon ?? ICONS.more} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        {actions.map(action => {
          const color = severityColor(theme, action.severity);
          return (
            <MenuItem key={action.id} disabled={action.disabled} onClick={() => trigger(action)}>
              <ListItemIcon sx={{ color }}>
                <Icon icon={action.icon} width="1.2rem" />
              </ListItemIcon>
              <ListItemText
                primary={action.label}
                secondary={action.description}
                primaryTypographyProps={{ sx: { color } }}
              />
            </MenuItem>
          );
        })}
        {withEditDelete && <Divider />}
        {withEditDelete && (
          <Box sx={{ px: 1, display: 'flex', gap: 0.5 }}>
            <EditButton item={item} />
            <DeleteButton item={item} />
          </Box>
        )}
      </Menu>
      {confirmDialog}
    </>
  );
}
