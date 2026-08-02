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
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import { alpha, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { KubeCondition } from '../../lib/k8s/cluster';
import {
  getConditionStatusIcon,
  getConditionStatusKind,
  getFriendlyConditionText,
} from './conditionMeta';
import { DateLabel, HoverInfoLabel, StatusLabel } from './Label';
import SimpleTable from './SimpleTable';
import { LightTooltip } from './Tooltip';

/**
 * Returns the condition from the given array whose type is 'Ready',
 * or undefined if no such condition exists.
 *
 * This utility is provided because the pattern
 *   conditions.find(c => c.type === 'Ready')
 * appears at least 9 times across the codebase. Centralising it here
 * makes call-sites shorter and keeps the semantics in one place.
 *
 * @param conditions - Array of KubeCondition objects to search.
 */
export function getReadyCondition(
  conditions: KubeCondition[] | undefined | null
): KubeCondition | undefined {
  return conditions?.find(c => c.type === 'Ready');
}

export interface ConditionListProps {
  /**
   * The conditions array, typically from resource.status.conditions.
   * Renders nothing when null, undefined, or empty.
   */
  conditions: KubeCondition[] | undefined | null;
  /**
   * When true, a Last Update column is shown in addition to Last Transition.
   * Defaults to false because most callers do not need it.
   */
  showLastUpdate?: boolean;
}

/**
 * ConditionList renders a Kubernetes conditions array as a consistent table.
 *
 * The component is intended to replace several existing condition renderers across the UI,
 * including common/Resource/Resource.tsx, gateway/ClassList.tsx, gateway/GatewayDetails.tsx, and
 * crd/CustomResourceDetails.tsx, which currently derive status colour in different ways.
 * The rules used here are:
 *
 * - status === 'True'  -> 'success'
 * - status === 'False' -> 'error'
 * - anything else      -> '' (neutral chip)
 *
 * @example
 * // Basic usage
 * <ConditionList conditions={resource.status?.conditions} />
 *
 * @example
 * // With the extra Last Update column
 * <ConditionList conditions={resource.status?.conditions} showLastUpdate />
 */
export function ConditionList({ conditions, showLastUpdate = false }: ConditionListProps) {
  const { t } = useTranslation(['glossary', 'translation']);

  if (!conditions || conditions.length === 0) {
    return null;
  }

  const columns: {
    label: string;
    getter: (c: KubeCondition) => React.ReactNode;
    hide?: boolean;
  }[] = [
    {
      label: t('glossary|Condition'),
      getter: condition => <StatusLabel status="">{condition.type}</StatusLabel>,
    },
    {
      label: t('translation|Status'),
      getter: condition => <ConditionStatusCell condition={condition} />,
    },
    {
      label: t('glossary|Last Transition'),
      getter: condition =>
        condition.lastTransitionTime !== null && condition.lastTransitionTime !== undefined ? (
          <DateLabel date={condition.lastTransitionTime} />
        ) : (
          '-'
        ),
    },
    {
      label: t('glossary|Last Update'),
      getter: condition =>
        condition.lastUpdateTime !== null && condition.lastUpdateTime !== undefined ? (
          <DateLabel date={condition.lastUpdateTime} />
        ) : (
          '-'
        ),
      hide: !showLastUpdate,
    },
    {
      label: t('translation|Reason'),
      getter: condition =>
        condition.reason ? (
          <HoverInfoLabel label={condition.reason} hoverInfo={condition.message} noWrap={false} />
        ) : (
          '-'
        ),
    },
  ];

  return <SimpleTable data={conditions} columns={columns.filter(col => !col.hide)} />;
}

/**
 * Renders the Status cell for a single condition row.
 *
 * The pill uses a fully-rounded ("pill") shape via a borderRadius override so
 * it visually reads as a status chip regardless of theme.shape.borderRadius.
 * The trailing info icon opens a click-triggered Popover that shows the
 * friendly explanation, the raw reason, and the message (when present).
 * A tooltip on the icon tells the user the pill is interactive.
 */
function ConditionStatusCell({ condition }: { condition: KubeCondition }) {
  const { t } = useTranslation(['glossary', 'translation']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const statusText = condition.status ?? '';
  const kind = getConditionStatusKind(condition.type, statusText);
  const iconName = getConditionStatusIcon(kind);
  const friendly = getFriendlyConditionText(condition.type, statusText, condition.reason);
  const hasDetails = Boolean(friendly || condition.message);
  const open = Boolean(anchorEl);

  const color =
    kind === 'success'
      ? theme.palette.success.main
      : kind === 'warning'
      ? theme.palette.warning.main
      : kind === 'error'
      ? theme.palette.error.main
      : theme.palette.text.secondary;

  return (
    <>
      <LightTooltip title={open ? '' : t('translation|Click to see details')}>
        <Box
          component="button"
          type="button"
          onClick={e => (hasDetails ? setAnchorEl(e.currentTarget as HTMLElement) : undefined)}
          disabled={!hasDetails}
          aria-label={hasDetails ? t('translation|Click to see details') : statusText || '-'}
          aria-haspopup={hasDetails ? 'dialog' : undefined}
          aria-expanded={hasDetails ? open : undefined}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            px: 1,
            py: '3px',
            border: 'none',
            borderRadius: '999px',
            cursor: hasDetails ? 'pointer' : 'default',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            color,
            backgroundColor: alpha(color, 0.12),
            '&:hover': hasDetails ? { backgroundColor: alpha(color, 0.22) } : {},
            '&:focus-visible': { outline: '2px solid', outlineColor: color },
          }}
        >
          <Icon icon={iconName} width={16} height={16} />
          {statusText || '-'}
        </Box>
      </LightTooltip>
      {hasDetails ? (
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{
            paper: {
              sx: {
                p: 1.75,
                maxWidth: 420,
                minWidth: 300,
                border: '1.5px solid',
                borderColor: alpha(color, 0.5),
                borderRadius: 1.5,
                boxShadow: 6,
                backgroundImage: 'none',
              },
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Icon icon={iconName} width={20} height={20} color={color} />
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 700, color, flexGrow: 1, lineHeight: 1.2 }}
            >
              {condition.type} · {statusText}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setAnchorEl(null)}
              aria-label={t('translation|Close')}
              sx={{ p: 0.25 }}
            >
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Box>
          {friendly ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: condition.message ? 1 : 0 }}
            >
              {friendly}
            </Typography>
          ) : null}
          {condition.message ? (
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1, mt: 0.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}
              >
                {condition.message}
              </Typography>
            </Box>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
