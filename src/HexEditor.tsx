import React, {
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  Drawer,
  Toolbar,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemText,
  TextField,
  Button,
  Stack,
} from "@mui/material";
import HexViewer, { HexViewerHandle } from "./HexViewer";

/* ──────────────────── Helpers ──────────────────── */

/** Parse a hex string such as “0x1A2B”, “1a 2b”, “1A2B” → number | null */
const parseHexInput = (input: string): number | null => {
  const cleaned = input.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!cleaned.length) return null;
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? null : n;
};

/** Human-readable file-size (“12 345 678 bytes”) */
const formatFileSize = (bytes: number) => `${bytes.toLocaleString()} bytes`;

/* ──────────────────── Constants ──────────────────── */

const drawerWidthLeft = 260;
const drawerWidthRight = 300;

/* ──────────────────── Component ──────────────────── */

interface HexEditorProps {
  /** Absolute or app-relative file path */
  path: string;
}

const HexEditor = forwardRef<HexViewerHandle, HexEditorProps>(
  ({ path }, ref) => {
    const viewerRef = useRef<HexViewerHandle>(null);

    /* ─────────────── UI state ─────────────── */
    const [gotoOffset, setGotoOffset] = useState("");
    const [searchPattern, setSearchPattern] = useState("");
    const [fileSize, setFileSize] = useState<number | null>(null);

    /* ─────────────── File-size refresh ─────────────── */
    const refreshFileSize = useCallback(async () => {
      try {
        const size: number = await invoke("file_size", { path });
        setFileSize(size);
      } catch (err) {
        console.error("Failed to read file size:", err);
      }
    }, [path]);

    useEffect(() => {
      refreshFileSize(); // initial load + whenever `path` changes
    }, [refreshFileSize]);

    /* ─────────────── imperative-handle passthrough ─────────────── */
    useImperativeHandle(ref, () => ({
      goto: (o) => viewerRef.current?.goto(o),
      search: (p, opts) =>
        viewerRef.current?.search(p, opts) ?? Promise.resolve(null),
    }));

    /* ─────────────── Go-to logic ─────────────── */
    const handleGoto = () => {
      const off = parseHexInput(gotoOffset);
      if (off === null) {
        console.warn("[Go To] invalid offset:", gotoOffset);
        return;
      }
      viewerRef.current?.goto(off);
    };

    /* ─────────────── (Optional) search logic ─────────────── */
    const hexStringToUint8 = (str: string): Uint8Array =>
      Uint8Array.from(
        str
          .trim()
          .split(/\s+/)
          .map((h) => parseInt(h, 16))
          .filter((b) => !Number.isNaN(b) && b >= 0 && b <= 255),
      );

    const handleFindNext = () => {
      const pat = hexStringToUint8(searchPattern);
      if (pat.length) viewerRef.current?.search(pat);
    };

    const handleFindPrevious = () => {
      const pat = hexStringToUint8(searchPattern);
      if (pat.length) viewerRef.current?.search(pat, { backward: true });
    };

    /* ─────────────── render ─────────────── */
    return (
      <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* ░░░ LEFT DRAWER ░░░ */}
        <Drawer
          variant="permanent"
          anchor="left"
          sx={{
            width: drawerWidthLeft,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidthLeft,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          <Toolbar />
          <Box sx={{ p: 2, overflowY: "auto" }}>
            {/* ───────────── File Information ───────────── */}
            <Typography variant="subtitle1" gutterBottom>
              File Information
            </Typography>
            <List dense disablePadding>
              <ListItem>
                <ListItemText
                  primary="File Name"
                  secondary={path.split("/").pop() ?? "-"}
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="File Size"
                  secondary={fileSize !== null ? formatFileSize(fileSize) : "…"}
                />
              </ListItem>
            </List>

            <Divider sx={{ my: 2 }} />

            {/* ───────────── Data Inspector (placeholder) ───────────── */}
            <Typography variant="subtitle1" gutterBottom>
              Data Inspector (Little-endian)
            </Typography>
            <List dense disablePadding>
              {[
                "8-bit Integer",
                "16-bit Integer",
                "24-bit Integer",
                "32-bit Integer",
                "32-bit Float",
                "64-bit Integer (+)",
              ].map((label) => (
                <ListItem key={label} sx={{ py: 0 }}>
                  <ListItemText primary={label} secondary="0" />
                </ListItem>
              ))}
            </List>
          </Box>
        </Drawer>

        {/* ░░░ MAIN VIEWER ░░░ */}
        <Box component="main" sx={{ flexGrow: 1, overflow: "hidden" }}>
          <Toolbar />
          <HexViewer
            ref={viewerRef}
            path={path}
            onFileChanged={refreshFileSize}
          />
        </Box>

        {/* ░░░ RIGHT DRAWER ░░░ */}
        <Drawer
          variant="permanent"
          anchor="right"
          sx={{
            width: drawerWidthRight,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidthRight,
              boxSizing: "border-box",
              borderLeft: 1,
              borderColor: "divider",
            },
          }}
        >
          <Toolbar />
          <Box sx={{ p: 2, overflowY: "auto" }}>
            {/* ───────────── Go To ───────────── */}
            <Typography variant="subtitle1" gutterBottom>
              Go To
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <TextField
                size="small"
                label="Offset (hex)"
                value={gotoOffset}
                onChange={(e) => setGotoOffset(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleGoto();
                }}
                fullWidth
              />
              <Button variant="contained" onClick={handleGoto}>
                Go
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            {/* ───────────── Search (placeholder) ───────────── */}
            <Typography variant="subtitle1" gutterBottom>
              Search
            </Typography>
            <TextField
              size="small"
              label="Pattern (hex)"
              placeholder="00 00 00"
              value={searchPattern}
              onChange={(e) => setSearchPattern(e.target.value)}
              fullWidth
              sx={{ mb: 1 }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={handleFindPrevious}>
                Find previous
              </Button>
              <Button variant="contained" onClick={handleFindNext}>
                Find next
              </Button>
            </Stack>
          </Box>
        </Drawer>
      </Box>
    );
  },
);

export default HexEditor;
