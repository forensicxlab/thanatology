import React, { useCallback, useEffect, useState } from "react";
import { FixedSizeList as List } from "react-window";
import { invoke } from "@tauri-apps/api/core";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";

function useTauriFileReader(fileId: number, chunkSize = 256, fileSize: number) {
  const [offset, setOffset] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const readNextChunk = useCallback(async () => {
    if (isReading || !hasMore) return "";

    setIsReading(true);

    try {
      const length = chunkSize;
      let text = "";

      if (offset === 0) {
        // First read – grab the prefix.
        text = await invoke<string>("read_file_prefix", {
          fileId: fileId,
          length,
        });
      } else {
        text = await invoke<string>("read_file_slice", {
          fileId: fileId,
          offset,
          length,
        });
      }

      const newOffset = offset + length;
      setOffset(newOffset);

      if (text.length === 0 || newOffset >= fileSize) {
        setHasMore(false);
      }
      return text;
    } finally {
      setIsReading(false);
    }
  }, [fileId, chunkSize, offset, isReading, hasMore]);

  return { readNextChunk, hasMore, isReading };
}

interface RawViewerProps {
  /** Absolute or relative path recognised by backend */
  fileId: number;
  fileSize: number;
  /** Height of the list viewport in px */
  height?: number;
  /** Width of the list viewport in px */
  width?: number | string;
  /** Approximate height of a single text line in px */
  lineHeight?: number;
  /** Bytes per chunk */
  chunkSize?: number;
  /** Additional className for the wrapping Card */
  className?: string;
  /** Inline sx prop forwarded to MUI Card */
  sx?: object;
}

/**
 * A virtualised text viewer that streams huge files chunk‑by‑chunk from the filesystem
 * via Tauri commands, keeping memory usage low and UX snappy.
 */
const RawViewer: React.FC<RawViewerProps> = ({
  fileId,
  fileSize,
  height = 600,
  width = "100%",
  lineHeight = 20,
  chunkSize,
  className,
  sx,
}) => {
  const { readNextChunk, hasMore, isReading } = useTauriFileReader(
    fileId,
    chunkSize,
    fileSize,
  );

  const [lines, setLines] = useState<string[]>([]);

  // Initial load
  useEffect(() => {
    (async () => {
      const chunk = await readNextChunk();
      if (!chunk) return;
      setLines([chunk]); // Just append the raw chunk as-is
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Load more when we scroll near the end
  const loadMoreLines = useCallback(async () => {
    if (!hasMore || isReading) return;
    const chunk = await readNextChunk();
    if (!chunk) return;

    setLines((prev) => [...prev, chunk]);
  }, [readNextChunk, hasMore, isReading]);

  const handleScroll = ({ scrollOffset }: { scrollOffset: number }) => {
    const threshold = (lines.length - 100) * lineHeight;
    if (scrollOffset > threshold) {
      loadMoreLines();
    }
  };

  return (
    <Card className={className} sx={{ maxWidth: width, ...sx }}>
      <CardContent sx={{ p: 0 }}>
        <List
          height={height}
          itemCount={lines.length}
          itemSize={lineHeight}
          width={"100%"}
          onScroll={handleScroll}
        >
          {({ index, style }) => (
            <div
              style={style}
              className="whitespace-pre font-mono text-sm px-2"
            >
              {lines[index]}
            </div>
          )}
        </List>
        {isReading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 0",
              gap: 8,
            }}
          >
            <CircularProgress size={18} thickness={4} />
            <span style={{ fontSize: 14, color: "#666" }}>Loading…</span>
          </div>
        )}
        {!hasMore && (
          <div
            style={{
              textAlign: "center",
              padding: "8px 0",
              fontSize: 12,
              color: "#999",
            }}
          >
            EOF
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RawViewer;
