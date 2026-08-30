import * as React from "react";
import Grid from "@mui/material/Grid";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SearchIcon from "@mui/icons-material/Search";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import ShieldIcon from "@mui/icons-material/Shield";
import MemoryIcon from "@mui/icons-material/Memory";
import { DataGridPro, GridColDef } from "@mui/x-data-grid-pro";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useSnackbar } from "../SnackbarProvider";

type ModuleId = "pslist" | "triage" | "bitlocker" | "memdump";
type LogLevel = "info" | "warning" | "success" | "error";
type MemorySessionStatusLevel = LogLevel | "warn";

type MemoryGridColumn = {
  field: string;
  headerName: string;
  minWidth: number;
  flex: number;
  type: "string" | "number";
};

type MemoryModuleDescriptor = {
  id: ModuleId;
  name: string;
  description: string;
  supportsProcessFilter: boolean;
  supportsAddressRange: boolean;
  requiresOutputPath: boolean;
};

type OsKind = "windows" | "linux";

type DiscoverMemoryDmaResponse = {
  healthy: boolean;
  connector: string;
  connectorType: "pcileech";
  maxAddressHex: string;
  physicalMemoryEndHex: string;
  sampleProcessCount: number;
  availableModules: MemoryModuleDescriptor[];
};

type MemoryModuleExecutionResponse = {
  moduleId: ModuleId;
  rowCount: number;
  summary: string;
};

type MemorySessionEvent =
  | { kind: "reset_results" }
  | { kind: "status"; level: MemorySessionStatusLevel; message: string }
  | { kind: "progress"; current: number; total: number; message: string }
  | { kind: "result_schema"; title: string; columns: MemoryGridColumn[] }
  | { kind: "result_row"; row: Record<string, unknown> }
  | { kind: "complete"; summary: string };

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
};

type GridRow = Record<string, unknown> & { __rowId: number };

const LOG_HISTORY_LIMIT = 250;

const FALLBACK_MODULES: MemoryModuleDescriptor[] = [
  {
    id: "pslist",
    name: "Process Listing",
    description: "Enumerate the process list through the DMA connector.",
    supportsProcessFilter: false,
    supportsAddressRange: false,
    requiresOutputPath: false,
  },
  {
    id: "triage",
    name: "Process Triage",
    description: "Inspect a process by PID and list its loaded modules.",
    supportsProcessFilter: true,
    supportsAddressRange: false,
    requiresOutputPath: false,
  },
  {
    id: "bitlocker",
    name: "BitLocker Recovery",
    description: "Scan memory for FVEK and VMK material.",
    supportsProcessFilter: false,
    supportsAddressRange: true,
    requiresOutputPath: false,
  },
  {
    id: "memdump",
    name: "Memdump",
    description: "Dump physical memory to disk with progress updates.",
    supportsProcessFilter: false,
    supportsAddressRange: true,
    requiresOutputPath: true,
  },
];

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `memory-${Date.now()}`;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return Math.trunc(parsed);
}

function normalizeLogLevel(level: MemorySessionStatusLevel): LogLevel {
  return level === "warn" ? "warning" : level;
}

function logBadgeLabel(level: LogLevel): string {
  switch (level) {
    case "info":
      return "INFO";
    case "warning":
      return "WARN";
    case "success":
      return "OK";
    case "error":
      return "ERROR";
  }
}

function logBadgeSx(level: LogLevel) {
  switch (level) {
    case "info":
      return {
        bgcolor: "#12344f",
        color: "#8bd3ff",
        border: "1px solid #198fca",
      };
    case "warning":
      return {
        bgcolor: "#4b2e12",
        color: "#f7c66b",
        border: "1px solid #d98b1f",
      };
    case "success":
      return {
        bgcolor: "#143826",
        color: "#8fe0ab",
        border: "1px solid #2f9e62",
      };
    case "error":
      return {
        bgcolor: "#4a1820",
        color: "#ffb2b8",
        border: "1px solid #dc5b6a",
      };
  }
}

function moduleIcon(moduleId: ModuleId) {
  if (moduleId === "bitlocker") {
    return <ShieldIcon sx={{ fontSize: 18 }} />;
  }

  if (moduleId === "memdump") {
    return <SaveAltIcon sx={{ fontSize: 18 }} />;
  }

  return <MemoryIcon sx={{ fontSize: 18 }} />;
}

const LeechCore: React.FC = () => {
  const { display_message } = useSnackbar();
  const [sessionId] = React.useState(createSessionId);
  const [connector, setConnector] = React.useState(":device=FPGA");
  const [osKind, setOsKind] = React.useState<OsKind>("windows");
  const [linuxProfile, setLinuxProfile] = React.useState("");
  const [probeResult, setProbeResult] =
    React.useState<DiscoverMemoryDmaResponse | null>(null);
  const [selectedModule, setSelectedModule] = React.useState<ModuleId>("pslist");
  const [limit, setLimit] = React.useState("32");
  const [processPid, setProcessPid] = React.useState("");
  const [startAddress, setStartAddress] = React.useState("");
  const [endAddress, setEndAddress] = React.useState("");
  const [chunkSize, setChunkSize] = React.useState("0x100000");
  const [outputPath, setOutputPath] = React.useState("");
  const [gridTitle, setGridTitle] = React.useState("Module Output");
  const [gridColumns, setGridColumns] = React.useState<MemoryGridColumn[]>([]);
  const [gridRows, setGridRows] = React.useState<GridRow[]>([]);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [progress, setProgress] = React.useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);
  const [summary, setSummary] = React.useState("");
  const [runningLabel, setRunningLabel] = React.useState<string | null>(null);

  const nextLogId = React.useRef(1);
  const nextRowId = React.useRef(1);

  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listen<MemorySessionEvent>(`memory_session_${sessionId}`, ({ payload }) => {
      switch (payload.kind) {
        case "reset_results":
          setProgress(null);
          setSummary("");
          break;
        case "status":
          setLogs((current) => [
            ...current.slice(-(LOG_HISTORY_LIMIT - 1)),
            {
              id: nextLogId.current++,
              level: normalizeLogLevel(payload.level),
              message: payload.message,
            },
          ]);
          break;
        case "progress":
          setProgress({
            current: payload.current,
            total: payload.total,
            message: payload.message,
          });
          break;
        case "result_schema":
          nextRowId.current = 1;
          setGridTitle(payload.title);
          setGridColumns(payload.columns);
          setGridRows([]);
          break;
        case "result_row":
          setGridRows((current) => [
            ...current,
            {
              __rowId: nextRowId.current++,
              ...payload.row,
            },
          ]);
          break;
        case "complete":
          setSummary(payload.summary);
          break;
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((error) => {
        console.error("Failed to subscribe to LeechCore events", error);
        display_message(
          "error",
          `LeechCore event subscription failed: ${String(error)}`,
        );
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [display_message, sessionId]);

  const availableModules = probeResult?.availableModules ?? FALLBACK_MODULES;
  const activeModule =
    availableModules.find((module) => module.id === selectedModule) ??
    FALLBACK_MODULES[0];
  const supportsLimit =
    selectedModule === "pslist" || selectedModule === "triage";

  const muiColumns = React.useMemo<GridColDef[]>(
    () =>
      gridColumns.map((column) => ({
        field: column.field,
        headerName: column.headerName,
        minWidth: column.minWidth,
        flex: column.flex,
        type: column.type,
      })),
    [gridColumns],
  );

  const prepareRunState = React.useCallback(() => {
    setProgress(null);
    setSummary("");
  }, []);

  const handleDiscover = async () => {
    prepareRunState();
    setProbeResult(null);
    setRunningLabel("DMA discovery");

    try {
      const response = await invoke<DiscoverMemoryDmaResponse>(
        "discover_memory_dma",
        {
          request: {
            sessionId,
            connector,
            connectorType: "pcileech",
            processLimit: 8,
            osKind,
            linuxProfile: linuxProfile || null,
          },
        },
      );
      setProbeResult(response);
      setSelectedModule(response.availableModules[0]?.id ?? "pslist");
    } catch (error) {
      console.error(error);
      display_message("error", String(error));
    } finally {
      setRunningLabel(null);
    }
  };

  const handleRunModule = async () => {
    if (!probeResult?.healthy) {
      display_message("error", "Run DMA discovery first.");
      return;
    }

    try {
      const limitValue = parseOptionalNumber(limit);
      const pidValue = parseOptionalNumber(processPid);
      const chunkSizeValue = parseOptionalNumber(chunkSize);

      prepareRunState();
      setRunningLabel(activeModule.name);

      const response = await invoke<MemoryModuleExecutionResponse>(
        "run_memory_module",
        {
          request: {
            sessionId,
            connector,
            connectorType: "pcileech",
            moduleId: selectedModule,
            limit: limitValue,
            pid: pidValue,
            start: startAddress,
            end: endAddress,
            chunkSize: chunkSizeValue,
            outputPath,
            osKind,
            linuxProfile: linuxProfile || null,
          },
        },
      );
      setSummary(response.summary);
    } catch (error) {
      console.error(error);
      display_message("error", String(error));
    } finally {
      setRunningLabel(null);
    }
  };

  const chooseOutputPath = async () => {
    const selected = await save({ defaultPath: "memory.raw" });
    if (selected) {
      setOutputPath(selected);
    }
  };

  const browseLinuxProfile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "TOML profile", extensions: ["toml"] }],
    });
    if (selected && typeof selected === "string") {
      setLinuxProfile(selected);
    }
  };

  const progressValue =
    progress && progress.total > 0
      ? Math.min(100, (progress.current / progress.total) * 100)
      : 0;

  return (
    <Box
      sx={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto auto minmax(0, 1fr)",
        gap: 1.25,
        p: 1.25,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 1.25,
          background:
            "linear-gradient(135deg, rgba(18,28,47,0.98) 0%, rgba(9,87,117,0.92) 55%, rgba(15,120,94,0.88) 100%)",
        }}
      >
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: "column", xl: "row" }}
            spacing={1.25}
            sx={{
              alignItems: { xs: "stretch", xl: "center" }
            }}
          >
            <Stack
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: "center",
                minWidth: 0,
                flex: 1
              }}>
              <DeveloperBoardIcon sx={{ fontSize: 34, color: "common.white" }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{
                  color: "common.white"
                }}>
                  LeechCore DMA Workspace
                </Typography>
                <Typography variant="caption" sx={{
                  color: "rgba(255,255,255,0.8)"
                }}>
                  Validate DMA access and run exhume_memory modules with live output.
                </Typography>
              </Box>
            </Stack>

            <TextField
              label="Connector"
              size="small"
              value={connector}
              onChange={(event) => setConnector(event.target.value)}
              sx={{
                minWidth: { xs: "100%", md: 320 },
                maxWidth: { xs: "100%", xl: 380 },
                "& .MuiInputBase-root": { bgcolor: "rgba(7, 11, 20, 0.26)" },
                "& .MuiInputLabel-root, & .MuiInputBase-input": {
                  color: "common.white",
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.22)",
                },
              }}
            />

            <ToggleButtonGroup
              size="small"
              exclusive
              value={osKind}
              onChange={(_, v) => {
                if (v) {
                  setOsKind(v);
                  setProbeResult(null);
                }
              }}
              sx={{
                "& .MuiToggleButton-root": {
                  color: "rgba(255,255,255,0.7)",
                  borderColor: "rgba(255,255,255,0.22)",
                  px: 1.5,
                  py: 0.5,
                  fontSize: 12,
                },
                "& .Mui-selected": {
                  bgcolor: "rgba(255,255,255,0.15) !important",
                  color: "common.white !important",
                },
              }}
            >
              <ToggleButton value="windows">Windows</ToggleButton>
              <ToggleButton value="linux">Linux</ToggleButton>
            </ToggleButtonGroup>

            {osKind === "linux" && (
              <Stack direction="row" spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label="Linux Profile (.toml)"
                  size="small"
                  value={linuxProfile}
                  onChange={(event) => setLinuxProfile(event.target.value)}
                  placeholder="Optional — uses MEMFLOW_LINUX_PROFILE if unset"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    "& .MuiInputBase-root": { bgcolor: "rgba(7, 11, 20, 0.26)" },
                    "& .MuiInputLabel-root, & .MuiInputBase-input, & .MuiInputBase-input::placeholder": {
                      color: "common.white",
                    },
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "rgba(255,255,255,0.22)",
                    },
                  }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={browseLinuxProfile}
                  sx={{ borderColor: "rgba(255,255,255,0.24)", color: "common.white", whiteSpace: "nowrap" }}
                >
                  Browse
                </Button>
              </Stack>
            )}

            <Stack direction="row" spacing={1} useFlexGap sx={{
              flexWrap: "wrap"
            }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<SearchIcon />}
                onClick={handleDiscover}
                disabled={Boolean(runningLabel)}
              >
                Discover DMA
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                onClick={handleRunModule}
                disabled={!probeResult?.healthy || Boolean(runningLabel)}
                sx={{ borderColor: "rgba(255,255,255,0.24)", color: "common.white" }}
              >
                Run {activeModule.name}
              </Button>
            </Stack>
          </Stack>

          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            sx={{
              flexWrap: "wrap",
              alignItems: "center"
            }}>
            <Chip
              size="small"
              label="LeechCore"
              color="success"
              variant="filled"
            />
            <Chip
              size="small"
              label={probeResult?.healthy ? "DMA Verified" : "Awaiting Probe"}
              color={probeResult?.healthy ? "success" : "error"}
              variant="filled"
            />
            {runningLabel && (
              <Chip
                size="small"
                color="warning"
                label={`Running ${runningLabel}`}
              />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`Connector example: :device=FPGA`}
              sx={{ color: "common.white", borderColor: "rgba(255,255,255,0.22)" }}
            />
          </Stack>

          <Grid container spacing={1}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ px: 1, py: 0.75, bgcolor: "rgba(8, 12, 20, 0.2)" }}>
                <Typography variant="caption" sx={{
                  color: "rgba(255,255,255,0.7)"
                }}>
                  Max Address
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: "common.white",
                    fontFamily: "monospace"
                  }}>
                  {probeResult?.maxAddressHex ?? "-"}
                </Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ px: 1, py: 0.75, bgcolor: "rgba(8, 12, 20, 0.2)" }}>
                <Typography variant="caption" sx={{
                  color: "rgba(255,255,255,0.7)"
                }}>
                  Physical Memory End
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: "common.white",
                    fontFamily: "monospace"
                  }}>
                  {probeResult?.physicalMemoryEndHex ?? "-"}
                </Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ px: 1, py: 0.75, bgcolor: "rgba(8, 12, 20, 0.2)" }}>
                <Typography variant="caption" sx={{
                  color: "rgba(255,255,255,0.7)"
                }}>
                  Sample Processes
                </Typography>
                <Typography variant="body2" sx={{
                  color: "common.white"
                }}>
                  {probeResult?.sampleProcessCount ?? 0}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ px: 1.5, py: 1.25 }}>
        <Stack spacing={1.25}>
          <Box>
            <Typography variant="subtitle2">exhume_memory Modules</Typography>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              Select a module, then expose only the parameters relevant to that run.
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.75} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            {availableModules.map((module) => (
              <Chip
                key={module.id}
                clickable
                icon={moduleIcon(module.id)}
                label={module.name}
                color={selectedModule === module.id ? "success" : "error"}
                variant={selectedModule === module.id ? "filled" : "outlined"}
                onClick={() => setSelectedModule(module.id)}
              />
            ))}
          </Stack>

          <Alert severity={probeResult?.healthy ? "success" : "info"} sx={{ py: 0 }}>
            {probeResult?.healthy
              ? activeModule.description
              : "Run discovery to confirm DMA access before executing modules."}
          </Alert>

          <Grid container spacing={1}>
            {supportsLimit && (
              <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                <TextField
                  size="small"
                  label="Limit"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  fullWidth
                  helperText="pslist and triage"
                />
              </Grid>
            )}
            {activeModule.supportsProcessFilter && (
              <Grid size={{ xs: 12, sm: 6, xl: supportsLimit ? 5 : 8 }}>
                <TextField
                  size="small"
                  label="PID"
                  value={processPid}
                  onChange={(event) => setProcessPid(event.target.value)}
                  fullWidth
                  helperText="Optional, for example 640"
                />
              </Grid>
            )}
            {activeModule.supportsAddressRange && (
              <>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <TextField
                    size="small"
                    label="Start Address"
                    value={startAddress}
                    onChange={(event) => setStartAddress(event.target.value)}
                    fullWidth
                    helperText="Hex accepted"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <TextField
                    size="small"
                    label="End Address"
                    value={endAddress}
                    onChange={(event) => setEndAddress(event.target.value)}
                    fullWidth
                    helperText="Hex accepted"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <TextField
                    size="small"
                    label="Chunk Size"
                    value={chunkSize}
                    onChange={(event) => setChunkSize(event.target.value)}
                    fullWidth
                    helperText="Default 0x100000"
                  />
                </Grid>
              </>
            )}
            {activeModule.requiresOutputPath && (
              <>
                <Grid size={{ xs: 12, md: 8 }}>
                  <TextField
                    size="small"
                    label="Output Path"
                    value={outputPath}
                    onChange={(event) => setOutputPath(event.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Button
                    fullWidth
                    size="small"
                    sx={{ height: "100%", minHeight: 40 }}
                    variant="outlined"
                    onClick={chooseOutputPath}
                  >
                    Browse Output
                  </Button>
                </Grid>
              </>
            )}
          </Grid>
        </Stack>
      </Paper>
      <Grid container spacing={1.25} sx={{ minHeight: 0 }}>
        <Grid size={{ xs: 12, lg: 9 }} sx={{ minHeight: 0 }}>
          <Paper
            variant="outlined"
            sx={{
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Box sx={{ px: 1.5, py: 1.25 }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                sx={{
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" }
                }}>
                <Box>
                  <Typography variant="subtitle2">{gridTitle}</Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    Structured module output streams directly into the grid.
                  </Typography>
                </Box>
                {summary && <Chip size="small" color="success" label={summary} />}
              </Stack>

              {progress && (
                <Box sx={{ mt: 1.25 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={0.5}
                    sx={{
                      justifyContent: "space-between",
                      mb: 0.75
                    }}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {progress.message}
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {progress.current}/{progress.total}
                    </Typography>
                  </Stack>
                  <Box
                    sx={{
                      width: "100%",
                      height: 7,
                      borderRadius: 999,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                    }}
                  >
                    <Box
                      sx={{
                        width: `${progressValue}%`,
                        height: "100%",
                        background:
                          "linear-gradient(90deg, #15aabf 0%, #51cf66 100%)",
                      }}
                    />
                  </Box>
                </Box>
              )}
            </Box>
            <Divider />
            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
              <DataGridPro
                rows={gridRows}
                columns={muiColumns}
                getRowId={(row) => row.__rowId}
                density="compact"
                showToolbar
                disableRowSelectionOnClick
                pageSizeOptions={[25, 50, 100]}
                rowHeight={36}
                sx={{
                  border: 0,
                  height: "100%",
                  "& .MuiDataGrid-main": {
                    minHeight: 0,
                  },
                }}
              />
            </Box>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 3 }} sx={{ minHeight: 0 }}>
          <Paper
            variant="outlined"
            sx={{
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Box sx={{ px: 1.25, py: 1.1 }}>
              <Typography variant="subtitle2">Execution Log</Typography>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                Discovery and module events from the backend.
              </Typography>
            </Box>
            <Divider />
            <List dense sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", py: 0.5 }}>
              {logs.length === 0 ? (
                <ListItem sx={{ alignItems: "flex-start" }}>
                  <ListItemText
                    primary="No messages yet."
                    secondary="Run discovery or a module to populate the activity log."
                  />
                </ListItem>
              ) : (
                logs.map((entry) => (
                  <ListItem key={entry.id} sx={{ alignItems: "flex-start", py: 0.625 }}>
                    <ListItemText
                      primary={
                        <Chip
                          size="small"
                          label={logBadgeLabel(entry.level)}
                          sx={{
                            fontWeight: 700,
                            letterSpacing: 0.6,
                            height: 22,
                            ...logBadgeSx(entry.level),
                          }}
                        />
                      }
                      secondary={
                        <Typography
                          variant="body2"
                          sx={{
                            color: "text.secondary",
                            mt: 0.5,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word"
                          }}>
                          {entry.message}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))
              )}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default LeechCore;
