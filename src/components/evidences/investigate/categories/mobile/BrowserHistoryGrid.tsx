import * as React from "react";
import SearchIcon from "@mui/icons-material/Search";
import {
  DataGridPro,
  GRID_DETAIL_PANEL_TOGGLE_FIELD,
  GridColDef,
  GridPaginationModel,
  GridRowParams,
  GridSortModel,
} from "@mui/x-data-grid-pro";
import {
  Alert,
  Box,
  Chip,
  InputAdornment,
  Link,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  getBrowserActivityDownloads,
  getBrowserActivitySites,
  getBrowserActivityVisits,
} from "../../../../../dbutils/sqlite";
import type {
  BrowserActivityQuery,
  BrowserDownloadRow,
  BrowserSiteRow,
  BrowserVisitRow,
} from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import {
  formatBytes,
  IosJsonDetailPanel,
  renderTimestampCell,
} from "./common";

type BrowserActivityTab = "visits" | "sites" | "downloads";
type BrowserActivityRow = BrowserVisitRow | BrowserSiteRow | BrowserDownloadRow;

export interface BrowserHistoryGridProps {
  evidenceId: number;
  partitionId: number;
  /** Exact artifact tag. Required to keep Chrome, Edge and Brave separate. */
  tag?: string;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

function defaultSort(tab: BrowserActivityTab): GridSortModel {
  switch (tab) {
    case "sites":
      return [{ field: "last_visit_ms", sort: "desc" }];
    case "downloads":
      return [{ field: "start_ms", sort: "desc" }];
    default:
      return [{ field: "ts", sort: "desc" }];
  }
}

function clippedText(value: unknown): React.ReactNode {
  const text = String(value ?? "");
  if (!text) return "—";
  return (
    <Tooltip title={text} placement="bottom-start">
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </Tooltip>
  );
}

function urlCell(value: unknown): React.ReactNode {
  const url = String(value ?? "");
  if (!url) return "—";
  return (
    <Tooltip title={url} placement="bottom-start">
      <Link
        href={url}
        target="_blank"
        rel="noreferrer"
        underline="hover"
        sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {url}
      </Link>
    </Tooltip>
  );
}

function parserCell(value: unknown): React.ReactNode {
  return value ? <Chip size="small" variant="outlined" label={String(value)} /> : "—";
}

function columnsFor(tab: BrowserActivityTab): GridColDef<BrowserActivityRow>[] {
  const parser: GridColDef<BrowserActivityRow> = {
    field: "parser",
    headerName: "Parser",
    width: 165,
    renderCell: (params) => parserCell(params.value),
  };
  const source: GridColDef<BrowserActivityRow> = {
    field: "source_path",
    headerName: "Source database",
    flex: 1,
    minWidth: 240,
    renderCell: (params) => clippedText(params.value),
  };

  if (tab === "sites") {
    return [
      {
        field: "last_visit_ms",
        headerName: "Last visit (UTC)",
        width: 220,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "first_visit_ms",
        headerName: "First visit (UTC)",
        width: 220,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "visit_count",
        headerName: "Visits",
        type: "number",
        width: 95,
      },
      {
        field: "title",
        headerName: "Representative title",
        flex: 1,
        minWidth: 210,
        renderCell: (params) => clippedText(params.value),
      },
      { field: "host", headerName: "Host", minWidth: 170, flex: 1 },
      {
        field: "url",
        headerName: "URL",
        flex: 2,
        minWidth: 280,
        renderCell: (params) => urlCell(params.value),
      },
      parser,
      source,
    ];
  }

  if (tab === "downloads") {
    return [
      {
        field: "start_ms",
        headerName: "Started (UTC)",
        width: 220,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "end_ms",
        headerName: "Finished (UTC)",
        width: 220,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      {
        field: "target_path",
        headerName: "Target path",
        flex: 1,
        minWidth: 260,
        renderCell: (params) => clippedText(params.value),
      },
      { field: "host", headerName: "Host", minWidth: 170, flex: 1 },
      {
        field: "url",
        headerName: "Source URL",
        flex: 2,
        minWidth: 280,
        renderCell: (params) => urlCell(params.value),
      },
      {
        field: "received_bytes",
        headerName: "Received",
        width: 115,
        type: "number",
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      {
        field: "total_bytes",
        headerName: "Total",
        width: 115,
        type: "number",
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      parser,
      source,
    ];
  }

  return [
    {
      field: "ts",
      headerName: "Visit time (UTC)",
      width: 220,
      renderCell: (params) => renderTimestampCell(params.value),
    },
    {
      field: "title",
      headerName: "Title",
      flex: 1,
      minWidth: 210,
      renderCell: (params) => clippedText(params.value),
    },
    { field: "host", headerName: "Host", minWidth: 170, flex: 1 },
    {
      field: "url",
      headerName: "URL",
      flex: 2,
      minWidth: 280,
      renderCell: (params) => urlCell(params.value),
    },
    {
      field: "transition",
      headerName: "Transition",
      width: 120,
      renderCell: (params) => clippedText(params.value),
    },
    {
      field: "is_redirect",
      headerName: "Redirect",
      width: 95,
      renderCell: (params) =>
        params.value === 1 ? <Chip size="small" variant="outlined" label="redirect" /> : "—",
    },
    parser,
    source,
  ];
}

/**
 * Neutral browser workspace for iOS Safari and macOS Safari/Chromium/Firefox.
 * Visits and downloads are server paged; Sites is an SQL aggregation over the
 * visits in the active global time window.
 */
export default function BrowserHistoryGrid({
  evidenceId,
  partitionId,
  tag = "Safari",
}: BrowserHistoryGridProps) {
  const { start, end } = useTimeFilter();
  const [activeTab, setActiveTab] = React.useState<BrowserActivityTab>("visits");
  const [rows, setRows] = React.useState<BrowserActivityRow[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [querySearch, setQuerySearch] = React.useState("");
  const [paginationModel, setPaginationModel] = React.useState<GridPaginationModel>({
    page: 0,
    pageSize: PAGE_SIZE_OPTIONS[0],
  });
  const [sortModel, setSortModel] = React.useState<GridSortModel>(defaultSort("visits"));

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    setPaginationModel((current) => ({ ...current, page: 0 }));
  }, [evidenceId, partitionId, tag, querySearch, start, end]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const sort = sortModel[0];
    const query: BrowserActivityQuery = {
      evidenceId,
      partitionId,
      tag,
      offset: paginationModel.page * paginationModel.pageSize,
      limit: paginationModel.pageSize,
      search: querySearch || undefined,
      sortField: sort?.field,
      sortDirection: sort?.sort === "asc" ? "asc" : "desc",
    };

    const request =
      activeTab === "sites"
        ? getBrowserActivitySites(query)
        : activeTab === "downloads"
          ? getBrowserActivityDownloads(query)
          : getBrowserActivityVisits(query);

    request
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setRowCount(result.rowCount);
      })
      .catch((cause) => {
        if (cancelled) return;
        setRows([]);
        setRowCount(0);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    evidenceId,
    partitionId,
    tag,
    paginationModel.page,
    paginationModel.pageSize,
    querySearch,
    sortModel,
    start,
    end,
  ]);

  const columns = React.useMemo(() => columnsFor(activeTab), [activeTab]);
  const primaryColumn =
    activeTab === "sites" ? "last_visit_ms" : activeTab === "downloads" ? "start_ms" : "ts";

  const changeTab = (_event: React.SyntheticEvent, next: BrowserActivityTab) => {
    setActiveTab(next);
    setRows([]);
    setRowCount(0);
    setPaginationModel((current) => ({ ...current, page: 0 }));
    setSortModel(defaultSort(next));
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        flexGrow: 1,
        minHeight: 420,
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", px: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Tabs value={activeTab} onChange={changeTab} aria-label="Browser activity view">
          <Tab value="visits" label="Visits" />
          <Tab value="sites" label="Sites" />
          <Tab value="downloads" label="Downloads" />
        </Tabs>
        <Box sx={{ flexGrow: 1 }} />
        <Chip size="small" label={tag} />
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search URL, title, host or source"
          aria-label="Search browser activity"
          sx={{ width: 300 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      <TimeFilterBanner
        mode={activeTab === "downloads" ? "interval" : "intrinsic"}
        noun={activeTab}
        timestampLabel={
          activeTab === "downloads"
            ? "start/end interval"
            : activeTab === "sites"
              ? "underlying visit time"
              : "visit time"
        }
      />

      {error && (
        <Alert severity="error" sx={{ m: 1 }}>
          Failed to load {tag} {activeTab}: {error}
        </Alert>
      )}

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <DataGridPro
          key={activeTab}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={loading}
          rowCount={rowCount}
          density="compact"
          rowHeight={36}
          pagination
          paginationMode="server"
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sortingMode="server"
          sortModel={sortModel}
          onSortModelChange={(model) => {
            setSortModel(model);
            setPaginationModel((current) => ({ ...current, page: 0 }));
          }}
          disableColumnFilter
          disableRowSelectionOnClick
          pinnedColumns={{ left: [GRID_DETAIL_PANEL_TOGGLE_FIELD, primaryColumn] }}
          getDetailPanelContent={(params: GridRowParams<BrowserActivityRow>) => (
            <IosJsonDetailPanel jsonRaw={params.row.json} />
          )}
          getDetailPanelHeight={() => 420}
          slots={{
            noRowsOverlay: () => (
              <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  No parsed {activeTab} found for {tag} in this scope.
                </Typography>
              </Stack>
            ),
          }}
          sx={{ border: 0 }}
        />
      </Box>
    </Box>
  );
}
