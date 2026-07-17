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
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../../lib/k8s/cluster';
import { createRouteURL } from '../../../lib/router/createRouteURL';
import { useId } from '../../../lib/util';
import { useTypedSelector } from '../../../redux/hooks';
import ErrorBoundary from '../../common/ErrorBoundary/ErrorBoundary';
// The following imports are only used by the disabled cluster-delete path
// (see the commented Delete menu item, confirmation dialog and helpers below):
//   import { Box, DialogContentText } from '@mui/material';
//   import { useSnackbar } from 'notistack';
//   import { useDispatch } from 'react-redux';
//   import helpers from '../../../helpers';
//   import { deleteCluster } from '../../../lib/k8s/api/v1/clusterApi';
//   import { setConfig } from '../../../redux/configSlice';
//   import { ConfirmDialog } from '../../common/ConfirmDialog';

interface ClusterContextMenuProps {
  /** The cluster for the context menu to act on. */
  cluster: Cluster;
}

/**
 * ClusterContextMenu component displays a context menu for a given cluster.
 */
export default function ClusterContextMenu({ cluster }: ClusterContextMenuProps) {
  const { t } = useTranslation(['translation']);
  const history = useHistory();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const menuId = useId('context-menu');
  const [openConfirmDialog, setOpenConfirmDialog] = React.useState<string | null>(null);
  const dialogs = useTypedSelector(state => state.clusterProvider.dialogs);
  const menuItems = useTypedSelector(state => state.clusterProvider.menuItems);

  /*
    Cluster deletion is intentionally disabled from this menu (see the
    commented Delete menu item and confirmation dialog below). The state and
    helpers that drove it are commented out here as one unit so nothing can
    trigger a cluster removal; re-enable them together to restore the action.

  const dispatch = useDispatch();
  // const isDynamicClusterEnabled = useTypedSelector(state => state.config.isDynamicClusterEnabled);
  // const allowKubeconfigChanges = useTypedSelector(state => state.config.allowKubeconfigChanges);
  const { enqueueSnackbar } = useSnackbar();

  const kubeconfigOrigin = cluster.meta_data?.origin?.kubeconfig;
  const deleteFromKubeconfig = cluster.meta_data?.source === 'kubeconfig';

  function removeCluster(cluster: Cluster) {
    const clusterID = cluster.meta_data?.clusterID;
    const originalName = cluster.meta_data?.originalName ?? '';
    const clusterName = cluster.name;

    deleteCluster(clusterName, deleteFromKubeconfig, clusterID, kubeconfigOrigin, originalName)
      .then(config => {
        dispatch(setConfig(config));
      })
      .catch((err: Error) => {
        enqueueSnackbar(
          t('translation|Failed to delete cluster: {{ error }}', { error: err.message }),
          {
            variant: 'error',
            preventDuplicate: true,
          }
        );
      })
      .finally(() => {
        history.push('/');
      });
  }

  function removeClusterDescription(cluster: Cluster) {
    const description = deleteFromKubeconfig
      ? t('translation|This action will delete cluster "{{ clusterName }}" from "{{ source }}"', {
          clusterName: cluster.name,
          source: kubeconfigOrigin,
        })
      : t('translation|This action will remove cluster "{{ clusterName }}".', {
          clusterName: cluster.name,
        });

    const removeFromKubeconfigDes = deleteFromKubeconfig
      ? t('translation|This action cannot be undone! Do you want to proceed?')
      : t('translation|Remove this cluster?');

    return (
      <>
        {description}
        {removeFromKubeconfigDes && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              marginTop: '1rem',
              marginBottom: '1rem',
            }}
          >
            <DialogContentText id="alert-dialog-description">
              {removeFromKubeconfigDes}
            </DialogContentText>
          </Box>
        )}
      </>
    );
  }
  */

  function handleMenuClose() {
    setAnchorEl(null);
  }

  return (
    <>
      <Tooltip title={t('Actions')}>
        <IconButton
          size="small"
          onClick={event => {
            setAnchorEl(event.currentTarget);
          }}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-label={t('Actions')}
        >
          <Icon icon="mdi:more-vert" />
        </IconButton>
      </Tooltip>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => {
          handleMenuClose();
        }}
      >
        <MenuItem
          onClick={() => {
            history.push(createRouteURL('cluster', { cluster: cluster.name }));
            handleMenuClose();
          }}
        >
          <ListItemText>{t('translation|View')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            history.push(createRouteURL('settingsCluster', { cluster: cluster.name }));
            handleMenuClose();
          }}
        >
          <ListItemText>{t('translation|Settings')}</ListItemText>
        </MenuItem>
        {/*
          Cluster "Delete" is intentionally disabled in this build. Upstream
          Headlamp only renders it when it is running as the desktop app
          (helpers.isElectron()) or the backend allows kubeconfig changes
          (allowKubeconfigChanges) / dynamic clusters (isDynamicClusterEnabled);
          in the web app with the default backend config that condition is
          false, which is why the action menu already shows only View and
          Settings. It is commented out here so the Delete action can never be
          exposed from the Home cluster menu, regardless of those flags — we
          do not want cluster removal driven from this UI. Re-enable by
          restoring this block if that policy changes.

        {(!menuItems || menuItems.length === 0) &&
          ((cluster.meta_data?.source === 'dynamic_cluster' &&
            (helpers.isElectron() || isDynamicClusterEnabled)) ||
            (cluster.meta_data?.source === 'kubeconfig' &&
              (helpers.isElectron() || allowKubeconfigChanges))) && (
            <MenuItem
              onClick={() => {
                setOpenConfirmDialog('deleteDynamic');
                handleMenuClose();
              }}
            >
              <ListItemText>{t('translation|Delete')}</ListItemText>
            </MenuItem>
          )}
        */}
        {menuItems.map((Item, index) => {
          return (
            <Item
              cluster={cluster}
              setOpenConfirmDialog={setOpenConfirmDialog}
              handleMenuClose={handleMenuClose}
              key={index}
            />
          );
        })}
      </Menu>
      {/*
        The built-in cluster-delete confirmation is disabled along with the
        Delete menu item above, so nothing (not even a cluster-provider plugin
        that sets openConfirmDialog to 'deleteDynamic') can drive a cluster
        deletion from this menu. Re-enable together with the Delete item.

      <ConfirmDialog
        open={openConfirmDialog === 'deleteDynamic'}
        handleClose={() => setOpenConfirmDialog('')}
        confirmLabel={t('translation|Delete')}
        onConfirm={() => {
          setOpenConfirmDialog('');
          removeCluster(cluster);
        }}
        title={t('translation|Delete Cluster')}
        description={removeClusterDescription(cluster)}
      />
      */}
      {openConfirmDialog !== null &&
        dialogs.map((Dialog, index) => {
          return (
            <ErrorBoundary>
              <Dialog
                cluster={cluster}
                openConfirmDialog={openConfirmDialog}
                setOpenConfirmDialog={setOpenConfirmDialog}
                key={index}
              />
            </ErrorBoundary>
          );
        })}
    </>
  );
}
