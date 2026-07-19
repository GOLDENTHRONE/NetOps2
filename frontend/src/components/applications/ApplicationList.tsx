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
  Autocomplete,
  Box,
  Checkbox,
  Divider,
  Popover,
  TextField,
  Theme,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import Link from '../common/Link';
import Table, { TableColumn } from '../common/Table/Table';
import {
  AppHealth,
  AppHealthStatus,
  evaluateApplicationHealth,
  healthSortRank,
  WorkloadHealth,
  WorkloadState,
} from './applicationHealth';
import { ApplicationDefinition, NOT_AVAILABLE } from './applicationUtils';
import { groupResourcesByApplication, useAllApplicationResources } from './useApplicationResources';
import { useApplicationDefinitions } from './useApplications';

/**
 * Renders an application metadata value, using a small subdued "n/a" when the
 * value is not available (e.g. the cluster doesn't carry the uspe.dev labels
 * yet).
 */
function MetadataValue({ value }: { value: string }) {
  if (value === NOT_AVAILABLE) {
    return (
      <Typography component="span" variant="caption" color="text.secondary">
        {NOT_AVAILABLE}
      </Typography>
    );
  }
  return <>{value}</>;
}

/**
 * Multi-select filter over application (namespace) names, styled like the
 * namespaces filter dropdown ({@link PureNamespacesAutocomplete}) but wide
 * enough to show whole application names.
 *
 * The typed search text is kept while the popup is open, so "type to narrow
 * down, then tick several checkboxes" works: selecting an option does NOT
 * reset the text (which used to snap the option list back to the full list
 * and jump the scroll position on every click). The text clears once the
 * popup closes.
 */
function ApplicationsAutocomplete({
  applicationNames,
  selectedApplications,
  onChange,
}: {
  applicationNames: string[];
  selectedApplications: string[];
  onChange: (newValue: string[]) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['translation', 'glossary']);
  const [input, setInput] = useState('');
  // Wide enough that typical (namespace) application names fit whole.
  const maxNamesChars = 40;

  const onInputChange = (_event: object, value: string, reason: string) => {
    // MUI fires a 'reset' input change after each selection, which would wipe
    // the user's search text mid-selection; ignore it so the filtered list
    // (and its scroll position) stay put while ticking checkboxes.
    if (reason !== 'reset') {
      setInput(value);
    }
  };

  return (
    <Autocomplete
      multiple
      id="applications-filter"
      autoComplete
      openOnFocus
      disableCloseOnSelect
      options={applicationNames}
      onChange={(_event, newValue) => {
        onChange(newValue);
      }}
      onClose={() => setInput('')}
      onInputChange={onInputChange}
      inputValue={input}
      value={selectedApplications}
      renderOption={(props, option, { selected }) => (
        <li {...props} key={props.key}>
          <Checkbox
            icon={<Icon icon="mdi:checkbox-blank-outline" />}
            checkedIcon={<Icon icon="mdi:check-box-outline" />}
            style={{
              color: selected ? theme.palette.primary.main : theme.palette.text.primary,
            }}
            checked={selected}
          />
          {option}
        </li>
      )}
      renderTags={(tags: string[]) => {
        if (tags.length === 0) {
          return <Typography variant="body2">{t('translation|All applications')}</Typography>;
        }

        // Show the most recently selected first, purely for display: the
        // label is ellipsized, so surfacing the newest selection makes each
        // click visibly do something.
        const displayTags = [...tags].reverse();
        let namesToShow = displayTags[0];
        const joiner = ', ';
        let joinedNames = 1;
        const remainingTags = displayTags.slice(1);

        displayTags.slice(1).forEach(tag => {
          if (namesToShow.length + tag.length + joiner.length <= maxNamesChars) {
            namesToShow += joiner + tag;
            joinedNames++;
          }
        });

        return (
          <Typography style={{ overflowWrap: 'anywhere' }} ml={1}>
            {namesToShow.length > maxNamesChars
              ? namesToShow.slice(0, maxNamesChars) + '…'
              : namesToShow}
            {displayTags.length > joinedNames && (
              <>
                <span>,&nbsp;</span>
                <Tooltip
                  title={
                    <ul style={{ margin: 0, padding: 10, listStyle: 'none' }}>
                      {remainingTags.map((tag, key) => (
                        <li key={key}>{tag}</li>
                      ))}
                    </ul>
                  }
                  arrow
                  placement="top"
                >
                  <b style={{ cursor: 'pointer' }}>{`+${displayTags.length - joinedNames}`}</b>
                </Tooltip>
              </>
            )}
          </Typography>
        );
      }}
      renderInput={params => (
        <Box width="24rem">
          <TextField
            {...params}
            variant="outlined"
            size="small"
            label={t('translation|Applications')}
            fullWidth
            InputLabelProps={{ shrink: true }}
            style={{ marginTop: 0 }}
            placeholder={selectedApplications.length > 0 ? '' : t('translation|Filter')}
          />
        </Box>
      )}
    />
  );
}

/** Precomputed per-application numbers + health, derived once per data batch. */
interface AppSummary {
  count: number;
  health: AppHealth;
  /** Workload KubeObjects by "kind/namespace/name", for links in the popover. */
  workloadObjects: Map<string, KubeObject>;
}

/**
 * The three-dot pulse used by Headlamp's splash screen, as an inline loading
 * indicator: quiet, familiar and lighter than skeleton bars.
 */
function LoadingDots({ size = 6 }: { size?: number }) {
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
 * A table row: an application plus its (progressively arriving) summary. The
 * summary is carried IN the row data — not read from a closure — so that when
 * more resources arrive the row object changes identity and the table
 * recomputes the Resources/Health cells. Reading it from a closure kept the
 * memoized cells frozen on their first (skeleton) value until an unrelated
 * remount, which is what made the columns look stuck.
 */
interface AppRow extends ApplicationDefinition {
  summary?: AppSummary;
  resourcesLoading: boolean;
}

/** How each application-health verdict reads: color, icon and tone. */
const HEALTH_PRESENTATION: Record<AppHealthStatus, { icon: string; color: (t: Theme) => string }> =
  {
    healthy: { icon: 'mdi:check-circle', color: t => t.palette.success.main },
    progressing: { icon: 'mdi:progress-clock', color: t => t.palette.info.main },
    degraded: { icon: 'mdi:alert', color: t => t.palette.warning.main },
    unhealthy: { icon: 'mdi:alert-circle', color: t => t.palette.error.main },
    idle: { icon: 'mdi:pause-circle-outline', color: t => t.palette.text.secondary },
    noWorkloads: { icon: 'mdi:cube-outline', color: t => t.palette.text.secondary },
    empty: { icon: 'mdi:help-circle-outline', color: t => t.palette.text.disabled },
  };

/** Per-workload state colors, for the little status dots in the popover. */
const WORKLOAD_STATE_COLOR: Record<WorkloadState, (t: Theme) => string> = {
  ready: t => t.palette.success.main,
  progressing: t => t.palette.info.main,
  degraded: t => t.palette.warning.main,
  down: t => t.palette.error.main,
  scaledZero: t => t.palette.text.disabled,
};

/**
 * One workload's row in the health popover. When the live KubeObject is known
 * the name is a link straight to that resource's details page (the browser's
 * Back button returns here), so "Job failed" is one click from the Job itself.
 */
function WorkloadRow({ w, kubeObject }: { w: WorkloadHealth; kubeObject?: KubeObject }) {
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
 * The Health cell: a color-coded chip that, on click, opens a popover
 * explaining *why* the application is Healthy / Degraded / Unhealthy / etc.,
 * from the real workload readiness — so an operator gets the reasoning, not
 * just a colored word.
 */
function HealthCell({
  health,
  loading,
  workloadObjects,
}: {
  health?: AppHealth;
  loading: boolean;
  workloadObjects?: Map<string, KubeObject>;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['translation']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (!health && loading) {
    return <LoadingDots />;
  }
  if (!health) {
    return null;
  }

  const p = HEALTH_PRESENTATION[health.status];
  const color = p.color(theme);
  const problems = health.workloads.filter(w => w.state !== 'ready' && w.state !== 'scaledZero');

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
          <Icon icon={p.icon} width={16} height={16} />
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
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {t('translation|{{ ready }}/{{ total }} workloads ready', {
                ready: health.readyWorkloads,
                total: health.totalWorkloads,
              })}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              {(problems.length > 0 ? problems : health.workloads).slice(0, 8).map(w => (
                <WorkloadRow
                  key={`${w.kind}/${w.namespace}/${w.name}`}
                  w={w}
                  kubeObject={workloadObjects?.get(`${w.kind}/${w.namespace}/${w.name}`)}
                />
              ))}
            </Box>
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
      </Popover>
    </>
  );
}

export default function ApplicationList() {
  const { t } = useTranslation(['translation', 'glossary']);
  const { applications, errors, isLoading } = useApplicationDefinitions();
  const [selectedApplications, setSelectedApplications] = useState<string[]>([]);

  // One shared fetch for the whole table (one request per resource kind per
  // cluster, live-watched) instead of a fetch per row: rows read their counts
  // from this map, so the column fills in as fast as the lists arrive and
  // matches exactly what the application details page shows.
  const {
    items: allResources,
    errors: resourceErrors,
    isLoading: resourcesLoading,
  } = useAllApplicationResources();

  // Roll the resources up into one summary per application, once per data
  // batch: the resource count and a workload-based health verdict (see
  // applicationHealth). Cells then render from this instead of recomputing on
  // every render.
  const summaries = useMemo(() => {
    const byApp = groupResourcesByApplication(allResources);
    const out = new Map<string, AppSummary>();
    for (const [appId, items] of byApp) {
      const health = evaluateApplicationHealth(items.map(i => i.jsonData));
      // Keep the live KubeObjects of the evaluated workloads so the popover
      // can link each one straight to its details page.
      const workloadObjects = new Map<string, KubeObject>();
      for (const item of items) {
        const key = `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`;
        if (health.workloads.some(w => `${w.kind}/${w.namespace}/${w.name}` === key)) {
          workloadObjects.set(key, item);
        }
      }
      out.set(appId, { count: items.length, health, workloadObjects });
    }
    return out;
  }, [allResources]);

  const applicationNames = useMemo(() => applications.map(app => app.id), [applications]);

  // Carry the summary in the row data (see AppRow) so the table recomputes
  // cells as resources arrive.
  const tableData = useMemo<AppRow[]>(
    () => applications.map(app => ({ ...app, summary: summaries.get(app.id), resourcesLoading })),
    [applications, summaries, resourcesLoading]
  );

  // No selection means show every application (all namespaces).
  const filterFunction = useCallback(
    (app: AppRow) => selectedApplications.length === 0 || selectedApplications.includes(app.id),
    [selectedApplications]
  );

  const columns = useMemo<TableColumn<AppRow>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        // Size to the content: the name column no longer hoards flexible
        // space (the Clusters column absorbs the leftover width instead).
        gridTemplate: 'minmax(min-content, max-content)',
        accessorFn: app => app.id,
        // Single line: the cluster spread has its own column, and anything
        // that changes as clusters connect must not live in this cell (its
        // accessor value is the stable id, so it would not re-render).
        Cell: ({ row: { original } }) => (
          <Link routeName="applicationDetails" params={{ name: original.id }}>
            {original.id}
          </Link>
        ),
      },
      {
        id: 'resources',
        header: t('translation|Resources'),
        gridTemplate: 'min-content',
        // -1 while this app has no resources yet and lists are still arriving;
        // the value carried by the row (see AppRow) changes as data lands, so
        // the memoized cell re-renders and the count is never stuck.
        accessorFn: app => app.summary?.count ?? (app.resourcesLoading ? -1 : 0),
        Cell: ({ cell }) => {
          const value = cell.getValue<number>();
          if (value === -1) {
            return <LoadingDots />;
          }
          return value;
        },
      },
      {
        id: 'health',
        header: t('translation|Health'),
        gridTemplate: 'min-content',
        // A sortable rank (problems first) that also drives cell re-renders as
        // health changes; -1 while loading.
        accessorFn: app => healthSortRank(app.summary?.health, app.resourcesLoading),
        Cell: ({ row: { original } }) => (
          <HealthCell
            health={original.summary?.health}
            loading={original.resourcesLoading}
            workloadObjects={original.summary?.workloadObjects}
          />
        ),
      },
      {
        id: 'clusters',
        header: t('glossary|Clusters'),
        // The flexible column: it absorbs whatever width the content-sized
        // columns leave over, so no column hoards empty space.
        gridTemplate: 1,
        accessorFn: app => app.clusters.join(', '),
        Cell: ({ row: { original } }) => (
          // Each cluster redirects to that cluster's own overview page, the
          // same navigation as clicking a cluster on the Home tab.
          <Box sx={{ overflowWrap: 'anywhere' }}>
            {original.clusters.map((cluster, index) => (
              <React.Fragment key={cluster}>
                <Link routeName="cluster" params={{ cluster }}>
                  {cluster}
                </Link>
                {index < original.clusters.length - 1 && ', '}
              </React.Fragment>
            ))}
          </Box>
        ),
      },
      {
        id: 'version',
        header: t('translation|Version'),
        gridTemplate: 'min-content',
        accessorFn: app => app.version,
        Cell: ({ row: { original } }) => <MetadataValue value={original.version} />,
      },
      {
        id: 'deploymentType',
        header: t('translation|Deployment Type'),
        gridTemplate: 'min-content',
        accessorFn: app => app.deploymentType,
        Cell: ({ row: { original } }) => <MetadataValue value={original.deploymentType} />,
      },
    ],
    [t]
  );

  if (!isLoading && applications.length === 0 && errors.length === 0) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="400px"
        textAlign="center"
      >
        <Icon icon="mdi:grid-large" style={{ fontSize: 64, color: '#ccc', marginBottom: 16 }} />
        <Typography variant="h6" gutterBottom>
          {t('translation|No applications found')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t(
            'translation|Applications are discovered from the business namespaces of your clusters'
          )}
        </Typography>
        {/* Applications are discovered from namespaces, so there is nothing to
            create by hand here. Create-project button kept (disabled) from the
            Projects page this tab is based on:
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={handleCreateProject}
        >
          {t('Create Project')}
        </Button> */}
      </Box>
    );
  }

  return (
    <>
      <Box display="flex" justifyContent="flex-end" alignItems="center" gap={2} mb={2} mt={2}>
        {/* Create-project button kept (disabled) from the Projects page this
            tab is based on. Applications are discovered from namespaces, so
            there is nothing to create by hand here:
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={handleCreateProject}
        >
          {t('Create Project')}
        </Button> */}
        <ApplicationsAutocomplete
          applicationNames={applicationNames}
          selectedApplications={selectedApplications}
          onChange={setSelectedApplications}
        />
      </Box>

      <ClusterGroupErrorMessage errors={[...errors, ...resourceErrors]} />

      {isLoading ? (
        // While the application list itself is loading, show the same quiet
        // three-dot pulse as Headlamp's splash on a soft neutral surface,
        // instead of a spinner — calmer and consistent with the app's opening.
        <Box
          sx={theme => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            minHeight: 260,
            borderRadius: '10px',
            backgroundColor: theme.palette.background.muted,
          })}
        >
          <LoadingDots size={10} />
          <Typography variant="body2" color="text.secondary">
            {t('translation|Discovering applications…')}
          </Typography>
        </Box>
      ) : (
        <Table
          columns={columns}
          data={tableData}
          loading={false}
          filterFunction={filterFunction}
          emptyMessage={t('translation|No applications found')}
          // Stable per-application id. The row objects change as resources
          // arrive (see AppRow), which is what makes the table recompute the
          // Resources/Health cells; the id keeps sorting and selection stable.
          getRowId={row => row.id}
          initialState={{
            sorting: [{ id: 'name', desc: false }],
          }}
        />
      )}
    </>
  );
}
