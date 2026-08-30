import React, { useState, useEffect } from "react";
import { Evidence } from "../../../dbutils/types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { getEvidence } from "../../../dbutils/sqlite";
import { listen } from "@tauri-apps/api/event";
import { useParams } from "react-router";

import {
  Apps,
  BlurOn,
  Fingerprint,
  Home,
  Hub,
  List,
  PermMedia,
  Settings,
  Timeline,
  Psychology,
  ExpandLess,
  ExpandMore,
} from "@mui/icons-material";
import Summary from "./categories/summary/Summary";
import System from "./categories/system/System";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import Network from "./categories/network/Network";
import { PartitionSelection } from "./PartitionSelection";
import Users from "./categories/users/Users";
import Applications from "./categories/applications/Applications";
import MediaTab from "./categories/media/MediaTab";
import FilesExplorer from "./categories/files/FilesExplorer";
import AiArtifacts from "./categories/ai_analysis/AiArtifacts";
import SpatiotemporalLaunchPanel from "./SpatiotemporalLaunchPanel";
import TimeScopeControl from "./TimeScopeControl";
import Alert from "@mui/material/Alert";
import {
  EVIDENCE_STATUS,
  getEvidenceStatusInfo,
} from "../../../dbutils/evidenceStatus";
import { useEvidenceStore } from "../../../store/evidenceStore";
import { useTimeFilterStore } from "../../../store/timeFilterStore";
import { useMainSpatiotemporalTimeSync } from "../../../spatiotemporal/useMainSpatiotemporalTimeSync";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const INVESTIGATION_LAYOUT_OFFSET = 84;
const SCOPE_EXPANSION_STORAGE_KEY =
  "thanatology:investigation-scope-expanded:v1";

function restoreScopeExpanded(): boolean {
  try {
    return localStorage.getItem(SCOPE_EXPANSION_STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

function compactUtcStamp(ms: number): string {
  return dayjs.utc(ms).format("YYYY-MM-DD HH:mm");
}

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("UTC");

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
      sx={{
        display: value === index ? "flex" : "none",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {value === index && (
        <Box
          sx={{
            p: 1,
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

function a11yProps(index: number) {
  return {
    id: `vertical-tab-${index}`,
    "aria-controls": `vertical-tabpanel-${index}`,
  };
}

const InvestigateLinux: React.FC = () => {
  const { id: evidence_id } = useParams<{ id: string }>();
  const [value, setValue] = React.useState(0);
  const [selectedPartition, setSelectedPartition] = useState<number | null>(
    null,
  );
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aiLive, setAiLive] = useState(false);
  const [scopeExpanded, setScopeExpanded] = useState(restoreScopeExpanded);
  const [fileReveal, setFileReveal] = useState<{
    fileId: number;
    requestId: number;
  } | null>(null);

  const { setActiveEvidence, setProcessingStatus, clearActiveEvidence } = useEvidenceStore();
  const initTimeScope = useTimeFilterStore((state) => state.initForScope);
  const timeRangeStart = useTimeFilterStore((state) => state.start);
  const timeRangeEnd = useTimeFilterStore((state) => state.end);
  const fileTimeField = useTimeFilterStore((state) => state.fileTimeField);
  const timeScopeEvidenceId = useTimeFilterStore((state) => state.evidenceId);
  const timeScopePartitionId = useTimeFilterStore((state) => state.partitionId);
  // This bridge intentionally lives at the investigation-shell level rather
  // than inside the Time&Location tab. Synchronized UTC ranges therefore keep
  // constraining every investigation view while the investigator changes tabs.
  const mainTimeSync = useMainSpatiotemporalTimeSync(
    evidence?.id ?? 0,
    selectedPartition,
  );

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handlePartitionChanged = (newId: number | null) => {
    if (evidence) initTimeScope(evidence.id, newId);
    setSelectedPartition(newId);
    setFileReveal(null);
  };

  const handleRevealFile = React.useCallback((fileId: number) => {
    setFileReveal({ fileId, requestId: Date.now() });
    setValue(1);
  }, []);

  const toggleScopeExpanded = React.useCallback(() => {
    setScopeExpanded((expanded) => {
      const next = !expanded;
      try {
        localStorage.setItem(
          SCOPE_EXPANSION_STORAGE_KEY,
          next ? "expanded" : "collapsed",
        );
      } catch {
        // The preference is optional; folding still works for this session.
      }
      return next;
    });
  }, []);

  const timeScopeMatchesSelection =
    evidence != null &&
    selectedPartition != null &&
    timeScopeEvidenceId === evidence.id &&
    timeScopePartitionId === selectedPartition;
  const compactScopeLabel = React.useMemo(() => {
    if (selectedPartition == null) return "Select a partition";
    if (!timeScopeMatchesSelection) return "Loading scope…";
    if (timeRangeStart == null && timeRangeEnd == null) return "All time";
    if (timeRangeStart == null) {
      return `Until ${compactUtcStamp(timeRangeEnd!)} UTC`;
    }
    if (timeRangeEnd == null) {
      return `From ${compactUtcStamp(timeRangeStart)} UTC`;
    }
    return `${compactUtcStamp(timeRangeStart)} → ${compactUtcStamp(
      timeRangeEnd,
    )} UTC`;
  }, [
    selectedPartition,
    timeRangeEnd,
    timeRangeStart,
    timeScopeMatchesSelection,
  ]);
  const timeScopeIsActive =
    timeScopeMatchesSelection &&
    (timeRangeStart != null || timeRangeEnd != null);
  const detachedWorkspaceConnected =
    mainTimeSync.snapshot?.timelineConnected === true ||
    mainTimeSync.snapshot?.locationConnected === true;

  const compactTabSx = {
    fontSize: "0.72rem",
    minHeight: 34,
    minWidth: 84,
    px: 1,
    py: 0.25,
    justifyContent: "left",
    textTransform: "none",
    "& .MuiTab-iconWrapper": {
      marginRight: 0.75,
      "& .MuiSvgIcon-root": {
        fontSize: 18,
      },
    },
  };

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const fetchEvidence = async () => {
      try {
        if (!evidence_id) {
          setError("No valid evidence ID found in the URL.");
          setLoading(false);
          return;
        }
        const fetchedEvidence = await getEvidence(null, evidence_id.toString());
        if (!fetchedEvidence) {
          setError(`No evidence found for ID ${evidence_id}.`);
        } else {
          setEvidence(fetchedEvidence);
          setProcessingStatus(fetchedEvidence.status);

          // Keep polling for as long as the pipeline is still working, so the
          // state banners follow it through identification, artefacts and AI
          // rather than only while indexing.
          if (getEvidenceStatusInfo(fetchedEvidence.status).isRunning) {
            pollTimer = setInterval(async () => {
              const refreshed = await getEvidence(null, evidence_id);
              if (refreshed) {
                setEvidence(refreshed);
                setProcessingStatus(refreshed.status);
                if (!getEvidenceStatusInfo(refreshed.status).isRunning && pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
              }
            }, 5000);
          }
        }
      } catch (err) {
        console.error("Error fetching evidence:", err);
        setError("Failed to load evidence details.");
      } finally {
        setLoading(false);
      }
    };

    fetchEvidence();

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      clearActiveEvidence();
    };
  }, [evidence_id, setActiveEvidence, setProcessingStatus, clearActiveEvidence]);

  useEffect(() => {
    if (evidence) {
      setActiveEvidence(`sqlite:evidences/${evidence.id}.db`, evidence.id);
    }
  }, [evidence, setActiveEvidence]);

  // Only claim AI is still running when the pipeline actually says so; evidence
  // processed before this stage existed also rests at ARTEFACTS_PARSED.
  useEffect(() => {
    if (!evidence || evidence.status !== EVIDENCE_STATUS.ARTEFACTS_PARSED) {
      setAiLive(false);
      return;
    }
    const progress = listen(`main_progress_info_${evidence.id}`, () => setAiLive(true));
    const done = listen(`pipeline_complete_${evidence.id}`, () => setAiLive(false));
    return () => {
      void progress.then((fn) => fn());
      void done.then((fn) => fn());
    };
  }, [evidence?.id, evidence?.status]);

  if (loading) {
    return <div>Loading evidence details...</div>;
  }
  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }
  if (!evidence) {
    return <div>No evidence found.</div>;
  }

  const evidenceStatusInfo = getEvidenceStatusInfo(evidence.status);
  if (!evidenceStatusInfo.isReviewable) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity={evidenceStatusInfo.severity}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Evidence review is not available yet
          </Typography>
          <Typography variant="body2">
            {evidenceStatusInfo.blockedReason ??
              "Artefact parsing must complete before this evidence can be reviewed."}
          </Typography>
          <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
            Current status: {evidenceStatusInfo.label}
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: `calc(100vh - ${INVESTIGATION_LAYOUT_OFFSET}px)`,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 1.5,
        minHeight: 0,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: scopeExpanded ? 1.25 : 0.75,
          borderRadius: 2,
          flexShrink: 0,
          transition: (theme) =>
            theme.transitions.create("padding", {
              duration: theme.transitions.duration.shortest,
            }),
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          sx={{
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between",
          }}
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: "center", minWidth: 0, flexGrow: 1 }}
          >
            <Tooltip
              title={
                scopeExpanded
                  ? "Collapse investigation scope"
                  : "Expand investigation scope"
              }
            >
              <IconButton
                size="small"
                onClick={toggleScopeExpanded}
                aria-expanded={scopeExpanded}
                aria-controls="investigation-scope-controls"
                aria-label={
                  scopeExpanded
                    ? "Collapse investigation scope"
                    : "Expand investigation scope"
                }
                sx={{ flexShrink: 0 }}
              >
                {scopeExpanded ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </Tooltip>

            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}
              >
                <Typography id="investigation-scope-heading" variant="subtitle2">
                  Investigation Scope
                </Typography>
                {!scopeExpanded && (
                  <>
                    <Chip
                      size="small"
                      color={timeScopeIsActive ? "warning" : "default"}
                      variant={timeScopeIsActive ? "filled" : "outlined"}
                      label={compactScopeLabel}
                      title={compactScopeLabel}
                      sx={{ height: 21, maxWidth: { xs: 250, lg: 420 } }}
                    />
                    {timeScopeIsActive && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Files: ${
                          fileTimeField === "any"
                            ? "any timestamp"
                            : fileTimeField
                        }`}
                        sx={{ height: 21, textTransform: "capitalize" }}
                      />
                    )}
                    {mainTimeSync.error ? (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label="Time sync warning"
                        title={mainTimeSync.error}
                        sx={{ height: 21 }}
                      />
                    ) : mainTimeSync.snapshot?.syncEnabled &&
                      detachedWorkspaceConnected ? (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label="Time sync on"
                          sx={{ height: 21 }}
                        />
                      ) : mainTimeSync.snapshot?.syncEnabled ? (
                        <Chip
                          size="small"
                          color="warning"
                          variant="outlined"
                          label="Time sync unavailable"
                          sx={{ height: 21 }}
                        />
                      ) : null}
                  </>
                )}
              </Stack>
              {scopeExpanded && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  The selected partition always applies. The UTC window constrains
                  time-bearing records; panels without a defensible timestamp remain
                  visible and say so explicitly.
                </Typography>
              )}
            </Box>
          </Stack>
          <PartitionSelection
            evidenceId={evidence.id}
            onPartitionChange={handlePartitionChanged}
          />
        </Stack>

        <Collapse in={scopeExpanded}>
          <Box
            id="investigation-scope-controls"
            role="region"
            aria-labelledby="investigation-scope-heading"
          >
            <Divider sx={{ my: 1 }} />
            <TimeScopeControl
              evidenceId={evidence.id}
              partitionId={selectedPartition}
              timeSync={{
                snapshot: mainTimeSync.snapshot,
                loading: mainTimeSync.loading,
                error: mainTimeSync.error,
                setEnabled: mainTimeSync.setSyncEnabled,
              }}
            />
          </Box>
        </Collapse>
      </Paper>

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* An investigator must never mistake partial or still-growing results
            for a finished analysis. */}
        {evidence.status === EVIDENCE_STATUS.ARTEFACTS_FAILED && (
          <Alert severity="error" sx={{ mb: 1 }}>
            Artefact parsing failed for this evidence. Indexed files and the
            filesystem timeline are complete, but parsed application artefacts
            are missing or partial — re-process before relying on this analysis.
          </Alert>
        )}
        {evidence.status === EVIDENCE_STATUS.ARTEFACTS_PARSED && aiLive && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Artefacts are parsed and reviewable. AI analysis is still running, so
            AI-derived results will continue to appear.
          </Alert>
        )}
        {selectedPartition !== null ? (
          <>
            <Tabs
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              value={value}
              onChange={handleChange}
              sx={{
                minHeight: 36,
                flexShrink: 0,
                "& .MuiTabs-indicator": {
                  backgroundColor: "success.main",
                },
                "& .MuiTabs-scrollButtons": {
                  width: 28,
                },
                "& .MuiTab-root.Mui-selected": {
                  color: "inherit",
                },
              }}
            >
              <Tab
                icon={<Home />}
                iconPosition="start"
                label="Summary"
                {...a11yProps(0)}
                sx={compactTabSx}
              />
              <Tab
                icon={<List />}
                iconPosition="start"
                label="Files"
                {...a11yProps(1)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Settings />}
                iconPosition="start"
                label="System"
                {...a11yProps(2)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Hub />}
                iconPosition="start"
                label="Network"
                {...a11yProps(3)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Fingerprint />}
                iconPosition="start"
                label="Users"
                {...a11yProps(4)}
                sx={compactTabSx}
              />
              <Tab
                icon={<PermMedia />}
                iconPosition="start"
                label="Multimedia"
                {...a11yProps(5)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Apps />}
                iconPosition="start"
                label="Applications"
                {...a11yProps(6)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Timeline />}
                iconPosition="start"
                label="Time&Location"
                {...a11yProps(7)}
                sx={compactTabSx}
              />
              <Tab
                icon={<BlurOn />}
                iconPosition="start"
                label="Explore"
                {...a11yProps(8)}
                sx={compactTabSx}
              />
              <Tab
                icon={<Psychology />}
                iconPosition="start"
                label="AI Analysis"
                {...a11yProps(9)}
                sx={compactTabSx}
              />
            </Tabs>
            <Box
              sx={{
                width: "100%",
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
                flexGrow: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <TabPanel value={value} index={0}>
                <Summary evidence={evidence} partitionId={selectedPartition} />
              </TabPanel>

              <TabPanel value={value} index={1}>
                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                  <FilesExplorer
                    evidenceId={evidence.id}
                    partitionId={selectedPartition}
                    revealFile={fileReveal}
                  />
                </Box>
              </TabPanel>

              <TabPanel value={value} index={2}>
                <System
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                />
              </TabPanel>
              <TabPanel value={value} index={3}>
                <Network
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                />
              </TabPanel>
              <TabPanel value={value} index={4}>
                <Users
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                />
              </TabPanel>
              <TabPanel value={value} index={5}>
                <MediaTab
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                />
              </TabPanel>
              <TabPanel value={value} index={6}>
                <Applications
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                  onRevealFile={handleRevealFile}
                />
              </TabPanel>
              <TabPanel value={value} index={7}>
                <SpatiotemporalLaunchPanel
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                  rangeStartMs={timeRangeStart}
                  rangeEndMs={timeRangeEnd}
                  snapshot={mainTimeSync.snapshot}
                  syncLoading={mainTimeSync.loading}
                  syncError={mainTimeSync.error}
                  onRefresh={mainTimeSync.refresh}
                />
              </TabPanel>
              <TabPanel value={value} index={8}>
                Explore content
              </TabPanel>
              <TabPanel value={value} index={9}>
                <AiArtifacts
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
                />
              </TabPanel>
            </Box>
          </>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              display: "grid",
              placeItems: "center",
              flexGrow: 1,
              minHeight: 0,
              px: 3,
            }}
          >
            <Typography variant="body1" sx={{ color: "text.secondary" }}>
              Please select a partition to start investigate.
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default InvestigateLinux;
