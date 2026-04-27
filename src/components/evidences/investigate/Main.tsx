import React, { useState, useEffect } from "react";
import { Evidence } from "../../../dbutils/types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getEvidence } from "../../../dbutils/sqlite";
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
import Media from "./categories/media/Media";
import FilesExplorer from "./categories/files/FilesExplorer";
import AiArtifacts from "./categories/ai_analysis/AiArtifacts";
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

  const { setActiveEvidence, clearActiveEvidence } = useEvidenceStore();

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
      clearActiveEvidence();
    };
  }, [evidence_id, setActiveEvidence, clearActiveEvidence]);

  useEffect(() => {
    if (evidence) {
      setActiveEvidence(`sqlite:evidences/${evidence.id}.db`, evidence.id);
    }
  }, [evidence, setActiveEvidence]);

  if (loading) {
    return <div>Loading evidence details...</div>;
  }
  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }
  if (!evidence) {
    return <div>No evidence found.</div>;
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
                <Media
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
            <Typography variant="subtitle2">Partition Scope</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              The active investigation view is constrained to the selected
              partition.
            </Typography>
          </Box>
          <PartitionSelection
            evidenceId={evidence.id}
            onPartitionChange={handlePartitionChanged}
          />
        </Stack>
      </Paper>
    </Box>
  );
};

export default InvestigateLinux;
