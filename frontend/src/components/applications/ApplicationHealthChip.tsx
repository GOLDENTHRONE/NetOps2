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
  IconButton,
  Popover,
  Theme,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import Link from '../common/Link';
import { LightTooltip } from '../common/Tooltip';
import {
  AppHealth,
  AppHealthStatus,
  PodHealth,
  ScheduleInfo,
  ScheduleState,
  WorkloadHealth,
  WorkloadState,
} from './applicationHealth';

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
  paused: t => t.palette.text.secondary,
};

/**
 * Colors for the schedule/CronJob dots. Kept in a cooler palette than the
 * workload states because a CronJob's state is scheduling context, not app
 * health — an operator scanning the popover must never confuse the two.
 */
export const SCHEDULE_STATE_COLOR: Record<ScheduleState, (t: Theme) => string> = {
  onSchedule: t => t.palette.success.main,
  running: t => t.palette.info.main,
  suspended: t => t.palette.text.disabled,
  behind: t => t.palette.warning.main,
  never: t => t.palette.text.secondary,
};

/**
 * Dot color for a pod problem: hard faults (crashLoop / imagePull / oomKilled)
 * are error-red; unschedulable is warning-amber since the pod is not broken,
 * only unplaceable.
 */
function podColor(p: PodHealth, theme: Theme): string {
  if (p.state === 'unschedulable') return theme.palette.warning.main;
  return theme.palette.error.main;
}

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
  // Surface the controller for controller-owned workloads (Job from CronJob
  // is the common case: "Job foo-28912345 from CronJob foo" beats an opaque
  // hash-suffixed Job name). Skip the trivial case where the owner is the
  // resource itself (should not happen but be safe).
  const ownerLabel =
    w.ownerKind && w.ownerName && !(w.ownerKind === w.kind && w.ownerName === w.name)
      ? `${w.ownerKind}/${w.ownerName}`
      : undefined;
  // HPA context tag, if an HPA scales this workload. Reading it as
  // "min–max, current" tells an operator that a temporarily-low ready count
  // is autoscaler behavior, not a mystery flap.
  const hpaTag = w.hpa
    ? `HPA ${w.hpa.min}–${w.hpa.max}${
        w.hpa.current !== undefined ? `, current ${w.hpa.current}` : ''
      }`
    : undefined;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {w.kind}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="caption" noWrap title={w.name}>
          {/* NOTE: no onClick here — Link treats onClick as "disable navigation".
              The popover is unmounted by the route change itself. */}
          {kubeObject ? <Link kubeObject={kubeObject}>{w.name}</Link> : w.name}
        </Typography>
        {(ownerLabel || hpaTag) && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.2 }}
            noWrap
            title={[ownerLabel, hpaTag].filter(Boolean).join(' · ')}
          >
            {[ownerLabel && `from ${ownerLabel}`, hpaTag].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" sx={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {w.reason ?? `${w.ready}/${w.desired}`}
      </Typography>
    </Box>
  );
}

/**
 * One schedule (CronJob) row in the popover. Rendered under a separate
 * heading so its state cannot be mistaken for a workload verdict.
 */
export function ScheduleRow({ s, kubeObject }: { s: ScheduleInfo; kubeObject?: KubeObject }) {
  const theme = useTheme();
  const color = SCHEDULE_STATE_COLOR[s.state](theme);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {s.kind}
      </Typography>
      <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap title={s.name}>
        {kubeObject ? <Link kubeObject={kubeObject}>{s.name}</Link> : s.name}
      </Typography>
      <Typography variant="caption" sx={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {s.reason}
      </Typography>
    </Box>
  );
}

/**
 * Generic problem row shared by pod / PVC / quota / service / ingress / PDB
 * sections. Same shape as WorkloadRow (dot, kind, name-with-owner, reason),
 * kept in one place so every section reads the same way.
 */
export function ProblemRow({
  kind,
  name,
  namespace,
  reason,
  color,
  owner,
  workloadObjects,
}: {
  kind: string;
  name: string;
  namespace?: string;
  reason: string;
  color: string;
  owner?: string;
  workloadObjects?: Map<string, KubeObject>;
}) {
  const kubeObject = workloadObjects?.get(`${kind}/${namespace}/${name}`);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {kind}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="caption" noWrap title={name}>
          {kubeObject ? <Link kubeObject={kubeObject}>{name}</Link> : name}
        </Typography>
        {owner && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.2 }}
            noWrap
            title={owner}
          >
            {`from ${owner}`}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" sx={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {reason}
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
  onClose,
}: {
  health: AppHealth;
  workloadObjects?: Map<string, KubeObject>;
  /** When provided, renders a close (X) button in the popover header. */
  onClose?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['translation']);
  const p = HEALTH_PRESENTATION[health.status];
  const color = p.color(theme);
  // "Problems" excludes intentional off-states (scaledZero, paused): a paused
  // Deployment with N/N ready is not a fault, and inflating the "not ready"
  // count with it would misrepresent the app.
  const problems = health.workloads.filter(
    w => w.state !== 'ready' && w.state !== 'scaledZero' && w.state !== 'paused'
  );
  const shownServiceProblems = health.serviceProblems.slice(0, 6);
  const hiddenServiceProblems = Math.max(
    0,
    health.serviceProblems.length - shownServiceProblems.length
  );
  const criticalServices = health.criticalServiceProblems.length;

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Icon icon={p.icon} width={20} height={20} color={color} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color, flexGrow: 1 }}>
          {health.label}
        </Typography>
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('translation|Close')}
            sx={{ p: 0.25 }}
          >
            <Icon icon="mdi:close" width={16} />
          </IconButton>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {health.status === 'healthy'
          ? t('translation|Every workload has all of its desired replicas ready.')
          : health.status === 'progressing'
          ? t('translation|This application is still rolling out.')
          : health.status === 'degraded'
          ? t('translation|This application is partially available.')
          : health.status === 'unhealthy'
          ? t('translation|This application is not ready — see the details below.')
          : health.status === 'idle'
          ? t('translation|This application is intentionally scaled to zero.')
          : health.status === 'noWorkloads'
          ? t('translation|This application has no workloads that run pods.')
          : health.status === 'empty'
          ? t('translation|This application has no resources.')
          : health.summary}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {t(
          'translation|Health status counts workloads first. Pods/storage/quota/network checks are extra signals shown below.'
        )}
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

      {health.podProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.error.main }}>
            {t('translation|Pod problems')} ({health.podProblems.length})
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.podProblems.slice(0, 6).map(p => (
              <ProblemRow
                key={`${p.kind}/${p.namespace}/${p.name}`}
                kind={p.kind}
                name={p.name}
                namespace={p.namespace}
                reason={p.reason}
                color={podColor(p, theme)}
                owner={p.ownerKind && p.ownerName ? `${p.ownerKind}/${p.ownerName}` : undefined}
                workloadObjects={workloadObjects}
              />
            ))}
            {health.podProblems.length > 6 && (
              <Typography variant="caption" color="text.secondary">
                {t('translation|…and {{ count }} more', {
                  count: health.podProblems.length - 6,
                })}
              </Typography>
            )}
          </Box>
        </>
      )}

      {health.pvcProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.warning.main }}>
            {t('translation|Storage problems')} ({health.pvcProblems.length})
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.pvcProblems.slice(0, 6).map(p => (
              <ProblemRow
                key={`${p.kind}/${p.namespace}/${p.name}`}
                kind={p.kind}
                name={p.name}
                namespace={p.namespace}
                reason={p.reason}
                color={p.state === 'lost' ? theme.palette.error.main : theme.palette.warning.main}
                workloadObjects={workloadObjects}
              />
            ))}
          </Box>
        </>
      )}

      {health.quotaProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: health.quotaProblems.some(q => q.state === 'exhausted')
                ? theme.palette.error.main
                : theme.palette.warning.main,
            }}
          >
            {t('translation|Quota pressure')} ({health.quotaProblems.length})
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.quotaProblems.slice(0, 4).map(q => (
              <ProblemRow
                key={`${q.kind}/${q.namespace}/${q.name}`}
                kind={q.kind}
                name={q.name}
                namespace={q.namespace}
                reason={q.reason}
                color={
                  q.state === 'exhausted' ? theme.palette.error.main : theme.palette.warning.main
                }
                workloadObjects={workloadObjects}
              />
            ))}
          </Box>
        </>
      )}

      {health.serviceProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.warning.main }}>
            {t('translation|Service problems')} ({health.serviceProblems.length})
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {criticalServices > 0
              ? t(
                  'translation|{{ count }} ingress-exposed service(s) affect app health. Others shown as diagnostics.',
                  { count: criticalServices }
                )
              : t('translation|Diagnostic only: internal services without ready endpoints.')}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {shownServiceProblems.map(s => (
              <ProblemRow
                key={`${s.kind}/${s.namespace}/${s.name}`}
                kind={s.kind}
                name={s.name}
                namespace={s.namespace}
                reason={
                  health.criticalServiceProblems.some(
                    cs => cs.name === s.name && cs.namespace === s.namespace
                  )
                    ? `${s.reason} (impacts health)`
                    : `${s.reason} (diagnostic)`
                }
                color={
                  health.criticalServiceProblems.some(
                    cs => cs.name === s.name && cs.namespace === s.namespace
                  )
                    ? theme.palette.warning.main
                    : theme.palette.text.secondary
                }
                workloadObjects={workloadObjects}
              />
            ))}
            {hiddenServiceProblems > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('translation|…and {{ count }} more services', {
                  count: hiddenServiceProblems,
                })}
              </Typography>
            )}
          </Box>
        </>
      )}

      {health.ingressProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.warning.main }}>
            {t('translation|Ingress problems')} ({health.ingressProblems.length})
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.ingressProblems.slice(0, 6).map(i => (
              <ProblemRow
                key={`${i.kind}/${i.namespace}/${i.name}`}
                kind={i.kind}
                name={i.name}
                namespace={i.namespace}
                reason={i.reason}
                color={
                  i.state === 'missingBackend'
                    ? theme.palette.warning.main
                    : theme.palette.text.secondary
                }
                workloadObjects={workloadObjects}
              />
            ))}
          </Box>
        </>
      )}

      {health.pdbProblems.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            {t('translation|Disruption budgets blocked')} ({health.pdbProblems.length})
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.pdbProblems.slice(0, 4).map(p => (
              <ProblemRow
                key={`${p.kind}/${p.namespace}/${p.name}`}
                kind={p.kind}
                name={p.name}
                namespace={p.namespace}
                reason={p.reason}
                color={theme.palette.text.secondary}
                workloadObjects={workloadObjects}
              />
            ))}
          </Box>
        </>
      )}

      {health.schedules.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            {t('translation|Scheduled jobs (informational)')}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {health.schedules.slice(0, 6).map(s => (
              <ScheduleRow
                key={`${s.kind}/${s.namespace}/${s.name}`}
                s={s}
                kubeObject={workloadObjects?.get(`${s.kind}/${s.namespace}/${s.name}`)}
              />
            ))}
            {health.schedules.length > 6 && (
              <Typography variant="caption" color="text.secondary">
                {t('translation|…and {{ count }} more', {
                  count: health.schedules.length - 6,
                })}
              </Typography>
            )}
          </Box>
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
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: pillWidth,
          height: medium ? 28 : 24,
        }}
      >
        <LoadingDots size={medium ? 6 : 5} />
      </Box>
    );
  }
  if (!health) {
    return null;
  }

  const p = HEALTH_PRESENTATION[health.status];
  const color = p.color(theme);

  return (
    <>
      <LightTooltip title={anchorEl ? '' : t('translation|Click to see')}>
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
      </LightTooltip>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              p: 1.5,
              maxWidth: 560,
              minWidth: 300,
              border: '1px solid',
              borderColor: theme => (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.500'),
              borderRadius: 1,
              boxShadow: 4,
            },
          },
        }}
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
          <HealthBreakdown
            health={health}
            workloadObjects={workloadObjects}
            onClose={() => setAnchorEl(null)}
          />
        </Box>
      </Popover>
    </>
  );
}

/**
 * Builds the "kind/namespace/name" → KubeObject map the popover uses to link
 * each evaluated workload, schedule and problem row (pods, PVCs, quotas,
 * services, ingresses, PDBs) to its live object.
 */
export function buildWorkloadObjectsMap(
  items: KubeObject[],
  health: AppHealth
): Map<string, KubeObject> {
  const wanted = new Set<string>();
  const add = (arr: Array<{ kind: string; namespace?: string; name: string }>) => {
    for (const it of arr) wanted.add(`${it.kind}/${it.namespace}/${it.name}`);
  };
  add(health.workloads);
  add(health.schedules);
  add(health.podProblems);
  add(health.pvcProblems);
  add(health.quotaProblems);
  add(health.serviceProblems);
  add(health.ingressProblems);
  add(health.pdbProblems);
  const out = new Map<string, KubeObject>();
  for (const item of items) {
    const key = `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`;
    if (wanted.has(key)) out.set(key, item);
  }
  return out;
}
