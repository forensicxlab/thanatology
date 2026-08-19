// FileViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import { DataGridPro, GridColDef } from "@mui/x-data-grid-pro";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

import HexViewerWindow from "./HexViewerWindow";
import { HexViewerHandle } from "./HexViewer";
import RawViewer from "./RawViewer";
import { PeViewer } from "./components/PeViewer";
import { PmlViewer } from "./components/PmlViewer";
import BottomActionBar from "./components/navigation/BottomActionBar";
import WindowsEventsTimeliner from "./components/evidences/investigate/categories/windows_events/WindowsEventsTimeliner";
import ArtefactObjectsGrid from "./components/evidences/investigate/categories/files/ArtefactObjectsGrid";
import ApfsXattrInspector, {
  parseApfsFileMetadata,
} from "./components/fileviewer/ApfsXattrInspector";
import PlistViewer from "./components/fileviewer/PlistViewer";
import SqliteViewer from "./components/SqliteViewer";
import { getEvidenceDb, getEvidenceDbPath } from "./dbutils/db";
import {
  countParsedArtefactObjects,
  getEvidence,
} from "./dbutils/sqlite";

type ViewerTab =
  | "raw"
  | "hex"
  | "artefacts"
  | "objects"
  | "plist"
  | "sqlite"
  | "pe"
  | "pml"
  | "metadata"
  | "xattrs";

type FileOpenPayload = {
  Identifier: number;
  fileId: number;
  fileSize: number;
  evidenceId: number;
  partitionId: number;
  path: string;
  evidenceRootPath?: string;
};

dayjs.extend(utc);
dayjs.extend(timezone);
// optional default:
dayjs.tz.setDefault("UTC");

type MetadataRow = { id: string; property: string; value: string };
type IndexedFileRecord = Record<string, unknown> & { metadata?: unknown };

type ArtifactInspection = {
  pe: unknown | null;
  pml: boolean;
  evtx: boolean;
};

const METADATA_COLUMNS: GridColDef[] = [
  { field: "property", headerName: "Property", flex: 1, minWidth: 150 },
  { field: "value", headerName: "Value", flex: 2, minWidth: 200 },
];

const toSqliteUrl = (p: string) =>
  p.startsWith("sqlite:") ? p : `sqlite:${p}`;

const metadataDisplayValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const FileViewer: React.FC = () => {
  const hexRef = useRef<HexViewerHandle>(null);
  const openPayloadSequence = useRef(0);
  const inspectionSequence = useRef(0);
  const [tab, setTab] = useState<ViewerTab>("raw");
  const [file, setFile] = useState<FileOpenPayload | null>(null);
  const [fileMetadata, setFileMetadata] = useState<MetadataRow[]>([]);
  const [indexedMetadata, setIndexedMetadata] = useState<unknown>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [isSqlite, setIsSqlite] = useState(false);
  const [isPlist, setIsPlist] = useState(false);
  const [parsedObjectCount, setParsedObjectCount] = useState(0);

  // Hash Dialog State
  const [hashOpen, setHashOpen] = useState(false);
  const [hashLoading, setHashLoading] = useState(false);
  const [hashes, setHashes] = useState<{ md5: string; sha256: string }>({
    md5: "",
    sha256: "",
  });

  // Artefacts data
  const [peData, setPeData] = useState<any>(null);
  const [pmlData, setPmlData] = useState<boolean>(false);
  const [evtxData, setEvtxData] = useState<boolean>(false);

  const apfsMetadata = useMemo(
    () => parseApfsFileMetadata(indexedMetadata),
    [indexedMetadata],
  );
  const hasApfsMetadata = apfsMetadata.state === "apfs";

  async function hydratePayload(
    payload: FileOpenPayload,
  ): Promise<FileOpenPayload> {
    if (payload.evidenceRootPath) {
      return payload;
    }

    try {
      const evidence = await getEvidence(null, String(payload.evidenceId));
      if (evidence?.type === "Folder" && typeof evidence.path === "string") {
        return {
          ...payload,
          evidenceRootPath: evidence.path,
        };
      }
    } catch (error) {
      console.error("Failed to resolve evidence metadata for file viewer:", error);
    }

    return payload;
  }

  async function openPayload(rawPayload: FileOpenPayload) {
    // Allocate the sequence before hydration so a slow, older folder-evidence
    // lookup cannot overwrite a newer open request.
    const requestId = ++openPayloadSequence.current;
    const payload = await hydratePayload(rawPayload);
    if (openPayloadSequence.current !== requestId) return;

    setFile(payload);
    void inspectFile(payload);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let receivedMessage = false;

    (async () => {
      // Install the listener before awaiting pending-payload hydration so a
      // second open request cannot be lost during window startup.
      const removeListener = await listen<FileOpenPayload>("message", (event) => {
        receivedMessage = true;
        void openPayload(event.payload);
      });
      if (disposed) {
        removeListener();
        return;
      }
      unlisten = removeListener;

      // Read any immediately pending payload from localStorage (solves the
      // message race when a new FileViewer window is first created).
      const pendingPayloadStr = localStorage.getItem("pending_fileviewer_payload");
      if (pendingPayloadStr) {
        try {
          const payload = JSON.parse(pendingPayloadStr) as FileOpenPayload;
          // Clear synchronously so refreshes cannot replay a payload whose
          // folder-evidence hydration is still in flight.
          localStorage.removeItem("pending_fileviewer_payload");
          // A live message is newer than the launch-time fallback.
          if (!receivedMessage) void openPayload(payload);
        } catch (err) {
          console.error("Failed to parse pending fileviewer payload from localStorage", err);
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const inspectArtifacts = async (
    evidenceId: number,
    partitionId: number,
    fileDbId: number,
    path: string,
  ): Promise<ArtifactInspection> => {
    const empty: ArtifactInspection = { pe: null, pml: false, evtx: false };
    if (!path) {
      return empty;
    }
    if (evidenceId <= 0 || partitionId <= 0 || fileDbId <= 0) {
      return empty;
    }

    console.log(
      `Checking artifacts for evidence=${evidenceId}, partition=${partitionId}, file=${fileDbId}, path=${path}`,
    );

    let dbPath: string;
    try {
      dbPath = toSqliteUrl(await getEvidenceDbPath(evidenceId));
    } catch (error) {
      console.error("Unable to resolve evidence database for FileViewer:", error);
      return empty;
    }

    const [peResult, pmlResult, evtxResult] = await Promise.allSettled([
      invoke("parse_pe", {
        dbPath,
        evidenceId,
        partitionId,
        fileId: fileDbId,
      }),
      invoke<boolean>("has_pml_data", {
        dbPath,
        evidenceId,
        partitionId,
        fileId: fileDbId,
      }),
      invoke<boolean>("has_evtx_data", {
        dbPath,
        evidenceId,
        partitionId,
        fileId: fileDbId,
      }),
    ]);

    return {
      pe:
        peResult.status === "fulfilled" && peResult.value
          ? peResult.value
          : null,
      pml: pmlResult.status === "fulfilled" && pmlResult.value,
      evtx: evtxResult.status === "fulfilled" && evtxResult.value,
    };
  }

  async function inspectFile(payload: FileOpenPayload) {
    const requestId = ++inspectionSequence.current;

    setTab("raw");
    setIsSqlite(false);
    setIsPlist(false);
    setParsedObjectCount(0);
    setPeData(null);
    setPmlData(false);
    setEvtxData(false);

    const [prefixResult, objectCountResult, artifactResult] =
      await Promise.allSettled([
        invoke<string>("read_file_prefix", {
          fileId: payload.Identifier,
          length: 4096,
          path: payload.path,
          rootPath: payload.evidenceRootPath,
        }),
        countParsedArtefactObjects({
          evidenceId: payload.evidenceId,
          partitionId: payload.partitionId,
          fileId: payload.fileId,
        }),
        inspectArtifacts(
          payload.evidenceId,
          payload.partitionId,
          payload.fileId,
          payload.path,
        ),
      ]);

    if (inspectionSequence.current !== requestId) return;

    const prefix =
      prefixResult.status === "fulfilled" ? prefixResult.value : "";
    if (prefixResult.status === "rejected") {
      console.error("Error reading file signature:", prefixResult.reason);
    }

    const sqlite = prefix.startsWith("SQLite format 3");
    const normalizedPrefix = prefix.replace(/^\uFEFF/, "").trimStart();
    const plist =
      prefix.startsWith("bplist00") ||
      /<plist(?:\s|>)/.test(normalizedPrefix);
    const objectCount =
      objectCountResult.status === "fulfilled" ? objectCountResult.value : 0;
    const artifacts =
      artifactResult.status === "fulfilled"
        ? artifactResult.value
        : { pe: null, pml: false, evtx: false };

    setIsSqlite(sqlite);
    setIsPlist(plist);
    setParsedObjectCount(objectCount);
    setPeData(artifacts.pe);
    setPmlData(artifacts.pml);
    setEvtxData(artifacts.evtx);

    if (artifacts.evtx) setTab("artefacts");
    else if (artifacts.pml) setTab("pml");
    else if (artifacts.pe) setTab("pe");
    else if (sqlite) setTab("sqlite");
    else if (plist) setTab("plist");
    else if (objectCount > 0) setTab("objects");
    else setTab("raw");
  }

  const handleDump = async () => {
    if (!file) return;
    try {
      const path = await save({
        defaultPath: "dumped_file.bin",
      });
      if (path) {
        await invoke("dump_file_to_disk", {
          fileId: file.Identifier,
          destinationPath: path,
          path: file.path,
          rootPath: file.evidenceRootPath,
        });
        // Ideally show a snackbar here
      }
    } catch (err) {
      console.error("Failed to dump file:", err);
    }
  };

  const handleHash = async () => {
    if (!file) return;
    setHashOpen(true);
    setHashLoading(true);
    setHashes({ md5: "", sha256: "" });
    try {
      const [md5, sha256] = await Promise.all([
        invoke<string>("compute_hash", {
          fileId: file.Identifier,
          algorithm: "md5",
          path: file.path,
          rootPath: file.evidenceRootPath,
        }),
        invoke<string>("compute_hash", {
          fileId: file.Identifier,
          algorithm: "sha256",
          path: file.path,
          rootPath: file.evidenceRootPath,
        }),
      ]);
      setHashes({ md5, sha256 });
    } catch (err) {
      console.error("Failed to compute hash:", err);
    } finally {
      setHashLoading(false);
    }
  };

  useEffect(() => {
    if (!file) {
      setFileMetadata([]);
      setIndexedMetadata(null);
      setMetadataLoading(false);
      setMetadataError(null);
      return;
    }

    let cancelled = false;
    setFileMetadata([]);
    setIndexedMetadata(null);
    setMetadataLoading(true);
    setMetadataError(null);

    (async () => {
      try {
        const db = await getEvidenceDb(file.evidenceId);
        const rows = await db.select<IndexedFileRecord[]>(
          `SELECT *
           FROM system_files
           WHERE id = $1 AND evidence_id = $2 AND partition_id = $3`,
          [file.fileId, file.evidenceId, file.partitionId],
        );
        const record = rows[0];
        if (cancelled) return;
        if (record) {
          const metaRows: MetadataRow[] = Object.entries(record)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => ({
              id: k,
              property: k,
              value: metadataDisplayValue(v),
            }));
          setFileMetadata(metaRows);
          setIndexedMetadata(record.metadata ?? null);
        } else {
          setMetadataError("The indexed file record could not be found.");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch file metadata:", error);
        setFileMetadata([]);
        setIndexedMetadata(null);
        setMetadataError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        pb: "28px",
        boxSizing: "border-box",
      }}>
      {/* Action toolbar */}
      <Paper
        elevation={0}
        square
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="subtitle2" sx={{ mr: 1 }}>
            File Viewer
          </Typography>

          <Divider orientation="vertical" flexItem />

          <Button size="small" variant="contained" onClick={handleDump}>
            Dump
          </Button>
          <Button size="small" variant="outlined" onClick={handleHash}>
            Compute Hash
          </Button>
        </Toolbar>
      </Paper>
      {/* Main content row */}
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}>
        {/* Left: main viewer */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}>
          {/* Tabs */}
          <Paper
            elevation={0}
            square
            sx={{ borderBottom: 1, borderColor: "divider" }}
          >
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab value="raw" label="RawViewer" />
              <Tab value="hex" label="HexViewer" />
              <Tab value="metadata" label="File Metadata" />
              {hasApfsMetadata && (
                <Tab value="xattrs" label="Extended Attributes" />
              )}
              {isPlist && <Tab value="plist" label="Property List" />}
              {isSqlite && <Tab value="sqlite" label="SQLite Viewer" />}
              {peData && <Tab value="pe" label="PE Analysis" />}
              {pmlData && <Tab value="pml" label="Procmon Events" />}
              {evtxData && (
                <Tab value="artefacts" label="EVTX Timeline" />
              )}
              {parsedObjectCount > 0 && (
                <Tab
                  value="objects"
                  label={`Parsed Objects (${parsedObjectCount.toLocaleString()})`}
                />
              )}
            </Tabs>
          </Paper>

          {/* Tab content */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              p: 1,
            }}>
            {tab === "raw" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0,
                  }}>
                  {file && (
                    <RawViewer
                      fileId={file.Identifier}
                      fileSize={file.fileSize}
                      path={file.path}
                      rootPath={file.evidenceRootPath}
                      height={"100%"}
                      language="plaintext"
                      theme="vs-dark"
                    />
                  )}
                </Box>
              </Paper>
            )}

            {tab === "sqlite" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0,
                  }}>
                  {file && (
                    <SqliteViewer
                      fileId={file.Identifier}
                      path={file.path}
                      rootPath={file.evidenceRootPath}
                    />
                  )}
                </Box>
              </Paper>
            )}

            {tab === "plist" && isPlist && (
              <Paper
                variant="outlined"
                sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
              >
                {file && (
                  <PlistViewer
                    fileId={file.Identifier}
                    path={file.path}
                    rootPath={file.evidenceRootPath}
                  />
                )}
              </Paper>
            )}

            {tab === "pe" && peData && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <PeViewer data={peData} />
              </Paper>
            )}

            {tab === "pml" && pmlData && file && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <PmlViewer
                  evidenceId={file.evidenceId}
                  partitionId={file.partitionId}
                  fileId={file.fileId}
                />
              </Paper>
            )}

            {tab === "hex" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0,
                  }}>
                  {file ? (
                    <HexViewerWindow
                      ref={hexRef}
                      fileId={file.Identifier}
                      fileSize={file.fileSize}
                      path={file.path}
                      rootPath={file.evidenceRootPath}
                    />
                  ) : (
                    <Box sx={{ p: 2 }}>
                      <Typography
                        variant="body2"
                        sx={{ color: "text.secondary" }}
                      >
                        No file loaded.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )}

            {tab === "metadata" && (
              <Paper
                variant="outlined"
                sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
              >
                <DataGridPro
                  rows={fileMetadata}
                  columns={METADATA_COLUMNS}
                  density="compact"
                  disableColumnFilter
                  disableColumnMenu
                  hideFooter
                  style={{ height: "100%", border: "none" }}
                />
              </Paper>
            )}

            {tab === "xattrs" && hasApfsMetadata && (
              <Paper
                variant="outlined"
                sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
              >
                <ApfsXattrInspector
                  metadata={indexedMetadata}
                  loading={metadataLoading}
                  error={metadataError}
                  height="100%"
                />
              </Paper>
            )}

            {tab === "artefacts" && evtxData && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0,
                  }}>
                  {file ? (
                    <WindowsEventsTimeliner
                      evidenceId={file.evidenceId}
                      partitionId={file.partitionId}
                    />
                  ) : (
                    <Box sx={{ p: 2 }}>
                      <Typography
                        variant="body2"
                        sx={{ color: "text.secondary" }}
                      >
                        No file loaded.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )}

            {tab === "objects" && parsedObjectCount > 0 && file && (
              <Paper
                variant="outlined"
                sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
              >
                <ArtefactObjectsGrid
                  evidenceId={file.evidenceId}
                  partitionId={file.partitionId}
                  fileId={file.fileId}
                  height="100%"
                  persistKeyPrefix="thanatology:grid:fileviewer:objects"
                />
              </Paper>
            )}
          </Box>
        </Box>
      </Box>
      <Dialog
        open={hashOpen}
        onClose={() => setHashOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>File Hashes</DialogTitle>
        <DialogContent>
          {hashLoading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                p: 3,
              }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="MD5"
                value={hashes.md5}
                fullWidth
                size="small"
                variant="outlined"
                slotProps={{
                  input: { readOnly: true },
                }}
              />
              <TextField
                label="SHA256"
                value={hashes.sha256}
                fullWidth
                size="small"
                variant="outlined"
                slotProps={{
                  input: { readOnly: true },
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHashOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <BottomActionBar />
    </Box>
  );
};

export default FileViewer;
