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
import { alpha, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { loadClusterSettings } from '../../helpers/clusterSettings';
import { useCluster } from '../../lib/k8s';
import Namespace from '../../lib/k8s/namespace';
import Link from '../common/Link';
import { MetadataDictGrid } from '../common/Resource';
import ResourceListView from '../common/Resource/ResourceListView';
import {
  ResourceTableFromResourceClassProps,
  ResourceTableProps,
} from '../common/Resource/ResourceTable';
import { LightTooltip } from '../common/Tooltip';
import CreateNamespaceButton from './CreateNamespaceButton';

function NamespaceStatusPill({ namespace }: { namespace: Namespace }) {
  const theme = useTheme();
  const { t } = useTranslation('translation');
  const phase = namespace.status?.phase ?? 'Unknown';
  const isActive = phase === 'Active';

  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const iconName = isActive ? 'mdi:check-circle' : 'mdi:close-circle';
  const color = isActive ? theme.palette.success.main : theme.palette.error.main;

  const conditions = namespace.status?.conditions ?? [];
  const finalizers = namespace.metadata?.finalizers ?? [];

  return (
    <>
      <LightTooltip title={anchorEl ? '' : t('Click to see')}>
        <Box
          component="button"
          type="button"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-label={t('Show namespace status details')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: '3px',
            border: 'none',
            borderRadius: '999px',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            color,
            backgroundColor: alpha(color, 0.12),
            '&:hover': { backgroundColor: alpha(color, 0.22) },
          }}
        >
          <Icon icon={iconName} width={16} height={16} />
          {phase}
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
              p: 1.5,
              maxWidth: 380,
              minWidth: 260,
              border: '1px solid',
              borderColor: theme => (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.500'),
              borderRadius: 1,
              boxShadow: 4,
            },
          },
        }}
      >
        <Box sx={{ p: 0.5 }}>
          {/* Header row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Icon icon={iconName} width={20} height={20} color={color} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color, flexGrow: 1 }}>
              {phase}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setAnchorEl(null)}
              aria-label={t('Close')}
              sx={{ p: 0.25 }}
            >
              <Icon icon="mdi:close" width={16} />
            </IconButton>
          </Box>

          {/* Active: show descriptive text; non-Active: show only real K8s fields */}
          {isActive ? (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {t('Phase is Active — namespace is fully operational and accepting workloads.')}
              </Typography>
            </>
          ) : (
            (finalizers.length > 0 || conditions.length > 0) && (
              <>
                <Divider sx={{ my: 1 }} />

                {finalizers.length > 0 && (
                  <Box sx={{ mb: conditions.length > 0 ? 1 : 0 }}>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}
                    >
                      {t('Finalizers')}
                    </Typography>
                    {finalizers.map((f, i) => (
                      <Box
                        key={i}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 0.5 }}
                      >
                        <Box
                          component="span"
                          sx={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            backgroundColor: 'text.secondary',
                            flexShrink: 0,
                          }}
                        />
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                        >
                          {f}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                {conditions.length > 0 && (
                  <Box>
                    {conditions.map((c, i) => (
                      <Box key={i} sx={{ ml: 0.5, mb: 0.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {c.type}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              color:
                                c.status === 'True'
                                  ? theme.palette.error.main
                                  : theme.palette.text.secondary,
                              fontWeight: 600,
                            }}
                          >
                            — {c.status}
                          </Typography>
                        </Box>
                        {c.message && (
                          <Typography
                            variant="caption"
                            display="block"
                            color="text.secondary"
                            sx={{ mt: 0.25 }}
                          >
                            {c.message}
                          </Typography>
                        )}
                        {c.reason && (
                          <Typography
                            variant="caption"
                            display="block"
                            sx={{ color: theme.palette.warning.main }}
                          >
                            {t('Reason')}: {c.reason}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </>
            )
          )}
        </Box>
      </Popover>
    </>
  );
}

export default function NamespacesList() {
  const { t } = useTranslation(['glossary', 'translation']);
  const cluster = useCluster();
  // Use the metadata.name field to match the expected format of the ResourceTable component.
  const [allowedNamespaces, setAllowedNamespaces] = React.useState<
    { metadata: { name: string } }[]
  >([]);

  React.useEffect(() => {
    if (cluster) {
      const namespaces = loadClusterSettings(cluster)?.allowedNamespaces || [];
      setAllowedNamespaces(
        namespaces.map(namespace => ({
          metadata: {
            name: namespace,
          },
        }))
      );
    }
  }, [cluster]);

  const resourceTableProps:
    | ResourceTableProps<Namespace>
    | ResourceTableFromResourceClassProps<typeof Namespace> = React.useMemo(() => {
    if (allowedNamespaces.length > 0) {
      return {
        columns: [
          {
            id: 'name',
            label: t('translation|Name'),
            getValue: ns => ns.metadata.name,
            render: ({ metadata }) => (
              <Link
                routeName={'namespace'}
                params={{
                  name: metadata.name,
                }}
              >
                {metadata.name}
              </Link>
            ),
          },
          'cluster',
          {
            id: 'status',
            gridTemplate: 'auto',
            label: t('translation|Status'),
            getValue: () => 'Unknown',
          },
          {
            id: 'age',
            label: t('translation|Age'),
            getValue: () => 'Unknown',
          },
        ],
        data: allowedNamespaces as unknown as Namespace[],
      } satisfies ResourceTableProps<Namespace>;
    }
    return {
      resourceClass: Namespace,
      columns: [
        'name',
        'cluster',
        {
          id: 'status',
          gridTemplate: 'auto',
          label: t('translation|Status'),
          filterVariant: 'multi-select',
          getValue: ns => ns.status.phase,
          render: ns => (
            <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <NamespaceStatusPill namespace={ns} />
            </Box>
          ),
        },
        {
          id: 'labels',
          label: t('translation|Labels'),
          gridTemplate: 'auto',
          getValue: ns =>
            Object.entries(ns.metadata.labels || {})
              .map(([k, v]) => `${k}=${v}`)
              .join(', '),
          render: ns =>
            ns.metadata.labels ? <MetadataDictGrid dict={ns.metadata.labels} /> : null,
        },
        'age',
      ],
    } satisfies ResourceTableFromResourceClassProps<typeof Namespace>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedNamespaces]);

  return (
    <ResourceListView
      title={t('Namespaces')}
      headerProps={{
        titleSideActions: [<CreateNamespaceButton />],
        noNamespaceFilter: true,
      }}
      {...(resourceTableProps as ResourceTableProps<Namespace>)}
    />
  );
}
