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
  Link as MuiLink,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { uniq } from 'lodash';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from '../activity/Activity';
import { ClusterGroupErrorMessage } from '../cluster/ClusterGroupErrorMessage';
import { StatusLabel } from '../common/Label';
import Table, { TableColumn } from '../common/Table/Table';
import { KubeIcon } from '../resourceMap/kubeIcon/KubeIcon';
import ApplicationDetails from './ApplicationDetails';
import { ApplicationInfo, NOT_AVAILABLE } from './applicationUtils';
import { useApplications } from './useApplications';

/** Opens the application details side panel for the given application. */
export function launchApplicationDetails(app: ApplicationInfo) {
  Activity.launch({
    id: `application-${app.cluster}-${app.namespace}`,
    title: app.name,
    location: 'split-right',
    cluster: app.cluster,
    temporary: true,
    icon: <KubeIcon kind="Namespace" width="100%" height="100%" />,
    content: (
      <ApplicationDetails appName={app.name} namespace={app.namespace} cluster={app.cluster} />
    ),
  });
}

export default function ApplicationList() {
  const { t } = useTranslation(['translation', 'glossary']);
  const theme = useTheme();
  const { applications, errors, isLoading } = useApplications();
  const [selectedApps, setSelectedApps] = useState<string[]>([]);

  const applicationNames = useMemo(
    () => uniq(applications.map(app => app.name)).sort((a, b) => a.localeCompare(b)),
    [applications]
  );

  const filterFunction = useCallback(
    (app: ApplicationInfo) => selectedApps.length === 0 || selectedApps.includes(app.name),
    [selectedApps]
  );

  const columns = useMemo<TableColumn<ApplicationInfo>[]>(
    () => [
      {
        id: 'name',
        header: t('translation|Application Name'),
        accessorFn: app => app.name,
        gridTemplate: 1.5,
        Cell: ({ row: { original } }) => (
          <MuiLink
            component="button"
            variant="body2"
            sx={{ textAlign: 'left', verticalAlign: 'baseline' }}
            onClick={() => launchApplicationDetails(original)}
          >
            {original.name}
          </MuiLink>
        ),
      },
      {
        id: 'status',
        header: t('translation|Status'),
        accessorFn: app => app.status,
        gridTemplate: 'min-content',
        Cell: ({ row: { original } }) =>
          original.status === NOT_AVAILABLE ? (
            NOT_AVAILABLE
          ) : (
            <StatusLabel status={original.status === 'Active' ? 'success' : 'error'}>
              {original.status}
            </StatusLabel>
          ),
      },
      {
        id: 'cluster',
        header: t('glossary|Cluster'),
        accessorFn: app => app.cluster,
      },
      {
        id: 'version',
        header: t('translation|Version'),
        accessorFn: app => app.version,
      },
      {
        id: 'deploymentType',
        header: t('translation|Deployment Type'),
        accessorFn: app => app.deploymentType,
      },
    ],
    [t]
  );

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'flex-start', my: 2 }}>
        <Autocomplete
          multiple
          disableCloseOnSelect
          options={applicationNames}
          value={selectedApps}
          onChange={(_event, newValue) => setSelectedApps(newValue)}
          sx={{ minWidth: 320 }}
          size="small"
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
          renderTags={(tags: string[]) =>
            tags.length === 0 ? null : (
              <Typography variant="body2" ml={1} noWrap>
                {tags.length === 1
                  ? tags[0]
                  : t('translation|{{ count }} selected', { count: tags.length })}
              </Typography>
            )
          }
          renderInput={params => (
            <TextField
              {...params}
              label={t('translation|Applications')}
              placeholder={selectedApps.length > 0 ? '' : t('translation|All applications')}
            />
          )}
        />
      </Box>

      <ClusterGroupErrorMessage errors={errors} />

      <Table
        id="headlamp-applications"
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
