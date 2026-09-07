import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Chip,
  Typography,
  Checkbox,
  Tooltip,
  IconButton,
  Divider,
} from "@mui/material";
import {
  DoubleArrowSharp,
  PlayArrow,
  Stop,
  Visibility,
  HourglassEmpty,
  ErrorOutlined,
  Info,
  RestartAlt,
  Storage,
  Layers,
  Memory,
  Terminal,
  Folder as FolderIcon,
} from "@mui/icons-material";
import { useNavigate } from "react-router";
import { Evidence } from "../../../dbutils/types";
import { useSnackbar } from "../../SnackbarProvider";
import LinearProgress from "@mui/material/LinearProgress";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Autorenew from "@mui/icons-material/Autorenew";
import { listen } from "@tauri-apps/api/event";
import { deleteEvidences } from "../../../dbutils/sqlite";
import {
  cancelEvidenceProcessing,
  getEvidenceSourceStatus,
  relinkEvidenceSourceAndReset,
  restartEvidenceProcessing,
} from "../../../dbutils/evidenceLifecycle";
import {
  EVIDENCE_STATUS,
  PROCESSING_STAGES,
  getEvidenceStatusInfo,
} from "../../../dbutils/evidenceStatus";
import EvidenceSourceRecoveryDialog, {
  EvidenceSourceRecoveryIntent,
} from "../dialogs/EvidenceSourceRecoveryDialog";

const getStatusIcon = (status: number) => {
  const info = getEvidenceStatusInfo(status);
  if (info.isFailed) return <ErrorOutlined sx={{ fontSize: 14 }} />;
  if (status === EVIDENCE_STATUS.COMPLETE) return <CheckCircle sx={{ fontSize: 14 }} />;
  if (info.isRunning) return <Autorenew sx={{ fontSize: 14 }} />;
  if (status === EVIDENCE_STATUS.STOPPING) return <HourglassEmpty sx={{ fontSize: 14 }} />;
  return <Info sx={{ fontSize: 14 }} />;
};

const getTypeIcon = (type: Evidence["type"]) => {
  switch (type) {
    case "Physical Disk image": return <Storage fontSize="small" />;
    case "Logical Disk image": return <Layers fontSize="small" />;
    case "Memory Image": return <Memory fontSize="small" />;
    case "Procmon dump": return <Terminal fontSize="small" />;
    case "Folder": return <FolderIcon fontSize="small" />;
  }
};

const processingStageForPhase = (phase?: string): number | null => {
  switch (phase) {
    case "artefact_identification": return 2;
    case "artefact_parsing": return 3;
    case "ai_analysis": return 4;
    case "complete": return PROCESSING_STAGES.length;
    default: return null;
  }
};

interface EvidenceCardProps {
  evidence: Evidence;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onEvidenceChange?: () => void;
  onEvidenceDeleted: (id: number) => void;
}

const EvidenceCard: React.FC<EvidenceCardProps> = ({
  evidence,
  isSelected,
  onToggleSelect,
  onEvidenceChange,
  onEvidenceDeleted,
}) => {
  const navigate = useNavigate();
  const { display_message } = useSnackbar();
  const [hovered, setHovered] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [sourceRecovery, setSourceRecovery] = useState<{
    intent: EvidenceSourceRecoveryIntent;
    reason: string;
    sourcePath?: string;
    evidenceType?: Evidence["type"];
  } | null>(null);

  const showSourceRecovery = (
    intent: EvidenceSourceRecoveryIntent,
    reason: string,
    sourcePath?: string,
    evidenceType?: Evidence["type"],
  ) => {
    setSourceRecovery({ intent, reason, sourcePath, evidenceType });
  };

  const checkRegisteredSource = async (
    intent: EvidenceSourceRecoveryIntent,
  ): Promise<boolean> => {
    try {
      const source = await getEvidenceSourceStatus(evidence.id);
      if (!source.available) {
        showSourceRecovery(
          intent,
          source.reason ??
            `The registered ${source.evidenceType} source is not available at ${source.path}.`,
          source.path,
          source.evidenceType,
        );
      }
      return source.available;
    } catch (error) {
      showSourceRecovery(
        intent,
        `The registered evidence source could not be accessed: ${String(error)}`,
      );
      return false;
    }
  };

  const handleRestart = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (!(await checkRegisteredSource("restart"))) return;
      await restartEvidenceProcessing(evidence.id);
      display_message("success", "Evidence processing restarted.");
      onEvidenceChange?.();
    } catch (err) {
      display_message("error", `Failed to restart evidence: ${err}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleStop = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await cancelEvidenceProcessing(evidence.id);
      if (result.outcome === "resetToNotProcessed") {
        display_message(
          "info",
          "No active processing task was found. Incomplete analysis data was removed and the evidence was reset to Not processed.",
        );
      } else {
        display_message(
          "info",
          "Stop requested. The evidence is now marked as stopped.",
        );
      }
      onEvidenceChange?.();
    } catch (e) {
      display_message("error", `Failed to stop processing: ${e}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleInvestigate = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (!(await checkRegisteredSource("review"))) return;
      navigate(`/evidences/investigate/${evidence.id}`);
    } catch (e) {
      display_message("error", `Error checking evidence: ${e}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenEvidenceWorkflow = async (
    intent: "preprocess" | "process",
  ) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (!(await checkRegisteredSource(intent))) return;
      navigate(
        intent === "preprocess"
          ? `/evidences/preprocess/${evidence.id}`
          : `/evidences/process/${evidence.id}`,
      );
    } catch (error) {
      display_message("error", `Error checking evidence: ${String(error)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRelink = async (newPath: string) => {
    if (!sourceRecovery || actionBusy) return;
    setActionBusy(true);
    try {
      const recoveryIntent = sourceRecovery.intent;
      const result = await relinkEvidenceSourceAndReset(evidence.id, newPath);

      display_message(
        "success",
        `Evidence source relinked to ${result.newPath}. Existing analysis was reset safely.`,
      );
      onEvidenceChange?.();
      setSourceRecovery(null);
      navigate(
        recoveryIntent === "preprocess"
          ? `/evidences/preprocess/${evidence.id}`
          : `/evidences/process/${evidence.id}`,
      );
    } catch (error) {
      throw new Error(`Failed to relink evidence source: ${String(error)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMissingEvidence = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const result = await deleteEvidences([evidence.id]);
      if (!result.deletedEvidenceIds.includes(evidence.id)) {
        throw new Error("The evidence record was not deleted.");
      }

      setSourceRecovery(null);
      onEvidenceDeleted(evidence.id);
      if (result.cleanupWarnings.length > 0) {
        display_message(
          "warning",
          `Evidence record deleted, but some generated files could not be removed: ${result.cleanupWarnings.join(" ")}`,
        );
      } else {
        display_message(
          "success",
          `EV-${evidence.id} was deleted. The original source was not modified.`,
        );
      }
    } catch (error) {
      display_message("error", `Failed to delete evidence: ${String(error)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const renderActions = () => {
    const { status } = evidence;
    const info = getEvidenceStatusInfo(status);

    if (status === EVIDENCE_STATUS.NOT_PROCESSED) {
      return (
        <Tooltip title="Review for processing">
          <IconButton
            size="small"
            disabled={actionBusy}
            onClick={() => void handleOpenEvidenceWorkflow("preprocess")}
          >
            <DoubleArrowSharp fontSize="small" />
          </IconButton>
        </Tooltip>
      );
    }

    // The review action is always rendered, but disabled with the reason when
    // the evidence is not yet reviewable — hiding it makes the app look broken.
    const reviewAction = info.isReviewable ? (
      <Tooltip
        title={info.isPartial ? "Review investigation (incomplete results)" : "Review investigation"}
      >
        <IconButton size="small" disabled={actionBusy} onClick={handleInvestigate}>
          <Visibility fontSize="small" color={info.isPartial ? "warning" : "inherit"} />
        </IconButton>
      </Tooltip>
    ) : (
      <Tooltip title={info.blockedReason ?? "Not available yet"}>
        <span>
          <IconButton size="small" disabled>
            <Visibility fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    );

    const canResume =
      status === EVIDENCE_STATUS.PENDING ||
      status === EVIDENCE_STATUS.STOPPED ||
      status === EVIDENCE_STATUS.INDEXING_FAILED ||
      status === EVIDENCE_STATUS.ARTEFACTS_FAILED;

    return (
      <>
        {canResume && (
          <Tooltip
            title={
              status === EVIDENCE_STATUS.PENDING
                ? "Start extraction"
                : "Restart analysis from indexing"
            }
          >
            <IconButton
              size="small"
              disabled={actionBusy}
              onClick={() => void handleOpenEvidenceWorkflow("process")}
            >
              <PlayArrow fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {info.isRunning && status !== EVIDENCE_STATUS.STOPPING && (
          <Tooltip title="Stop processing">
            <IconButton size="small" disabled={actionBusy} onClick={handleStop}>
              <Stop fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {reviewAction}

        {!info.isRunning && status !== EVIDENCE_STATUS.PENDING && (
          <Tooltip title="Restart processing">
            <IconButton size="small" disabled={actionBusy} onClick={handleRestart}>
              <RestartAlt fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </>
    );
  };

  const statusInfo = getEvidenceStatusInfo(evidence.status);
  const [liveDetail, setLiveDetail] = useState<string | null>(null);
  const [liveStagesDone, setLiveStagesDone] = useState<number | null>(null);

  // The pipeline already emits per-evidence progress; surfacing it costs nothing
  // and turns "Parsing artefacts" into something an investigator can act on.
  React.useEffect(() => {
    // Subscribe whenever the evidence could still be worked on, including the
    // reviewable-but-AI-running state, since events are the only proof of it.
    if (!statusInfo.isRunning && evidence.status !== EVIDENCE_STATUS.ARTEFACTS_PARSED) {
      setLiveDetail(null);
      setLiveStagesDone(null);
      return;
    }

    const updateLiveDetail = (payload: any, stage?: number) => {
      const message = typeof payload === "string" ? payload : payload?.message ?? null;
      if (message) setLiveDetail(String(message));
      const phaseStage = processingStageForPhase(
        typeof payload === "string" ? undefined : payload?.phase,
      );
      if (phaseStage !== null) setLiveStagesDone(phaseStage);
      else if (stage !== undefined) setLiveStagesDone(stage);
    };

    const unlistens = [
      listen<any>(`main_progress_info_${evidence.id}`, ({ payload }) => {
        updateLiveDetail(payload);
      }),
      listen<any>(`main_progress_progress_${evidence.id}`, ({ payload }) => {
        updateLiveDetail(payload);
      }),
      listen<any>(`module_progress_info_${evidence.id}`, ({ payload }) => {
        updateLiveDetail(payload);
      }),
      listen<any>(`module_progress_parser_${evidence.id}`, ({ payload }) => {
        updateLiveDetail(payload, 3);
      }),
    ];
    return () => {
      unlistens.forEach((unlisten) => void unlisten.then((fn) => fn()));
    };
  }, [evidence.id, statusInfo.isRunning, evidence.status]);

  const statusColor = statusInfo.color;
  const displayedStagesDone = Math.max(
    statusInfo.stagesDone,
    liveStagesDone ?? 0,
  );

  return (
    <>
    <Card
      variant="outlined"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        position: "relative",
        borderLeftWidth: 4,
        borderLeftStyle: "solid",
        borderLeftColor: statusColor,
        ...(isSelected && {
          borderColor: "primary.main",
          borderLeftColor: statusColor,
          bgcolor: "action.selected",
        }),
        transition: "box-shadow 0.15s",
        ...(hovered && { boxShadow: 2 }),
      }}
    >
      {(hovered || isSelected) && (
        <Checkbox
          checked={isSelected}
          size="small"
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(evidence.id)}
          sx={{ position: "absolute", top: 4, right: 4, p: 0.5 }}
        />
      )}

      <CardContent sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, pr: hovered || isSelected ? 4 : 0 }}>
          <Box sx={{ color: statusColor, display: "flex" }}>{getTypeIcon(evidence.type)}</Box>
          <Typography variant="subtitle2" noWrap sx={{ flex: 1, fontWeight: 600 }}>
            {evidence.name}
          </Typography>
          <Chip
            label={`EV-${evidence.id}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: "0.65rem", height: 18, flexShrink: 0 }}
          />
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {evidence.type}
        </Typography>

        <Typography
          variant="body2"
          color={evidence.description ? "text.primary" : "text.disabled"}
          sx={{ mb: 1.5, fontSize: "0.8rem" }}
        >
          {evidence.description || "No description provided."}
        </Typography>

        <Chip
          icon={getStatusIcon(evidence.status)}
          label={statusInfo.label}
          size="small"
          variant="outlined"
          sx={{
            color: statusColor,
            borderColor: statusColor,
            "& .MuiChip-icon": { color: statusColor },
            fontSize: "0.7rem",
            height: 20,
          }}
        />

        {(statusInfo.isRunning || statusInfo.isPartial || liveDetail !== null) && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={(displayedStagesDone / PROCESSING_STAGES.length) * 100}
              color={statusInfo.isPartial ? "error" : "primary"}
              sx={{ height: 4, borderRadius: 2 }}
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                mt: 0.5,
                gap: 0.5,
              }}
            >
              {PROCESSING_STAGES.map((stage, index) => (
                <Typography
                  key={stage.key}
                  variant="caption"
                  sx={{
                    fontSize: "0.6rem",
                    color:
                      index < displayedStagesDone
                        ? "success.main"
                        : index === displayedStagesDone && statusInfo.isRunning
                          ? "info.main"
                          : "text.disabled",
                    fontWeight: index === displayedStagesDone ? 600 : 400,
                  }}
                >
                  {stage.label}
                </Typography>
              ))}
            </Box>
            {liveDetail && (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.25,
                  fontSize: "0.6rem",
                  color: "text.secondary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {liveDetail}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>

      {hovered && (
        <>
          <Divider />
          <CardActions sx={{ py: 0.5, px: 1.5 }}>
            {renderActions()}
          </CardActions>
        </>
      )}
    </Card>
    {sourceRecovery && (
      <EvidenceSourceRecoveryDialog
        open
        evidence={{
          ...evidence,
          path: sourceRecovery.sourcePath ?? evidence.path,
          type: sourceRecovery.evidenceType ?? evidence.type,
        }}
        intent={sourceRecovery.intent}
        reason={sourceRecovery.reason}
        busy={actionBusy}
        onClose={() => setSourceRecovery(null)}
        onRelink={handleRelink}
        onDelete={handleDeleteMissingEvidence}
      />
    )}
    </>
  );
};

interface EvidenceListProps {
  evidences: Evidence[];
  onSelectionChange: (selectedIds: number[]) => void;
  onEvidenceChange?: () => void;
}

const EvidenceList: React.FC<EvidenceListProps> = ({
  evidences,
  onSelectionChange,
  onEvidenceChange,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(Array.from(next));
      return next;
    });
  };

  const handleEvidenceDeleted = (id: number) => {
    const next = new Set(selectedIds);
    next.delete(id);
    setSelectedIds(next);
    onSelectionChange(Array.from(next));
    onEvidenceChange?.();
  };

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 2,
        width: "100%",
      }}
    >
      {evidences.map((evidence) => (
        <EvidenceCard
          key={evidence.id}
          evidence={evidence}
          isSelected={selectedIds.has(evidence.id)}
          onToggleSelect={handleToggleSelect}
          onEvidenceChange={onEvidenceChange}
          onEvidenceDeleted={handleEvidenceDeleted}
        />
      ))}
    </Box>
  );
};

export default EvidenceList;
