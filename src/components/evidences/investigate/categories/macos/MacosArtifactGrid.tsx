import * as React from "react";
import SearchIcon from "@mui/icons-material/Search";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  DataGridPro,
  GRID_DETAIL_PANEL_TOGGLE_FIELD,
  GridActionsCellItem,
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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getMacosArtifactPage } from "../../../../../dbutils/sqlite";
import type {
  MacosArtifactPanel,
  MacosArtifactRow,
} from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import {
  IosJsonDetailPanel,
  renderTimestampCell,
} from "../mobile/common";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

export interface MacosArtifactGridLabels {
  primary: string;
  secondary?: string;
  tertiary?: string;
  detail?: string;
  state?: string;
  numeric?: string;
  timestamp?: string;
  secondaryTimestamp?: string;
}

export interface MacosArtifactGridProps {
  evidenceId: number;
  partitionId: number;
  tag: string;
  category: "Users" | "System" | "Network";
  panel: MacosArtifactPanel;
  labels: MacosArtifactGridLabels;
  emptyMessage: string;
  searchPlaceholder: string;
  defaultSortField: string;
  defaultSortDirection?: "asc" | "desc";
  notice?: React.ReactNode;
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

async function openSourceFile(
  evidenceId: number,
  partitionId: number,
  row: MacosArtifactRow,
): Promise<void> {
  if (
    row.file_id == null ||
    row.fs_identifier == null ||
    row.file_size == null ||
    !row.file_path
  ) {
    throw new Error("The source file is not available in the indexed filesystem.");
  }

  const payload = {
    evidenceId,
    partitionId,
    Identifier: row.fs_identifier,
    fileId: row.file_id,
    fileSize: row.file_size,
    path: row.file_path,
  };
  localStorage.setItem("pending_fileviewer_payload", JSON.stringify(payload));
  try {
    await invoke("new_fileviewer");
  } finally {
    await emitTo("fileviewer", "message", payload);
  }
}

function buildColumns(
  labels: MacosArtifactGridLabels,
  evidenceId: number,
  partitionId: number,
  onOpenError: (message: string) => void,
): GridColDef<MacosArtifactRow>[] {
  const columns: GridColDef<MacosArtifactRow>[] = [];
  if (labels.timestamp) {
    columns.push({
      field: "timestamp_ms",
      headerName: labels.timestamp,
      width: 205,
      renderCell: (params) => renderTimestampCell(params.value),
    });
  }
  if (labels.secondaryTimestamp) {
    columns.push({
      field: "secondary_timestamp_ms",
      headerName: labels.secondaryTimestamp,
      width: 205,
      renderCell: (params) => renderTimestampCell(params.value),
    });
  }
  columns.push({
    field: "primary_value",
    headerName: labels.primary,
    minWidth: 190,
    flex: 1,
    renderCell: (params) => clippedText(params.value),
  });
  if (labels.secondary) {
    columns.push({
      field: "secondary_value",
      headerName: labels.secondary,
      minWidth: 210,
      flex: 1.15,
      renderCell: (params) => clippedText(params.value),
    });
  }
  if (labels.tertiary) {
    columns.push({
      field: "tertiary_value",
      headerName: labels.tertiary,
      width: 155,
      renderCell: (params) => clippedText(params.value),
    });
  }
  if (labels.detail) {
    columns.push({
      field: "detail_value",
      headerName: labels.detail,
      minWidth: 170,
      flex: 0.8,
      renderCell: (params) => clippedText(params.value),
    });
  }
  if (labels.state) {
    columns.push({
      field: "state_value",
      headerName: labels.state,
      width: 145,
      renderCell: (params) =>
        params.value ? (
          <Chip size="small" variant="outlined" label={String(params.value)} />
        ) : (
          "—"
        ),
    });
  }
  if (labels.numeric) {
    columns.push({
      field: "numeric_value",
      headerName: labels.numeric,
      width: 115,
      type: "number",
    });
  }
  columns.push(
    {
      field: "parser",
      headerName: "Parser",
      width: 175,
      renderCell: (params) => (
        <Chip size="small" variant="outlined" label={String(params.value)} />
      ),
    },
    {
      field: "source_path",
      headerName: "Source path",
      minWidth: 280,
      flex: 1.35,
      renderCell: (params) => clippedText(params.value),
    },
    {
      field: "actions",
      type: "actions",
      headerName: "",
      width: 52,
      getActions: ({ row }) => [
        <GridActionsCellItem
          key="open-source"
          icon={<VisibilityOutlinedIcon />}
          label="Open source file"
          disabled={
            row.file_id == null ||
            row.fs_identifier == null ||
            row.file_size == null ||
            !row.file_path
          }
          onClick={() => {
            void openSourceFile(evidenceId, partitionId, row).catch((cause) =>
              onOpenError(cause instanceof Error ? cause.message : String(cause)),
            );
          }}
          showInMenu={false}
        />,
      ],
    },
  );
  return columns;
}

/** Shared, server-paged workstation grid used by all six focused V4 panels. */
export default function MacosArtifactGrid({
  evidenceId,
  partitionId,
  tag,
  category,
  panel,
  labels,
  emptyMessage,
  searchPlaceholder,
  defaultSortField,
  defaultSortDirection = "desc",
  notice,
}: MacosArtifactGridProps) {
  const { start, end, isActive } = useTimeFilter();
  const timeAware = Boolean(labels.timestamp || labels.secondaryTimestamp);
  const [rows, setRows] = React.useState<MacosArtifactRow[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [querySearch, setQuerySearch] = React.useState("");
  const [paginationModel, setPaginationModel] =
    React.useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [sortModel, setSortModel] = React.useState<GridSortModel>([
    { field: defaultSortField, sort: defaultSortDirection },
  ]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    setPaginationModel((current) => ({ ...current, page: 0 }));
  }, [category, evidenceId, panel, partitionId, querySearch, tag, start, end]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const sort = sortModel[0];
    getMacosArtifactPage({
      evidenceId,
      partitionId,
      tag,
      category,
      panel,
      offset: paginationModel.page * paginationModel.pageSize,
      limit: paginationModel.pageSize,
      search: querySearch || undefined,
      sortField: sort?.field,
      sortDirection: sort?.sort === "asc" ? "asc" : "desc",
    })
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
    category,
    evidenceId,
    panel,
    paginationModel.page,
    paginationModel.pageSize,
    partitionId,
    querySearch,
    sortModel,
    start,
    end,
    tag,
  ]);

  const columns = React.useMemo(
    () => buildColumns(labels, evidenceId, partitionId, setOpenError),
    [evidenceId, labels, partitionId],
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 420,
        minWidth: 0,
      }}
    >
      {notice && (
        <Alert severity="info" variant="outlined" sx={{ m: 1, mb: 0 }}>
          {notice}
        </Alert>
      )}
      {(error || openError) && (
        <Alert
          severity="error"
          variant="outlined"
          onClose={() => {
            setError(null);
            setOpenError(null);
          }}
          sx={{ m: 1, mb: 0 }}
        >
          {error || openError}
        </Alert>
      )}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1, py: 0.75 }}
      >
        <Chip size="small" label={tag} />
        <Chip size="small" variant="outlined" label={`Partition ${partitionId}`} />
        {timeAware && isActive && (
          <Chip size="small" color="primary" variant="outlined" label="Time filtered" />
        )}
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          sx={{ width: { xs: 260, lg: 360 } }}
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
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGridPro
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
          pinnedColumns={{
            left: [GRID_DETAIL_PANEL_TOGGLE_FIELD, defaultSortField],
            right: ["actions"],
          }}
          getDetailPanelContent={(params: GridRowParams<MacosArtifactRow>) => (
            <IosJsonDetailPanel jsonRaw={params.row.json} />
          )}
          getDetailPanelHeight={() => 420}
          slots={{
            noRowsOverlay: () => (
              <Stack
                sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}
              >
                <Typography variant="body2" color="text.secondary">
                  {emptyMessage}
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
