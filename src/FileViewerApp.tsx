// FileViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from "@mui/material";
import HexViewerWindow from "./HexViewerWindow";
import { HexViewerHandle } from "./HexViewer";
import RawViewer from "./RawViewer";
import { save } from "@tauri-apps/plugin-dialog";
import { PeViewer } from "./components/PeViewer";
import { PmlViewer } from "./components/PmlViewer";
import { listen } from "@tauri-apps/api/event";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  TextField,
} from "@mui/material";
import {
  DataGridPro,
  GridColDef,
} from "@mui/x-data-grid-pro";
import BottomActionBar from "./components/navigation/BottomActionBar";
import WindowsEventsTimeliner from "./components/evidences/investigate/categories/windows_events/WindowsEventsTimeliner";
type ViewerTab = "raw" | "hex" | "artefacts" | "sqlite" | "pe" | "pml" | "metadata";

type FileOpenPayload = {
  Identifier: number;
  fileId: number;
  fileSize: number;
  evidenceId: number;
  partitionId: number;
  path: string;
  evidenceRootPath?: string;
};

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import SqliteViewer from "./components/SqliteViewer";
import { invoke } from "@tauri-apps/api/core";
import { getEvidenceDb, getEvidenceDbPath } from "./dbutils/db";
import { getEvidence } from "./dbutils/sqlite";

dayjs.extend(utc);
dayjs.extend(timezone);
// optional default:
dayjs.tz.setDefault("UTC");

type MetadataRow = { id: string; property: string; value: string };

const METADATA_COLUMNS: GridColDef[] = [
  { field: "property", headerName: "Property", flex: 1, minWidth: 150 },
  { field: "value", headerName: "Value", flex: 2, minWidth: 200 },
];

const toSqliteUrl = (p: string) =>
  p.startsWith("sqlite:") ? p : `sqlite:${p}`;

const FileViewer: React.FC = () => {
  const hexRef = useRef<HexViewerHandle>(null);
  const [tab, setTab] = useState<ViewerTab>("raw");
  const [file, setFile] = useState<FileOpenPayload | null>(null);
  const [fileMetadata, setFileMetadata] = useState<MetadataRow[]>([]);

  const [isSqlite, setIsSqlite] = useState(false);

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      // 1. Read any immediately pending payload from localStorage (solves race condition on new window)
      const pendingPayloadStr = localStorage.getItem("pending_fileviewer_payload");
      if (pendingPayloadStr) {
        try {
          const payload = await hydratePayload(
            JSON.parse(pendingPayloadStr) as FileOpenPayload,
          );
          setFile(payload);
          void checkIfSqlite(
            payload.Identifier,
            payload.path,
            payload.fileId,
            payload.evidenceId,
            payload.partitionId,
            payload.evidenceRootPath,
          );
          // Clear it so we don't accidentally load it again on refresh
          localStorage.removeItem("pending_fileviewer_payload");
        } catch (err) {
          console.error("Failed to parse pending fileviewer payload from localStorage", err);
        }
      }

      // 2. Set up listener for subsequent open requests
      unlisten = await listen<FileOpenPayload>("message", (event) => {
        void (async () => {
          const payload = await hydratePayload(event.payload);
          setFile(payload);
          void checkIfSqlite(
            payload.Identifier,
            payload.path,
            payload.fileId,
            payload.evidenceId,
            payload.partitionId,
            payload.evidenceRootPath,
          );
        })();
      });
    })();

    return () => unlisten?.();
  }, []);

  const checkArtifacts = async (
    evidenceId: number,
    partitionId: number,
    fileDbId: number,
    path: string,
  ) => {
    // console.log(`[checkArtifacts] Called with dbId: ${dbId}, path: "${path}"`);
    // Reset
    setPeData(null);
    setPmlData(false);
    setEvtxData(false);

    // Simple heuristic based on extension or magic bytes (we can do better later)
    if (!path) {
      // console.warn("[checkArtifacts] No path provided, skipping.");
      return;
    }
    if (evidenceId <= 0 || partitionId <= 0 || fileDbId <= 0) {
      return;
    }

    console.log(
      `Checking artifacts for evidence=${evidenceId}, partition=${partitionId}, file=${fileDbId}, path=${path}`,
    );

    const evidenceDbPath = await getEvidenceDbPath(evidenceId);
    const dbPath = toSqliteUrl(evidenceDbPath);

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

    if (peResult.status === "fulfilled" && peResult.value) {
      setPeData(peResult.value);
    }

    if (pmlResult.status === "fulfilled" && pmlResult.value) {
      setPmlData(true);
    }

    if (evtxResult.status === "fulfilled" && evtxResult.value) {
      setEvtxData(true);
    }

    if (evtxResult.status === "fulfilled" && evtxResult.value) {
      setTab("artefacts");
    } else if (pmlResult.status === "fulfilled" && pmlResult.value) {
      setTab("pml");
    } else if (peResult.status === "fulfilled" && peResult.value) {
      setTab("pe");
    }
  };

  const checkIfSqlite = async (
    fsId: number,
    path: string,
    dbId: number,
    evidenceId: number,
    partitionId: number,
    evidenceRootPath?: string,
  ) => {
    try {
      // Read first 16 bytes for magic "SQLite format 3\0"
      const prefix = await invoke<string>("read_file_prefix", {
        fileId: fsId,
        length: 16,
        path: path,
        rootPath: evidenceRootPath,
      });
      if (prefix.startsWith("SQLite format 3")) {
        setIsSqlite(true);
        setTab("sqlite");
      } else {
        setIsSqlite(false);
        setTab("raw");
      }
    } catch (err) {
      console.error("Error checking SQLite magic:", err);
      setIsSqlite(false);
      setTab("raw");
    } finally {
      // Always check for artefacts regardless of file read success
      void checkArtifacts(evidenceId, partitionId, dbId, path);
    }
  };

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
      return;
    }
    (async () => {
      try {
        const db = await getEvidenceDb(file.evidenceId);
        const rows = await db.select<any[]>(
          "SELECT * FROM system_files WHERE id = $1",
          [file.fileId],
        );
        const record = rows[0];
        if (record) {
          const metaRows: MetadataRow[] = Object.entries(record)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => ({ id: k, property: k, value: String(v) }));
          setFileMetadata(metaRows);
        }
      } catch (err) {
        console.error("Failed to fetch file metadata:", err);
        setFileMetadata([]);
      }
    })();
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
          minWidth: 0
        }}>
        {/* Left: main viewer */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0
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
              {isSqlite && <Tab value="sqlite" label="SQLite Viewer" />}
              {peData && <Tab value="pe" label="PE Analysis" />}
              {pmlData && <Tab value="pml" label="Procmon Events" />}
              {evtxData && (
                <Tab value="artefacts" label="Parsed Artefacts" />
              )}
            </Tabs>
          </Paper>

          {/* Tab content */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              p: 1
            }}>
            {tab === "raw" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0
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
                    minHeight: 0
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
                    minHeight: 0
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
                    <Box sx={{
                      p: 2
                    }}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        No file loaded.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )}

            {tab === "metadata" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
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

            {tab === "artefacts" && evtxData && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box
                  sx={{
                    height: "100%",
                    minHeight: 0
                  }}>
                  {file ? (
                    <WindowsEventsTimeliner
                      evidenceId={file.evidenceId}
                      partitionId={file.partitionId}
                    />
                  ) : (
                    // <ArtefactObjectsGrid
                    //   evidenceId={file.evidenceId}
                    //   fileId={file.fileId}
                    //   height="100%"
                    //   persistKeyPrefix="thanatology:grid:fileviewer:artefacts"
                    // />
                    (<Box sx={{
                      p: 2
                    }}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        No file loaded.
                      </Typography>
                    </Box>)
                  )}
                </Box>
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
                p: 3
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
                  input: { readOnly: true }
                }}
              />
              <TextField
                label="SHA256"
                value={hashes.sha256}
                fullWidth
                size="small"
                variant="outlined"
                slotProps={{
                  input: { readOnly: true }
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
