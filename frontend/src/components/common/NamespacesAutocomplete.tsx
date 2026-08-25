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
import { Tooltip } from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import { useTheme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { isEqual, uniq } from 'lodash';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import { getCombinedAllowedNamespaces } from '../../helpers/clusterSettings';
import { useCluster, useClustersConf } from '../../lib/k8s';
import Namespace from '../../lib/k8s/namespace';
import { setNamespaceFilter } from '../../redux/filterSlice';
import { useTypedSelector } from '../../redux/hooks';

/**
 * addQuery will add a query parameter to the URL using history API.
 *
 * It will also remove the parameter if the value is the same as the default value.
 * If the tableName is provided, it will be added to the query string.
 * @param queryObj The query object to add to the URL.
 * @param queryParamDefaultObj The default query object to compare with.
 * @param history The history object from react-router.
 * @param location The location object from react-router.
 * @param tableName The table name to add to the query string.
 * @returns void
 */
function addQuery(
  queryObj: { [key: string]: string },
  queryParamDefaultObj: { [key: string]: string } = {},
  history: any,
  location: any,
  tableName = ''
) {
  const pathname = location.pathname;
  const searchParams = new URLSearchParams(location.search);

  if (!!tableName) {
    searchParams.set('tableName', tableName);
  }
  // Ensure that default values will not show up in the URL
  for (const key in queryObj) {
    const value = queryObj[key];
    if (value !== queryParamDefaultObj[key]) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
  }

  history.push({
    pathname: pathname,
    search: searchParams.toString(),
  });
}

export interface PureNamespacesAutocompleteProps {
  namespaceNames: string[];
  onChange: (event: React.ChangeEvent<{}>, newValue: string[]) => void;
  filter: { namespaces: Set<string> };
  /**
   * Called when the dropdown closes (click away, Escape, or selecting an
   * option while `disableCloseOnSelect` is off). Used by callers that need to
   * sync the final selection elsewhere (e.g. the URL) without doing so on
   * every intermediate pick, since navigating mid-selection can close the
   * still-open dropdown.
   */
  onClose?: () => void;
  /**
   * Width of the input box. The dropdown matches this width. Defaults to
   * '30rem' so even long namespace names stay on a single line across the
   * whole tool (e.g. openshift-kube-storage-version-migrator-operator).
   */
  inputWidth?: string;
  /**
   * Max characters of the selected-namespaces summary shown in the input before
   * it is truncated with an ellipsis. Defaults to 40 to suit the wider input.
   */
  maxSummaryChars?: number;
}

export function PureNamespacesAutocomplete({
  namespaceNames,
  onChange: onChangeFromProps,
  filter,
  onClose: onCloseFromProps,
  inputWidth = '30rem',
  maxSummaryChars = 40,
}: PureNamespacesAutocompleteProps) {
  const theme = useTheme();
  const { t } = useTranslation(['glossary', 'translation']);
  const [namespaceInput, setNamespaceInput] = React.useState<string>('');
  // Kept separate from namespaceInput: this is what narrows the option list.
  // Unlike namespaceInput (the visible textbox text, cleared after each pick
  // so it shows the selected-namespaces summary), the search term survives
  // picks so the list stays filtered and multiple matches (e.g. all "bgw"
  // namespaces) can be picked one after another without retyping.
  const [searchTerm, setSearchTerm] = React.useState<string>('');
  const maxNamespacesChars = maxSummaryChars;

  const onInputChange = (event: object, value: string, reason: string) => {
    // For some reason, the AutoComplete component resets the text after a short
    // delay, so we need to avoid that or the user won't be able to edit/use what they type.
    if (reason !== 'reset') {
      setNamespaceInput(value);
      setSearchTerm(value);
    }
  };

  const onChange = (event: React.ChangeEvent<{}>, newValue: string[]) => {
    // Clear only the visible textbox text so it immediately shows the
    // selected namespaces (their summary) instead of the text that was typed
    // to find them. The search term is left alone so the option list stays
    // filtered, letting the user pick more matches without retyping.
    setNamespaceInput('');
    onChangeFromProps(event, newValue);
  };

  const onClose = () => {
    setNamespaceInput('');
    setSearchTerm('');
    onCloseFromProps?.();
  };

  const filterOptions = (options: string[]) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter(option => option.toLowerCase().includes(term));
  };

  return (
    <Autocomplete
      multiple
      id="namespaces-filter"
      autoComplete
      openOnFocus
      disableCloseOnSelect
      options={namespaceNames}
      filterOptions={filterOptions}
      onChange={onChange}
      onClose={onClose}
      onInputChange={onInputChange}
      inputValue={namespaceInput}
      // We reverse the namespaces so the last chosen appear as the first in the label. This
      // is useful since the label is ellipsized and this we get to see it change.
      value={[...filter.namespaces.values()].reverse()}
      renderOption={(props, option, { selected }) => (
        <li {...props} key={props.key}>
          <Checkbox
            icon={<Icon icon="mdi:checkbox-blank-outline" />}
            checkedIcon={<Icon icon="mdi:check-box-outline" />}
            style={{
              color: selected ? theme.palette.primary.main : theme.palette.text.primary,
              // Purely a visual indicator: clicks pass through to the li so
              // the checkbox (a focusable native input) never steals focus.
              // Focusing it directly was read as a blur by the Autocomplete,
              // closing the still-open dropdown after a single pick.
              pointerEvents: 'none',
            }}
            checked={selected}
            tabIndex={-1}
          />
          {option}
        </li>
      )}
      renderTags={(tags: string[]) => {
        // Only while the user is actively typing a filter do we hide the
        // summary and show just the typed text (avoids "selected, +N  typed"
        // clutter). When not typing — including when picking via the
        // checkboxes — the summary of selected namespaces is shown in the input.
        if (namespaceInput !== '') {
          return null;
        }
        if (tags.length === 0) {
          return <Typography variant="body2">{t('translation|All namespaces')}</Typography>;
        }

        let namespacesToShow = tags[0];
        const joiner = ', ';
        const joinerLength = joiner.length;
        let joinnedNamespaces = 1;
        const remainingTags = tags.slice(1);

        tags.slice(1).forEach(tag => {
          if (namespacesToShow.length + tag.length + joinerLength <= maxNamespacesChars) {
            namespacesToShow += joiner + tag;
            joinnedNamespaces++;
          }
        });

        return (
          <Typography variant="body2" style={{ overflowWrap: 'anywhere' }}>
            {namespacesToShow.length > maxNamespacesChars
              ? namespacesToShow.slice(0, maxNamespacesChars) + '…'
              : namespacesToShow}
            {tags.length > joinnedNamespaces && (
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
                  <b style={{ cursor: 'pointer' }}>{`+${tags.length - joinnedNamespaces}`}</b>
                </Tooltip>
              </>
            )}
          </Typography>
        );
      }}
      renderInput={params => (
        <Box width={inputWidth}>
          <TextField
            {...params}
            variant="outlined"
            size="small"
            label={t('Namespaces')}
            fullWidth
            InputLabelProps={{ shrink: true }}
            style={{ marginTop: 0 }}
            placeholder={[...filter.namespaces.values()].length > 0 ? '' : t('Filter')}
          />
        </Box>
      )}
    />
  );
}

export function NamespacesAutocomplete() {
  const history = useHistory();
  const location = useLocation();
  const dispatch = useDispatch();
  const filter = useTypedSelector(state => state.filter);
  const cluster = useCluster();
  const [namespaceNames, setNamespaceNames] = React.useState<string[]>([]);

  React.useEffect(() => {
    const allowedNamespaces = getCombinedAllowedNamespaces(cluster || '');
    if (allowedNamespaces.length > 0) {
      setNamespaceNames(allowedNamespaces);
    }
  }, [cluster]);

  const onChange = (event: React.ChangeEvent<{}>, newValue: string[]) => {
    // Update redux synchronously so the table filters immediately as each
    // namespace is picked.
    dispatch(setNamespaceFilter(newValue));
  };

  // Sync the URL only when the dropdown closes (click away, Escape, or a
  // pick), not on every intermediate pick while it's still open. Pushing
  // history from inside onChange - even deferred to an effect keyed on the
  // redux filter - raced with fast consecutive picks and closed the
  // still-open dropdown before the next pick landed.
  const onClose = () => {
    addQuery(
      { namespace: [...filter.namespaces].join(' ') },
      { namespace: '' },
      history,
      location,
      ''
    );
  };

  return namespaceNames.length > 0 ? (
    <PureNamespacesAutocomplete
      namespaceNames={namespaceNames}
      onChange={onChange}
      filter={filter}
      onClose={onClose}
    />
  ) : (
    <NamespacesFromClusterAutocomplete onChange={onChange} filter={filter} onClose={onClose} />
  );
}

/**
 * This hook will try to select a namespace in a specific case
 *
 * If we failed to load namespaces it might be because the user
 * doesn't have access to list all the namespaces but still has
 * access to a specific namespace
 *
 * Sometimes in the kubeconfig there will be a default namespace set
 * which we can try to use as a fallback
 */
const useDefaultNamespaceFallback = (
  namespacesList: Namespace[] | null,
  isNamespaceError: boolean
) => {
  const selectedNamespaces = useTypedSelector(state => state.filter.namespaces);
  const allClustersConfigs = useClustersConf();
  const currentCluster = useCluster();
  const dispatch = useDispatch();

  useEffect(() => {
    if (
      currentCluster &&
      allClustersConfigs &&
      isNamespaceError &&
      (!namespacesList || namespacesList?.length === 0) &&
      selectedNamespaces.size === 0
    ) {
      const defaultNamespaceFromKubeconfig =
        allClustersConfigs[currentCluster]?.meta_data.namespace;

      if (defaultNamespaceFromKubeconfig) {
        dispatch(setNamespaceFilter([defaultNamespaceFromKubeconfig]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespacesList, isNamespaceError, currentCluster]);
};

function NamespacesFromClusterAutocomplete(
  props: Omit<PureNamespacesAutocompleteProps, 'namespaceNames'>
) {
  const [namespacesList, error] = Namespace.useList();
  const rawNamespaceNames = useMemo(
    () =>
      uniq(namespacesList?.map(namespace => namespace.metadata.name) ?? [])
        .slice()
        .sort((a, b) => a.localeCompare(b)),
    [namespacesList]
  );
  // Namespace.useList() re-emits on every watch event (including reconnects),
  // which produced a brand-new array above even when the names didn't
  // change. Passing a fresh `options` reference to the still-open Autocomplete
  // on every one of those events was closing its dropdown mid-selection.
  // Keep the same array reference when the contents are unchanged.
  const namespaceNamesRef = React.useRef<string[]>(rawNamespaceNames);
  if (!isEqual(namespaceNamesRef.current, rawNamespaceNames)) {
    namespaceNamesRef.current = rawNamespaceNames;
  }
  const namespaceNames = namespaceNamesRef.current;

  useDefaultNamespaceFallback(namespacesList, Boolean(error));

  return <PureNamespacesAutocomplete namespaceNames={namespaceNames} {...props} />;
}
