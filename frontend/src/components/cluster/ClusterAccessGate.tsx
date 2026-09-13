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
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../../lib/k8s/api/v2/ApiError';

/**
 * The state the access gate is in when a user opens a cluster.
 *
 * - `checking`: the authorization check is still in flight.
 * - `unreachable`: the cluster did not respond (timeout / 5xx / network).
 * - `expired`: the cluster answered but the session is no longer valid (401).
 * - `forbidden`: the user is signed in but not allowed on this cluster (403).
 */
export type ClusterAccessGateState = 'checking' | 'unreachable' | 'expired' | 'forbidden';

export interface ClusterAccessGateProps {
  /** Name of the cluster being opened. */
  clusterName: string;
  /** Which state to render. */
  state: ClusterAccessGateState;
  /** The underlying auth error, shown (verbatim) under "Technical details". */
  error?: ApiError | null;
  /** Retry the authorization check (shown for `unreachable`). */
  onRetry?: () => void;
  /** Go to the sign-in flow (shown for `expired`). */
  onSignIn?: () => void;
  /** Return to the All Clusters page (always shown). */
  onBack: () => void;
}

type Palette = 'info' | 'success' | 'warning' | 'error';

/**
 * A single centered screen shown while opening a cluster. It replaces the old
 * blank/redirect behaviour: whatever the outcome of the authorization check, the
 * user lands here with a clear, translated message and a way forward, and the
 * All Clusters page is always one click away.
 *
 * The messages are derived from live state (the cluster name and the real auth
 * error), never hardcoded per cluster, and go through i18n so they are translatable.
 */
export default function ClusterAccessGate({
  clusterName,
  state,
  error,
  onRetry,
  onSignIn,
  onBack,
}: ClusterAccessGateProps) {
  const { t } = useTranslation(['translation']);
  const theme = useTheme();
  const [showDetails, setShowDetails] = useState(false);

  const config: {
    palette: Palette;
    icon: string;
    spin?: boolean;
    kicker: string;
    title: string;
    body: string;
  } = (() => {
    switch (state) {
      case 'expired':
        return {
          palette: 'warning',
          icon: 'mdi:key-alert-outline',
          kicker: t('translation|Sign-in needed'),
          title: t('translation|Your session for this cluster expired'),
          body: t(
            'translation|We reached "{{cluster}}", but your sign-in is no longer valid. Sign in again to continue — your other clusters stay connected.',
            { cluster: clusterName }
          ),
        };
      case 'forbidden':
        return {
          palette: 'error',
          icon: 'mdi:lock-outline',
          kicker: t('translation|Access limited'),
          title: t('translation|You do not have access to this cluster'),
          body: t(
            'translation|You are signed in, but your account is not allowed to open "{{cluster}}". Ask a cluster administrator for access, then try again.',
            { cluster: clusterName }
          ),
        };
      case 'unreachable':
        return {
          palette: 'error',
          icon: 'mdi:cloud-off-outline',
          kicker: t('translation|Not responding'),
          title: t('translation|This cluster is not responding'),
          body: t(
            'translation|We could not reach "{{cluster}}" right now. It may be down, or the connection timed out. You can retry, or go back.',
            { cluster: clusterName }
          ),
        };
      case 'checking':
      default:
        return {
          palette: 'info',
          icon: 'mdi:shield-search',
          spin: true,
          kicker: t('translation|Opening cluster'),
          title: t('translation|Checking your access…'),
          body: t(
            'translation|Confirming that "{{cluster}}" is reachable and your sign-in is still valid.',
            { cluster: clusterName }
          ),
        };
    }
  })();

  const accent = theme.palette[config.palette].main;
  const haloBg = theme.palette[config.palette].light;

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
        gap: 0,
        px: 3,
        py: 4,
      }}
    >
      <Box
        sx={{
          width: 84,
          height: 84,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: haloBg,
          color: accent,
          mb: 2.5,
        }}
      >
        {state === 'checking' ? (
          <CircularProgress size={34} sx={{ color: accent }} aria-hidden />
        ) : (
          <Icon icon={config.icon} width={38} />
        )}
      </Box>

      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', letterSpacing: '0.12em', mb: 0.5 }}
      >
        {config.kicker}
      </Typography>

      <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mb: 1, textWrap: 'balance' }}>
        {config.title}
      </Typography>

      <Typography
        component="span"
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          color: accent,
          bgcolor: haloBg,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          mb: 2,
          wordBreak: 'break-all',
          maxWidth: '100%',
        }}
      >
        {clusterName}
      </Typography>

      <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 460, mb: 3 }}>
        {config.body}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          width: '100%',
          maxWidth: 320,
        }}
      >
        {state === 'expired' && onSignIn && (
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<Icon icon="mdi:login-variant" />}
            onClick={onSignIn}
          >
            {t('translation|Sign in again')}
          </Button>
        )}
        {state === 'unreachable' && onRetry && (
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<Icon icon="mdi:refresh" />}
            onClick={onRetry}
          >
            {t('translation|Retry now')}
          </Button>
        )}
        <Button
          variant="outlined"
          color="inherit"
          size="large"
          startIcon={<Icon icon="mdi:arrow-left" />}
          onClick={onBack}
        >
          {t('translation|Back to All Clusters')}
        </Button>
      </Box>

      {state !== 'checking' && (error?.status !== undefined || error?.message) && (
        <Box sx={{ mt: 2.5, maxWidth: 460, width: '100%' }}>
          <Link
            component="button"
            type="button"
            variant="body2"
            color="text.secondary"
            underline="hover"
            onClick={() => setShowDetails(s => !s)}
            aria-expanded={showDetails}
          >
            {showDetails
              ? t('translation|Hide technical details')
              : t('translation|Technical details')}
          </Link>
          <Collapse in={showDetails} unmountOnExit>
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1.5,
                textAlign: 'left',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: 'text.secondary',
                bgcolor: 'background.muted',
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                overflowX: 'auto',
              }}
            >
              {[
                error?.status !== undefined
                  ? t('translation|HTTP code: {{code}}', { code: error.status })
                  : null,
                error?.message || null,
              ]
                .filter(Boolean)
                .join('\n')}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}
