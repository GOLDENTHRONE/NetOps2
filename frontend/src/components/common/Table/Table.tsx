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
import Paper from '@mui/material/Paper';
import { Theme, useTheme } from '@mui/material/styles';
import MuiTable from '@mui/material/Table';
import { TableCellProps } from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import MuiTooltip from '@mui/material/Tooltip';
import { alpha, styled } from '@mui/system';
import { visuallyHidden } from '@mui/utils';
import { isEqual } from 'lodash';
import {
  MRT_BottomToolbar,
  MRT_Cell,
  MRT_ColumnDef as MaterialTableColumn,
  MRT_ColumnOrderState,
  MRT_ColumnSizingInfoState,
  MRT_ColumnSizingState,
  MRT_Header,
  MRT_Localization,
  MRT_TableBodyCell,
  MRT_TableHeadCell,
  MRT_TableInstance,
  MRT_TableOptions as MaterialTableOptions,
  MRT_TopToolbar,
  useMaterialReactTable,
  useMRT_Rows,
} from 'material-react-table';
import { MRT_Localization_AR } from 'material-react-table/locales/ar';
import { MRT_Localization_DE } from 'material-react-table/locales/de';
import { MRT_Localization_EN } from 'material-react-table/locales/en';
import { MRT_Localization_ES } from 'material-react-table/locales/es';
import { MRT_Localization_FR } from 'material-react-table/locales/fr';
import { MRT_Localization_HE } from 'material-react-table/locales/he';
import { MRT_Localization_IT } from 'material-react-table/locales/it';
import { MRT_Localization_JA } from 'material-react-table/locales/ja';
import { MRT_Localization_KO } from 'material-react-table/locales/ko';
import { MRT_Localization_PT } from 'material-react-table/locales/pt';
import { MRT_Localization_RU } from 'material-react-table/locales/ru';
import { MRT_Localization_ZH_HANS } from 'material-react-table/locales/zh-Hans';
import { MRT_Localization_ZH_HANT } from 'material-react-table/locales/zh-Hant';
import { memo, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTablesRowsPerPage, setTablesRowsPerPage } from '../../../helpers/tablesRowsPerPage';
import { loadTablePreferences, storeTablePreferences } from '../../../helpers/userPreferences';
import { useShortcut } from '../../../lib/useShortcut';
import { useURLState } from '../../../lib/util';
import { useSettings } from '../../App/Settings/hook';
import { useQueryParamsState } from '../../resourceMap/useQueryParamsState';
import Empty from '../EmptyContent';
import Loader from '../Loader';
import { reconcileColumnOrder } from './columnOrder';

/**
 * Column definition
 * We reuse the Material React Table column definition
 * Additional gridTemplate property is added because we have our own layout
 * based on the CSS grid
 *
 * @see https://www.material-react-table.com/docs/api/column-options
 */
export type TableColumn<RowItem extends Record<string, any>, Value = any> = MaterialTableColumn<
  RowItem,
  Value
> & {
  /**
   * Column width in the grid template format
   * Number values will be converted to "fr"
   * @example
   * 1
   * "1.5fr"
   * "min-content"
   */
  gridTemplate?: string | number;
};

/**
 * All the options provided by the MRT and some of our custom behaviour
 *
 * @see https://www.material-react-table.com/docs/api/table-options
 */
export type TableProps<RowItem extends Record<string, any>> = Omit<
  MaterialTableOptions<RowItem>,
  'columns'
> & {
  columns: TableColumn<RowItem>[];
  /**
   * Unique ID for this table. When provided, user layout preferences
   * (column widths and column order) are persisted to localStorage under
   * this ID (see helpers/userPreferences.ts) so the table looks the same
   * after a reload or when the window is reopened.
   */
  id?: string;
  /**
   * Message to show when the table is empty
   */
  emptyMessage?: ReactNode;
  /**
   * Error message to show instead of the table
   */
  errorMessage?: ReactNode;
  /** Whether to reflect the page/perPage properties in the URL.
   * If assigned to a string, it will be the prefix for the page/perPage parameters.
   * If true or '', it'll reflect the parameters without a prefix.
   * By default, no parameters are reflected in the URL. */
  reflectInURL?: string | boolean;
  /**
   * Initial page to show in the table
   * Important: page is 1-indexed!
   * @default 1
   */
  initialPage?: number;
  /**
   * List of options for the rows per page selector
   * @example [15, 25, 50, 100]
   */
  rowsPerPage?: number[];
  /**
   * Function to filter the rows
   * Works in addition to the default table filtering and searching
   */
  filterFunction?: (item: RowItem) => boolean;
  /**
   * Whether to show a loading spinner
   */
  loading?: boolean;
  renderRowSelectionToolbar?: (props: { table: MRT_TableInstance<RowItem> }) => ReactNode;
};

// Use a zero-indexed "useURLState" hook, so pages are shown in the URL as 1-indexed
// but internally are 0-indexed.
function usePageURLState(
  key: string,
  prefix: string,
  initialPage: number
): ReturnType<typeof useURLState> {
  const [page, setPage] = useURLState(key, { defaultValue: initialPage + 1, prefix });
  const [zeroIndexPage, setZeroIndexPage] = useState(page - 1);

  useEffect(() => {
    setZeroIndexPage((zeroIndexPage: number) => {
      if (page - 1 !== zeroIndexPage) {
        return page - 1;
      }

      return zeroIndexPage;
    });
  }, [page]);

  useEffect(() => {
    setPage(zeroIndexPage + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeroIndexPage]);

  return [zeroIndexPage, setZeroIndexPage];
}

const tableLocalizationMap: Partial<Record<string, MRT_Localization>> = {
  ar: MRT_Localization_AR,
  de: MRT_Localization_DE,
  en: MRT_Localization_EN,
  es: MRT_Localization_ES,
  fr: MRT_Localization_FR,
  he: MRT_Localization_HE,
  it: MRT_Localization_IT,
  ja: MRT_Localization_JA,
  pt: MRT_Localization_PT,
  ko: MRT_Localization_KO,
  ru: MRT_Localization_RU,
  zh: MRT_Localization_ZH_HANS,
  'zh-TW': MRT_Localization_ZH_HANT,
};

const StyledHeadRow = styled('tr')(({ theme }) => ({
  display: 'contents',
  background: theme.palette.background.muted,
}));
const StyledRow = styled('tr')(({ theme }) => ({
  display: 'contents',
  // The row itself paints no box (display: contents), so hover and selection
  // tint the row's cells instead.
  '&:hover > td': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.04)
        : alpha(theme.palette.primary.main, 0.03),
  },
  '&[data-selected=true]': {
    background: alpha(theme.palette.primary.main, 0.2),
  },
  '&[data-selected=true] > td': {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
  },
}));
const StyledBody = styled('tbody')({ display: 'contents' });

/**
 * Table component based on the Material React Table
 *
 * @see https://www.material-react-table.com/docs
 */
export default function Table<RowItem extends Record<string, any>>({
  id: tableId,
  emptyMessage,
  reflectInURL,
  initialPage = 1,
  rowsPerPage,
  filterFunction,
  errorMessage,
  loading,
  ...tableProps
}: TableProps<RowItem>) {
  const shouldReflectInURL = reflectInURL !== undefined && reflectInURL !== false;
  const prefix = reflectInURL === true ? '' : reflectInURL || '';
  const [page, setPage] = usePageURLState(shouldReflectInURL ? 'p' : '', prefix, initialPage);
  const filterKey = prefix ? `${prefix}filter` : 'filter';
  const [globalFilterState, setGlobalFilterState] = useState<string | undefined>(
    tableProps.initialState?.globalFilter
  );
  const [globalFilterQueryParam, setGlobalFilterQueryParam] = useQueryParamsState<
    string | undefined
  >(
    shouldReflectInURL ? filterKey : '',
    shouldReflectInURL ? tableProps.initialState?.globalFilter : undefined
  );

  // When `reflectInURL` is enabled, the filter needs to stay in sync with the URL
  // query parameter. Otherwise we keep the filter in plain React state only.
  const [globalFilter, setGlobalFilter] = shouldReflectInURL
    ? [globalFilterQueryParam, setGlobalFilterQueryParam]
    : [globalFilterState, setGlobalFilterState];

  const storeRowsPerPageOptions = useSettings('tableRowsPerPageOptions');
  const rowsPerPageOptions = rowsPerPage || storeRowsPerPageOptions;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultRowsPerPage = getTablesRowsPerPage(rowsPerPageOptions[0]);
  const [pageSize, setPageSize] = useURLState(shouldReflectInURL ? 'perPage' : '', {
    defaultValue: defaultRowsPerPage,
    prefix,
  });

  const { t, i18n } = useTranslation();
  const theme = useTheme();

  // State for shift+click range selection
  const [lastSelectedRowIndex, setLastSelectedRowIndex] = useState<number | null>(null);

  // Provide defaults for the columns
  const tableColumns: TableColumn<RowItem>[] = useMemo(
    () =>
      tableProps.columns.map((column, i) => ({
        ...column,
        id: column.id ?? String(i),
        header: column.header || '',
      })),
    [tableProps.columns]
  );

  const tableData = useMemo(() => {
    if (!filterFunction) return tableProps.data ?? [];
    return (tableProps.data ?? []).filter(it => filterFunction(it));
  }, [tableProps.data, filterFunction]);

  const paginationSelectProps = import.meta.env.UNDER_TEST
    ? {
        inputProps: {
          SelectDisplayProps: {
            'aria-controls': 'test-id',
          },
        },
      }
    : undefined;

  const defaultColumnOrder = useMemo(() => {
    const ids: string[] = tableProps.columns.map((it, i) => it.id ?? String(i));
    if (tableProps.enableRowActions) {
      ids.push('mrt-row-actions');
    }
    if (tableProps.enableRowSelection) {
      ids.unshift('mrt-row-select');
    }

    return ids;
  }, [tableProps.columns, tableProps.enableRowActions, tableProps.enableRowSelection]);

  // Column order is stateful so users can drag columns to rearrange them.
  // It is seeded from (and persisted to) the per-table user preferences.
  const [columnOrder, setColumnOrder] = useState<MRT_ColumnOrderState>(() =>
    reconcileColumnOrder(loadTablePreferences(tableId).columnOrder, defaultColumnOrder)
  );

  // Column widths chosen by the user by dragging the resize handles.
  // Columns without an entry keep their default (gridTemplate) width.
  const [columnSizing, setColumnSizing] = useState<MRT_ColumnSizingState>(
    () => loadTablePreferences(tableId).columnSizing ?? {}
  );

  // When the set of columns changes (e.g. a conditional column appears),
  // merge the new set into the user's arrangement instead of discarding it.
  useEffect(() => {
    setColumnOrder(currentOrder => {
      const reconciled = reconcileColumnOrder(currentOrder, defaultColumnOrder);
      return isEqual(reconciled, currentOrder) ? currentOrder : reconciled;
    });
  }, [defaultColumnOrder]);

  // Keep the latest sizing in a ref so we can persist the final value once a
  // resize gesture ends without re-creating callbacks on every mouse move.
  const columnSizingRef = useRef(columnSizing);
  columnSizingRef.current = columnSizing;
  const columnOrderRef = useRef(columnOrder);
  columnOrderRef.current = columnOrder;

  // The resize gesture state (start offset, delta, which column is being
  // resized). Owned here instead of inside MRT so we can detect the start and
  // end of a gesture. The ref mirror is updated synchronously because
  // TanStack emits two consecutive updates on mouse-up.
  const [columnSizingInfo, setColumnSizingInfo] = useState<MRT_ColumnSizingInfoState>({
    startOffset: null,
    startSize: null,
    deltaOffset: null,
    deltaPercentage: null,
    isResizingColumn: false,
    columnSizingStart: [],
  });
  const columnSizingInfoRef = useRef(columnSizingInfo);

  // Details about the column currently being resized: TanStack computes new
  // widths from the column's abstract size (default 180px) rather than the
  // rendered width of our CSS grid track, so when a not-yet-resized column's
  // gesture starts we measure its real width and shift the reported sizes by
  // the difference, making resizing start exactly from the current visual
  // width instead of jumping.
  const resizeAdjustRef = useRef<{ columnId: string; startSize: number; measured: number } | null>(
    null
  );
  const tableRef = useRef<MRT_TableInstance<RowItem> | null>(null);

  const table = useMaterialReactTable({
    ...tableProps,
    columns: tableColumns ?? [],
    data: tableData,
    enablePagination: tableData.length > rowsPerPageOptions[0],
    enableDensityToggle: tableProps.enableDensityToggle ?? false,
    enableFullScreenToggle: tableProps.enableFullScreenToggle ?? false,
    enableColumnActions: false,
    enableColumnResizing: tableProps.enableColumnResizing ?? true,
    columnResizeMode: 'onChange',
    enableColumnOrdering: tableProps.enableColumnOrdering ?? true,
    displayColumnDefOptions: {
      'mrt-row-select': {
        enableResizing: false,
        enableColumnOrdering: false,
        enableColumnDragging: false,
      },
      'mrt-row-actions': {
        enableResizing: false,
        enableColumnOrdering: false,
        enableColumnDragging: false,
      },
      ...tableProps.displayColumnDefOptions,
    },
    onColumnOrderChange: updater => {
      const next = typeof updater === 'function' ? updater(columnOrderRef.current) : updater;
      columnOrderRef.current = next;
      setColumnOrder(next);
      if (tableId) {
        storeTablePreferences(tableId, { columnOrder: next });
      }
    },
    onColumnSizingChange: updater => {
      let next = typeof updater === 'function' ? updater(columnSizingRef.current) : updater;
      const resizingColumnId = columnSizingInfoRef.current.isResizingColumn;
      const adjust = resizeAdjustRef.current;
      if (
        resizingColumnId &&
        adjust?.columnId === resizingColumnId &&
        typeof next[resizingColumnId] === 'number'
      ) {
        next = {
          ...next,
          [resizingColumnId]: Math.max(
            40,
            Math.round(next[resizingColumnId] - adjust.startSize + adjust.measured)
          ),
        };
      }
      columnSizingRef.current = next;
      setColumnSizing(next);
      if (tableId && !resizingColumnId) {
        // Not mid-gesture (e.g. a double-click width reset): persist now.
        // Mid-gesture values are persisted once when the gesture ends.
        storeTablePreferences(tableId, { columnSizing: next });
      }
    },
    onColumnSizingInfoChange: updater => {
      const old = columnSizingInfoRef.current;
      const next = typeof updater === 'function' ? updater(old) : updater;
      if (next.isResizingColumn && next.isResizingColumn !== old.isResizingColumn) {
        // A resize gesture started: if the column has no explicit width yet,
        // measure its rendered width so the resize continues from it.
        const columnId = next.isResizingColumn;
        const headCell = tableRef.current?.refs?.tableHeadCellRefs?.current?.[columnId];
        const measured = headCell?.getBoundingClientRect?.().width;
        resizeAdjustRef.current =
          measured && columnSizingRef.current[columnId] === undefined
            ? { columnId, startSize: next.startSize ?? 0, measured }
            : null;
      } else if (!next.isResizingColumn && old.isResizingColumn) {
        // Gesture ended: persist the final widths.
        resizeAdjustRef.current = null;
        if (tableId) {
          storeTablePreferences(tableId, { columnSizing: columnSizingRef.current });
        }
      }
      columnSizingInfoRef.current = next;
      setColumnSizingInfo(next);
    },
    localization: {
      ...tableLocalizationMap[i18n.language],
      // The column grab handle's label; MRT's default reads just "Move".
      move: t('Drag column'),
    },
    // MRT wraps the grab handle in its own Tooltip hardcoded to a 1s
    // enterDelay, which made this one tooltip feel broken next to every other
    // (instant) tooltip. An empty title disables that slow Tooltip (MUI skips
    // empty titles) — the fast replacement lives on the DragHandleIcon below —
    // while the explicit aria-label keeps the button named for screen readers.
    muiColumnDragHandleProps: {
      title: '',
      'aria-label': t('Drag column'),
    },
    autoResetAll: false,
    icons: {
      ...tableProps.icons,
      MoreHorizIcon: () => <Icon icon="mdi:more-vert" />,
      // The column reorder grip: a dotted grip (⠿) instead of the default
      // horizontal-lines handle, matching the modern-table reference. It is
      // revealed on header hover via CSS (see the table sx below). The
      // Tooltip here replaces MRT's own slow one (see
      // muiColumnDragHandleProps above) so it appears as fast as the rest.
      DragHandleIcon: () => (
        <MuiTooltip title={t('Drag column')} placement="top" disableInteractive>
          {/* span carries the ref/hover props MUI Tooltip needs (the iconify
              Icon does not forward refs); padding+negative margin stretch its
              hover area over the whole grab-handle button. */}
          <span style={{ display: 'inline-flex', padding: 6, margin: -6 }}>
            <Icon icon="mdi:drag-vertical" width="1.1rem" height="1.1rem" />
          </span>
        </MuiTooltip>
      ),
    },
    onPaginationChange: (updater: any) => {
      if (!tableProps.data?.length) return;
      const pagination = updater({ pageIndex: Number(page) - 1, pageSize: Number(pageSize) });
      setPage(pagination.pageIndex + 1);
      setPageSize(pagination.pageSize);
      if (pagination.pageSize !== Number(pageSize)) {
        setTablesRowsPerPage(pagination.pageSize);
      }
    },
    onGlobalFilterChange: setGlobalFilter,
    renderToolbarInternalActions: props => {
      const isSomeRowsSelected =
        tableProps.enableRowSelection && props.table.getSelectedRowModel().rows.length !== 0;
      if (isSomeRowsSelected) {
        const renderRowSelectionToolbar = tableProps.renderRowSelectionToolbar;
        if (renderRowSelectionToolbar !== undefined) {
          return renderRowSelectionToolbar(props);
        }
      }
      return null;
    },
    initialState: useMemo(
      () => ({
        density: 'compact',
        globalFilter: globalFilter || '',
        ...(tableProps.initialState ?? {}),
      }),
      [tableProps.initialState, globalFilter]
    ),
    state: useMemo(
      () => ({
        ...(tableProps.state ?? {}),
        columnOrder,
        columnSizing,
        columnSizingInfo,
        pagination: {
          pageIndex: page - 1,
          pageSize: pageSize,
        },
        globalFilter,
        ...(globalFilter ? { showGlobalFilter: true } : {}),
      }),
      [tableProps.state, columnOrder, columnSizing, columnSizingInfo, page, pageSize, globalFilter]
    ),
    positionActionsColumn: 'last',
    layoutMode: 'grid',
    // Need to provide our own empty message
    // because default one breaks with our custom layout
    renderEmptyRowsFallback: () => (
      <Box height={60}>
        <Box position="absolute" left={0} right={0} textAlign="center">
          <Empty>{t('No results found')}</Empty>
        </Box>
      </Box>
    ),
    muiSearchTextFieldProps: {
      id: 'table-search-field',
    },
    muiPaginationProps: {
      rowsPerPageOptions: rowsPerPageOptions,
      showFirstButton: false,
      showLastButton: false,
      SelectProps: paginationSelectProps,
    },
    muiTableBodyCellProps: {
      sx: {
        // By default in compact mode text doesn't wrap
        // so we need to override that
        whiteSpace: 'normal',
        width: 'unset',
        minWidth: 'unset',
      },
    },
    muiTopToolbarProps: {
      sx: {
        height: '3.5rem',
        backgroundColor: undefined,
      },
    },
    muiBottomToolbarProps: {
      sx: {
        backgroundColor: undefined,
        boxShadow: undefined,
      },
    },
    muiTableHeadCellProps: {
      sx: {
        width: 'unset',
        minWidth: 'unset',
        '.MuiTableSortLabel-icon': {
          margin: 0,
          width: '14px',
          height: '14px',
          marginTop: '-2px',
        },
        ',MuiTableSortLabel-root': {
          width: 'auto',
        },
      },
    },
    muiSelectCheckboxProps: {
      size: 'small',
      sx: { padding: 0 },
    },
    muiSelectAllCheckboxProps: {
      size: 'small',
      sx: { padding: 0 },
    },
  });

  tableRef.current = table;

  useShortcut(
    'TABLE_COLUMN_FILTERS',
    event => {
      event.stopPropagation();
      table.setShowColumnFilters(!table.getState().showColumnFilters);
    },
    {},
    [table]
  );

  // Hide actions column when others are hidden
  useEffect(() => {
    const visibility = table.getState().columnVisibility || {};

    const shouldHideActions = tableColumns
      .filter(col => (col.id ?? '') !== 'actions')
      .every(col => visibility[col.id ?? ''] === false);

    if (shouldHideActions && visibility['actions'] !== false) {
      table.setColumnVisibility(prev => ({ ...prev, actions: false }));
    } else if (!shouldHideActions && visibility['actions'] === false) {
      table.setColumnVisibility(prev => ({ ...prev, actions: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getState().columnVisibility, tableColumns, table]);

  // Derive the CSS grid tracks from the visible leaf columns so that the
  // tracks always follow the user's column order and visibility. Columns the
  // user resized get a fixed pixel track; the rest keep their gridTemplate
  // default and flex to fill the remaining space.
  const gridTemplateColumns = useMemo(() => {
    return table
      .getVisibleLeafColumns()
      .map(column => {
        if (column.id === 'mrt-row-select') {
          return '44px';
        }
        if (column.id === 'mrt-row-actions') {
          return '0.05fr';
        }
        const userSize = columnSizing[column.id];
        if (typeof userSize === 'number') {
          return `${userSize}px`;
        }
        const gridTemplate = (column.columnDef as TableColumn<RowItem>).gridTemplate;
        if (typeof gridTemplate === 'number') {
          return `${gridTemplate}fr`;
        }
        // 'min-content' used to size the track to the longest WORD, which
        // wrapped short labels (e.g. "No workloads" broke onto two lines) even
        // with plenty of table width to spare. Give such columns their full
        // one-line width when space allows, while still letting them shrink
        // back to min-content when the user squeezes the table.
        if (gridTemplate === 'min-content') {
          return 'minmax(min-content, max-content)';
        }
        return gridTemplate ?? '1fr';
      })
      .join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tableProps.columns,
    columnSizing,
    columnOrder,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    table.getState()?.columnVisibility,
    tableProps.state?.columnVisibility,
    tableProps.enableRowActions,
    tableProps.enableRowSelection,
  ]);

  const rows = useMRT_Rows(table);
  const rowIds = useMemo(() => rows.map(r => r.id), [rows]);

  // Handle shift+click range selection
  const handleRowClick = (e: React.MouseEvent, clickedIndex: number) => {
    if (!table || !table.getRowModel) {
      return;
    }

    const target = e.target as HTMLElement | null;
    const shouldHandle =
      !!target &&
      !!target.closest('input[type="checkbox"]') &&
      !target.closest('.MuiSwitch-root, [role="switch"]') &&
      !target.closest('[role="dialog"]');

    if (!shouldHandle) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && lastSelectedRowIndex !== null) {
      const start = Math.min(lastSelectedRowIndex, clickedIndex);
      const end = Math.max(lastSelectedRowIndex, clickedIndex);

      const newSelected: Record<string, boolean> = {};
      for (let i = start; i <= end; i++) {
        const rowId = rowIds[i];
        if (rowId) {
          newSelected[rowId] = true;
        }
      }

      table.setRowSelection(prev => ({ ...prev, ...newSelected }));
    } else {
      const rowId = rowIds[clickedIndex];
      table.setRowSelection(prev => ({ ...prev, [rowId]: !prev[rowId] }));
      setLastSelectedRowIndex(clickedIndex);
    }
  };

  const emptyMsg = emptyMessage || t('No data to be shown.');
  const isEmpty = !tableProps.data?.length && !loading;
  const noSearchResults = !errorMessage && !loading && !isEmpty && rows.length === 0;
  const statusMsg = isEmpty ? emptyMsg : noSearchResults ? t('No results found') : '';

  // Defer status text by one render so NVDA always sees a change ('' → message).
  const [announcedStatus, setAnnouncedStatus] = useState<
    | string
    | number
    | true
    | React.ReactElement<any, string | React.JSXElementConstructor<any>>
    | Iterable<React.ReactNode>
  >('');
  useEffect(() => {
    setAnnouncedStatus(statusMsg);
  }, [statusMsg]);

  let content;
  if (!!errorMessage) {
    content = <Empty color="error">{errorMessage}</Empty>;
  } else if (loading) {
    content = <Loader title={t('Loading table data')} />;
  } else if (!tableProps.data?.length) {
    content = (
      <Paper variant="outlined">
        <Empty>{emptyMsg}</Empty>
      </Paper>
    );
  } else {
    const headerGroups = table.getHeaderGroups();

    content = (
      <>
        <MRT_TopToolbar table={table} />
        <MuiTable
          // gridTemplateColumns changes on every mouse move during a column
          // resize, so it goes through `style` instead of `sx` to avoid
          // generating a new emotion class per frame.
          style={{ gridTemplateColumns }}
          sx={{
            display: 'grid',
            border: '1px solid',
            borderColor: theme.palette.tables.head.borderColor,
            borderRadius: '10px',
            borderBottom: 'none',
            overflowX: 'auto',
            width: '100%',
            // Modern table dressing, applied via descendant selectors so the
            // memoized head/body cells keep their own (cached) styles:
            // a quiet header band, hairline column separators, airier rows
            // and an always-visible sort affordance.
            '& th': {
              backgroundColor: theme.palette.background.muted,
              fontWeight: 600,
              borderRight: '1px solid',
              borderRightColor: theme.palette.divider,
              paddingTop: '0.55rem',
              paddingBottom: '0.55rem',
            },
            '& th:last-of-type': {
              borderRight: 'none',
            },
            '& td': {
              borderRight: '1px solid',
              borderRightColor: theme.palette.divider,
              paddingTop: '0.55rem',
              paddingBottom: '0.55rem',
              transition: 'background-color 0.1s ease',
            },
            '& td:last-of-type': {
              borderRight: 'none',
            },
            // Keep the ⇅ sort caret clearly visible on every sortable column
            // (MRT dims the whole label to 0.3 when unsorted; lift it so the
            // affordance reads like the reference), and make the active
            // column's arrow the primary color.
            '& .MuiTableSortLabel-root': {
              opacity: 1,
            },
            '& .MuiTableSortLabel-icon': {
              opacity: 0.6,
            },
            '& .MuiTableSortLabel-root.Mui-active .MuiTableSortLabel-icon': {
              opacity: 1,
              color: `${theme.palette.primary.main} !important`,
            },
            // The column-reorder grip (in the header cell's Actions box) is
            // revealed only when the header is hovered — like the reference —
            // so the header stays clean but reordering is still discoverable.
            // It keeps interactivity while hidden (opacity, not display), so
            // drag still works. The right margin moves the grip out from under
            // the absolutely-positioned resize strip, which otherwise
            // intercepts the pointer and swallows the grip's tooltip/drag.
            '& .Mui-TableHeadCell-Content-Actions': {
              opacity: 0,
              transition: 'opacity 0.15s ease',
              marginRight: '10px',
            },
            '& th:hover .Mui-TableHeadCell-Content-Actions, & th:focus-within .Mui-TableHeadCell-Content-Actions':
              {
                opacity: 1,
              },
            // Keep the resize strip to a slim edge zone so it never covers the
            // grip; it remains easy to hit at the column boundary itself.
            '& .Mui-TableHeadCell-ResizeHandle-Wrapper': {
              paddingLeft: '1px',
              paddingRight: '1px',
            },
            // MRT shifts every resize divider 4px right (translateX(4px)) to
            // center it on the column boundary. On the LAST column that shift
            // sticks out past the table edge, which registers as ~3px of
            // horizontal overflow and drew a permanent (useless) horizontal
            // scrollbar under every table. Keep the last column's divider
            // inside the table so the scrollbar appears only when columns
            // genuinely overflow.
            '& th:last-of-type .Mui-TableHeadCell-ResizeHandle-Divider': {
              transform: 'none',
            },
          }}
        >
          <TableHead sx={{ display: 'contents' }}>
            <StyledHeadRow>
              {headerGroups[0].headers.map(header => (
                <MemoHeadCell
                  key={header.id}
                  header={header as MRT_Header<Record<string, any>>}
                  table={table as MRT_TableInstance<Record<string, any>>}
                  isFiltered={header.column.getIsFiltered()}
                  sorting={header.column.getIsSorted()}
                  showColumnFilters={table.getState().showColumnFilters}
                  selected={table.getSelectedRowModel().flatRows.length}
                  filterValue={header.column.getFilterValue()}
                  isResizing={header.column.getIsResizing()}
                  // Broadcast (not per-column) on purpose: MRT's own drag-enter/
                  // drag-end handlers inside MRT_TableHeadCell close over
                  // `draggingColumn`/`hoveredColumn` at the time THAT cell last
                  // rendered. If only the dragged/hovered cell re-rendered, every
                  // other cell would keep a stale "no drag in progress" closure
                  // and never call setHoveredColumn on dragenter, so the drop
                  // would silently no-op. Changing this value for every cell in
                  // lockstep forces the whole header row to refresh together
                  // whenever a drag starts, the hover target changes, or the
                  // drag ends, keeping those closures current.
                  draggingColumnId={table.getState().draggingColumn?.id ?? null}
                  hoveredColumnId={table.getState().hoveredColumn?.id ?? null}
                />
              ))}
            </StyledHeadRow>
          </TableHead>
          <StyledBody>
            {rows.map((row, index) => (
              <Row
                key={row.id}
                rowIndex={index}
                cells={row.getVisibleCells() as MRT_Cell<Record<string, any>, unknown>[]}
                table={table as MRT_TableInstance<Record<string, any>>}
                isSelected={row.getIsSelected()}
                onRowClick={handleRowClick}
              />
            ))}
          </StyledBody>
        </MuiTable>
        <MRT_BottomToolbar table={table} />
      </>
    );
  }

  return (
    <>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {announcedStatus}
      </Box>
      {content}
    </>
  );
}

/**
 * Column ids that are frozen (sticky) to the right edge, so an actions column
 * stays visible while the rest of the table scrolls horizontally — regardless
 * of how many columns there are. Covers both the built-in row-actions column
 * and any column a table explicitly names "actions".
 */
const STICKY_RIGHT_COLUMN_IDS = new Set(['actions', 'mrt-row-actions']);

/** Sticky-right styling for a frozen column's header/body cell. */
function stickyRightSx(theme: Theme, isHeader: boolean) {
  return {
    position: 'sticky' as const,
    right: 0,
    zIndex: isHeader ? 4 : 3,
    // Opaque base so scrolled cells don't bleed through; the row-hover rule
    // still tints the body cell on top of this.
    backgroundColor: isHeader ? theme.palette.background.muted : theme.palette.background.paper,
    borderLeft: `1px solid ${theme.palette.divider}`,
  };
}

const MemoHeadCell = memo(
  <RowItem extends Record<string, any>>({
    header,
    table,
  }: {
    table: MRT_TableInstance<RowItem>;
    header: MRT_Header<RowItem>;
    sorting: string | false;
    isFiltered: boolean;
    selected: number;
    showColumnFilters: boolean;
    filterValue: any;
    isResizing: boolean;
    draggingColumnId: string | null;
    hoveredColumnId: string | null;
  }) => {
    const sticky = STICKY_RIGHT_COLUMN_IDS.has(header.column.id);
    return (
      <MRT_TableHeadCell
        header={header}
        key={header.id}
        staticColumnIndex={-1}
        table={table}
        sx={theme => ({
          borderColor: theme.palette.divider,
          ...(sticky ? stickyRightSx(theme, true) : {}),
        })}
      />
    );
  },
  (a, b) =>
    a.header.column.id === b.header.column.id &&
    a.sorting === b.sorting &&
    a.isFiltered === b.isFiltered &&
    a.showColumnFilters === b.showColumnFilters &&
    (a.header.column.id === 'mrt-row-select' ? a.selected === b.selected : true) &&
    a.filterValue === b.filterValue &&
    // Repaint during column resize so the resize border stays live.
    a.isResizing === b.isResizing &&
    // Broadcast values (see call site) so every header cell re-renders in
    // lockstep on drag start/hover-change/drag-end, keeping MRT's own
    // dragenter/dragend closures fresh instead of stale.
    a.draggingColumnId === b.draggingColumnId &&
    a.hoveredColumnId === b.hoveredColumnId
);

const Row = memo(
  <RowItem extends Record<string, any>>({
    cells,
    table,
    isSelected,
    onRowClick,
    rowIndex,
  }: {
    table: MRT_TableInstance<RowItem>;
    cells: MRT_Cell<RowItem, unknown>[];
    isSelected: boolean;
    onRowClick?: (e: React.MouseEvent, rowIndex: number) => void;
    rowIndex: number;
  }) => (
    <StyledRow data-selected={isSelected} onClickCapture={e => onRowClick?.(e, rowIndex)}>
      {cells.map(cell => (
        <MemoCell
          cell={cell as MRT_Cell<Record<string, any>, unknown>}
          table={table as MRT_TableInstance<Record<string, any>>}
          key={cell.id}
          isRowSelected={cell.row.getIsSelected()}
          canSelect={cell.row.getCanSelect()}
        />
      ))}
    </StyledRow>
  )
);

const MemoCell = memo(
  <RowItem extends Record<string, any>>({
    cell,
    table,
  }: {
    cell: MRT_Cell<RowItem, unknown>;
    table: MRT_TableInstance<RowItem>;
    isRowSelected: boolean;
    canSelect?: boolean;
  }) => {
    const column = cell.column.columnDef as TableColumn<any, unknown>;
    const sticky = STICKY_RIGHT_COLUMN_IDS.has(cell.column.id);
    return (
      <MRT_TableBodyCell
        staticRowIndex={-1}
        cell={cell}
        table={table}
        rowRef={{ current: null }}
        sx={theme =>
          ({
            whiteSpace: 'normal',
            width: 'unset',
            minWidth: 'unset',
            wordBreak: column.gridTemplate === 'min-content' ? 'normal' : 'break-word',
            borderColor: theme.palette.divider,
            ...(sticky ? stickyRightSx(theme, false) : {}),
            ...(column.muiTableBodyCellProps as TableCellProps)?.sx,
          } as any)
        }
      />
    );
  },
  (a, b) =>
    a.cell.getValue() === b.cell.getValue() &&
    (a.cell.column.id === 'mrt-row-select' && b.cell.column.id === 'mrt-row-select'
      ? a.canSelect === b.canSelect && a.isRowSelected === b.isRowSelected
      : true)
);
