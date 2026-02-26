import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridToolbarContainer,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
  GridToolbarDensitySelector,
  GridToolbarExport,
  GridToolbarQuickFilter,
  useGridApiRef,
  GridRowId,
  GridColumnGroupingModel,
} from "@mui/x-data-grid-pro";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
  IconButton,
  Divider,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import { fetchParsedArtefactObjects } from "../../../../../dbutils/sqlite";
import { ArtifactObjectRow } from "../../../../../dbutils/types";
// -------- helpers: safe JSON + flattening (unknown schema) --------

function safeJsonParse(raw: string | null): unknown | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function stringifySafe(v: unknown): string {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Flatten an object into dot-notation keys.
 * - Objects: recurse
 * - Arrays: stringify (keeps grid manageable); full JSON available in detail panel
 */
function flattenJson(
  input: unknown,
  opts?: { maxDepth?: number; maxStringLen?: number },
): Record<string, unknown> {
  const maxDepth = opts?.maxDepth ?? 6;
  const maxStringLen = opts?.maxStringLen ?? 5000;

  const out: Record<string, unknown> = {};

  const walk = (val: unknown, prefix: string, depth: number) => {
    if (depth > maxDepth) {
      out[prefix] = "[Max depth reached]";
      return;
    }

    if (val === null || val === undefined) {
      if (prefix) out[prefix] = null;
      return;
    }

    if (Array.isArray(val)) {
      const s = stringifySafe(val);
      out[prefix || ""] =
        s.length > maxStringLen ? s.slice(0, maxStringLen) + "…" : s;
      return;
    }

    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0 && prefix) out[prefix] = "{}";
      for (const k of keys) {
        const next = prefix ? `${prefix}.${k}` : k;
        walk(obj[k], next, depth + 1);
      }
      return;
    }

    // primitives
    if (!prefix) return;
    if (typeof val === "string" && val.length > maxStringLen) {
      out[prefix] = val.slice(0, maxStringLen) + "…";
    } else {
      out[prefix] = val;
    }
  };

  walk(input, "", 0);
  // remove empty key if any
  delete out[""];
  return out;
}

function inferColType(values: unknown[]): GridColDef["type"] {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return "string";

  const allNumber = nonNull.every(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (allNumber) return "number";

  const allBool = nonNull.every((v) => typeof v === "boolean");
  if (allBool) return "boolean";

  return "string";
}

// -------- UI: toolbar + detail panel --------

function ArtefactToolbar(props: {
  title?: string;
  subtitle?: string;
  onCopyAllJson?: () => void;
}) {
  return (
    <GridToolbarContainer>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        sx={{ width: "100%", p: 1 }}
      >
        <Stack spacing={0.25}>
          <Typography variant="subtitle1" fontWeight={700}>
            {props.title ?? "Parsed artefacts"}
          </Typography>
          {props.subtitle ? (
            <Typography variant="caption" color="text.secondary">
              {props.subtitle}
            </Typography>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <GridToolbarQuickFilter debounceMs={250} />
          <GridToolbarFilterButton />
          <GridToolbarColumnsButton />
          <GridToolbarDensitySelector />
          <GridToolbarExport />

          {props.onCopyAllJson ? (
            <Tooltip title="Copy ALL rows JSON to clipboard">
              <IconButton size="small" onClick={props.onCopyAllJson}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>
    </GridToolbarContainer>
  );
}

function JsonDetailPanel(props: { row: any }) {
  const jsonRaw = props.row.json_raw as string | null;
  const parsed = props.row.json_parsed as unknown | null;

  const pretty =
    parsed != null
      ? JSON.stringify(parsed, null, 2)
      : jsonRaw?.trim()
        ? jsonRaw
        : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty || "");
    } catch {
      // ignore
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center">
          {props.row.kind ? (
            <Chip size="small" label={`kind: ${props.row.kind}`} />
          ) : null}
          {props.row.parser ? (
            <Chip size="small" label={`parser: ${props.row.parser}`} />
          ) : null}
          {props.row.artifact_id != null ? (
            <Chip
              size="small"
              label={`artifact_id: ${props.row.artifact_id}`}
            />
          ) : null}
        </Stack>

        <Tooltip title="Copy JSON">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Divider sx={{ my: 1 }} />

      {props.row.text ? (
        <>
          <Typography variant="overline" color="text.secondary">
            Text
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "background.default",
              overflow: "auto",
              maxHeight: 180,
              fontSize: 12,
            }}
          >
            {props.row.text}
          </Box>
          <Divider sx={{ my: 1 }} />
        </>
      ) : null}

      <Typography variant="overline" color="text.secondary">
        JSON
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          borderRadius: 1,
          bgcolor: "background.default",
          overflow: "auto",
          maxHeight: 320,
          fontSize: 12,
        }}
      >
        {pretty || "(empty)"}
      </Box>
    </Box>
  );
}

// -------- main component --------

export type ArtefactObjectsGridProps = {
  evidenceId: number;
  partitionId: number;
  fileId: number;

  /** Optional: persist investigator grid tweaks per file */
  persistKeyPrefix?: string;

  /** Optional: UI */
  height?: number | string;
};

export default function ArtefactObjectsGrid(props: ArtefactObjectsGridProps) {
  const apiRef = useGridApiRef();

  const persistKey = React.useMemo(() => {
    const prefix = props.persistKeyPrefix ?? "thanatology:grid:artefacts";
    return `${prefix}:e${props.evidenceId}:f${props.fileId}`;
  }, [props.persistKeyPrefix, props.evidenceId, props.fileId]);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rawRows, setRawRows] = React.useState<ArtifactObjectRow[]>([]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        console.log(props.evidenceId);
        const rows = await fetchParsedArtefactObjects({
          evidenceId: props.evidenceId,
          partitionId: props.partitionId,
          fileId: props.fileId,
        });
        if (!alive) return;
        setRawRows(rows);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? String(e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [props.evidenceId, props.fileId]);

  // Build display rows with parsed+flattened JSON
  const rows = React.useMemo(() => {
    return rawRows.map((r) => {
      const parsed = safeJsonParse(r.json);
      const flat = parsed ? flattenJson(parsed) : {};
      return {
        id: r.id,
        evidence_id: r.evidence_id,
        partition_id: r.partition_id,
        artifact_id: r.artifact_id,
        file_id: r.file_id,
        parser: r.parser ?? "",
        kind: r.kind ?? "",
        text: r.text ?? "",
        json_raw: r.json ?? "",
        json_parsed: parsed,
        __flat: flat as Record<string, unknown>,
      };
    });
  }, [rawRows]);

  // Collect union of json keys across all rows
  const jsonKeys = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const flat = (r.__flat ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(flat)) s.add(k);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Build dynamic JSON columns
  const jsonColumns: GridColDef[] = React.useMemo(() => {
    if (jsonKeys.length === 0) return [];

    // infer type by sampling values for each key
    const cols: GridColDef[] = jsonKeys.map((k) => {
      const field = `j:${k}`; // avoid collisions
      const values = rows.map((r) => (r.__flat as any)?.[k]);
      const type = inferColType(values);

      return {
        field,
        headerName: k,
        type,
        flex: 1,
        minWidth: 160,
        sortable: true,
        filterable: true,
        valueGetter: (_value, row) => {
          const v = (row.__flat as any)?.[k];
          return v === undefined ? null : v;
        },
      };
    });

    return cols;
  }, [jsonKeys, rows]);

  const baseColumns: GridColDef[] = React.useMemo(
    () => [
      { field: "id", headerName: "Object ID", width: 110 },
      { field: "kind", headerName: "Kind", width: 160 },
      { field: "parser", headerName: "Parser", width: 170 },
      {
        field: "artifact_id",
        headerName: "Artifact ID",
        width: 110,
        type: "number",
      },
      {
        field: "text",
        headerName: "Text",
        flex: 1,
        minWidth: 220,
        sortable: true,
        renderCell: (params) => {
          const v = String(params.value ?? "");
          const short = v.length > 200 ? v.slice(0, 200) + "…" : v;
          return (
            <Tooltip title={v || ""} placement="bottom-start">
              <span>{short}</span>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const columns = React.useMemo(
    () => [...baseColumns, ...jsonColumns],
    [baseColumns, jsonColumns],
  );

  const columnGroupingModel = React.useMemo<GridColumnGroupingModel>(() => {
    const jsonFields = jsonColumns.map((c) => c.field);
    return [
      {
        groupId: "core",
        headerName: "Core",
        children: [
          { field: "id" },
          { field: "kind" },
          { field: "parser" },
          { field: "artifact_id" },
          { field: "text" },
        ],
      },
      ...(jsonFields.length
        ? [
            {
              groupId: "json",
              headerName: "Parsed fields (JSON)",
              children: jsonFields.map((f) => ({ field: f })),
            },
          ]
        : []),
    ];
  }, [jsonColumns]);

  // Detail panel (full JSON + text)
  const getDetailPanelContent = React.useCallback(
    (params: any) => <JsonDetailPanel row={params.row} />,
    [],
  );
  const getDetailPanelHeight = React.useCallback(() => 520, []);

  // Persist/restore investigator layout (columns, filters, grouping, etc.)
  React.useEffect(() => {
    const saved = localStorage.getItem(persistKey);
    if (!saved) return;
    try {
      const state = JSON.parse(saved);
      apiRef.current.restoreState(state);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);

  const persistNow = React.useCallback(() => {
    try {
      const state = apiRef.current.exportState();
      localStorage.setItem(persistKey, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [apiRef, persistKey]);

  const copyAllJson = React.useCallback(async () => {
    try {
      const payload = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        parser: r.parser,
        artifact_id: r.artifact_id,
        json: r.json_parsed ?? safeJsonParse(r.json_raw),
      }));
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  }, [rows]);

  const height = props.height ?? 720;

  if (error) {
    return (
      <Alert severity="error">Failed to load parsed artefacts: {error}</Alert>
    );
  }

  return (
    <Paper sx={{ height, width: "100%", overflow: "hidden" }}>
      {loading ? (
        <Box sx={{ p: 3, display: "flex", alignItems: "center", gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">Loading parsed artefacts…</Typography>
        </Box>
      ) : (
        <DataGridPro
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id as GridRowId}
          columnGroupingModel={columnGroupingModel}
          density="compact"
          disableRowSelectionOnClick
          pagination
          pageSizeOptions={[25, 50, 100, 250]}
          initialState={{
            pagination: { paginationModel: { pageSize: 50, page: 0 } },
            pinnedColumns: { left: ["id", "kind", "parser"], right: [] },
            rowGrouping: { model: ["kind"] }, // ergonomic default; investigator can change & it persists
            sorting: { sortModel: [{ field: "id", sort: "asc" }] },
          }}
          slots={{
            toolbar: ArtefactToolbar,
          }}
          slotProps={{
            toolbar: {
              title: "Parsed artefact objects",
              subtitle: `evidence=${props.evidenceId} • file=${props.fileId} • rows=${rows.length} • jsonFields=${jsonKeys.length}`,
              onCopyAllJson: copyAllJson,
            },
          }}
          rowHeight={50}
          showToolbar
          getDetailPanelContent={getDetailPanelContent}
          getDetailPanelHeight={getDetailPanelHeight}
          onStateChange={persistNow}
          sx={{
            "& .MuiDataGrid-cell": { outline: "none" },
            "& .MuiDataGrid-columnHeaders": {
              borderBottom: 1,
              borderColor: "divider",
            },
          }}
        />
      )}
    </Paper>
  );
}
