import React, { useState } from "react";
import { Box, Tab, Tabs } from "@mui/material";
import Media from "./Media";
import PhotosLibrary from "../mobile/PhotosLibrary";

interface MediaTabProps {
  evidenceId: number;
  partitionId: number;
}

/**
 * Multimedia has two complementary faces:
 *  - "Library": the user's parsed Photos library (capture dates, GPS and the
 *    hidden/trashed/favorite state that exists only in Photos.sqlite).
 *  - "Files": every media file present on disk, including caches and system
 *    assets, browsable as a gallery.
 */
const MediaTab: React.FC<MediaTabProps> = ({ evidenceId, partitionId }) => {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
      >
        <Tab label="Library" />
        <Tab label="Files" />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", pt: 1 }}>
        {tab === 0 ? (
          <PhotosLibrary evidenceId={evidenceId} partitionId={partitionId} />
        ) : (
          <Media evidenceId={evidenceId} partitionId={partitionId} />
        )}
      </Box>
    </Box>
  );
};

export default MediaTab;
