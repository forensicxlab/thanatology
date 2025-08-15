import React, { useCallback, useMemo, useState } from "react";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import MediaGallery, { MediaEntry } from "./MediaGallery";
import FileDataGrid from "./MediaDataGrid";
import { File } from "../../../../../dbutils/types";
interface MediaProps {
  evidenceId: number;
  partitionId: number;
}

const isMediaMime = (mime?: string | null) =>
  !!mime && /^(image|video|audio)\//i.test(mime);

const kindFromMime = (mime: string): MediaEntry["kind"] =>
  mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : "audio";

const basename = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : "");

const Media: React.FC<MediaProps> = ({ partitionId }) => {
  const [loadedRows, setLoadedRows] = useState<File[]>([]);
  const [openById, setOpenById] = useState<number | null>(null);

  // Convert whatever the grid loaded (this page) to gallery entries, filtered to media.
  const media: MediaEntry[] = useMemo(() => {
    return loadedRows
      .filter((r) => isMediaMime(r.sig_mime))
      .map((r) => ({
        id: r.identifier, // used by Tauri read_file_bytes
        kind: kindFromMime(r.sig_mime!),
        mime: r.sig_mime!,
        label:
          basename(r.absolute_path) ||
          r.identifier ||
          `File ${String(r.identifier)}`,
      }));
  }, [loadedRows]);

  // When the user activates a row, open the lightbox at that item if it's media.
  const handleRowActivate = useCallback((row: File) => {
    if (isMediaMime(row.sig_mime)) {
      setOpenById(row.identifier);
    }
  }, []);

  return (
    <Box>
      <Grid container spacing={2}>
        {/* Left: DataGrid */}
        <Grid size={12}>
          <FileDataGrid
            partition_id={partitionId}
            onRowsLoaded={setLoadedRows}
            onRowActivate={handleRowActivate}
          />
        </Grid>

        {/* Right: Gallery */}
        <Grid size={12}>
          <MediaGallery
            media={media}
            openById={openById}
            onClose={() => setOpenById(null)}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default Media;
