import React, { useEffect, useState } from "react";
import { Box, CircularProgress, Tab, Tabs, Typography } from "@mui/material";
import Artifacts from "../../Artifacts";
import { fetchApplicationTags } from "../../../../../dbutils/sqlite";

interface ApplicationsProps {
  evidenceId: number;
  partitionId: number;
}

const Applications: React.FC<ApplicationsProps> = ({
  evidenceId,
  partitionId,
}) => {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    setLoading(true);
    setSelectedTab(0);
    fetchApplicationTags(evidenceId, partitionId)
      .then(setTags)
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, [evidenceId, partitionId]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (tags.length === 0) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">No application artifacts found for this partition.</Typography>
      </Box>
    );
  }

  const activeTag = tags[selectedTab] ?? tags[0];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Tabs
        value={selectedTab}
        onChange={(_, v: number) => setSelectedTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
      >
        {tags.map((tag) => (
          <Tab key={tag} label={tag} />
        ))}
      </Tabs>

      <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column", pt: 1 }}>
        <Artifacts
          key={activeTag}
          evidence_id={evidenceId}
          partition_id={partitionId}
          category="Application"
          tag={activeTag}
        />
      </Box>
    </Box>
  );
};

export default Applications;
