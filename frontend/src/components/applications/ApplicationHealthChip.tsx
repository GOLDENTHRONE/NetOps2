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
import {
  alpha,
  Box,
  Divider,
  Popover,
  Skeleton,
  Theme,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import Link from '../common/Link';
import { AppHealth, AppHealthStatus, WorkloadHealth, WorkloadState } from './applicationHealth';

/**
 * The one place that says how each application-health verdict reads: color,
 * icon and tone. Shared by the Applications table's Health column and the
 * application details page's Status card, so the same verdict can never look
 * different in the two places.
 */
export const HEALTH_PRESENTATION: Record<
  AppHealthStatus,
  { icon: string; color: (t: Theme) => string }
> = {
  healthy: { icon: 'mdi:check-circle', color: t => t.palette.success.main },
  progressing: { icon: 'mdi:progress-clock', color: t => t.palette.info.main },
  degraded: { icon: 'mdi:alert', color: t => t.palette.warning.main },
  unhealthy: { icon: 'mdi:alert-circle', color: t => t.palette.error.main },
  idle: { icon: 'mdi:pause-circle-outline', color: t => t.palette.text.secondary },
  noWorkloads: { icon: 'mdi:cube-outline', color: t => t.palette.text.secondary },
  empty: { icon: 'mdi:help-circle-outline', color: t => t.palette.text.disabled },
};

/** Per-workload state colors, for the little status dots in the popover. */
export const WORKLOAD_STATE_COLOR: Record<WorkloadState, (t: Theme) => string> = {
  ready: t => t.palette.success.main,
  progressing: t => t.palette.info.main,
  degraded: t => t.palette.warning.main,
  down: t => t.palette.error.main,
  scaledZero: t => t.palette.text.disabled,
};

/**
 * The three-dot pulse used by Headlamp's splash screen, as an inline loading
 * indicator: quiet, familiar and lighter than skeleton bars.
 */
export function LoadingDots({ size = 6 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      aria-label="Loading"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${size * 0.7}px`,
        '@keyframes appLoadingDot': {
          '0%, 80%, 100%': { opacity: 0.25, transform: 'scale(0.8)' },
          '40%': { opacity: 1, transform: 'scale(1)' },
        },
        '& > span': {
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: theme.palette.text.secondary,
          animation: 'appLoadingDot 1.2s infinite ease-in-out',
        },
        '& > span:nth-of-type(2)': { animationDelay: '0.15s' },
        '& > span:nth-of-type(3)': { animationDelay: '0.3s' },
      }}
    >
      <span />
      <span />
      <span />
    </Box>
  );
}

/**
 * One workload's row in the health popover. When the live KubeObject is known
 * the name is a link straight to that resource's details page (the browser's
 * Back button returns here), so "Job failed" is one click from the Job itself.
 */
export function WorkloadRow({ w, kubeObject }: { w: WorkloadHealth; kubeObject?: KubeObject }) {
  const theme = useTheme();
  const color = WORKLOAD_STATE_COLOR[w.state](theme);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {w.kind}
      </Typography>
      <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap title={w.name}>
        {/* NOTE: no onClick here — Link treats onClick as "disable navigation".
            The popover is unmounted by the route change itself. */}
        {kubeObject ? <Link kubeObject={kubeObject}>{w.name}</Link> : w.name}
      </Typography>
      <Typography variant="caption" sx={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {w.reason ?? `${w.ready}/${w.desired}`}
      </Typography>
    </Box>
  );
}

/**
 * The body of the "why is health X" popover: the verdict, its meaning, and a
 * per-workload breakdown (problems first) where every workload links to its
 * own details page.
 */
export function HealthBreakdown({
  health,
  workloadObjects,
}: {
  health: AppHealth;
  workloadObjects?: Map<string, KubeObject>;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['translation']);
  const p = HEALTH_PRESENTATION[health.status];
  const color = p.color(theme);
  const problems = health.workloads.filter(w => w.state !== 'ready' && w.state !== 'scaledZero');

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Icon icon={p.icon} width={20} height={20} color={color} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>
          {health.label}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {health.summary}
      </Typography>

      {health.totalWorkloads > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          {problems.length > 0 ? (
            // Problem apps lead with what is wrong and list ONLY the failing
            // workloads — never the healthy "3/3 ready" rows — so an operator
            // sees the cause immediately, not stats that look fine.
            <>
              <Typography variant="caption" sx={{ fontWeight: 700, color }}>
                {t('translation|{{ count }} of {{ total }} workloads not ready', {
                  count: problems.length,
                  total: health.totalWorkloads,
                })}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                {problems.slice(0, 8).map(w => (
                  <WorkloadRow
                    key={`${w.kind}/${w.namespace}/${w.name}`}
                    w={w}
                    kubeObject={workloadObjects?.get(`${w.kind}/${w.namespace}/${w.name}`)}
                  />
                ))}
                {problems.length > 8 && (
                  <Typography variant="caption" color="text.secondary">
                    {t('translation|…and {{ count }} more with problems', {
                      count: problems.length - 8,
                    })}
                  </Typography>
                )}
              </Box>
            </>
          ) : (
            // Healthy app: the positive stat is the point here.
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {t('translation|All {{ total }} workloads ready', {
                total: health.totalWorkloads,
              })}
            </Typography>
          )}
        </>
      )}

      {health.status === 'noWorkloads' && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {t('translation|{{ count }} resource(s), none of them workloads that run pods.', {
              count: health.totalResources,
            })}
          </Typography>
        </>
      )}
    </>
  );
}

/**
 * A color-coded application-health chip that, on click, opens a popover
 * explaining *why* the application is Healthy / Degraded / Unhealthy / etc.,
 * from the real workload readiness — so an operator gets the reasoning, not
 * just a colored word. Used by both the Applications table (Health column)
 * and the application details page (Status card), guaranteeing the two always
 * agree.
 */
export function ApplicationHealthChip({
  health,
  loading,
  workloadObjects,
  size = 'small',
}: {
  health?: AppHealth;
  loading: boolean;
  /** Workload KubeObjects by "kind/namespace/name", for links in the popover. */
  workloadObjects?: Map<string, KubeObject>;
  /** 'medium' renders the larger chip used on the details page Status card. */
  size?: 'small' | 'medium';
}) {
  const theme = useTheme();
  const { t } = useTranslation(['translation']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const medium = size === 'medium';
  // One width for every pill (sized to the longest label, "No workloads"),
  // so the Health column reads as a tidy rail instead of ragged chips.
  const pillWidth = medium ? '9rem' : '8.25rem';

  if (!health && loading) {
    return <Skeleton variant="rounded" width={pillWidth} height={medium ? 28 : 24} />;
  }
  if (!health) {
    return null;
  }

  const p = HEALTH_PRESENTATION[health.status];
  const color = p.color(theme);

  return (
    <>
      <Tooltip title={t('translation|Click to see')}>
        <Box
          component="button"
          type="button"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-label={t('translation|Show health details')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            width: pillWidth,
            px: medium ? 1.25 : 1,
            py: medium ? '5px' : '3px',
            border: 'none',
            borderRadius: '999px',
            cursor: 'pointer',
            fontSize: medium ? '0.875rem' : '0.8125rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            color,
            backgroundColor: alpha(color, 0.12),
            '&:hover': { backgroundColor: alpha(color, 0.22) },
          }}
        >
          <Icon icon={p.icon} width={medium ? 18 : 16} height={medium ? 18 : 16} />
          {health.label}
        </Box>
      </Tooltip>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 380, minWidth: 260 } } }}
      >
        {/* Close on any link click: in drawer mode a link opens the details
            side panel WITHOUT a route change, and a still-open modal popover
            would keep its scroll lock + backdrop over the panel, freezing
            scrolling and clicks. Capture phase, so the Link still navigates. */}
        <Box
          onClickCapture={e => {
            if ((e.target as HTMLElement).closest('a')) {
              setAnchorEl(null);
            }
          }}
        >
          <HealthBreakdown health={health} workloadObjects={workloadObjects} />
        </Box>
      </Popover>
    </>
  );
}

/**
 * Builds the "kind/namespace/name" → KubeObject map the popover uses to link
 * each evaluated workload to its live object.
 */
export function buildWorkloadObjectsMap(
  items: KubeObject[],
  health: AppHealth
): Map<string, KubeObject> {
  const workloadObjects = new Map<string, KubeObject>();
  for (const item of items) {
    const key = `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`;
    if (health.workloads.some(w => `${w.kind}/${w.namespace}/${w.name}` === key)) {
      workloadObjects.set(key, item);
    }
  }
  return workloadObjects;
}
