import * as React from "react";

declare module "@mui/x-data-grid-pro" {
  interface ToolbarPropsOverrides {
    title?: string;
    subtitle?: string;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    onCopyPageJson?: () => void;
  }
}

import {
  DataGridPro,
  GridColDef,
  GridColumnGroupingModel,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowId,
  GridSortModel,
  GridToolbarColumnsButton,
  GridToolbarContainer,
  GridToolbarDensitySelector,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SearchIcon from "@mui/icons-material/Search";

import { fetchParsedArtefactObjectsPage } from "../../../../../dbutils/sqlite";
import type {
  ParsedArtefactObjectRow,
  ParsedArtefactObjectSortField,
} from "../../../../../dbutils/types";

type DisplayRow = ParsedArtefactObjectRow & {
  jsonParsed: unknown | null;
  sourceParsed: unknown | null;
};

function safeJsonParse(raw: string | null): unknown | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSource(parsed: unknown): unknown | null {
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
    return null;
  }
  return (parsed as Record<string, unknown>).source ?? null;
}

function prettyJson(parsed: unknown | null, raw: string | null): string {
  if (parsed != null) {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Fall through to the original parser output.
    }
  }
  return raw?.trim() ?? "";
}

function formatUtc(value: unknown): string {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString();
}

function ParsedObjectsToolbar(props: {
  title?: string;
  subtitle?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onCopyPageJson?: () => void;
}) {
  return (
    <GridToolbarContainer sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        sx={{
          width: "100%",
          p: 1,
          gap: 1,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Stack spacing={0.1} sx={{ minWidth: 210 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {props.title ?? "Parsed artefact objects"}
          </Typography>
          {props.subtitle ? (
            <Typography variant="caption" color="text.secondary">
              {props.subtitle}
            </Typography>
          ) : null}
        </Stack>

        <Stack
          direction="row"
          sx={{ gap: 0.5, alignItems: "center", flexWrap: "wrap" }}
        >
          <SearchIcon fontSize="small" color="action" />
          <TextField
            value={props.searchValue ?? ""}
            onChange={(event) => props.onSearchChange?.(event.target.value)}
            size="small"
            label="Search this file's objects"
            placeholder="Parser, kind, text or source path"
            sx={{ width: 310 }}
          />
          {props.searchValue ? (
            <Tooltip title="Clear search">
              <IconButton
                size="small"
                aria-label="Clear parsed-object search"
                onClick={() => props.onSearchChange?.("")}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          <GridToolbarColumnsButton />
          <GridToolbarDensitySelector />
          {props.onCopyPageJson ? (
            <Tooltip title="Copies only the rows currently loaded from the server">
              <Button
                size="small"
                variant="text"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={props.onCopyPageJson}
              >
                Copy page JSON
              </Button>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>
    </GridToolbarContainer>
  );
}

function JsonDetailPanel({ row }: { row: DisplayRow }) {
  const fullJson = prettyJson(row.jsonParsed, row.json);
  const sourceJson =
    row.sourceParsed == null
      ? ""
      : prettyJson(row.sourceParsed, null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullJson);
    } catch {
      // Clipboard denial is non-fatal; the inspector remains usable.
    }
  };

  return (
    <Box sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        sx={{
          gap: 0.75,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" label={`object ${row.id}`} />
          {row.kind ? <Chip size="small" label={row.kind} /> : null}
          {row.parser ? (
            <Chip size="small" variant="outlined" label={row.parser} />
          ) : null}
          <Chip
            size="small"
            variant="outlined"
            label={`artifact ${row.artifact_id}`}
          />
          {row.file_id != null ? (
            <Chip
              size="small"
              variant="outlined"
              label={`file ${row.file_id}`}
            />
          ) : null}
        </Stack>
        <Tooltip title="Copy full object JSON">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Divider sx={{ my: 1 }} />

      {sourceJson ? (
        <>
          <Typography variant="overline" color="text.secondary">
            Parser source and provenance
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              maxHeight: 190,
              overflow: "auto",
              borderRadius: 1,
              bgcolor: "background.default",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {sourceJson}
          </Box>
          <Divider sx={{ my: 1 }} />
        </>
      ) : null}

      {row.text ? (
        <>
          <Typography variant="overline" color="text.secondary">
            Display text
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              maxHeight: 150,
              overflow: "auto",
              borderRadius: 1,
              bgcolor: "background.default",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {row.text}
          </Box>
          <Divider sx={{ my: 1 }} />
        </>
      ) : null}

      <Typography variant="overline" color="text.secondary">
        Full parser JSON
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          maxHeight: 360,
          overflow: "auto",
          borderRadius: 1,
          bgcolor: "background.default",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {fullJson || "(empty parser output)"}
      </Box>
    </Box>
  );
}

export type ArtefactObjectsGridProps = {
  evidenceId: number;
  partitionId: number;
  /** `system_files.id`, not the filesystem-native identifier. */
  fileId: number;
  persistKeyPrefix?: string;
  height?: number | string;
};

const SORTABLE_FIELDS = new Set<ParsedArtefactObjectSortField>([
  "id",
  "parser",
  "kind",
  "artifact_id",
  "text",
  "source_path",
  "created_at",
]);

export default function ArtefactObjectsGrid({
  evidenceId,
  partitionId,
  fileId,
  persistKeyPrefix,
  height = 720,
}: ArtefactObjectsGridProps) {
  const apiRef = useGridApiRef();
  const requestSequence = React.useRef(0);
  const rowCountCache = React.useRef<{
    scope: string;
    count: number;
  } | null>(null);
  const [rows, setRows] = React.useState<DisplayRow[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [paginationModel, setPaginationModel] =
    React.useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [sortModel, setSortModel] = React.useState<GridSortModel>([
    { field: "id", sort: "asc" },
  ]);

  const persistKey = React.useMemo(() => {
    const prefix = persistKeyPrefix ?? "thanatology:grid:artefacts";
    return `${prefix}:e${evidenceId}:p${partitionId}:f${fileId}`;
  }, [evidenceId, fileId, partitionId, persistKeyPrefix]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPaginationModel((previous) =>
        previous.page === 0 ? previous : { ...previous, page: 0 },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    setPaginationModel((previous) => ({ ...previous, page: 0 }));
    setRows([]);
    setRowCount(0);
  }, [evidenceId, fileId, partitionId]);

  React.useEffect(() => {
    const requestId = ++requestSequence.current;
    const activeSort = sortModel[0];
    const sortField = SORTABLE_FIELDS.has(
      activeSort?.field as ParsedArtefactObjectSortField,
    )
      ? (activeSort.field as ParsedArtefactObjectSortField)
      : "id";
    const countScope = `${evidenceId}:${partitionId}:${fileId}:${search}`;
    const knownRowCount =
      rowCountCache.current?.scope === countScope
        ? rowCountCache.current.count
        : undefined;

    setLoading(true);
    setError(null);

    void fetchParsedArtefactObjectsPage({
      evidenceId,
      partitionId,
      fileId,
      offset: paginationModel.page * paginationModel.pageSize,
      limit: paginationModel.pageSize,
      search,
      sortField,
      sortDirection: activeSort?.sort === "desc" ? "desc" : "asc",
      knownRowCount,
    })
      .then((page) => {
        if (requestSequence.current !== requestId) return;
        setRows(
          page.rows.map((row) => {
            const parsed = safeJsonParse(row.json);
            return {
              ...row,
              jsonParsed: parsed,
              sourceParsed: getSource(parsed),
            };
          }),
        );
        setRowCount(page.rowCount);
        rowCountCache.current = { scope: countScope, count: page.rowCount };
      })
      .catch((reason: unknown) => {
        if (requestSequence.current !== requestId) return;
        setRows([]);
        setRowCount(0);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestSequence.current === requestId) setLoading(false);
      });
  }, [
    evidenceId,
    fileId,
    paginationModel.page,
    paginationModel.pageSize,
    partitionId,
    search,
    sortModel,
  ]);

  const columns = React.useMemo<GridColDef<DisplayRow>[]>(
    () => [
      { field: "id", headerName: "Object ID", width: 112, type: "number" },
      { field: "parser", headerName: "Parser", width: 185 },
      { field: "kind", headerName: "Kind", width: 220 },
      {
        field: "artifact_id",
        headerName: "Artifact ID",
        width: 112,
        type: "number",
      },
      {
        field: "source_path",
        headerName: "Source path",
        minWidth: 260,
        flex: 1,
        renderCell: (params: GridRenderCellParams<DisplayRow>) => (
          <Tooltip title={String(params.value ?? "")} placement="bottom-start">
            <span>{String(params.value ?? "—")}</span>
          </Tooltip>
        ),
      },
      {
        field: "source_table",
        headerName: "Table",
        width: 150,
        sortable: false,
      },
      {
        field: "source_record",
        headerName: "Record type",
        width: 145,
        sortable: false,
      },
      {
        field: "source_rowid",
        headerName: "Source row",
        width: 115,
        sortable: false,
      },
      {
        field: "source_role",
        headerName: "Source role",
        width: 125,
        sortable: false,
      },
      {
        field: "source_schema",
        headerName: "Schema variant",
        width: 210,
        sortable: false,
      },
      {
        field: "text",
        headerName: "Parser text",
        minWidth: 260,
        flex: 1,
        renderCell: (params: GridRenderCellParams<DisplayRow>) => {
          const value = String(params.value ?? "");
          const preview = value.length > 220 ? `${value.slice(0, 220)}…` : value;
          return (
            <Tooltip title={value} placement="bottom-start">
              <span>{preview || "—"}</span>
            </Tooltip>
          );
        },
      },
      {
        field: "created_at",
        headerName: "Indexed (UTC)",
        width: 205,
        renderCell: (params: GridRenderCellParams<DisplayRow>) => (
          <Typography variant="body2" component="span">
            {formatUtc(params.value)}
          </Typography>
        ),
      },
    ],
    [],
  );

  const columnGroupingModel = React.useMemo<GridColumnGroupingModel>(
    () => [
      {
        groupId: "object",
        headerName: "Parsed object",
        children: [
          { field: "id" },
          { field: "parser" },
          { field: "kind" },
          { field: "artifact_id" },
        ],
      },
      {
        groupId: "provenance",
        headerName: "Parser provenance",
        children: [
          { field: "source_path" },
          { field: "source_table" },
          { field: "source_record" },
          { field: "source_rowid" },
          { field: "source_role" },
          { field: "source_schema" },
        ],
      },
      {
        groupId: "content",
        headerName: "Content",
        children: [{ field: "text" }, { field: "created_at" }],
      },
    ],
    [],
  );

  React.useEffect(() => {
    const saved = localStorage.getItem(persistKey);
    if (!saved) return;
    try {
      apiRef.current?.restoreState(JSON.parse(saved));
    } catch {
      // Ignore stale preferences from an earlier grid schema.
    }
  }, [apiRef, persistKey]);

  const persistNow = React.useCallback(() => {
    try {
      if (!apiRef.current) return;
      localStorage.setItem(
        persistKey,
        JSON.stringify(apiRef.current.exportState()),
      );
    } catch {
      // Private browsing / storage denial must not block evidence inspection.
    }
  }, [apiRef, persistKey]);

  const copyPageJson = React.useCallback(async () => {
    const page = rows.map((row) => ({
      id: row.id,
      evidence_id: row.evidence_id,
      partition_id: row.partition_id,
      artifact_id: row.artifact_id,
      file_id: row.file_id,
      parser: row.parser,
      kind: row.kind,
      text: row.text,
      json: row.jsonParsed ?? row.json,
    }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(page, null, 2));
    } catch {
      // Clipboard denial is non-fatal.
    }
  }, [rows]);

  const firstVisible = rowCount
    ? paginationModel.page * paginationModel.pageSize + 1
    : 0;
  const lastVisible = Math.min(
    rowCount,
    (paginationModel.page + 1) * paginationModel.pageSize,
  );
  const subtitle = `${rowCount.toLocaleString()} matching object${
    rowCount === 1 ? "" : "s"
  } • showing ${firstVisible.toLocaleString()}–${lastVisible.toLocaleString()}`;

  return (
    <Paper
      variant="outlined"
      sx={{
        height,
        width: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {error ? (
        <Alert severity="error" sx={{ flexShrink: 0 }}>
          Failed to load parsed artefacts: {error}
        </Alert>
      ) : null}
      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id as GridRowId}
        columnGroupingModel={columnGroupingModel}
        loading={loading}
        rowCount={rowCount}
        pagination
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[25, 50, 100, 250]}
        sortingMode="server"
        sortModel={sortModel}
        onSortModelChange={(model) => {
          setSortModel(model.slice(0, 1));
          setPaginationModel((previous) => ({ ...previous, page: 0 }));
        }}
        disableColumnFilter
        disableRowSelectionOnClick
        density="compact"
        rowHeight={48}
        showToolbar
        slots={{ toolbar: ParsedObjectsToolbar }}
        slotProps={{
          toolbar: {
            title: "Parsed artefact objects",
            subtitle,
            searchValue: searchInput,
            onSearchChange: setSearchInput,
            onCopyPageJson: copyPageJson,
          },
        }}
        initialState={{
          columns: {
            columnVisibilityModel: {
              source_record: false,
              source_role: false,
              source_schema: false,
            },
          },
          pinnedColumns: { left: ["id", "parser", "kind"], right: [] },
        }}
        getDetailPanelContent={(params) => (
          <JsonDetailPanel row={params.row as DisplayRow} />
        )}
        getDetailPanelHeight={() => "auto"}
        onStateChange={persistNow}
        sx={{
          flex: 1,
          minHeight: 0,
          border: 0,
          "& .MuiDataGrid-cell": { outline: "none" },
          "& .MuiDataGrid-columnHeaders": {
            borderBottom: 1,
            borderColor: "divider",
          },
        }}
      />
    </Paper>
  );
}
