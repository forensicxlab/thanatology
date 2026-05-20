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

const getStatusColorToken = (status: number): string => {
  if (status === -2 || status === 1) return "warning.main";
  if (status === -1) return "error.main";
  if (status === 0) return "text.disabled";
  if (status === 2) return "info.main";
  return "success.main";
};

const getStatusLabel = (status: number): string => {
  switch (status) {
    case -2: return "Stopping...";
    case -1: return "Stopped / Error";
    case 0: return "Not processed";
    case 1: return "Pending start";
    case 2: return "Processing";
    default: return "Ready";
  }
};

const getStatusIcon = (status: number) => {
  if (status === -2) return <HourglassEmpty sx={{ fontSize: 14 }} />;
  if (status === -1) return <ErrorOutlined sx={{ fontSize: 14 }} />;
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

    if (status === 0) {
      return (
        <Tooltip title="Review for processing">
          <IconButton size="small" onClick={() => navigate(`/evidences/preprocess/${evidence.id}`)}>
            <DoubleArrowSharp fontSize="small" />
          </IconButton>
        </Tooltip>
      );
    }

    if (status === 1 || status === -1 || status === -2) {
      return (
        <>
          <Tooltip title={status === -1 || status === -2 ? "Resume Extraction" : "Start Extraction"}>
            <IconButton size="small" onClick={() => navigate(`/evidences/process/${evidence.id}`)}>
              <PlayArrow fontSize="small" />
            </IconButton>
          </Tooltip>
          {(status === -1 || status === -2) && (
            <Tooltip title="Restart processing">
              <IconButton size="small" onClick={handleRestart}>
                <RestartAlt fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </>
      );
    }

    if (status === 2) {
      return (
        <>
          <Tooltip title="Stop processing">
            <IconButton size="small" onClick={handleStop}>
              <Stop fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Review investigation">
            <IconButton size="small" onClick={handleInvestigate}>
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      );
    }

    // status >= 3: Ready
    return (
      <>
        <Tooltip title="Review investigation">
          <IconButton size="small" onClick={handleInvestigate}>
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Restart processing">
          <IconButton size="small" onClick={handleRestart}>
            <RestartAlt fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    );
  };

  const statusColor = getStatusColorToken(evidence.status);

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
          <Typography variant="subtitle2" fontWeight={600} noWrap sx={{ flex: 1 }}>
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
          label={getStatusLabel(evidence.status)}
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
