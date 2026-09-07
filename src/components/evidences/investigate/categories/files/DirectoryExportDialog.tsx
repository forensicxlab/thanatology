import * as React from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";

import {
  cancelDirectoryExport,
  DIRECTORY_EXPORT_EVENT,
  getDirectoryExportJobs,
  startDirectoryExport,
  type DirectoryExportJobSnapshot,
} from "../../../../../dbutils/filesystemExport";
import { useSnackbar } from "../../../../SnackbarProvider";

export interface DirectoryExportSource {
  systemFileId: number;
  name: string;
  absolutePath: string;
}

interface DirectoryExportDialogProps {
  open: boolean;
  evidenceId: number;
  partitionId: number;
  source: DirectoryExportSource | null;
  onClose: () => void;
  onRunningJobRecovered: () => void;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "failed"]);
const ACTIVE_STATUS_RANK: Record<string, number> = {
  queued: 0,
  running: 1,
  cancelling: 2,
};
function isActiveJob(job: DirectoryExportJobSnapshot | null): boolean {
  return job != null && ACTIVE_STATUSES.has(job.status);
}

function shouldReplaceSnapshot(
  current: DirectoryExportJobSnapshot | null,
  next: DirectoryExportJobSnapshot,
): boolean {
  if (!current || current.jobId !== next.jobId) return true;

  const currentTerminal = TERMINAL_STATUSES.has(current.status);
  const nextTerminal = TERMINAL_STATUSES.has(next.status);
  // A fast export can finish before start_directory_export returns its initial
  // queued snapshot. Once terminal, that job must never become active again.
  if (currentTerminal && !nextTerminal) return false;
  if (!currentTerminal && nextTerminal) return true;
  if (currentTerminal && nextTerminal) {
    return (next.finishedAtUnixMs ?? 0) >= (current.finishedAtUnixMs ?? 0);
  }
  if (
    (ACTIVE_STATUS_RANK[next.status] ?? 0) <
    (ACTIVE_STATUS_RANK[current.status] ?? 0)
  ) {
    return false;
  }
  const countersRegressed =
    next.entriesProcessed < current.entriesProcessed ||
    next.bytesWritten < current.bytesWritten ||
    next.filesExported < current.filesExported ||
    next.directoriesCreated < current.directoriesCreated ||
    next.skippedEntries < current.skippedEntries ||
    next.failedEntries < current.failedEntries;
  return !countersRegressed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "Unknown";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatCount(value: number | null | undefined): string {
  return Intl.NumberFormat().format(value ?? 0);
}

function targetPreview(parent: string, sourceName: string): string {
  if (!parent) return "";
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${sourceName}`;
}

function jobSortValue(job: DirectoryExportJobSnapshot): number {
  return job.finishedAtUnixMs ?? job.startedAtUnixMs ?? 0;
}

function statusColor(
  status: DirectoryExportJobSnapshot["status"],
): "default" | "primary" | "success" | "warning" | "error" {
  switch (status) {
    case "queued":
    case "running":
      return "primary";
    case "cancelling":
    case "cancelled":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function stageLabel(stage: string): string {
  const normalized = stage.replace(/[-_]+/g, " ").trim();
  return normalized
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : "Preparing export";
}

function Metrics({ job }: { job: DirectoryExportJobSnapshot }) {
  const metrics = [
    [
      "Processed",
      job.totalEntries == null
        ? formatCount(job.entriesProcessed)
        : `${formatCount(job.entriesProcessed)} / ${formatCount(job.totalEntries)}`,
    ],
    ["Files", formatCount(job.filesExported)],
    ["Directories", formatCount(job.directoriesCreated)],
    ["Written", formatBytes(job.bytesWritten)],
    ["Skipped", formatCount(job.skippedEntries)],
    ["Failures", formatCount(job.failedEntries)],
  ];

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 1,
      }}
    >
      {metrics.map(([label, value]) => (
        <Box key={label} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const DirectoryExportDialog: React.FC<DirectoryExportDialogProps> = ({
  open,
  evidenceId,
  partitionId,
  source,
  onClose,
  onRunningJobRecovered,
}) => {
  const { display_message } = useSnackbar();
  const [destinationParent, setDestinationParent] = React.useState("");
  const [snapshot, setSnapshot] =
    React.useState<DirectoryExportJobSnapshot | null>(null);
  const [showConfiguration, setShowConfiguration] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [choosingDestination, setChoosingDestination] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [cancelPending, setCancelPending] = React.useState(false);

  const trackedJobIdRef = React.useRef<string | null>(null);
  const pendingStartRef = React.useRef<{
    sourceId: number;
    requestedAtUnixMs: number;
  } | null>(null);
  const latestSnapshotRef = React.useRef<DirectoryExportJobSnapshot | null>(null);
  const recoverySequenceRef = React.useRef(0);
  const listenerReadyRef = React.useRef<Promise<void>>(Promise.resolve());
  const priorStatusesRef = React.useRef(new Map<string, string>());

  const acceptSnapshot = React.useCallback(
    (next: DirectoryExportJobSnapshot) => {
      if (next.evidenceId !== evidenceId || next.partitionId !== partitionId) return false;
      const trackedJobId = trackedJobIdRef.current;
      if (trackedJobId && next.jobId !== trackedJobId) return false;
      if (!trackedJobId && pendingStartRef.current) {
        if (next.directorySystemFileId !== pendingStartRef.current.sourceId) return false;
        if (
          next.startedAtUnixMs != null &&
          next.startedAtUnixMs < pendingStartRef.current.requestedAtUnixMs
        ) {
          return false;
        }
      }
      if (!shouldReplaceSnapshot(latestSnapshotRef.current, next)) return false;

      if (
        TERMINAL_STATUSES.has(next.status) &&
        pendingStartRef.current &&
        !priorStatusesRef.current.has(next.jobId)
      ) {
        // Preserve the active -> terminal transition for a tiny job whose
        // first observed snapshot is already complete.
        priorStatusesRef.current.set(next.jobId, "running");
      }
      trackedJobIdRef.current = next.jobId;
      latestSnapshotRef.current = next;
      setSnapshot(next);
      setShowConfiguration(false);
      setCancelPending(next.status === "cancelling");
      // The backend snapshot is authoritative. Clear transient start/cancel/
      // recovery transport errors once the job is observed successfully.
      setError(next.error ?? null);
      return true;
    },
    [evidenceId, partitionId],
  );

  // Install the event listener before listing recoverable jobs. This closes the
  // list/listen race and also guarantees the listener is ready before Start.
  React.useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const recoveryId = ++recoverySequenceRef.current;

    const listenerPromise = listen<DirectoryExportJobSnapshot>(
      DIRECTORY_EXPORT_EVENT,
      (event) => {
        if (disposed) return;
        if (acceptSnapshot(event.payload)) {
          recoverySequenceRef.current += 1;
        }
      },
    );
    listenerReadyRef.current = listenerPromise.then((removeListener) => {
      if (disposed) {
        removeListener();
      } else {
        unlisten = removeListener;
      }
    });

    void listenerReadyRef.current
      .then(async () => {
        try {
          const jobs = await getDirectoryExportJobs(evidenceId);
          if (disposed || recoverySequenceRef.current !== recoveryId) return;

          const matchingScope = jobs
            .filter(
              (job) =>
                job.evidenceId === evidenceId && job.partitionId === partitionId,
            )
            .sort((left, right) => jobSortValue(right) - jobSortValue(left));
          const recovered =
            matchingScope.find((job) => isActiveJob(job)) ??
            matchingScope.find(
              (job) => job.directorySystemFileId === source?.systemFileId,
            ) ??
            null;

          if (!recovered) return;
          trackedJobIdRef.current = recovered.jobId;
          acceptSnapshot(recovered);
          if (isActiveJob(recovered)) onRunningJobRecovered();
        } catch (reason) {
          if (!disposed) {
            setError(`Unable to recover directory exports: ${errorMessage(reason)}`);
          }
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(`Unable to listen for directory export progress: ${errorMessage(reason)}`);
        }
      });

    return () => {
      disposed = true;
      recoverySequenceRef.current += 1;
      unlisten?.();
    };
  }, [acceptSnapshot, evidenceId, onRunningJobRecovered, partitionId, source?.systemFileId]);

  // Events are the low-latency path; polling the backend app-session registry is the
  // recovery path for a terminal event emitted before the start response, a
  // renderer suspension, or a transient listener failure.
  React.useEffect(() => {
    if (!snapshot || !isActiveJob(snapshot)) return;
    let disposed = false;
    let requestInFlight = false;
    const jobId = snapshot.jobId;
    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const jobs = await getDirectoryExportJobs(evidenceId);
        if (disposed) return;
        const current = jobs.find(
          (job) =>
            job.jobId === jobId &&
            job.evidenceId === evidenceId &&
            job.partitionId === partitionId,
        );
        if (current) acceptSnapshot(current);
      } catch {
        // The event stream remains authoritative; a later poll can recover.
      } finally {
        requestInFlight = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 1000);
    void refresh();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [acceptSnapshot, evidenceId, partitionId, snapshot?.jobId, snapshot?.status]);

  React.useEffect(() => {
    if (!snapshot) return;
    const previousStatus = priorStatusesRef.current.get(snapshot.jobId);
    priorStatusesRef.current.set(snapshot.jobId, snapshot.status);
    if (!previousStatus || !ACTIVE_STATUSES.has(previousStatus)) return;
    if (ACTIVE_STATUSES.has(snapshot.status)) return;

    if (snapshot.status === "completed") {
      const hasWarnings = snapshot.skippedEntries > 0 || snapshot.failedEntries > 0;
      display_message(
        hasWarnings ? "warning" : "success",
        hasWarnings
          ? "Directory export completed with skipped or failed entries."
          : `Directory exported to ${snapshot.outputPath ?? snapshot.destinationParent}.`,
      );
    } else if (snapshot.status === "cancelled") {
      display_message("info", "Directory export cancelled.");
    } else if (snapshot.status === "failed") {
      display_message("error", snapshot.error ?? "Directory export failed.");
    }
  }, [display_message, snapshot]);

  React.useEffect(() => {
    if (isActiveJob(snapshot)) return;
    if (!snapshot || snapshot.directorySystemFileId !== source?.systemFileId) {
      setDestinationParent("");
      setError(null);
      trackedJobIdRef.current = null;
      latestSnapshotRef.current = null;
      setSnapshot(null);
      setShowConfiguration(true);
    }
  }, [snapshot, source?.systemFileId]);

  const busy = starting || cancelPending || isActiveJob(snapshot);
  const configuredSourcePath = source?.absolutePath ?? "No directory selected";
  const displayedSourcePath =
    !showConfiguration && snapshot?.sourcePath
      ? snapshot.sourcePath
      : configuredSourcePath;
  const displayedSystemFileId =
    !showConfiguration && snapshot
      ? snapshot.directorySystemFileId
      : source?.systemFileId;
  const preview = source
    ? targetPreview(destinationParent, source.name || `directory-${source.systemFileId}`)
    : "";
  const progressValue =
    snapshot?.totalBytes != null && snapshot.totalBytes > 0
      ? Math.min(100, (snapshot.bytesWritten / snapshot.totalBytes) * 100)
      : undefined;

  const chooseDestination = async () => {
    setChoosingDestination(true);
    setError(null);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose directory export destination",
      });
      if (typeof selected === "string") setDestinationParent(selected);
    } catch (reason) {
      setError(`Unable to open the destination picker: ${errorMessage(reason)}`);
    } finally {
      setChoosingDestination(false);
    }
  };

  const startExport = async () => {
    if (!source || !destinationParent) return;
    const operationId = crypto.randomUUID();
    setStarting(true);
    setError(null);
    pendingStartRef.current = {
      sourceId: source.systemFileId,
      requestedAtUnixMs: Date.now(),
    };
    const requestedAtUnixMs = pendingStartRef.current.requestedAtUnixMs;
    // Correlate progress before invoking: a tiny export may emit and finish
    // before the command response arrives, and another client may export the
    // same source concurrently.
    trackedJobIdRef.current = operationId;
    latestSnapshotRef.current = null;
    recoverySequenceRef.current += 1;
    try {
      await listenerReadyRef.current;
      const initial = await startDirectoryExport({
        operationId,
        evidenceId,
        partitionId,
        directorySystemFileId: source.systemFileId,
        destinationParent,
      });
      acceptSnapshot(initial);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      display_message("error", message);
      // The start response can be lost after the backend accepted the job.
      // Recover by listing before permitting a second submission.
      try {
        const jobs = await getDirectoryExportJobs(evidenceId);
        const recovered = jobs
          .filter(
            (job) =>
              job.jobId === operationId &&
              job.evidenceId === evidenceId &&
              job.partitionId === partitionId &&
              job.directorySystemFileId === source.systemFileId &&
              (job.startedAtUnixMs == null ||
                job.startedAtUnixMs >= requestedAtUnixMs),
          )
          .sort((left, right) => jobSortValue(right) - jobSortValue(left))[0];
        if (recovered) {
          acceptSnapshot(recovered);
        } else if (
          (latestSnapshotRef.current as DirectoryExportJobSnapshot | null)?.jobId !== operationId
        ) {
          trackedJobIdRef.current = null;
        }
      } catch {
        // Preserve the actionable start error; recovery will retry on remount.
      }
    } finally {
      pendingStartRef.current = null;
      setStarting(false);
    }
  };

  const cancelExport = async () => {
    if (!snapshot || !isActiveJob(snapshot) || cancelPending) return;
    setCancelPending(true);
    setError(null);
    try {
      const result = await cancelDirectoryExport(snapshot.jobId);
      if (!result.accepted) {
        setError("The export is no longer running and could not be cancelled.");
        setCancelPending(false);
        return;
      }
      acceptSnapshot({ ...snapshot, status: "cancelling" });
    } catch (reason) {
      setError(`Unable to cancel the export: ${errorMessage(reason)}`);
      setCancelPending(false);
    }
  };

  const openOutput = async () => {
    if (!snapshot?.outputPath) return;
    setError(null);
    try {
      await openPath(snapshot.outputPath);
    } catch (reason) {
      setError(`Unable to open the export folder: ${errorMessage(reason)}`);
    }
  };

  const resetForNewExport = () => {
    if (busy) return;
    trackedJobIdRef.current = null;
    pendingStartRef.current = null;
    latestSnapshotRef.current = null;
    setSnapshot(null);
    setShowConfiguration(true);
    setDestinationParent("");
    setError(null);
  };

  const requestClose = () => {
    if (busy) return;
    trackedJobIdRef.current = null;
    onClose();
  };

  const renderContext = () => (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "max-content minmax(0, 1fr)",
        columnGap: 1.5,
        rowGap: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary">Evidence</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>EV-{evidenceId}</Typography>
      <Typography variant="caption" color="text.secondary">Partition</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>#{partitionId}</Typography>
      <Typography variant="caption" color="text.secondary">Directory record</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {displayedSystemFileId ?? "Unavailable"}
      </Typography>
      <Typography variant="caption" color="text.secondary">Source</Typography>
      <Typography
        variant="caption"
        title={displayedSourcePath}
        sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
      >
        {displayedSourcePath}
      </Typography>
    </Box>
  );

  const renderConfiguration = () => (
    <Stack spacing={1.5}>
      {renderContext()}
      <Alert severity="info" variant="outlined">
        The complete directory subtree is exported. Grid filters and the investigation time
        scope are ignored. Only the primary data fork is written; symbolic links and special
        files are skipped and recorded in the export manifest. Original timestamps, permissions,
        owner, and group are retained in the manifest rather than applied to the analyst's host.
      </Alert>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <TextField
          label="Destination parent"
          value={destinationParent}
          fullWidth
          size="small"
          slotProps={{ htmlInput: { readOnly: true } }}
          helperText={
            preview
              ? `Intended target preview: ${preview}. Unsafe or colliding source names are mapped by the exporter; the confirmed output is shown after start.`
              : "Choose an existing parent folder. The source directory name is created inside it."
          }
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={choosingDestination ? <CircularProgress size={14} /> : <FolderOpenOutlinedIcon />}
          onClick={() => void chooseDestination()}
          disabled={choosingDestination || starting}
          sx={{ mt: 0.25, whiteSpace: "nowrap" }}
        >
          Browse
        </Button>
      </Stack>
      <Alert severity="warning" variant="outlined">
        If the target directory already exists, the export stops before replacing any data.
      </Alert>
    </Stack>
  );

  const renderProgress = () => {
    if (!snapshot) return null;
    return (
      <Stack spacing={1.5} aria-live="polite">
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="subtitle2">{stageLabel(snapshot.stage)}</Typography>
          <Chip
            size="small"
            variant="outlined"
            color={statusColor(snapshot.status)}
            label={snapshot.status}
          />
        </Stack>
        {renderContext()}
        <LinearProgress
          variant={progressValue == null ? "indeterminate" : "determinate"}
          value={progressValue}
        />
        <Typography variant="caption" color="text.secondary">
          {formatBytes(snapshot.bytesWritten)}
          {snapshot.totalBytes != null ? ` of ${formatBytes(snapshot.totalBytes)}` : " written"}
        </Typography>
        {snapshot.currentPath && (
          <Typography
            variant="caption"
            title={snapshot.currentPath}
            sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
          >
            {snapshot.currentPath}
          </Typography>
        )}
        <Divider />
        <Metrics job={snapshot} />
      </Stack>
    );
  };

  const renderResult = () => {
    if (!snapshot) return null;
    const failures = snapshot.failures ?? [];
    const hasWarnings = snapshot.skippedEntries > 0 || snapshot.failedEntries > 0;
    const severity =
      snapshot.status === "failed"
        ? "error"
        : snapshot.status === "cancelled"
          ? "info"
          : hasWarnings
            ? "warning"
            : "success";
    const summary =
      snapshot.status === "failed"
        ? snapshot.error ?? "The directory export failed."
        : snapshot.status === "cancelled"
          ? "The directory export was cancelled. The result below describes any retained output."
          : hasWarnings
            ? "The directory export completed with skipped or failed entries. Review the manifest."
            : "The directory export completed successfully.";

    return (
      <Stack spacing={1.5}>
        <Alert severity={severity} variant="outlined">{summary}</Alert>
        {renderContext()}
        <Metrics job={snapshot} />
        <Divider />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            columnGap: 1.5,
            rowGap: 0.75,
          }}
        >
          <Typography variant="caption" color="text.secondary">Output</Typography>
          <Typography variant="caption" sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
            {snapshot.outputPath ?? "No output was published"}
          </Typography>
          <Typography variant="caption" color="text.secondary">Manifest</Typography>
          <Typography variant="caption" sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>
            {snapshot.manifestPath ?? "Not available"}
          </Typography>
        </Box>
        {failures.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Failures ({formatCount(snapshot.failedEntries)})
            </Typography>
            <Stack
              spacing={0.75}
              sx={{ maxHeight: 150, overflowY: "auto", pr: 0.5 }}
            >
              {failures.slice(0, 50).map((failure, index) => (
                <Box key={`${failure.path}:${index}`}>
                  <Typography variant="caption" sx={{ display: "block", fontFamily: "monospace" }}>
                    {failure.path}
                  </Typography>
                  <Typography variant="caption" color="error.main">
                    {failure.error}
                  </Typography>
                </Box>
              ))}
              {snapshot.failedEntries > 50 && (
                <Typography variant="caption" color="text.secondary">
                  {formatCount(snapshot.failedEntries - 50)} more failure records are available in the manifest.
                </Typography>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) requestClose();
      }}
      fullWidth
      maxWidth="sm"
      aria-labelledby="directory-export-dialog-title"
    >
      <DialogTitle id="directory-export-dialog-title" sx={{ pb: 1 }}>
        Export directory
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        {showConfiguration
          ? renderConfiguration()
          : isActiveJob(snapshot)
            ? renderProgress()
            : renderResult()}
      </DialogContent>
      <DialogActions>
        {showConfiguration ? (
          <>
            <Button color="inherit" onClick={requestClose} disabled={starting}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => void startExport()}
              disabled={!source || !destinationParent || choosingDestination || starting}
              startIcon={starting ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {starting ? "Starting…" : "Export directory"}
            </Button>
          </>
        ) : isActiveJob(snapshot) ? (
          <Button
            color="error"
            variant="outlined"
            onClick={() => void cancelExport()}
            disabled={cancelPending || snapshot?.status === "cancelling"}
            startIcon={cancelPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {cancelPending || snapshot?.status === "cancelling" ? "Cancelling…" : "Cancel export"}
          </Button>
        ) : (
          <>
            {snapshot?.outputPath && (
              <Button startIcon={<FolderOpenOutlinedIcon />} onClick={() => void openOutput()}>
                Open folder
              </Button>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button onClick={resetForNewExport} disabled={!source}>Export again</Button>
            <Button variant="contained" onClick={requestClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default DirectoryExportDialog;
