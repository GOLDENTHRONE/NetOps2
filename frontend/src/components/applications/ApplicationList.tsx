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
  Skeleton,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import { StatusLabel } from '../common/Label';
import Link from '../common/Link';
import Table, { TableColumn } from '../common/Table/Table';
import { getHealthIcon, getResourcesHealth } from '../project/projectUtils';
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

/** Precomputed per-application resource numbers, derived once per data batch. */
interface AppResourcesSummary {
  count: number;
  error: number;
  warning: number;
  success: number;
}

/**
 * Sortable health rank: unhealthy first when sorting ascending, so "sort by
 * health" surfaces the problems. -1 means the data hasn't arrived yet — the
 * value changing from -1 to a real rank is also what tells the memoized table
 * cells to re-render once the resource lists arrive.
 */
function healthRank(summary: AppResourcesSummary | undefined, loading: boolean): number {
  if (!summary) {
    return loading ? -1 : 3;
  }
  if (summary.error > 0) return 0;
  if (summary.warning > 0) return 1;
  if (summary.count > 0) return 2;
  return 3; // No resources.
}

export default function ApplicationList() {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();
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

  // Roll the resources up into one small summary per application, once per
  // data batch, so table cells render from plain numbers instead of
  // recomputing health over the full resource list on every render.
  const summaries = useMemo(() => {
    const byApp = groupResourcesByApplication(allResources);
    const out = new Map<string, AppResourcesSummary>();
    for (const [appId, items] of byApp) {
      const health = getResourcesHealth(items);
      out.set(appId, {
        count: items.length,
        error: health.error ?? 0,
        warning: health.warning ?? 0,
        success: health.success ?? 0,
      });
    }
    return out;
  }, [allResources]);

  const applicationNames = useMemo(() => applications.map(app => app.id), [applications]);

  // No selection means show every application (all namespaces).
  const filterFunction = useCallback(
    (app: ApplicationDefinition) =>
      selectedApplications.length === 0 || selectedApplications.includes(app.id),
    [selectedApplications]
  );

  const columns = useMemo<TableColumn<ApplicationDefinition>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Name'),
        gridTemplate: 1.5,
        accessorFn: app => app.id,
        Cell: ({ row: { original } }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: '8px',
                flexShrink: 0,
                color: theme.palette.primary.main,
                backgroundColor: alpha(theme.palette.primary.main, 0.1),
              }}
            >
              <Icon icon="mdi:grid-large" width={16} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Link routeName="applicationDetails" params={{ name: original.id }}>
                {original.id}
              </Link>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {original.clusters.length === 1
                  ? t('translation|1 cluster')
                  : t('translation|{{ count }} clusters', { count: original.clusters.length })}
              </Typography>
            </Box>
          </Box>
        ),
      },
      {
        id: 'resources',
        header: t('translation|Resources'),
        gridTemplate: 'min-content',
        // -1 while the lists are still arriving: the value change from -1 to
        // the real count is what re-renders the memoized cell (cells only
        // re-render when their accessor value changes), so the column can
        // never get stuck on a skeleton or a misleading 0 again.
        accessorFn: app => summaries.get(app.id)?.count ?? (resourcesLoading ? -1 : 0),
        Cell: ({ cell }) => {
          const value = cell.getValue<number>();
          if (value === -1) {
            return <Skeleton variant="text" width={32} />;
          }
          return value;
        },
      },
      {
        id: 'health',
        header: t('translation|Health'),
        gridTemplate: 'min-content',
        // A sortable rank (problems first). Doubles as the re-render trigger
        // for the memoized cell, exactly like the resources column: without
        // an accessor the cell's value never changes and it stays frozen on
        // whatever it first rendered.
        accessorFn: app => healthRank(summaries.get(app.id), resourcesLoading),
        Cell: ({ row: { original } }) => {
          const summary = summaries.get(original.id);
          if (!summary && resourcesLoading) {
            return <Skeleton variant="text" width={96} />;
          }
          const error = summary?.error ?? 0;
          const warning = summary?.warning ?? 0;
          const success = summary?.success ?? 0;
          return (
            <StatusLabel status={error > 0 ? 'error' : warning > 0 ? 'warning' : 'success'}>
              <Icon
                icon={getHealthIcon(success, error, warning)}
                style={{
                  fontSize: 24,
                }}
              />
              {!summary || summary.count === 0
                ? t('translation|No Resources')
                : error > 0
                ? t('translation|Unhealthy')
                : warning > 0
                ? t('translation|Degraded')
                : t('translation|Healthy')}
            </StatusLabel>
          );
        },
      },
      {
        id: 'clusters',
        header: t('glossary|Clusters'),
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
    [t, theme, summaries, resourcesLoading]
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

      <Table
        columns={columns}
        data={applications}
        loading={isLoading}
        filterFunction={filterFunction}
        emptyMessage={t('translation|No applications found')}
        // Include the cluster set in the row identity: when an application is
        // discovered in another cluster, the row remounts and every cell
        // (including the memoized name cell with its cluster count) redraws.
        getRowId={row => `${row.id}#${row.clusters.join(',')}`}
        initialState={{
          sorting: [{ id: 'name', desc: false }],
        }}
      />
    </>
  );
}
