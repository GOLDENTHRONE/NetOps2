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
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import { ResourceCategory } from '../../lib/k8s/ResourceCategory';
import { evaluateApplicationHealth } from '../applications/applicationHealth';
import { buildWorkloadObjectsMap, HealthBreakdown } from '../applications/ApplicationHealthChip';
import Link from '../common/Link';
import { KubeObjectStatus } from '../resourceMap/nodes/KubeObjectStatus';

/** The kinds whose getStatus verdict is a real health signal (readiness); for
 * every other kind Kubernetes reports no status, so a green check would be
 * meaningless. */
const HEALTH_SIGNAL_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'Pod',
  'PersistentVolumeClaim',
]);

/** True when at least one item in the category actually reports health. */
export function categoryHasHealthSignal(items: KubeObject[]): boolean {
  return items.some(item => HEALTH_SIGNAL_KINDS.has(item.kind));
}

export function ResourceCategoriesList({
  categoryList,
  selectedCategoryName,
  onCategoryClick,
}: {
  categoryList: Array<{
    category: ResourceCategory;
    items: KubeObject[];
    health: Record<KubeObjectStatus, number>;
  }>;
  selectedCategoryName?: string;
  onCategoryClick: (categoryName: string) => void;
}) {
  return (
    <Box
      sx={{
        flexShrink: 0,
      }}
    >
      <List dense>
        {categoryList.map(({ category, items, health }) => (
          <CategoryRow
            key={category.label}
            category={category}
            items={items}
            health={health}
            selected={selectedCategoryName === category.label}
            onCategoryClick={onCategoryClick}
          />
        ))}
      </List>
    </Box>
  );
}

/** Builds a per-kind count map for items. */
function kindCounts(items: KubeObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

/** Workload kinds that evaluateApplicationHealth understands. */
const WORKLOAD_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'Pod',
]);

/** Per-category short descriptor explaining what these resources do. */
const CATEGORY_EXPLANATIONS: Record<string, string> = {
  Network: 'Services route traffic to Pods.',
  Security: 'RBAC objects define access permissions.',
  Configuration: 'ConfigMaps and Secrets feed configuration to Pods.',
  Storage: 'PVCs manage storage binding.',
};

/** Returns non-Bound PVCs with their phase and requested size. */
function getPvcProblems(
  items: KubeObject[]
): Array<{ item: KubeObject; phase: string; size: string }> {
  const problems: Array<{ item: KubeObject; phase: string; size: string }> = [];
  for (const item of items) {
    if (item.kind === 'PersistentVolumeClaim') {
      const phase = (item.jsonData as any).status?.phase ?? 'Unknown';
      if (phase !== 'Bound') {
        const size = (item.jsonData as any).spec?.resources?.requests?.storage ?? 'unknown';
        problems.push({ item, phase, size });
      }
    }
  }
  return problems;
}

/** Counts total PVCs and how many are Bound. */
function pvcSummary(items: KubeObject[]): { total: number; bound: number } {
  let total = 0;
  let bound = 0;
  for (const item of items) {
    if (item.kind === 'PersistentVolumeClaim') {
      total++;
      if ((item.jsonData as any).status?.phase === 'Bound') bound++;
    }
  }
  return { total, bound };
}

/** Popover content: uses HealthBreakdown for workload categories,
 * PVC phase breakdown for storage, and short descriptors for the rest. */
function CategoryPopoverContent({
  category,
  items,
}: {
  category: ResourceCategory;
  items: KubeObject[];
  health: Record<KubeObjectStatus, number>;
}) {
  const { t } = useTranslation();
  const hasWorkloads = items.some(it => WORKLOAD_KINDS.has(it.kind));

  // Workload categories: use the same HealthBreakdown as the health chip.
  const appHealth = useMemo(
    () => (hasWorkloads ? evaluateApplicationHealth(items.map(it => it.jsonData)) : null),
    [hasWorkloads, items]
  );
  const workloadObjects = useMemo(
    () => (appHealth ? buildWorkloadObjectsMap(items, appHealth) : undefined),
    [appHealth, items]
  );

  if (hasWorkloads && appHealth) {
    return (
      <Box sx={{ p: 2, minWidth: 260, maxWidth: 380, maxHeight: 400, overflowY: 'auto' }}>
        <HealthBreakdown health={appHealth} workloadObjects={workloadObjects} />
      </Box>
    );
  }

  // Storage category: summary line + problem PVC list with clickable links
  const { total: pvcTotal, bound: pvcBound } = pvcSummary(items);
  const hasPvcs = pvcTotal > 0;
  if (hasPvcs) {
    const problems = getPvcProblems(items);

    return (
      <Box sx={{ p: 2, minWidth: 260, maxWidth: 380, maxHeight: 400, overflowY: 'auto' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          {category.label} - {pvcBound}/{pvcTotal} PVCs bound
        </Typography>
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
          {problems.length > 0 ? (
            problems.map(({ item, phase, size }) => (
              <Box
                key={item.metadata.uid}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: phase === 'Lost' ? 'error.main' : 'warning.main',
                    flexShrink: 0,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ flex: 1, minWidth: 0 }}
                  noWrap
                  title={item.metadata.name}
                >
                  <Link kubeObject={item}>{item.metadata.name}</Link> ({size})
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: phase === 'Lost' ? 'error.main' : 'warning.main',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  - {phase}
                </Typography>
              </Box>
            ))
          ) : (
            <Typography variant="caption" color="success.main">
              {t('translation|All PVCs are bound.')}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  // Non-signal categories: per-kind counts + short descriptor
  const explanation = CATEGORY_EXPLANATIONS[category.label] ?? '';

  return (
    <Box sx={{ p: 2, minWidth: 240, maxWidth: 340 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {category.label}
      </Typography>
      {items.length > 0 ? (
        <Box>
          {Object.entries(kindCounts(items)).map(([kind, count]) => (
            <Typography key={kind} variant="body2" sx={{ py: 0.25 }}>
              {kind}: {count}
            </Typography>
          ))}
          {explanation && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1.5, display: 'block', lineHeight: 1.4 }}
            >
              {t(`translation|${explanation}`)}
            </Typography>
          )}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t('translation|No resources in this category.')}
        </Typography>
      )}
    </Box>
  );
}

/** A single row in the resource categories list with its own popover state. */
function CategoryRow({
  category,
  items,
  health,
  selected,
  onCategoryClick,
}: {
  category: ResourceCategory;
  items: KubeObject[];
  health: Record<KubeObjectStatus, number>;
  selected: boolean;
  onCategoryClick: (categoryName: string) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const hasSignal = categoryHasHealthSignal(items);
  const error = health.error ?? 0;
  const warning = health.warning ?? 0;

  const healthColor =
    error > 0
      ? 'error.main'
      : warning > 0
      ? 'warning.main'
      : items.length > 0
      ? 'success.main'
      : 'grey.500';

  const countNode = (
    <Tooltip title="Click to see" arrow>
      <Box
        display="flex"
        alignItems="center"
        gap={0.5}
        onClick={e => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        sx={{ cursor: 'pointer' }}
      >
        <Typography
          variant="h6"
          sx={{
            color: hasSignal && items.length > 0 ? healthColor : 'text.primary',
            lineHeight: 1,
          }}
        >
          {items.length}
        </Typography>
      </Box>
    </Tooltip>
  );

  return (
    <ListItem disablePadding>
      <ListItemButton onClick={() => onCategoryClick(category.label)} selected={selected}>
        <ListItemIcon>
          <Icon icon={category.icon} style={{ fontSize: 32 }} />
        </ListItemIcon>
        <ListItemText
          primary={category.label}
          secondary={category.description}
          primaryTypographyProps={{ sx: { color: 'text.primary', fontWeight: 600 } }}
        />
        <ListItemIcon sx={{ justifyContent: 'flex-end' }}>{countNode}</ListItemIcon>
      </ListItemButton>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        disableRestoreFocus
      >
        <CategoryPopoverContent category={category} items={items} health={health} />
      </Popover>
    </ListItem>
  );
}
