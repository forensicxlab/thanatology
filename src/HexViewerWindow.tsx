// thanatology/src/HexViewerWindow.tsx
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

const parseHexInput = (input: string): number | null => {
  const cleaned = input.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!cleaned.length) return null;
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? null : n;
};

const formatFileSize = (bytes: number) => `${bytes.toLocaleString()} bytes`;

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

const leftWidth = 260;
const rightWidth = 300;

/* ──────────────────── Component ──────────────────── */

interface HexViewerWindowProps {
  fileId: number;
  fileSize: number;
}

const HexViewerWindow = forwardRef<HexViewerHandle, HexViewerWindowProps>(
  ({ fileId, fileSize }, ref) => {
    const viewerRef = useRef<HexViewerHandle>(null);

    const [gotoOffset, setGotoOffset] = useState("");
    const [searchPattern, setSearchPattern] = useState("");

    const [selection, setSelection] = useState<ByteRange | null>(null);
    const [inspector, setInspector] = useState<InspectorValues>({});

    useImperativeHandle(ref, () => ({
      goto: (o) => viewerRef.current?.goto(o),
      search: (p, opts) =>
        viewerRef.current?.search(p, opts) ?? Promise.resolve(null),
    }));

    const handleGoto = () => {
      const off = parseHexInput(gotoOffset);
      if (off === null) return;
      viewerRef.current?.goto(off);
    };

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

    /* ─────────────── Selection → Inspector (fileId-based bytes) ─────────────── */
    useEffect(() => {
      let cancelled = false;

      const computeInspector = async () => {
        if (!selection) {
          setInspector({});
          return;
        }
        const length = selection.end - selection.start + 1;
        const readLen = Math.min(8, length);

        try {
          const data: number[] = await invoke("read_file_slice_bytes", {
            fileId,
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
    }, [selection, fileId]);

    return (
      <Box
        sx={{
          display: "flex",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* LEFT PANE */}
        <Box
          sx={{
            width: leftWidth,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            overflowY: "auto",
            p: 2,
          }}
        >
          <Typography variant="subtitle1" gutterBottom>
            File Information
          </Typography>
          <List dense disablePadding>
            <ListItem>
              <ListItemText primary="File ID" secondary={String(fileId)} />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="File Size"
                secondary={formatFileSize(fileSize)}
              />
            </ListItem>
          </List>

          <Divider sx={{ my: 2 }} />

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

        {/* MAIN VIEWER */}
        <Box
          sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}
        >
          <HexViewer
            ref={viewerRef}
            fileId={fileId}
            fileSize={fileSize}
            height="100%"
            onSelectionChange={setSelection}
          />
        </Box>

        {/* RIGHT PANE */}
        <Box
          sx={{
            width: rightWidth,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: "divider",
            overflowY: "auto",
            p: 2,
          }}
        >
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
      </Box>
    );
  },
);

export default HexViewerWindow;
