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
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../../../lib/k8s/api/v2/ApiError';
import type { Cluster } from '../../../lib/k8s/cluster';
import { LightTooltip } from '../../common/Tooltip';
import { getControlPlaneHealthyCondition, STATUS_VARIANTS } from './ClusterInventory';
import { getClusterStatus } from './clusterStatus';

type Translate = (key: string) => string;

/** Reachability of the cluster API server, as told by the last version request. */
type Reachability = 'reachable' | 'unreachable' | 'unknown';

/**
 * Whether the API server answered at all. 401 and 403 count as an answer: the server
 * replied, it only refused the credentials.
 */
function getReachability(error: ApiError | null | undefined): Reachability {
  const status = getClusterStatus(error);
  if (status === 'active' || status === 'auth-error' || status === 'permission-error') {
    return 'reachable';
  }
  if (status === 'unavailable') {
    return 'unreachable';
  }
  return 'unknown';
}

function getReachabilityLabel(t: Translate, reachability: Reachability, status?: number) {
  const code = status !== undefined ? ` (HTTP ${status})` : '';
  if (reachability === 'reachable') {
    return t('translation|Reachable') + code;
  }
  if (reachability === 'unreachable') {
    return t('translation|Not reachable') + code;
  }
  return t('translation|Checking…');
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box display="flex" gap={2} alignItems="baseline" py={0.4}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>{value}</Box>
    </Box>
  );
}

export interface ClusterStatusPopoverProps {
  cluster: Cluster;
  /** Result of the last cluster version request: undefined while pending, null when it succeeded. */
  error?: ApiError | null;
  /** Status kind used to colour the header, matching the table cell. */
  statusKind: keyof typeof STATUS_VARIANTS;
  /** Status label shown in the table cell. */
  statusText: string;
  /** The status cell content, used as the popover trigger. */
  children: ReactNode;
}

/**
 * Wraps a cluster status cell so it can be clicked to open a popover showing what the
 * cluster API server answered for that status.
 */
export default function ClusterStatusPopover({
  cluster,
  error,
  statusKind,
  statusText,
  children,
}: ClusterStatusPopoverProps) {
  const { t } = useTranslation(['translation']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  const variant = STATUS_VARIANTS[statusKind];
  const color = theme.palette.home.status[variant.colorKey];
  const reachability = getReachability(error);
  const condition = getControlPlaneHealthyCondition(cluster);
  const server: string | undefined = cluster.server;
  const emptyValue = '—';
  // Colour follows the status kind, not reachability: a 401/403 means the API server
  // answered, but the row is still an error.
  const summaryColor = reachability === 'unknown' ? theme.palette.text.secondary : color;

  function copyServer() {
    if (!server) {
      return;
    }
    navigator.clipboard?.writeText(server).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <LightTooltip title={t('translation|Click to see why')}>
        <Box
          component="button"
          type="button"
          aria-haspopup="dialog"
          onClick={event => setAnchorEl(event.currentTarget)}
          sx={{
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
            borderRadius: 1,
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
          }}
        >
          {children}
        </Box>
      </LightTooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              maxWidth: 420,
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box px={2} pt={1.5} pb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <Icon icon={variant.icon} width={20} color={color} />
            <Typography variant="subtitle1" sx={{ color, fontWeight: 700, flexGrow: 1 }}>
              {statusText}
            </Typography>
            <IconButton
              size="small"
              aria-label={t('translation|Close')}
              onClick={() => setAnchorEl(null)}
            >
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Box>
          <Box display="flex" alignItems="baseline" gap={0.75} mt={0.75}>
            <Typography variant="body2" color="text.secondary">
              {t('translation|API server:')}
            </Typography>
            <Typography variant="body2" sx={{ color: summaryColor, fontWeight: 600 }}>
              {getReachabilityLabel(t, reachability, error?.status)}
            </Typography>
          </Box>
        </Box>
        <Divider />
        <Box px={2} py={1}>
          <DetailRow
            label={t('translation|API server')}
            value={
              server ? (
                <Box display="flex" alignItems="center" gap={0.5} sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {server}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={t('translation|Copy')}
                    onClick={copyServer}
                    sx={{ flexShrink: 0 }}
                  >
                    <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={14} />
                  </IconButton>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {emptyValue}
                </Typography>
              )
            }
          />
          {/* Only failed requests carry a status code: clusterRequest drops it on success. */}
          {error?.status !== undefined && (
            <DetailRow
              label={t('translation|HTTP code')}
              value={
                <Typography variant="body2" sx={{ color: summaryColor }}>
                  {error.status}
                </Typography>
              }
            />
          )}
          {error?.message && (
            <DetailRow
              label={t('translation|Reported error')}
              value={
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                  {error.message}
                </Typography>
              }
            />
          )}
          {condition && (
            <DetailRow
              label={t('translation|Control plane')}
              value={
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                  {[condition.reason, condition.message, condition.lastTransitionTime]
                    .filter(Boolean)
                    .join('\n')}
                </Typography>
              }
            />
          )}
        </Box>
      </Popover>
    </>
  );
}
