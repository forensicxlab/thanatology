import React, { useState, useEffect } from "react";
import { Evidence } from "../../../../dbutils/types";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getEvidence } from "../../../../dbutils/sqlite";
import { useSnackbar } from "../../../SnackbarProvider";
import { useParams } from "react-router";
import {
  Apps,
  BlurOn,
  Fingerprint,
  Home,
  Hub,
  PermMedia,
  Settings,
  Timeline,
} from "@mui/icons-material";
import Summary from "./summary/Summary";
import System from "./system/System";
import Network from "./network/Network";
import { PartitionSelection } from "../PartitionSelection";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`vertical-tabpanel-${index}`}
      aria-labelledby={`vertical-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          <Typography>{children}</Typography>
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `vertical-tab-${index}`,
    "aria-controls": `vertical-tabpanel-${index}`,
  };
}

const InvestigateLinux: React.FC = () => {
  const { display_message } = useSnackbar();
  const { id: evidence_id } = useParams<{ id: string }>();
  const [value, setValue] = React.useState(0);
  const [selectedPartition, setSelectedPartition] = useState<number | null>(
    null,
  );
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handlePartitionChanged = (newId: number | null) => {
    console.log("New partition selected:", newId);
    setSelectedPartition(newId);
  };

  useEffect(() => {
    const fetchEvidence = async () => {
      try {
        if (!evidence_id) {
          setError("No valid evidence ID found in the URL.");
          setLoading(false);
          return;
        }
        const db = null; // Replace with your DB instance if necessary
        const fetchedEvidence = await getEvidence(db, evidence_id.toString());
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
  }, [evidence_id]);

  // Handle loading and error states
  if (loading) {
    return <div>Loading evidence details...</div>;
  }
  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }
  if (!evidence) {
    return <div>No evidence found.</div>;
  }

  // Always show the partition selection, but only show the main UI if partition selected:
  return (
    <>
      <Box
        sx={{
          position: "absolute",
          mr: 1,
          bottom: "0",
          right: "0",
          zIndex: 1,
        }}
      >
        <PartitionSelection
          evidenceId={evidence.id}
          onPartitionChange={handlePartitionChanged}
        />
      </Box>
      <Box
        sx={{
          flexGrow: 1,
          bgcolor: "background.paper",
          display: "flex",
        }}
      >
        {selectedPartition ? (
          <>
            <Tabs
              sx={{
                "& .MuiTabs-indicator": {
                  backgroundColor: "success.main",
                },
                "& .MuiTab-root.Mui-selected": {
                  color: "inherit",
                },
                borderRight: 1,
                borderColor: "divider",
                height: "90vh",
              }}
              orientation="vertical"
              value={value}
              onChange={handleChange}
              aria-label="Vertical tabs example"
            >
              <Tab
                icon={<Home />}
                iconPosition="start"
                label="Summary"
                {...a11yProps(0)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<Settings />}
                iconPosition="start"
                label="System"
                {...a11yProps(1)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<Hub />}
                iconPosition="start"
                label="Network"
                {...a11yProps(2)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<Fingerprint />}
                iconPosition="start"
                label="Users"
                {...a11yProps(3)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<PermMedia />}
                iconPosition="start"
                label="Multimedia"
                {...a11yProps(4)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<Apps />}
                iconPosition="start"
                label="Applications"
                {...a11yProps(5)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<Timeline />}
                iconPosition="start"
                label="Timeline"
                {...a11yProps(6)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
              <Tab
                icon={<BlurOn />}
                iconPosition="start"
                label="Explore"
                {...a11yProps(7)}
                sx={{
                  fontSize: "0.75rem",
                  minHeight: 0,
                  justifyContent: "left",
                }}
              />
            </Tabs>
            <Box
              sx={{
                width: "100%",
                bgcolor: "background.paper",
              }}
            >
              <TabPanel value={value} index={0}>
                <Summary evidence={evidence} partition_id={selectedPartition} />
              </TabPanel>
              <TabPanel value={value} index={1}>
                <System />
              </TabPanel>
              <TabPanel value={value} index={2}>
                <Network />
              </TabPanel>
              <TabPanel value={value} index={3}>
                {/* Users content */}
              </TabPanel>
              <TabPanel value={value} index={4}>
                Multimedia content
              </TabPanel>
              <TabPanel value={value} index={5}>
                Applications content
              </TabPanel>
              <TabPanel value={value} index={6}>
                Timeline content
              </TabPanel>
              <TabPanel value={value} index={7}>
                Explore content
              </TabPanel>
            </Box>
          </>
        ) : (
          <div style={{ margin: "1rem", color: "#666" }}>
            Please select a partition to start investigate.
          </div>
        )}
      </Box>
    </>
  );
};

export default InvestigateLinux;
