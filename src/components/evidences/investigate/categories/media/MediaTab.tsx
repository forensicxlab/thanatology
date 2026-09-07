import React, { useEffect, useState } from "react";
import { Box, Tab, Tabs } from "@mui/material";
import Media from "./Media";
import PhotosLibrary from "../mobile/PhotosLibrary";
import { hasIosPhotoLibraryArtifacts } from "../../../../../dbutils/sqlite";

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
  const scopeKey = `${evidenceId}:${partitionId}`;
  const [tab, setTab] = useState<"files" | "library">("files");
  const [libraryAvailability, setLibraryAvailability] = useState<{
    scopeKey: string;
    available: boolean;
  } | null>(null);
  const hasLibrary =
    libraryAvailability?.scopeKey === scopeKey && libraryAvailability.available;
  const activeTab = tab === "library" && !hasLibrary ? "files" : tab;

  useEffect(() => {
    let active = true;

    setTab("files");
    setLibraryAvailability(null);
    hasIosPhotoLibraryArtifacts(evidenceId, partitionId)
      .then((available) => {
        if (active) setLibraryAvailability({ scopeKey, available });
      })
      .catch((error) => {
        console.error(
          `Failed to determine photo-library availability for evidence ${evidenceId}, partition ${partitionId}:`,
          error,
        );
        if (active) setLibraryAvailability({ scopeKey, available: false });
      });

    return () => {
      active = false;
    };
  }, [evidenceId, partitionId, scopeKey]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Tabs
        value={activeTab}
        onChange={(_, value: "files" | "library") => setTab(value)}
        sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
      >
        <Tab value="files" label="Files" />
        {hasLibrary && <Tab value="library" label="Library" />}
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", pt: 1 }}>
        {activeTab === "library" ? (
          <PhotosLibrary evidenceId={evidenceId} partitionId={partitionId} />
        ) : (
          <Media evidenceId={evidenceId} partitionId={partitionId} />
        )}
      </Box>
    </Box>
  );
};

export default MediaTab;
