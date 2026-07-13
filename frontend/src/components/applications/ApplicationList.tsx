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
import { useProjectItems } from '../project/useProjectResources';
import { ApplicationDefinition, NOT_AVAILABLE } from './applicationUtils';
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

  const onInputChange = (event: object, value: string, reason: string) => {
    // The AutoComplete component resets the text after a short delay, so we
    // need to avoid that or the user won't be able to edit/use what they type.
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
      onChange={(event, newValue) => {
        // Reset the input so it won't show next to the selected applications.
        setInput('');
        onChange(newValue);
      }}
      onInputChange={onInputChange}
      inputValue={input}
      // We reverse the selection so the last chosen appears as the first in
      // the label. This is useful since the label is ellipsized and this way
      // we get to see it change.
      value={[...selectedApplications].reverse()}
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

        let namesToShow = tags[0];
        const joiner = ', ';
        let joinedNames = 1;
        const remainingTags = tags.slice(1);

        tags.slice(1).forEach(tag => {
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
            {tags.length > joinedNames && (
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
                  <b style={{ cursor: 'pointer' }}>{`+${tags.length - joinedNames}`}</b>
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

export default function ApplicationList() {
  const { t } = useTranslation(['translation', 'glossary']);
  const { applications, errors, isLoading } = useApplicationDefinitions();
  const [selectedApplications, setSelectedApplications] = useState<string[]>([]);

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
          <Link routeName="applicationDetails" params={{ name: original.id }}>
            {original.id}
          </Link>
        ),
      },
      {
        id: 'resources',
        header: t('translation|Resources'),
        gridTemplate: 'min-content',
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          return items.length;
        },
      },
      {
        id: 'health',
        header: t('translation|Health'),
        gridTemplate: 'min-content',
        Cell: ({ row: { original } }) => {
          const { items } = useProjectItems(original, { disableWatch: true });
          const health = getResourcesHealth(items);
          return (
            <StatusLabel
              status={health.error > 0 ? 'error' : health.warning > 0 ? 'warning' : 'success'}
            >
              <Icon
                icon={getHealthIcon(health.success, health.error, health.warning)}
                style={{
                  fontSize: 24,
                }}
              />
              {items.length === 0
                ? t('translation|No Resources')
                : health.error > 0
                ? t('translation|Unhealthy')
                : health.warning > 0
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

      <ClusterGroupErrorMessage errors={errors} />

      <Table
        columns={columns}
        data={applications}
        loading={isLoading}
        filterFunction={filterFunction}
        emptyMessage={t('translation|No applications found')}
        initialState={{
          sorting: [{ id: 'name', desc: false }],
        }}
      />
    </>
  );
}
