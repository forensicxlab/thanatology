// FileViewer.tsx
import React, { useState, useRef } from "react";
import { Box, Button } from "@mui/material";
import HexViewerWindow from "./HexViewerWindow";
import { HexViewerHandle } from "./HexViewer";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Simple wrapper that lets the user pick a binary file and
 * shows it in the read-only HexViewer.  The Excalidraw import
 * is left in place—uncomment the marked section if you want to
 * display both editors side-by-side.
 */
const FileViewer: React.FC = () => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const hexRef = useRef<HexViewerHandle>(null);

  /** Open-file button handler (Tauri file-picker). */
  const handleOpenFile = async () => {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setFilePath(selected);
    }
  };

  return (
    <Box height="100vh" display="flex" flexDirection="column">
      {/* --- Toolbar ------------------------------------------------------ */}
      <Box p={1} display="flex" gap={1}>
        <Button variant="contained" onClick={handleOpenFile}>
          Open binary…
        </Button>
        <Button onClick={() => hexRef.current?.goto(0)} disabled={!filePath}>
          Go to start
        </Button>
      </Box>

      {/* --- Main area ---------------------------------------------------- */}
      <Box flexGrow={1} display="flex" overflow="hidden">
        <Box flex={1} overflow="hidden">
          {filePath ? (
            <HexViewerWindow ref={hexRef} path={filePath} />
          ) : (
            <Box
              height="100%"
              display="flex"
              alignItems="center"
              justifyContent="center"
              color="text.secondary"
              fontStyle="italic"
            >
              Open a file to start
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default FileViewer;
