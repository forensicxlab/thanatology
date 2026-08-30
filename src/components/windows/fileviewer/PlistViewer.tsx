import React, { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DataObjectOutlinedIcon from "@mui/icons-material/DataObjectOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import TableRowsOutlinedIcon from "@mui/icons-material/TableRowsOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { DataGridPro, type GridColDef } from "@mui/x-data-grid-pro";
import { invoke } from "@tauri-apps/api/core";

export type PlistJsonValue =
  | null
  | boolean
  | number
  | string
  | PlistJsonValue[]
  | { [key: string]: PlistJsonValue };

export interface PlistDocument {
  format: "xml" | "binary";
  rootType: string;
  byteLength: number;
  sha256: string;
  source: {
    sourceKind: "host_file" | "evidence_filesystem" | string;
    fileId: number;
    requestedPath: string | null;
    rootPath: string | null;
    resolvedPath: string | null;
  };
  stats: {
    nodeCount: number;
    dictionaryCount: number;
    arrayCount: number;
    dataValueCount: number;
    dataBytes: number;
    dataPreviewBytes: number;
    truncatedDataValues: number;
    maxDepth: number;
  };
  limits: {
    maxInputBytes: number;
    maxNodes: number;
    maxDepth: number;
    dataPreviewBytes: number;
    totalDataPreviewBytes: number;
    maxAggregateDataBytes: number;
  };
  value: PlistJsonValue;
}

export interface PlistViewerProps {
  fileId: number;
  path?: string;
  rootPath?: string;
}

type ViewMode = "tree" | "table" | "raw";

interface FlatRow {
  id: number;
  path: string;
  type: string;
  value: string;
}

const MAX_TREE_CHILDREN = 500;
const MAX_TABLE_ROWS = 10_000;

function isObject(value: PlistJsonValue): value is { [key: string]: PlistJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plistMarker(value: PlistJsonValue): { [key: string]: PlistJsonValue } | null {
  if (!isObject(value) || Object.keys(value).length !== 1 || !isObject(value.$plistValue)) {
    return null;
  }
  const marker = value.$plistValue;
  return marker.version === 1 && typeof marker.kind === "string" ? marker : null;
}

function typedValueKind(value: PlistJsonValue): string | null {
  const marker = plistMarker(value);
  return marker && typeof marker.kind === "string" ? marker.kind : null;
}

function containerValue(value: PlistJsonValue): PlistJsonValue[] | { [key: string]: PlistJsonValue } | null {
  const marker = plistMarker(value);
  if (marker?.kind === "dictionary" && isObject(marker.entries)) {
    return marker.entries;
  }
  if (!marker && (Array.isArray(value) || isObject(value))) {
    return value;
  }
  return null;
}

function valueType(value: PlistJsonValue): string {
  const typedKind = typedValueKind(value);
  if (typedKind) return typedKind;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isObject(value)) return "dictionary";
  return typeof value;
}

function truncatedText(value: string, maxLength = 320): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function valueSummary(value: PlistJsonValue): string {
  const marker = plistMarker(value);
  const typedKind = marker && typeof marker.kind === "string" ? marker.kind : null;
  if (typedKind && marker) {
    if (typedKind === "dictionary" && isObject(marker.entries)) {
      return `${Object.keys(marker.entries).length.toLocaleString()} key dictionary`;
    }
    if (typedKind === "data") {
      const length = typeof marker.byteLength === "number" ? marker.byteLength : 0;
      const truncated = marker.truncated === true ? ", preview truncated" : "";
      return `${formatBytes(length)} binary data${truncated}`;
    }
    if (typeof marker.decimal === "string") {
      return marker.decimal;
    }
    if (typeof marker.value === "string" || typeof marker.value === "number") {
      return String(marker.value);
    }
    return typedKind;
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return `${value.length.toLocaleString()} item array`;
  if (isObject(value)) return `${Object.keys(value).length.toLocaleString()} key dictionary`;
  if (typeof value === "string") return truncatedText(value);
  return String(value);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** order;
  return `${amount.toFixed(order === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[order]}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface TreeNodeProps {
  label: string;
  path: string;
  value: PlistJsonValue;
  depth: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ label, path, value, depth }) => {
  const typedKind = typedValueKind(value);
  const container = containerValue(value);
  const isContainer = container !== null;
  const isArrayContainer = Array.isArray(container);
  const [expanded, setExpanded] = useState(depth === 0);
  const entries = useMemo<[string, PlistJsonValue][]>(() => {
    if (!container || !expanded) return [];
    if (Array.isArray(container)) {
      return container.map((child, index) => [String(index), child]);
    }
    return Object.entries(container);
  }, [container, expanded]);
  const visibleEntries = entries.slice(0, MAX_TREE_CHILDREN);

  return (
    <Box>
      <Box
        sx={{
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          minHeight: 27,
          pl: `${depth * 16}px`,
          pr: 1,
        }}
      >
        {isContainer ? (
          <IconButton
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            onClick={() => setExpanded((current) => !current)}
            size="small"
            sx={{ height: 24, width: 24 }}
          >
            {expanded ? <ExpandMoreIcon fontSize="inherit" /> : <ChevronRightIcon fontSize="inherit" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 24, flexShrink: 0 }} />
        )}
        <Tooltip title={path} placement="top-start" enterDelay={600}>
          <Typography
            variant="caption"
            sx={{
              color: "text.primary",
              flex: "0 1 34%",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
              minWidth: 90,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Typography>
        </Tooltip>
        <Chip
          label={valueType(value)}
          size="small"
          variant="outlined"
          sx={{ height: 19, mx: 1, "& .MuiChip-label": { fontSize: 10, px: 0.7 } }}
        />
        <Typography
          variant="caption"
          sx={{
            color: typedKind === "date" ? "info.main" : "text.secondary",
            flex: 1,
            fontFamily: typedKind === "data" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {valueSummary(value)}
        </Typography>
      </Box>

      {visibleEntries.map(([key, child], index) => (
        <TreeNode
          key={`${path}/${key}/${index}`}
          label={isArrayContainer ? `[${key}]` : key}
          path={isArrayContainer ? `${path}[${key}]` : `${path}.${key}`}
          value={child}
          depth={depth + 1}
        />
      ))}
      {expanded && entries.length > MAX_TREE_CHILDREN && (
        <Alert severity="info" icon={false} sx={{ ml: `${(depth + 1) * 16}px`, py: 0 }}>
          This node has {entries.length.toLocaleString()} children. The tree shows the first{" "}
          {MAX_TREE_CHILDREN.toLocaleString()}; use Table or Raw JSON to inspect the remainder.
        </Alert>
      )}
    </Box>
  );
};

function flattenPlist(value: PlistJsonValue): { rows: FlatRow[]; truncated: boolean } {
  const rows: FlatRow[] = [];
  let truncated = false;

  const visit = (current: PlistJsonValue, path: string): void => {
    if (rows.length >= MAX_TABLE_ROWS) {
      truncated = true;
      return;
    }
    rows.push({
      id: rows.length,
      path,
      type: valueType(current),
      value: valueSummary(current),
    });

    const container = containerValue(current);
    if (Array.isArray(container)) {
      for (let index = 0; index < container.length; index += 1) {
        visit(container[index], `${path}[${index}]`);
        if (truncated) return;
      }
    } else if (container) {
      for (const [key, child] of Object.entries(container)) {
        visit(child, `${path}.${key}`);
        if (truncated) return;
      }
    }
  };

  visit(value, "$root");
  return { rows, truncated };
}

const TABLE_COLUMNS: GridColDef<FlatRow>[] = [
  {
    field: "path",
    headerName: "Key path",
    minWidth: 280,
    flex: 1.4,
    renderCell: ({ value }) => (
      <Typography
        variant="caption"
        sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {String(value)}
      </Typography>
    ),
  },
  { field: "type", headerName: "Type", width: 110 },
  { field: "value", headerName: "Value / summary", minWidth: 260, flex: 1 },
];

const PlistViewer: React.FC<PlistViewerProps> = ({ fileId, path, rootPath }) => {
  const theme = useTheme();
  const [document, setDocument] = useState<PlistDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("tree");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setError(null);
    setLoading(true);
    setMode("tree");

    void invoke<PlistDocument>("parse_plist_file", {
      fileId,
      path,
      rootPath,
    })
      .then((result) => {
        if (active) setDocument(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fileId, path, reloadToken, rootPath]);

  const flatData = useMemo(
    () => (document ? flattenPlist(document.value) : { rows: [], truncated: false }),
    [document],
  );
  const rawJson = useMemo(
    () => (document && mode === "raw" ? JSON.stringify(document.value, null, 2) : ""),
    [document, mode],
  );

  if (loading) {
    return (
      <Box sx={{ alignItems: "center", display: "flex", height: "100%", justifyContent: "center" }}>
        <CircularProgress size={22} />
        <Typography color="text.secondary" variant="body2" sx={{ ml: 1.5 }}>
          Parsing property list…
        </Typography>
      </Box>
    );
  }

  if (error || !document) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => setReloadToken((value) => value + 1)} size="small">
              Retry
            </Button>
          }
        >
          <Typography variant="subtitle2">Property list could not be parsed</Typography>
          <Typography component="div" variant="caption">
            {error ?? "The parser returned no document."}
          </Typography>
        </Alert>
      </Box>
    );
  }

  const sourcePath = document.source.resolvedPath ?? document.source.requestedPath ?? "Unknown path";

  return (
    <Paper
      elevation={0}
      square
      sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ alignItems: "center", borderBottom: 1, borderColor: "divider", minHeight: 38, px: 1 }}
      >
        <Chip color="primary" label={`${document.format.toUpperCase()} plist`} size="small" variant="outlined" />
        <Chip label={`Root: ${document.rootType}`} size="small" variant="outlined" />
        <Chip label={`${document.stats.nodeCount.toLocaleString()} nodes`} size="small" variant="outlined" />
        <Chip label={formatBytes(document.byteLength)} size="small" variant="outlined" />
        {document.stats.truncatedDataValues > 0 && (
          <Tooltip title={`Binary values are previewed up to ${formatBytes(document.limits.dataPreviewBytes)} each and ${formatBytes(document.limits.totalDataPreviewBytes)} per document. Full-value SHA-256 hashes are retained.`}>
            <Chip
              color="warning"
              label={`${document.stats.truncatedDataValues} data preview${document.stats.truncatedDataValues === 1 ? "" : "s"} truncated`}
              size="small"
              variant="outlined"
            />
          </Tooltip>
        )}
        <Box sx={{ flex: 1, minWidth: 12 }} />
        <ToggleButtonGroup
          exclusive
          onChange={(_, value: ViewMode | null) => value && setMode(value)}
          size="small"
          value={mode}
        >
          <ToggleButton aria-label="Tree view" value="tree">
            <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} /> Tree
          </ToggleButton>
          <ToggleButton aria-label="Table view" value="table">
            <TableRowsOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} /> Table
          </ToggleButton>
          <ToggleButton aria-label="Raw JSON view" value="raw">
            <DataObjectOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} /> Raw JSON
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", borderBottom: 1, borderColor: "divider", minHeight: 28, px: 1 }}
      >
        <Tooltip title={sourcePath}>
          <Typography
            color="text.secondary"
            variant="caption"
            sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            Source: {sourcePath}
          </Typography>
        </Tooltip>
        <Tooltip title={document.sha256}>
          <Typography
            color="text.secondary"
            variant="caption"
            sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            SHA-256 {document.sha256.slice(0, 12)}…
          </Typography>
        </Tooltip>
        <Typography color="text.secondary" variant="caption">
          Depth {document.stats.maxDepth}
        </Typography>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {mode === "tree" && (
          <Box sx={{ height: "100%", overflow: "auto" }}>
            <TreeNode depth={0} label="$root" path="$root" value={document.value} />
          </Box>
        )}
        {mode === "table" && (
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {flatData.truncated && (
              <Alert severity="info" icon={false} sx={{ borderRadius: 0, py: 0 }}>
                Table limited to the first {MAX_TABLE_ROWS.toLocaleString()} nodes. Raw JSON retains the complete node structure; large binary values remain bounded previews.
              </Alert>
            )}
            <DataGridPro
              columns={TABLE_COLUMNS}
              density="compact"
              disableColumnMenu
              disableRowSelectionOnClick
              hideFooter
              rows={flatData.rows}
              sx={{ border: 0, flex: 1, minHeight: 0 }}
            />
          </Box>
        )}
        {mode === "raw" && (
          <Editor
            height="100%"
            language="json"
            options={{
              automaticLayout: true,
              folding: true,
              fontSize: 12,
              minimap: { enabled: false },
              readOnly: true,
              renderWhitespace: "selection",
              scrollBeyondLastLine: false,
              wordWrap: "off",
            }}
            theme={theme.palette.mode === "dark" ? "vs-dark" : "light"}
            value={rawJson}
          />
        )}
      </Box>
    </Paper>
  );
};

export default PlistViewer;
