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

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

export interface ClusterConnectingProps {
  /** Name of the cluster currently being contacted. */
  clusterName?: string;
}

/**
 * Shown while a cluster's auth/status check is still in flight (e.g. right after
 * opening a cluster whose status hadn't loaded yet on the Home page).
 *
 * This replaces the previous blank screen so the user gets an explicit
 * "connecting" state instead of what looks like a hang, and — importantly — it
 * keeps them here until the check resolves rather than sending them straight to
 * the "Failed to get authentication information" auth screen while the API
 * server is still being reached. Once the check resolves the router renders the
 * cluster (on success) or the normal auth flow (on an auth error).
 */
export default function ClusterConnecting({ clusterName }: ClusterConnectingProps) {
  const { t } = useTranslation();

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '60vh',
        gap: 2,
        p: 3,
      }}
    >
      <CircularProgress
        aria-label={t('translation|Connecting to cluster')}
        title={t('translation|Connecting to cluster')}
      />
      <Typography variant="h6" component="h1">
        {t('translation|Connecting to cluster…')}
      </Typography>
      {clusterName ? (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
          {clusterName}
        </Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 440 }}>
        {t(
          'translation|Waiting for the cluster to respond before opening it. This avoids a failed request while the cluster is still coming up.'
        )}
      </Typography>
    </Box>
  );
}
