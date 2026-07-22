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
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import { ResourceCategory } from '../../lib/k8s/ResourceCategory';
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

/** Popover content: breakdown by kind and health state for a category. */
function CategoryPopoverContent({
  category,
  items,
  health,
}: {
  category: ResourceCategory;
  items: KubeObject[];
  health: Record<KubeObjectStatus, number>;
}) {
  const { t } = useTranslation();
  const hasSignal = categoryHasHealthSignal(items);
  const error = health.error ?? 0;
  const warning = health.warning ?? 0;
  const success = health.success ?? 0;
  const counts = kindCounts(items);

  return (
    <Box sx={{ p: 2, minWidth: 220, maxWidth: 320 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {category.label}
      </Typography>

      {/* Per-kind breakdown */}
      {Object.entries(counts).map(([kind, count]) => (
        <Typography key={kind} variant="body2" sx={{ py: 0.25 }}>
          {kind}: {count}
        </Typography>
      ))}

      {/* Health summary for categories with signals */}
      {hasSignal && items.length > 0 && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          {error > 0 && (
            <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
              {t('translation|{{ count }} unhealthy (no ready replicas or failed)', {
                count: error,
              })}
            </Typography>
          )}
          {warning > 0 && (
            <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }}>
              {t('translation|{{ count }} degraded (fewer ready replicas than desired)', {
                count: warning,
              })}
            </Typography>
          )}
          {success > 0 && (
            <Typography variant="body2" color="success.main">
              {t('translation|{{ count }} healthy', { count: success })}
            </Typography>
          )}
        </Box>
      )}

      {/* Count-only categories: explain why there is no health signal */}
      {!hasSignal && items.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('translation|No runtime health signal for this resource type.')}
        </Typography>
      )}

      {items.length === 0 && (
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
