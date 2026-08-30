import * as React from "react";
import {
  DataGridPro,
  GridActionsCellItem,
  type GridColDef,
  type GridPaginationModel,
  type GridSortModel,
} from "@mui/x-data-grid-pro";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  getSpotlightExploreFacets,
  getSpotlightExplorePage,
  prepareSpotlightExplore,
  type InvestigationTimeScope,
  type SpotlightPreparationProgress,
} from "../../../../../dbutils/sqlite";
import type {
  SpotlightExploreFacets,
  SpotlightExploreRow,
  SpotlightSortField,
} from "../../../../../dbutils/types";
import {
  useTimeFilter,
  useTimeFilterStore,
} from "../../../../../store/timeFilterStore";
import {
  formatBytes,
  renderTimestampCell,
} from "../mobile/common";
import TimeFilterBanner from "../../TimeFilterBanner";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
const EMPTY_FACETS: SpotlightExploreFacets = {
  contentTypes: [],
  itemKinds: [],
  sourceStores: [],
  pathRoots: [],
};

export interface SpotlightExploreProps {
  evidenceId: number;
  partitionId: number;
  onRevealFile: (fileId: number) => void;
}

function clipped(value: unknown): React.ReactNode {
  const text = String(value ?? "");
  if (!text) return "—";
  return (
    <Tooltip title={text} placement="bottom-start">
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {text}
      </span>
    </Tooltip>
  );
}

function facetLabel(value: string, count: number): string {
  return `${value} (${count.toLocaleString()})`;
}

function resolutionChip(status: SpotlightExploreRow["resolution_status"]) {
  if (status === "resolved") {
    return <Chip size="small" color="success" variant="outlined" label="Resolved" />;
  }
  if (status === "not_indexed") {
    return <Chip size="small" color="warning" variant="outlined" label="Not indexed" />;
  }
  return <Chip size="small" variant="outlined" label="No path" />;
}

async function openResolvedFile(
  evidenceId: number,
  partitionId: number,
  row: SpotlightExploreRow,
): Promise<void> {
  if (
    row.resolved_file_id == null ||
    row.resolved_identifier == null ||
    row.resolved_size == null ||
    !row.resolved_absolute_path
  ) {
    throw new Error("This Spotlight record is not resolved to an indexed file.");
  }
  const payload = {
    evidenceId,
    partitionId,
    Identifier: row.resolved_identifier,
    fileId: row.resolved_file_id,
    fileSize: row.resolved_size,
    path: row.resolved_absolute_path,
  };
  localStorage.setItem("pending_fileviewer_payload", JSON.stringify(payload));
  try {
    await invoke("new_fileviewer");
  } finally {
    await emitTo("fileviewer", "message", payload);
  }
}

type ParsedSpotlight = {
  attributes: Record<string, unknown>;
  source: Record<string, unknown>;
  store: Record<string, unknown>;
  pretty: string;
};

function parseDetails(row: SpotlightExploreRow | null): ParsedSpotlight {
  if (!row?.json) return { attributes: {}, source: {}, store: {}, pretty: "" };
  try {
    const parsed = JSON.parse(row.json) as Record<string, unknown>;
    return {
      attributes:
        parsed.attributes && typeof parsed.attributes === "object"
          ? (parsed.attributes as Record<string, unknown>)
          : {},
      source:
        parsed.source && typeof parsed.source === "object"
          ? (parsed.source as Record<string, unknown>)
          : {},
      store:
        parsed.store && typeof parsed.store === "object"
          ? (parsed.store as Record<string, unknown>)
          : {},
      pretty: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return { attributes: {}, source: {}, store: {}, pretty: row.json };
  }
}

function attributeDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function SpotlightExplore({
  evidenceId,
  partitionId,
  onRevealFile,
}: SpotlightExploreProps) {
  const { start, end, fileTimeField } = useTimeFilter();
  const scopeEvidenceId = useTimeFilterStore((state) => state.evidenceId);
  const scopePartitionId = useTimeFilterStore((state) => state.partitionId);
  const [prepared, setPrepared] = React.useState(false);
  const [preparationAttempt, setPreparationAttempt] = React.useState(0);
  const [preparation, setPreparation] = React.useState<SpotlightPreparationProgress>({
    stage: "indexes",
    message: "Preparing Spotlight Explore…",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<SpotlightExploreRow[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [facets, setFacets] = React.useState(EMPTY_FACETS);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [contentType, setContentType] = React.useState("");
  const [itemKind, setItemKind] = React.useState("");
  const [sourceStore, setSourceStore] = React.useState("");
  const [pathRoot, setPathRoot] = React.useState("");
  const [pagination, setPagination] = React.useState<GridPaginationModel>({
    page: 0,
    pageSize: 50,
  });
  const [sortModel, setSortModel] = React.useState<GridSortModel>([
    { field: "updated_ms", sort: "desc" },
  ]);
  const [selected, setSelected] = React.useState<SpotlightExploreRow | null>(null);
  const [detailTab, setDetailTab] = React.useState(0);
  const countCache = React.useRef(new Map<string, number>());
  const fetchSequence = React.useRef(0);
  const facetSequence = React.useRef(0);
  const timeScope = React.useMemo<InvestigationTimeScope | undefined>(
    () =>
      scopeEvidenceId === evidenceId && scopePartitionId === partitionId
        ? {
            evidenceId,
            partitionId,
            startMs: start,
            endMs: end,
            fileTimeField,
          }
        : undefined,
    [
      scopeEvidenceId,
      scopePartitionId,
      evidenceId,
      partitionId,
      start,
      end,
      fileTimeField,
    ],
  );
  const scopedStart = timeScope?.startMs ?? null;
  const scopedEnd = timeScope?.endMs ?? null;

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      setSearch(trimmed.length >= 3 ? trimmed : "");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    let cancelled = false;
    setPrepared(false);
    setError(null);
    setRows([]);
    setRowCount(0);
    setFacets(EMPTY_FACETS);
    countCache.current.clear();
    void prepareSpotlightExplore(evidenceId, partitionId, (progress) => {
      if (!cancelled) setPreparation(progress);
    })
      .then(() => {
        if (!cancelled) setPrepared(true);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [evidenceId, partitionId, preparationAttempt]);

  React.useEffect(() => {
    if (!prepared) return;
    const sequence = ++facetSequence.current;
    let cancelled = false;
    void getSpotlightExploreFacets(evidenceId, partitionId, timeScope)
      .then((nextFacets) => {
        if (!cancelled && sequence === facetSequence.current) {
          setFacets(nextFacets);
        }
      })
      .catch((reason) => {
        if (!cancelled && sequence === facetSequence.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [prepared, evidenceId, partitionId, timeScope]);

  const filterKey = React.useMemo(
    () =>
      JSON.stringify({
        evidenceId,
        partitionId,
        search,
        contentType,
        itemKind,
        sourceStore,
        pathRoot,
        start: scopedStart,
        end: scopedEnd,
      }),
    [
      evidenceId,
      partitionId,
      search,
      contentType,
      itemKind,
      sourceStore,
      pathRoot,
      scopedStart,
      scopedEnd,
    ],
  );

  React.useEffect(() => {
    setPagination((current) => ({ ...current, page: 0 }));
  }, [filterKey]);

  React.useEffect(() => {
    if (!prepared) return;
    const sequence = ++fetchSequence.current;
    const sort = sortModel[0];
    setLoading(true);
    setError(null);
    let cancelled = false;
    void getSpotlightExplorePage(
      {
        evidenceId,
        partitionId,
        offset: pagination.page * pagination.pageSize,
        limit: pagination.pageSize,
        search,
        contentType: contentType || undefined,
        itemKind: itemKind || undefined,
        sourceStore: sourceStore || undefined,
        pathRoot: pathRoot || undefined,
        startMs: scopedStart,
        endMs: scopedEnd,
        sortField: (sort?.field ?? "updated_ms") as SpotlightSortField,
        sortDirection: sort?.sort === "asc" ? "asc" : "desc",
        knownRowCount: countCache.current.get(filterKey),
      },
      timeScope,
    )
      .then((page) => {
        if (cancelled || sequence !== fetchSequence.current) return;
        countCache.current.set(filterKey, page.rowCount);
        setRows(page.rows);
        setRowCount(page.rowCount);
      })
      .catch((reason) => {
        if (!cancelled && sequence === fetchSequence.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled && sequence === fetchSequence.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    prepared,
    evidenceId,
    partitionId,
    pagination,
    sortModel,
    filterKey,
    search,
    contentType,
    itemKind,
    sourceStore,
    pathRoot,
    scopedStart,
    scopedEnd,
    timeScope,
  ]);

  const columns = React.useMemo<GridColDef<SpotlightExploreRow>[]>(
    () => [
      {
        field: "updated_ms",
        headerName: "Updated (UTC)",
        width: 205,
        renderCell: (params) => renderTimestampCell(params.value),
      },
      { field: "name", headerName: "Name", minWidth: 210, flex: 0.8, renderCell: (p) => clipped(p.value) },
      { field: "path", headerName: "Path", minWidth: 300, flex: 1.35, renderCell: (p) => clipped(p.value) },
      { field: "content_type", headerName: "Content type", minWidth: 190, flex: 0.7, renderCell: (p) => clipped(p.value) },
      { field: "item_kind", headerName: "Kind", minWidth: 150, flex: 0.55, renderCell: (p) => clipped(p.value) },
      { field: "source_store", headerName: "Source store", minWidth: 260, flex: 0.9, renderCell: (p) => clipped(p.value) },
      {
        field: "resolution_status",
        headerName: "Resolution",
        width: 125,
        sortable: false,
        renderCell: (params) => resolutionChip(params.row.resolution_status),
      },
      {
        field: "actions",
        type: "actions",
        headerName: "",
        width: 92,
        getActions: ({ row }) => {
          const resolved = row.resolution_status === "resolved" && row.resolved_file_id != null;
          return [
            <GridActionsCellItem
              key="details"
              icon={<InfoOutlinedIcon />}
              label="Inspect Spotlight attributes"
              onClick={() => {
                setSelected(row);
                setDetailTab(0);
              }}
              showInMenu={false}
            />,
            <GridActionsCellItem
              key="open"
              icon={<VisibilityOutlinedIcon />}
              label="Open file"
              disabled={!resolved}
              onClick={() => void openResolvedFile(evidenceId, partitionId, row).catch((reason) =>
                setError(reason instanceof Error ? reason.message : String(reason)),
              )}
              showInMenu
            />,
            <GridActionsCellItem
              key="reveal"
              icon={<FolderOpenOutlinedIcon />}
              label="Reveal in Files"
              disabled={!resolved}
              onClick={() => row.resolved_file_id != null && onRevealFile(row.resolved_file_id)}
              showInMenu
            />,
          ];
        },
      },
    ],
    [evidenceId, partitionId, onRevealFile],
  );

  const parsedDetails = React.useMemo(() => parseDetails(selected), [selected]);
  const attributeEntries = React.useMemo(
    () => Object.entries(parsedDetails.attributes).sort(([a], [b]) => a.localeCompare(b)),
    [parsedDetails.attributes],
  );

  if (!prepared) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          {error && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    setError(null);
                    setPreparationAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            {!error && <CircularProgress size={22} />}
            <Box>
              <Typography variant="subtitle2">Preparing Spotlight Explore</Typography>
              <Typography variant="body2" color="text.secondary">
                {preparation.message}
              </Typography>
            </Box>
          </Stack>
          {!error && <LinearProgress />}
          <Typography variant="caption" color="text.secondary">
            This one-time derived index build keeps all subsequent searches, facets and pages bounded. The evidence records are not modified.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 1 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Paper variant="outlined" sx={{ p: 1.25, flexShrink: 0 }}>
        <Stack direction={{ xs: "column", xl: "row" }} spacing={1} sx={{ alignItems: { xl: "center" } }}>
          <TextField
            size="small"
            label="Name or path"
            placeholder="Type at least 3 characters"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            sx={{ minWidth: 270, flex: 1.2 }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />
          <TextField select size="small" label="Content type" value={contentType} onChange={(e) => setContentType(e.target.value)} sx={{ minWidth: 190, flex: 0.8 }}>
            <MenuItem value="">All content types</MenuItem>
            {facets.contentTypes.map((facet) => <MenuItem key={facet.value} value={facet.value}>{facetLabel(facet.value, facet.count)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Kind" value={itemKind} onChange={(e) => setItemKind(e.target.value)} sx={{ minWidth: 175, flex: 0.7 }}>
            <MenuItem value="">All kinds</MenuItem>
            {facets.itemKinds.map((facet) => <MenuItem key={facet.value} value={facet.value}>{facetLabel(facet.value, facet.count)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Source store" value={sourceStore} onChange={(e) => setSourceStore(e.target.value)} sx={{ minWidth: 220, flex: 1 }}>
            <MenuItem value="">All source stores</MenuItem>
            {facets.sourceStores.map((facet) => <MenuItem key={facet.value} value={facet.value}>{facetLabel(facet.value, facet.count)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Path root" value={pathRoot} onChange={(e) => setPathRoot(e.target.value)} sx={{ minWidth: 175, flex: 0.65 }}>
            <MenuItem value="">All path roots</MenuItem>
            {facets.pathRoots.map((facet) => <MenuItem key={facet.value} value={facet.value}>{facetLabel(facet.value, facet.count)}</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {rowCount.toLocaleString()} Spotlight records in the current scope
          </Typography>
          {searchInput.trim().length > 0 && searchInput.trim().length < 3 && (
            <Typography variant="caption" color="warning.main">Enter 3 characters to search.</Typography>
          )}
        </Stack>
      </Paper>

      <TimeFilterBanner
        mode="intrinsic"
        noun="Spotlight records"
        timestampLabel="Spotlight updated time"
        sx={{ px: 0, pt: 0 }}
      />

      <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <DataGridPro
          rows={rows}
          columns={columns}
          loading={loading}
          rowCount={rowCount}
          pagination
          paginationMode="server"
          paginationModel={pagination}
          onPaginationModelChange={setPagination}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sortingMode="server"
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          disableRowSelectionOnClick
          density="compact"
          onRowDoubleClick={({ row }) => {
            setSelected(row);
            setDetailTab(0);
          }}
          slots={{
            noRowsOverlay: () => (
              <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
                <Typography color="text.secondary">No Spotlight records match this scope.</Typography>
              </Stack>
            ),
          }}
          sx={{ border: 0, height: "100%" }}
        />
      </Paper>

      <Drawer
        anchor="right"
        open={selected != null}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 620 }, p: 0 } } }}
      >
        <Stack direction="row" sx={{ px: 2, py: 1.25, alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>{selected?.name ?? "Spotlight record"}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{selected?.path ?? "No reconstructed path"}</Typography>
          </Box>
          <IconButton onClick={() => setSelected(null)}><CloseIcon /></IconButton>
        </Stack>
        <Divider />
        <Tabs value={detailTab} onChange={(_event, value) => setDetailTab(value)} sx={{ px: 1 }}>
          <Tab label={`Attributes (${attributeEntries.length})`} />
          <Tab label="Provenance" />
          <Tab label="Raw JSON" />
        </Tabs>
        <Divider />
        <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
          {detailTab === 0 && (
            <Stack spacing={0} divider={<Divider flexItem />}>
              {attributeEntries.length === 0 && <Typography color="text.secondary">No free-form attributes.</Typography>}
              {attributeEntries.map(([key, value]) => (
                <Box key={key} sx={{ display: "grid", gridTemplateColumns: "minmax(180px, 0.8fr) minmax(0, 1.2fr)", gap: 2, py: 0.9 }}>
                  <Typography variant="caption" sx={{ fontFamily: "monospace", wordBreak: "break-word" }}>{key}</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{attributeDisplay(value)}</Typography>
                </Box>
              ))}
            </Stack>
          )}
          {detailTab === 1 && selected && (
            <Stack spacing={1.25}>
              <Typography variant="overline">Parser and source</Typography>
              <Typography variant="body2">Parser: {selected.parser}</Typography>
              <Typography variant="body2" sx={{ wordBreak: "break-all" }}>Source store: {selected.source_store ?? "—"}</Typography>
              <Typography variant="body2">Spotlight ID: {selected.spotlight_id ?? "—"}</Typography>
              <Typography variant="body2">Parent ID: {selected.parent_id ?? "—"}</Typography>
              <Typography variant="body2">Item ID: {selected.item_id ?? "—"}</Typography>
              <Typography variant="body2">Flags: {selected.flags ?? "—"}</Typography>
              <Typography variant="body2">Resolved size: {formatBytes(selected.resolved_size)}</Typography>
              <Typography variant="body2" sx={{ wordBreak: "break-all" }}>Indexed path: {selected.resolved_absolute_path ?? "—"}</Typography>
              <Typography variant="overline" sx={{ mt: 1 }}>Source object</Typography>
              <Box component="pre" sx={{ m: 0, p: 1, bgcolor: "background.default", borderRadius: 1, overflow: "auto", fontSize: 12 }}>
                {JSON.stringify({ source: parsedDetails.source, store: parsedDetails.store }, null, 2)}
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" startIcon={<VisibilityOutlinedIcon />} disabled={selected.resolution_status !== "resolved"} onClick={() => void openResolvedFile(evidenceId, partitionId, selected)}>
                  Open file
                </Button>
                <Button size="small" variant="outlined" startIcon={<FolderOpenOutlinedIcon />} disabled={selected.resolved_file_id == null} onClick={() => selected.resolved_file_id != null && onRevealFile(selected.resolved_file_id)}>
                  Reveal in Files
                </Button>
              </Stack>
            </Stack>
          )}
          {detailTab === 2 && (
            <Stack spacing={1}>
              <Button size="small" variant="outlined" startIcon={<ContentCopyOutlinedIcon />} sx={{ alignSelf: "flex-end" }} onClick={() => void navigator.clipboard.writeText(parsedDetails.pretty)}>
                Copy JSON
              </Button>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "background.default", borderRadius: 1, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {parsedDetails.pretty}
              </Box>
            </Stack>
          )}
        </Box>
      </Drawer>
    </Box>
  );
}
