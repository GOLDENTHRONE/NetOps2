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

import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';
import { useAnyWatchReconnecting } from '../../lib/k8s/api/v2/webSocket';

/**
 * P1 freshness indicator: a small, non-blocking hint shown whenever a live watch
 * (WebSocket) has dropped and is reconnecting, so the user knows the on-screen
 * data may be briefly behind. It renders nothing while everything is live.
 * Pinned bottom-left so it doesn't collide with the P0 open-gate ReconnectingChip
 * (bottom-right).
 */
export default function WatchFreshnessChip() {
  const { t } = useTranslation();
  const reconnecting = useAnyWatchReconnecting();

  if (!reconnecting) {
    return null;
  }

  return (
    <Chip
      icon={<CircularProgress size={14} thickness={5} color="inherit" />}
      label={t('translation|Reconnecting live updates…')}
      size="small"
      variant="outlined"
      color="warning"
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        bottom: theme => theme.spacing(2),
        left: theme => theme.spacing(2),
        zIndex: theme => theme.zIndex.snackbar,
        backgroundColor: theme => theme.palette.background.paper,
        '& .MuiChip-icon': { marginLeft: 1 },
      }}
    />
  );
}
