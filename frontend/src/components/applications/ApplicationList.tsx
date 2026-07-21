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
  Autocomplete,
  Box,
  Checkbox,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KubeObject } from '../../lib/k8s/KubeObject';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import Link from '../common/Link';
import Table, { TableColumn } from '../common/Table/Table';
import { AppHealth, evaluateApplicationHealth, healthSortRank } from './applicationHealth';
import { ApplicationHealthChip, buildWorkloadObjectsMap } from './ApplicationHealthChip';
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

/**
 * A single, professional full-page loading state for the whole table: a header
 * band plus shimmer rows, shown while application definitions and their
 * resources load. This replaces per-cell placeholders — every cell (name,
 * clusters, resource count, health) appears at once, fully populated, instead
 * of the Resources/Health columns visibly filling in after the rest.
 */
function ApplicationsTableSkeleton({ rows = 8 }: { rows?: number }) {
  const { t } = useTranslation(['translation']);
  return (
    <Box aria-busy="true" aria-label={t('translation|Loading applications')}>
      <Box
        sx={theme => ({
          border: '1px solid',
          borderColor: theme.palette.tables.head.borderColor,
          borderRadius: '10px',
          overflow: 'hidden',
        })}
      >
        <Box
          sx={theme => ({
            display: 'flex',
            gap: 3,
            px: 2,
            py: 1.25,
            backgroundColor: theme.palette.background.muted,
            borderBottom: '1px solid',
            borderColor: theme.palette.divider,
          })}
        >
          {['30%', '10%', '12%', '28%'].map((w, i) => (
            <Skeleton key={i} variant="text" width={w} height={20} />
          ))}
        </Box>
        {Array.from({ length: rows }).map((_, r) => (
          <Box
            key={r}
            sx={theme => ({
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              px: 2,
              py: 1.5,
              borderBottom: r < rows - 1 ? '1px solid' : 'none',
              borderColor: theme.palette.divider,
            })}
          >
            <Skeleton variant="text" width="30%" height={18} />
            <Skeleton variant="text" width="6%" height={18} />
            <Skeleton variant="rounded" width={110} height={24} />
            <Skeleton variant="text" width="26%" height={18} />
          </Box>
        ))}
      </Box>
    </Box>
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
      const workloadObjects = buildWorkloadObjectsMap(items, health);
      out.set(appId, { count: items.length, health, workloadObjects });
    }
    return out;
  }, [allResources]);

  const applicationNames = useMemo(() => applications.map(app => app.id), [applications]);

  // Carry the summary in the row data (see AppRow) so the table recomputes
  // cells as resources arrive. Once loading is done, an application with no
  // resources gets an explicit "No resources" summary so its Health cell is
  // never blank.
  const tableData = useMemo<AppRow[]>(
    () =>
      applications.map(app => {
        let summary = summaries.get(app.id);
        if (!summary && !resourcesLoading) {
          summary = {
            count: 0,
            health: evaluateApplicationHealth([]),
            workloadObjects: new Map(),
          };
        }
        return { ...app, summary, resourcesLoading };
      }),
    [applications, summaries, resourcesLoading]
  );

  // Reveal the fully-populated table only once the data it shows is ready, so
  // the Resources/Health columns never visibly fill in after the rest. A
  // safety timeout reveals whatever has arrived if one cluster keeps a list
  // pending, so a single slow cluster can never block the whole table forever.
  const dataReady = !isLoading && !resourcesLoading;
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (revealed) {
      return;
    }
    if (dataReady) {
      setRevealed(true);
      return;
    }
    const id = setTimeout(() => setRevealed(true), 10000);
    return () => clearTimeout(id);
  }, [dataReady, revealed]);

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
            return <Skeleton variant="rounded" width={32} height={18} />;
          }
          return value;
        },
      },
      {
        id: 'health',
        header: t('translation|Health'),
        gridTemplate: 'min-content',
        // Chips are colored blocks of varying width; centering them under the
        // centered header reads as one tidy rail instead of a ragged left edge.
        muiTableHeadCellProps: {
          align: 'center',
        },
        muiTableBodyCellProps: {
          sx: { justifyContent: 'center' },
        },
        // The verdict text, so the column filter matches what the user reads
        // in the cell; severity ordering is preserved by the sortingFn below.
        accessorFn: app => app.summary?.health.label ?? '',
        filterVariant: 'select',
        sortingFn: (rowA, rowB) =>
          healthSortRank(rowA.original.summary?.health, rowA.original.resourcesLoading) -
          healthSortRank(rowB.original.summary?.health, rowB.original.resourcesLoading),
        Cell: ({ row: { original } }) => (
          <ApplicationHealthChip
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

      {!revealed ? (
        // One professional full-page loading state (header + shimmer rows) for
        // the whole table, instead of letting the Resources/Health cells fill
        // in individually after the name/cluster columns.
        <ApplicationsTableSkeleton />
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
            // Default to health severity (worst first) so Critical/Unhealthy
            // applications are at the top, then Degraded/Progressing, then
            // Healthy — an operator sees what needs attention without sorting.
            sorting: [{ id: 'health', desc: false }],
          }}
        />
      )}
    </>
  );
}
