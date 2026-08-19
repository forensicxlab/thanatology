import React, { useState, useEffect } from "react";
import { Evidence } from "../../../dbutils/types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
  Place,
  Settings,
  Timeline,
  Psychology,
} from "@mui/icons-material";
import Summary from "./categories/summary/Summary";
import System from "./categories/system/System";
import Timeliner from "./categories/timeline/Timeliner";
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
import LocationMap from "./categories/mobile/LocationMap";
import TimeScopeControl from "./TimeScopeControl";
import Alert from "@mui/material/Alert";
import {
  EVIDENCE_STATUS,
  getEvidenceStatusInfo,
} from "../../../dbutils/evidenceStatus";
import { useEvidenceStore } from "../../../store/evidenceStore";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const INVESTIGATION_LAYOUT_OFFSET = 84;

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

  const { setActiveEvidence, setProcessingStatus, clearActiveEvidence } = useEvidenceStore();

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handlePartitionChanged = (newId: number | null) => {
    setSelectedPartition(newId);
  };

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
        gridTemplateRows: "minmax(0, 1fr) auto",
        gap: 1.5,
        minHeight: 0,
      }}
    >
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
                label="Timeline"
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
              <Tab
                icon={<Place />}
                iconPosition="start"
                label="Location"
                {...a11yProps(10)}
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
                />
              </TabPanel>
              <TabPanel value={value} index={7}>
                <Timeliner
                  evidenceId={evidence.id}
                  partitionId={selectedPartition}
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
              <TabPanel value={value} index={10}>
                <LocationMap
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
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 1.25,
          borderRadius: 2,
          flexShrink: 0,
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          sx={{
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between"
          }}>
          <Box>
            <Typography variant="subtitle2">Investigation Scope</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Every view is constrained to the selected partition and time
              window.
            </Typography>
          </Box>
          <PartitionSelection
            evidenceId={evidence.id}
            onPartitionChange={handlePartitionChanged}
          />
        </Stack>

        <Divider sx={{ my: 1 }} />

        <TimeScopeControl
          evidenceId={evidence.id}
          partitionId={selectedPartition}
        />
      </Paper>
    </Box>
  );
};

export default InvestigateLinux;
