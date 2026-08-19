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
import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { useSnackbar } from "../../SnackbarProvider";
import LinearProgress from "@mui/material/LinearProgress";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Autorenew from "@mui/icons-material/Autorenew";
import { listen } from "@tauri-apps/api/event";
import {
  EVIDENCE_STATUS,
  PROCESSING_STAGES,
  getEvidenceStatusInfo,
} from "../../../dbutils/evidenceStatus";

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
}

const EvidenceCard: React.FC<EvidenceCardProps> = ({
  evidence,
  isSelected,
  onToggleSelect,
  onEvidenceChange,
}) => {
  const navigate = useNavigate();
  const { display_message } = useSnackbar();
  const [hovered, setHovered] = useState(false);

  const handleRestart = async () => {
    try {
      const baseDir = await appLocalDataDir();
      await invoke("reset_evidence", {
        evidenceId: evidence.id,
        mainDbPath: `${baseDir}/thanatology.db`,
        evidenceDbPath: `${baseDir}/evidences/${evidence.id}.db`,
      });
      display_message("success", "Evidence processing restarted.");
      onEvidenceChange?.();
    } catch (err) {
      display_message("error", `Failed to restart evidence: ${err}`);
    }
  };

  const handleStop = async () => {
    try {
      await invoke("cancel_processing", { evidenceId: evidence.id });
      display_message("info", "Stop requested, the process will complete its current task and stop.");
      onEvidenceChange?.();
    } catch (e) {
      display_message("error", `Failed to stop processing: ${e}`);
    }
  };

  const handleInvestigate = async () => {
    try {
      const exists: boolean = await invoke("check_evidence_exists", { path: evidence.path });
      if (exists) {
        navigate(`/evidences/investigate/${evidence.id}`);
      } else {
        display_message("error", "The source evidence file is missing on disk. Please relink it manually.");
      }
    } catch (e) {
      display_message("error", `Error checking evidence: ${e}`);
    }
  };

  const renderActions = () => {
    const { status } = evidence;
    const info = getEvidenceStatusInfo(status);

    if (status === EVIDENCE_STATUS.NOT_PROCESSED) {
      return (
        <Tooltip title="Review for processing">
          <IconButton size="small" onClick={() => navigate(`/evidences/preprocess/${evidence.id}`)}>
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
        <IconButton size="small" onClick={handleInvestigate}>
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
      status === EVIDENCE_STATUS.STOPPING ||
      status === EVIDENCE_STATUS.INDEXING_FAILED ||
      status === EVIDENCE_STATUS.ARTEFACTS_FAILED;

    return (
      <>
        {canResume && (
          <Tooltip
            title={
              status === EVIDENCE_STATUS.PENDING
                ? "Start extraction"
                : `Resume from ${PROCESSING_STAGES[info.stagesDone]?.label ?? "the last stage"}`
            }
          >
            <IconButton size="small" onClick={() => navigate(`/evidences/process/${evidence.id}`)}>
              <PlayArrow fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {info.isRunning && status !== EVIDENCE_STATUS.STOPPING && (
          <Tooltip title="Stop processing">
            <IconButton size="small" onClick={handleStop}>
              <Stop fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {reviewAction}

        {status !== EVIDENCE_STATUS.PENDING && (
          <Tooltip title="Restart processing">
            <IconButton size="small" onClick={handleRestart}>
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
        />
      ))}
    </Box>
  );
};

export default EvidenceList;
