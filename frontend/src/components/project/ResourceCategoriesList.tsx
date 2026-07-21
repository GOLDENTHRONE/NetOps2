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
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { Box } from '@mui/system';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import { ResourceCategory } from '../../lib/k8s/ResourceCategory';
import { LightTooltip } from '../common/Tooltip';
import { KubeObjectStatus } from '../resourceMap/nodes/KubeObjectStatus';
import { getHealthIcon } from './projectUtils';

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
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        flexShrink: 0,
      }}
    >
      <List dense>
        {categoryList.map(({ category, items, health }) => {
          // Only categories with kinds that report readiness (Workloads) get a
          // health icon + color. Network / Storage / Security / Configuration
          // are counts only: no icon, plain black number — a status glyph on a
          // ConfigMap or Service would be meaningless.
          const hasSignal = categoryHasHealthSignal(items);
          const error = health.error ?? 0;
          const warning = health.warning ?? 0;
          const success = health.success ?? 0;

          const healthColor =
            error > 0
              ? 'error.main'
              : warning > 0
              ? 'warning.main'
              : items.length > 0
              ? 'success.main'
              : 'grey.500';

          let tooltip = '';
          let healthIcon = '';
          if (hasSignal) {
            healthIcon = getHealthIcon(success, error, warning);
            if (error > 0) {
              tooltip = t(
                'translation|{{ error }} with no ready replicas or failed, {{ warning }} partially ready, {{ success }} ready.',
                { error, warning, success }
              );
            } else if (warning > 0) {
              tooltip = t(
                'translation|{{ warning }} running fewer ready replicas than desired, {{ success }} ready.',
                { warning, success }
              );
            } else {
              tooltip = t('translation|All {{ count }} report ready.', { count: items.length });
            }
          }

          const countNode = (
            <Box display="flex" alignItems="center" gap={0.5}>
              <Typography
                variant="h6"
                sx={{
                  // Health-bearing categories color the count by verdict;
                  // count-only categories stay plain black for readability.
                  color: hasSignal && items.length > 0 ? healthColor : 'text.primary',
                  lineHeight: 1,
                }}
              >
                {items.length}
              </Typography>
              {hasSignal && items.length > 0 && (
                <Box component={Icon} icon={healthIcon} sx={{ fontSize: 20, color: healthColor }} />
              )}
            </Box>
          );

          return (
            <ListItem key={category.label} disablePadding>
              <ListItemButton
                onClick={() => onCategoryClick(category.label)}
                selected={selectedCategoryName === category.label}
              >
                <ListItemIcon>
                  <Icon icon={category.icon} style={{ fontSize: 32 }} />
                </ListItemIcon>
                <ListItemText
                  primary={category.label}
                  secondary={category.description}
                  primaryTypographyProps={{ sx: { color: 'text.primary', fontWeight: 600 } }}
                />
                <ListItemIcon sx={{ justifyContent: 'flex-end' }}>
                  {tooltip ? <LightTooltip title={tooltip}>{countNode}</LightTooltip> : countNode}
                </ListItemIcon>
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
