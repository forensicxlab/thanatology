// FileViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  Tooltip,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import HexViewerWindow from "./HexViewerWindow";
import { HexViewerHandle } from "./HexViewer";
import RawViewer from "./RawViewer";
import { listen } from "@tauri-apps/api/event";

type ViewerTab = "raw" | "hex" | "other";
type FileOpenPayload = { fileId: number; fileSize: number };

const RIGHT_PANEL_WIDTH = 420;

const FileViewer: React.FC = () => {
  const hexRef = useRef<HexViewerHandle>(null);
  const [tab, setTab] = useState<ViewerTab>("raw");
  const [file, setFile] = useState<FileOpenPayload | null>(null);

  // Right panel open/close
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      unlisten = await listen<FileOpenPayload>("message", (event) => {
        console.log(event.payload);
        setFile(event.payload);
      });
    })();

    return () => unlisten?.();
  }, []);

  const handleDump = () => {
    console.log("dump file");
  };

  const handleHash = () => {
    console.log("compute hash");
  };

  return (
    <Box height="100vh" display="flex" flexDirection="column" minHeight={0}>
      {/* Action toolbar */}
      <Paper
        elevation={0}
        square
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="subtitle2" sx={{ mr: 1 }}>
            File Viewer
          </Typography>

          <Divider orientation="vertical" flexItem />

          <Button size="small" variant="contained" onClick={handleDump}>
            Dump
          </Button>
          <Button size="small" variant="outlined" onClick={handleHash}>
            Compute Hash
          </Button>

          <Box flex={1} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title={rightOpen ? "Hide panel" : "Show panel"}>
              <IconButton
                size="small"
                onClick={() => setRightOpen((v) => !v)}
                aria-label={rightOpen ? "Hide right panel" : "Show right panel"}
              >
                {rightOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </Paper>

      {/* Main content row */}
      <Box display="flex" flex={1} minHeight={0} minWidth={0}>
        {/* Left: main viewer (expands when right panel is closed) */}
        <Box
          flex={1}
          minWidth={0}
          display="flex"
          flexDirection="column"
          minHeight={0}
        >
          {/* Tabs */}
          <Paper
            elevation={0}
            square
            sx={{ borderBottom: 1, borderColor: "divider" }}
          >
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab value="raw" label="RawViewer" />
              <Tab value="hex" label="HexViewer" />
              <Tab value="other" label="Other (placeholder)" />
            </Tabs>
          </Paper>

          {/* Tab content */}
          <Box flex={1} minHeight={0} minWidth={0} p={1}>
            {tab === "raw" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box height="100%" minHeight={0}>
                  {file && (
                    <RawViewer
                      fileId={file.fileId}
                      fileSize={file.fileSize}
                      height={"90vh"}
                      language="plaintext"
                      theme="vs-dark"
                    />
                  )}
                </Box>
              </Paper>
            )}

            {tab === "hex" && (
              <Paper variant="outlined" sx={{ height: "100%", minHeight: 0 }}>
                <Box height="100%" minHeight={0}>
                  {file ? (
                    <HexViewerWindow
                      ref={hexRef}
                      fileId={file.fileId}
                      fileSize={file.fileSize}
                    />
                  ) : (
                    <Box p={2}>
                      <Typography variant="body2" color="text.secondary">
                        No file loaded.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )}

            {tab === "other" && (
              <Paper variant="outlined" sx={{ height: "100%", p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Placeholder for future viewers.
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>

        {/* Right: closable panel (metadata + AI prompt) */}
        <Collapse in={rightOpen} orientation="horizontal" unmountOnExit>
          <Box display="flex" height="100%" minHeight={0}>
            <Divider orientation="vertical" flexItem />

            <Box
              width={RIGHT_PANEL_WIDTH}
              minWidth={RIGHT_PANEL_WIDTH}
              display="flex"
              flexDirection="column"
              minHeight={0}
            >
              {/* Metadata (top) */}
              <Box flex={1} minHeight={0} p={1}>
                <Paper
                  variant="outlined"
                  sx={{ height: "100%", p: 2, minHeight: 0 }}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    File Metadata
                  </Typography>

                  <Box
                    sx={{
                      height: "100%",
                      borderRadius: 1,
                      border: "1px dashed",
                      borderColor: "divider",
                      p: 2,
                      color: "text.secondary",
                    }}
                  >
                    Metadata component goes here
                  </Box>
                </Paper>
              </Box>

              <Divider flexItem />

              {/* AI prompt (bottom) */}
              <Box flex={1} minHeight={0} p={1}>
                <Paper
                  variant="outlined"
                  sx={{ height: "100%", p: 2, minHeight: 0 }}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    Ask AI about this file
                  </Typography>

                  <Box
                    sx={{
                      height: "100%",
                      borderRadius: 1,
                      border: "1px dashed",
                      borderColor: "divider",
                      p: 2,
                      color: "text.secondary",
                    }}
                  >
                    AI prompt component goes here
                  </Box>
                </Paper>
              </Box>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
};

export default FileViewer;
