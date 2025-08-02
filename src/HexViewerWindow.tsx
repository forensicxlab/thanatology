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
import HexViewer, { ByteRange, HexViewerHandle } from "./HexViewer";

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

/* ──────────────────── Inspector helpers ──────────────────── */

interface InspectorValues {
  int8?: number;
  int16?: number;
  int24?: number;
  int32?: number;
  float32?: number;
  int64?: bigint;
}

const toHex = (n: number | bigint | undefined) =>
  n === undefined ? "-" : "0x" + n.toString(16).toUpperCase();

/* ──────────────────── Constants ──────────────────── */

const drawerWidthLeft = 260;
const drawerWidthRight = 300;

/* ──────────────────── Component ──────────────────── */

interface HexViewerWindowProps {
  /** Absolute or app-relative file path */
  path: string;
}

const HexViewerWindow = forwardRef<HexViewerHandle, HexViewerWindowProps>(
  ({ path }, ref) => {
    const viewerRef = useRef<HexViewerHandle>(null);

    /* ─────────────── UI state ─────────────── */
    const [gotoOffset, setGotoOffset] = useState("");
    const [searchPattern, setSearchPattern] = useState("");
    const [fileSize, setFileSize] = useState<number | null>(null);

    /* Selection & inspector */
    const [selection, setSelection] = useState<ByteRange | null>(null);
    const [inspector, setInspector] = useState<InspectorValues>({});

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

    /* ─────────────── Selection → Inspector ─────────────── */
    useEffect(() => {
      let cancelled = false;

      const computeInspector = async () => {
        if (!selection) {
          setInspector({});
          return;
        }
        const length = selection.end - selection.start + 1;
        const readLen = Math.min(8, length); // we never need more than 8 bytes
        try {
          const data: number[] = await invoke("read_chunk", {
            path,
            offset: selection.start,
            length: readLen,
          });
          if (cancelled) return;
          const buf = Uint8Array.from(data);
          const dv = new DataView(buf.buffer);

          const vals: InspectorValues = {};
          if (buf.length >= 1) vals.int8 = dv.getUint8(0);
          if (buf.length >= 2) vals.int16 = dv.getUint16(0, true);
          if (buf.length >= 3)
            vals.int24 =
              dv.getUint8(0) | (dv.getUint8(1) << 8) | (dv.getUint8(2) << 16);
          if (buf.length >= 4) {
            vals.int32 = dv.getUint32(0, true);
            vals.float32 = dv.getFloat32(0, true);
          }
          if (buf.length >= 8) vals.int64 = dv.getBigUint64(0, true);

          setInspector(vals);
        } catch (err) {
          console.error("Failed to read selection bytes:", err);
          setInspector({});
        }
      };

      computeInspector();
      return () => {
        cancelled = true;
      };
    }, [selection, path]);

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

            {/* ───────────── Data Inspector ───────────── */}
            <Typography variant="subtitle1" gutterBottom>
              Data Inspector (Little-endian)
            </Typography>
            <List dense disablePadding>
              {[
                { label: "8-bit Integer", val: inspector.int8 },
                { label: "16-bit Integer", val: inspector.int16 },
                { label: "24-bit Integer", val: inspector.int24 },
                { label: "32-bit Integer", val: inspector.int32 },
                { label: "32-bit Float", val: inspector.float32 },
                { label: "64-bit Integer (+)", val: inspector.int64 },
              ].map(({ label, val }) => (
                <ListItem key={label} sx={{ py: 0 }}>
                  <ListItemText
                    primary={label}
                    secondary={
                      val === undefined
                        ? "–"
                        : typeof val === "number"
                          ? `${val} (${toHex(val)})`
                          : `${val.toString()} (${toHex(val)})`
                    }
                  />
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
            onSelectionChange={setSelection}
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

            {/* ───────────── Search ───────────── */}
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

export default HexViewerWindow;
