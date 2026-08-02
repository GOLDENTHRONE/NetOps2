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

  function renderStatusCell(condition: KubeCondition) {
    const statusText = condition.status ?? '';
    const kind = getConditionStatusKind(condition.type, statusText);
    const iconName = getConditionStatusIcon(kind);
    const friendly = getFriendlyConditionText(condition.type, statusText, condition.reason);
    const rawReason = condition.reason ? ` (reason: ${condition.reason})` : '';
    const tooltip = friendly ? `${friendly}${rawReason}` : condition.message || condition.reason;

    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <StatusLabel status={kind}>
          <Icon icon={iconName} width="1rem" height="1rem" style={{ alignSelf: 'center' }} />
          {statusText || '-'}
        </StatusLabel>
        {tooltip ? (
          <LightTooltip title={tooltip}>
            <Box
              component="span"
              tabIndex={0}
              aria-label={typeof tooltip === 'string' ? tooltip : undefined}
              sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}
            >
              <Icon icon="mdi:information-outline" width="1rem" height="1rem" />
            </Box>
          </LightTooltip>
        ) : null}
      </Box>
    );
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
      getter: renderStatusCell,
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
