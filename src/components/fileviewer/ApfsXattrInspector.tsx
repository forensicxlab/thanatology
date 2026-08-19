import * as React from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";

type JsonRecord = Record<string, unknown>;
type IntegerLike = number | string;

export type ApfsXattrStorageKind =
  | "embedded"
  | "data_stream"
  | "unknown"
  | string;

export interface ApfsXattrPreview {
  encoding: string;
  value: string;
  truncated: boolean;
}

export interface ApfsDecmpfsHeader {
  compressionType: number | null;
  algorithm: string | null;
  storage: string | null;
  uncompressedSize: number | null;
  raw: JsonRecord;
}

export interface ApfsXattrStorage {
  kind: ApfsXattrStorageKind;
  size: number | null;
  allocatedSize: number | null;
  objectId: IntegerLike | null;
  cryptoId: IntegerLike | null;
  preview: ApfsXattrPreview | null;
  raw: JsonRecord;
}

export interface ApfsXattrEntry {
  id: string;
  name: string;
  flags: string;
  declaredDataLength: number | null;
  storage: ApfsXattrStorage;
  decmpfs: ApfsDecmpfsHeader | null;
  raw: JsonRecord;
}

export interface ApfsInodeXField {
  id: string;
  fieldType: number | null;
  typeLabel: string;
  flags: string;
  byteLength: number;
  preview: string;
  raw: JsonRecord;
}

export interface ParsedApfsFileMetadata {
  fsIndex: IntegerLike;
  inodeId: IntegerLike;
  size: number | null;
  mode: IntegerLike | null;
  inode: JsonRecord;
  inodeXfields: ApfsInodeXField[];
  xattrs: ApfsXattrEntry[];
  compressed: boolean;
  raw: JsonRecord;
}

export type ApfsMetadataParseResult =
  | { state: "apfs"; value: ParsedApfsFileMetadata }
  | { state: "non_apfs" }
  | { state: "error"; message: string; rawText: string | null };

export interface ApfsXattrInspectorProps {
  /** `system_files.metadata`, either as the SQLite JSON string or decoded object. */
  metadata: unknown;
  /** Optional authoritative filesystem label (for example `Apple File System`). */
  filesystemType?: string | null;
  /** Lets a parent surface its metadata-query state without replacing this panel. */
  loading?: boolean;
  /** Parent query error. Metadata parsing errors are reported independently. */
  error?: string | null;
  height?: number | string;
}

const INODE_HAS_UNCOMPRESSED_SIZE = 0x0004_0000n;
const BSD_UF_COMPRESSED = 0x0000_0020n;

const XFIELD_NAMES: Record<number, string> = {
  1: "Snapshot XID",
  2: "Delta tree OID",
  3: "Document ID",
  4: "Name",
  5: "Previous file size",
  7: "Finder info",
  8: "Data stream",
  10: "Directory stats key",
  11: "Filesystem UUID",
  13: "Sparse bytes",
  14: "Device ID",
  15: "Purgeable flags",
  16: "Original sync-root ID",
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonValue(value: unknown):
  | { ok: true; value: unknown }
  | { ok: false; message: string; rawText: string | null } {
  if (typeof value !== "string") return { ok: true, value };
  const text = value.trim();
  if (!text) {
    return { ok: false, message: "The file metadata is empty.", rawText: value };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    return {
      ok: false,
      message: `The indexed metadata is not valid JSON: ${detail}`,
      rawText: value,
    };
  }
}

function integerLike(value: unknown): IntegerLike | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatFlags(value: unknown, width = 4): string {
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) {
    return value.toLowerCase();
  }
  const parsed = toBigInt(value);
  return parsed === null
    ? "—"
    : `0x${parsed.toString(16).padStart(width, "0")}`;
}

function toBigInt(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^(?:0x[0-9a-f]+|\d+)$/i.test(value.trim())) {
      return BigInt(value.trim());
    }
  } catch {
    // Fall through to the null result.
  }
  return null;
}

function hasFlag(value: unknown, flag: bigint): boolean {
  const parsed = toBigInt(value);
  return parsed !== null && (parsed & flag) !== 0n;
}

function normalizePreview(value: unknown): ApfsXattrPreview | null {
  if (!isRecord(value)) return null;
  // Preview content is evidence data, not a semantic label. Preserve it
  // byte-for-byte as serialized, including leading/trailing or all whitespace.
  if (typeof value.value !== "string") return null;
  return {
    encoding: textValue(value.encoding) ?? "unknown",
    value: value.value,
    truncated: value.truncated === true,
  };
}

function normalizeDecmpfs(value: unknown): ApfsDecmpfsHeader | null {
  if (!isRecord(value)) return null;
  return {
    compressionType: finiteNumber(value.compression_type),
    algorithm: textValue(value.algorithm),
    storage: textValue(value.storage),
    uncompressedSize: finiteNumber(value.uncompressed_size),
    raw: value,
  };
}

function normalizeStorage(value: unknown): ApfsXattrStorage {
  const raw = isRecord(value) ? value : {};
  return {
    kind: textValue(raw.kind) ?? "unknown",
    size: finiteNumber(raw.size),
    allocatedSize: finiteNumber(raw.allocated_size),
    objectId: integerLike(raw.object_id),
    cryptoId: integerLike(raw.crypto_id),
    preview: normalizePreview(raw.preview),
    raw,
  };
}

function normalizeXattr(value: unknown, index: number): ApfsXattrEntry {
  const raw = isRecord(value) ? value : { value };
  const name = textValue(raw.name) ?? `(unnamed xattr ${index + 1})`;
  return {
    id: `${index}:${name}`,
    name,
    flags: formatFlags(raw.flags),
    declaredDataLength: finiteNumber(raw.declared_data_len),
    storage: normalizeStorage(raw.storage),
    decmpfs: normalizeDecmpfs(raw.decmpfs),
    raw,
  };
}

function bytesFromUnknown(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => finiteNumber(entry))
    .filter((entry): entry is number => entry !== null && entry >= 0 && entry <= 255)
    .map((entry) => Math.trunc(entry));
}

function bytesPreview(bytes: number[], preferText: boolean): string {
  const bounded = bytes.slice(0, 48);
  if (preferText && bounded.length > 0) {
    try {
      const end = bounded.indexOf(0);
      const textBytes = end >= 0 ? bounded.slice(0, end) : bounded;
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(textBytes),
      );
      if (decoded && [...decoded].every((character) => !/\p{Cc}/u.test(character))) {
        return bytes.length > bounded.length ? `${decoded}…` : decoded;
      }
    } catch {
      // Use the lossless hexadecimal representation below.
    }
  }
  const hex = bounded.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > bounded.length ? `${hex} …` : hex || "—";
}

function normalizeXfield(value: unknown, index: number): ApfsInodeXField {
  const raw = isRecord(value) ? value : { value };
  const fieldType = finiteNumber(raw.field_type);
  const bytes = bytesFromUnknown(raw.data);
  return {
    id: `${index}:${fieldType ?? "unknown"}`,
    fieldType,
    typeLabel: fieldType === null ? "Unknown" : (XFIELD_NAMES[fieldType] ?? "Unknown"),
    flags: formatFlags(raw.flags, 2),
    byteLength: bytes.length,
    preview: bytesPreview(bytes, fieldType === 4),
    raw,
  };
}

/** Normalize the APFS file metadata emitted by `ApfsFileRecord::to_json`. */
export function parseApfsFileMetadata(
  metadata: unknown,
  filesystemType?: string | null,
): ApfsMetadataParseResult {
  if (
    filesystemType &&
    !/(?:^|\b)apfs(?:\b|$)|apple file system/i.test(filesystemType)
  ) {
    return { state: "non_apfs" };
  }

  const decoded = parseJsonValue(metadata);
  if (!decoded.ok) return { state: "error", ...decoded };

  // Accept either the direct metadata value or a complete `system_files` row.
  let candidate = decoded.value;
  if (isRecord(candidate) && !isRecord(candidate.inode) && "metadata" in candidate) {
    const nested = parseJsonValue(candidate.metadata);
    if (!nested.ok) return { state: "error", ...nested };
    candidate = nested.value;
  }

  if (!isRecord(candidate)) {
    return {
      state: "error",
      message: "The indexed metadata must be a JSON object.",
      rawText: typeof metadata === "string" ? metadata : null,
    };
  }

  const inode = isRecord(candidate.inode) ? candidate.inode : null;
  const fsIndex = integerLike(candidate.fs_index);
  const inodeId = integerLike(candidate.inode_id);
  if (inode === null || fsIndex === null || inodeId === null) {
    return { state: "non_apfs" };
  }

  if (candidate.xattrs !== undefined && !Array.isArray(candidate.xattrs)) {
    return {
      state: "error",
      message: "The APFS metadata contains an invalid xattrs field (expected an array).",
      rawText: typeof metadata === "string" ? metadata : null,
    };
  }

  const xattrs = Array.isArray(candidate.xattrs)
    ? candidate.xattrs.map(normalizeXattr)
    : [];
  const xfields = Array.isArray(inode.xfields)
    ? inode.xfields.map(normalizeXfield)
    : [];
  const compressed =
    xattrs.some((entry) => entry.name === "com.apple.decmpfs") ||
    hasFlag(inode.bsd_flags, BSD_UF_COMPRESSED) ||
    hasFlag(inode.internal_flags, INODE_HAS_UNCOMPRESSED_SIZE);

  return {
    state: "apfs",
    value: {
      fsIndex,
      inodeId,
      size: finiteNumber(candidate.size),
      mode: integerLike(candidate.mode),
      inode,
      inodeXfields: xfields,
      xattrs,
      compressed,
      raw: candidate,
    },
  };
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [status, setStatus] = React.useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus("idle"), 1800);
  };

  const title =
    status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
  return (
    <Tooltip title={title}>
      <IconButton size="small" onClick={() => void copy()} aria-label={label}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const pretty = React.useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <Paper
      variant="outlined"
      sx={{ bgcolor: "background.default", overflow: "auto", minHeight: 0 }}
    >
      <Box
        component="pre"
        sx={{ m: 0, p: 1.25, fontSize: 11.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}
      >
        {pretty}
      </Box>
    </Paper>
  );
}

function InodeDetail({ metadata }: { metadata: ParsedApfsFileMetadata }) {
  const inode = metadata.inode;
  const dstream = isRecord(inode.dstream) ? inode.dstream : null;
  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 1.25,
        }}
      >
        <DetailField label="Inode ID" value={metadata.inodeId} />
        <DetailField label="Private ID" value={display(inode.private_id)} />
        <DetailField label="Parent ID" value={display(inode.parent_id)} />
        <DetailField label="Mode" value={display(metadata.mode)} />
        <DetailField label="Internal flags" value={formatFlags(inode.internal_flags, 8)} />
        <DetailField label="BSD flags" value={formatFlags(inode.bsd_flags, 8)} />
        <DetailField label="Protection class" value={display(inode.default_protection_class)} />
        <DetailField label="Uncompressed size" value={formatBytes(finiteNumber(inode.uncompressed_size))} />
        {dstream && (
          <>
            <DetailField label="Data-stream size" value={formatBytes(finiteNumber(dstream.size))} />
            <DetailField
              label="Allocated size"
              value={formatBytes(finiteNumber(dstream.alloced_size))}
            />
            <DetailField label="Crypto ID" value={display(dstream.default_crypto_id)} />
          </>
        )}
      </Box>

      <Divider />
      <Typography variant="subtitle2">
        Inode extended fields ({metadata.inodeXfields.length})
      </Typography>
      {metadata.inodeXfields.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No inode extended fields were indexed for this record.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="APFS inode extended fields">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Flags</TableCell>
                <TableCell align="right">Bytes</TableCell>
                <TableCell>Preview</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {metadata.inodeXfields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell>
                    <Typography variant="body2">{field.typeLabel}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {field.fieldType ?? "unknown"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{field.flags}</TableCell>
                  <TableCell align="right">{field.byteLength}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
                    {field.preview}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

function AttributeDetail({ entry }: { entry: ApfsXattrEntry }) {
  const preview = entry.storage.preview;
  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
        useFlexGap
      >
        <Typography variant="subtitle2" sx={{ fontFamily: "monospace" }}>
          {entry.name}
        </Typography>
        <Chip size="small" variant="outlined" label={entry.storage.kind} />
      </Stack>

      {entry.decmpfs && (
        <Alert severity="info" variant="outlined">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            AppleFSCompression
          </Typography>
          <Typography variant="caption" component="div">
            {entry.decmpfs.algorithm ?? "unknown algorithm"} · {entry.decmpfs.storage ?? "unknown storage"}
            {entry.decmpfs.uncompressedSize !== null
              ? ` · ${formatBytes(entry.decmpfs.uncompressedSize)} uncompressed`
              : ""}
            {entry.decmpfs.compressionType !== null
              ? ` · type ${entry.decmpfs.compressionType}`
              : ""}
          </Typography>
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
          gap: 1.25,
        }}
      >
        <DetailField label="Record flags" value={entry.flags} />
        <DetailField
          label="Declared data length"
          value={formatBytes(entry.declaredDataLength)}
        />
        <DetailField label="Stored size" value={formatBytes(entry.storage.size)} />
        <DetailField
          label="Allocated size"
          value={formatBytes(entry.storage.allocatedSize)}
        />
        <DetailField label="Stream object ID" value={display(entry.storage.objectId)} />
        <DetailField label="Crypto ID" value={display(entry.storage.cryptoId)} />
      </Box>

      <Divider />
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2">Indexed value preview</Typography>
        {preview && <CopyButton text={preview.value} label="Copy xattr preview" />}
      </Stack>
      {preview ? (
        <Paper
          variant="outlined"
          sx={{ bgcolor: "background.default", p: 1.25, overflow: "auto" }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.5 }}
          >
            {preview.encoding.toUpperCase()}
            {preview.truncated ? " · first 256 bytes" : " · complete indexed value"}
          </Typography>
          <Box
            component="pre"
            sx={{ m: 0, fontSize: 11.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {preview.value}
          </Box>
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Stream-backed attributes expose their descriptor here; their full value is read lazily
          by the filesystem engine and is not stored in the index.
        </Typography>
      )}
    </Stack>
  );
}

export default function ApfsXattrInspector({
  metadata,
  filesystemType,
  loading = false,
  error = null,
  height = "100%",
}: ApfsXattrInspectorProps) {
  const parsed = React.useMemo(
    () => parseApfsFileMetadata(metadata, filesystemType),
    [metadata, filesystemType],
  );
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [detailTab, setDetailTab] = React.useState<"attribute" | "inode" | "raw">(
    "attribute",
  );

  const fingerprint =
    parsed.state === "apfs"
      ? `${parsed.value.fsIndex}:${parsed.value.inodeId}:${parsed.value.xattrs
          .map((entry) => entry.name)
          .join("\u0000")}`
      : parsed.state;
  React.useEffect(() => {
    setSelectedIndex(0);
    setDetailTab(parsed.state === "apfs" && parsed.value.xattrs.length === 0 ? "inode" : "attribute");
  }, [fingerprint, parsed]);

  if (loading) {
    return (
      <Box
        sx={{ height, display: "grid", placeItems: "center", color: "text.secondary" }}
        aria-label="Loading APFS extended attributes"
      >
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={22} />
          <Typography variant="body2">Loading indexed filesystem metadata…</Typography>
        </Stack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height, p: 1 }}>
        <Alert severity="error">
          <Typography variant="subtitle2">Could not load file metadata</Typography>
          <Typography variant="body2">{error}</Typography>
        </Alert>
      </Box>
    );
  }

  if (parsed.state === "error") {
    return (
      <Box sx={{ height, p: 1, overflow: "auto" }}>
        <Alert severity="error">
          <Typography variant="subtitle2">Metadata could not be inspected</Typography>
          <Typography variant="body2">{parsed.message}</Typography>
        </Alert>
        {parsed.rawText && (
          <Paper variant="outlined" sx={{ mt: 1, p: 1, bgcolor: "background.default" }}>
            <Typography variant="caption" color="text.secondary">
              Raw metadata
            </Typography>
            <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11.5, whiteSpace: "pre-wrap" }}>
              {parsed.rawText.slice(0, 4096)}
              {parsed.rawText.length > 4096 ? "\n…" : ""}
            </Box>
          </Paper>
        )}
      </Box>
    );
  }

  if (parsed.state === "non_apfs") {
    return (
      <Box sx={{ height, p: 1 }}>
        <Alert severity="info" variant="outlined">
          <Typography variant="subtitle2">APFS metadata unavailable</Typography>
          <Typography variant="body2">
            Extended attributes are currently indexed for APFS records. This file’s metadata does
            not match the APFS inode shape.
          </Typography>
        </Alert>
      </Box>
    );
  }

  const value = parsed.value;
  const selected = value.xattrs[selectedIndex] ?? value.xattrs[0] ?? null;
  const counts = value.xattrs.reduce(
    (accumulator, entry) => {
      if (entry.storage.kind === "embedded") accumulator.embedded += 1;
      else if (entry.storage.kind === "data_stream") accumulator.stream += 1;
      else accumulator.unknown += 1;
      return accumulator;
    },
    { embedded: 0, stream: 0, unknown: 0 },
  );
  const rawJson = JSON.stringify(value.raw, null, 2);

  return (
    <Box
      sx={{
        height,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Paper
        elevation={0}
        square
        sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">APFS extended attributes</Typography>
            <Typography variant="caption" color="text.secondary">
              Volume {value.fsIndex} · inode {value.inodeId}
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
            useFlexGap
          >
            <Chip size="small" label={`${value.xattrs.length} xattr${value.xattrs.length === 1 ? "" : "s"}`} />
            {counts.embedded > 0 && (
              <Chip size="small" variant="outlined" label={`${counts.embedded} embedded`} />
            )}
            {counts.stream > 0 && (
              <Chip size="small" variant="outlined" label={`${counts.stream} stream`} />
            )}
            {counts.unknown > 0 && (
              <Chip size="small" variant="outlined" color="warning" label={`${counts.unknown} unknown`} />
            )}
            {value.compressed && (
              <Chip size="small" variant="outlined" color="info" label="Compressed" />
            )}
            <CopyButton text={rawJson} label="Copy complete APFS metadata JSON" />
          </Stack>
        </Stack>
      </Paper>

      {value.xattrs.length === 0 ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
          <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
            No extended attributes were indexed for this APFS inode.
          </Alert>
          <Paper variant="outlined">
            <InodeDetail metadata={value} />
          </Paper>
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(310px, 42%) minmax(0, 1fr)" },
            gridTemplateRows: { xs: "minmax(210px, 42%) minmax(0, 1fr)", md: "1fr" },
            gap: 1,
            p: 1,
          }}
        >
          <TableContainer component={Paper} variant="outlined" sx={{ minHeight: 0 }}>
            <Table stickyHeader size="small" aria-label="APFS extended attributes">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Storage</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Flags</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {value.xattrs.map((entry, index) => (
                  <TableRow
                    hover
                    selected={index === selectedIndex}
                    key={entry.id}
                    onClick={() => {
                      setSelectedIndex(index);
                      setDetailTab("attribute");
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        title={entry.name}
                        sx={{ fontFamily: "monospace" }}
                      >
                        {entry.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{entry.storage.kind}</TableCell>
                    <TableCell align="right">{formatBytes(entry.storage.size)}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>{entry.flags}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Paper
            variant="outlined"
            sx={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}
          >
            <Tabs
              value={detailTab}
              onChange={(_, next: "attribute" | "inode" | "raw") => setDetailTab(next)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ minHeight: 36, borderBottom: 1, borderColor: "divider" }}
            >
              <Tab value="attribute" label="Attribute" sx={{ minHeight: 36, py: 0 }} />
              <Tab value="inode" label={`Inode (${value.inodeXfields.length} xfields)`} sx={{ minHeight: 36, py: 0 }} />
              <Tab value="raw" label="Raw JSON" sx={{ minHeight: 36, py: 0 }} />
            </Tabs>
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {detailTab === "attribute" && selected && <AttributeDetail entry={selected} />}
              {detailTab === "inode" && <InodeDetail metadata={value} />}
              {detailTab === "raw" && selected && (
                <Stack spacing={1.5} sx={{ p: 1.5 }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Typography variant="subtitle2">Selected attribute JSON</Typography>
                    <CopyButton
                      text={JSON.stringify(selected.raw, null, 2)}
                      label="Copy selected xattr JSON"
                    />
                  </Stack>
                  <JsonBlock value={selected.raw} />
                  <Stack
                    direction="row"
                    sx={{ alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Typography variant="subtitle2">Complete APFS record JSON</Typography>
                    <CopyButton text={rawJson} label="Copy complete APFS metadata JSON" />
                  </Stack>
                  <JsonBlock value={value.raw} />
                </Stack>
              )}
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}
