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

/**
 * A small, non-blocking indicator shown OVER the current page while a background
 * auth/status re-check is being retried (P0 keep-last-good). Unlike the full
 * ClusterAccessGate, it never hides the content — the last-known-good view stays
 * usable while we quietly reconnect. Fixed to the bottom-right so it doesn't
 * shift the layout.
 */
export default function ReconnectingChip() {
  const { t } = useTranslation();
  return (
    <Chip
      icon={<CircularProgress size={14} thickness={5} color="inherit" />}
      label={t('translation|Reconnecting…')}
      size="small"
      variant="outlined"
      color="warning"
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        bottom: theme => theme.spacing(2),
        right: theme => theme.spacing(2),
        zIndex: theme => theme.zIndex.snackbar,
        backgroundColor: theme => theme.palette.background.paper,
        '& .MuiChip-icon': { marginLeft: 1 },
      }}
    />
  );
}
