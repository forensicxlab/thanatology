import React, {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FixedSizeList as List } from "react-window";
import { Box, LinearProgress, Typography } from "@mui/material";

/* ─────────────── Config ─────────────── */
const CHUNK_SIZE = 64 * 1024;
const CACHE_CAPACITY = 128; // #chunks
const ROW_HEIGHT = 18; // px
const POLL_INTERVAL_MS = 5_000; // watch for file growth

/* ─────────────── Types ─────────────── */
interface RawViewerProps {
  path: string;
}
interface RowData {
  getLine: (idx: number) => Promise<string>;
  widthDigits: number;
}
class LRU<K, V> {
  readonly #map = new Map<K, V>();
  constructor(private cap: number) {}
  get(k: K) {
    const v = this.#map.get(k);
    if (v !== undefined) {
      this.#map.delete(k);
      this.#map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V) {
    if (this.#map.has(k)) this.#map.delete(k);
    this.#map.set(k, v);
    if (this.#map.size > this.cap) {
      const first = this.#map.keys().next().value;
      this.#map.delete(first);
    }
  }
}

/* ─────────────── Component ─────────────── */
const RawViewer: React.FC<RawViewerProps> = ({ path }) => {
  /* file size & line-offset index */
  const [fileSize, setFileSize] = useState(0);
  const [newlines, setNewlines] = useState<Uint32Array | null>(null);
  const [loadPct, setLoadPct] = useState(0); // for progress bar

  /* chunk cache identical to HexViewer’s */
  const cacheRef = useRef(new LRU<number, Uint8Array>(CACHE_CAPACITY));
  const fetchChunk = useCallback(
    async (chunkStart: number): Promise<Uint8Array> => {
      const cached = cacheRef.current.get(chunkStart);
      if (cached) return cached;
      const length = Math.min(CHUNK_SIZE, fileSize - chunkStart);
      const data: number[] = await invoke("read_chunk", {
        path,
        offset: chunkStart,
        length,
      });
      const buf = Uint8Array.from(data);
      cacheRef.current.set(chunkStart, buf);
      return buf;
    },
    [path, fileSize],
  );

  /* ───── Build/extend the newline index ───── */
  useEffect(() => {
    let cancelled = false;

    const buildIndex = async () => {
      const size: number = await invoke("file_size", { path });
      if (cancelled) return;
      setFileSize(size);

      const indices: number[] = [];
      let processed = 0;

      for (let off = 0; off < size; off += CHUNK_SIZE) {
        const length = Math.min(CHUNK_SIZE, size - off);
        const bytes: number[] = await invoke("read_chunk", {
          path,
          offset: off,
          length,
        });
        for (let i = 0; i < length; i++)
          if (bytes[i] === 0x0a /* '\n' */) indices.push(off + i);
        processed += length;
        if (cancelled) return;
        setLoadPct(Math.round((processed / size) * 100));
      }
      if (cancelled) return;
      setNewlines(Uint32Array.from(indices));
    };

    buildIndex().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [path]);

  /* auto-grow index if the file grows (e.g. live log) */
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const size: number = await invoke("file_size", { path });
        if (size > fileSize && newlines) {
          // read the appended part
          const startOff = fileSize;
          const extraOff = [];
          for (let off = startOff; off < size; off += CHUNK_SIZE) {
            const length = Math.min(CHUNK_SIZE, size - off);
            const bytes: number[] = await invoke("read_chunk", {
              path,
              offset: off,
              length,
            });
            for (let i = 0; i < length; i++)
              if (bytes[i] === 0x0a) extraOff.push(off + i);
          }
          if (extraOff.length) {
            const merged = new Uint32Array(newlines.length + extraOff.length);
            merged.set(newlines, 0);
            merged.set(extraOff, newlines.length);
            setNewlines(merged);
          }
          setFileSize(size);
        }
      } catch (e) {
        console.error(e);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [path, fileSize, newlines]);

  /* ───── Line-fetch helper ───── */
  const getLine = useCallback(
    async (idx: number): Promise<string> => {
      if (!newlines) return ""; // not ready
      const start = idx === 0 ? 0 : newlines[idx - 1] + 1;
      const end = idx < newlines.length ? newlines[idx] : fileSize;
      let remaining = end - start;
      let cursor = start;

      const parts: Uint8Array[] = [];
      while (remaining > 0) {
        const chunkStart = (cursor >>> 16) << 16; // faster Math.floor(x / 65536) * 65536
        const chunk = await fetchChunk(chunkStart);
        const innerOff = cursor - chunkStart;
        const take = Math.min(chunk.length - innerOff, remaining);
        parts.push(chunk.subarray(innerOff, innerOff + take));
        cursor += take;
        remaining -= take;
      }
      const merged =
        parts.length === 1
          ? parts[0]
          : (() => {
              const buf = new Uint8Array(end - start);
              let p = 0;
              for (const seg of parts) {
                buf.set(seg, p);
                p += seg.length;
              }
              return buf;
            })();
      // strip trailing CR (for CRLF files)
      if (merged.length && merged[merged.length - 1] === 0x0d)
        return new TextDecoder().decode(merged.subarray(0, merged.length - 1));
      return new TextDecoder().decode(merged);
    },
    [newlines, fileSize, fetchChunk],
  );

  /* digits for the line-number gutter */
  const widthDigits = useMemo(() => {
    const lines = (newlines?.length ?? 0) + (fileSize ? 1 : 0);
    return Math.max(4, Math.floor(Math.log10(Math.max(1, lines))) + 1);
  }, [newlines, fileSize]);

  /* memoised row renderer ------------------------------------------- */
  const Row = memo(
    ({
      index,
      style,
      data,
    }: {
      index: number;
      style: CSSProperties;
      data: RowData;
    }) => {
      const { getLine, widthDigits } = data;
      const [text, setText] = useState<string>("");

      useEffect(() => {
        let mounted = true;
        getLine(index)
          .then((t) => mounted && setText(t))
          .catch((e) => mounted && setText(`⚠️ ${e}`));
        return () => {
          mounted = false;
        };
      }, [index, getLine]);

      return (
        <Box
          sx={{
            ...style,
            display: "flex",
            gap: 2,
            fontFamily: "Roboto Mono, monospace",
            fontSize: 13,
            lineHeight: `${ROW_HEIGHT}px`,
            whiteSpace: "pre",
            px: 1,
          }}
        >
          <Typography
            component="span"
            color="text.disabled"
            sx={{
              userSelect: "none",
              width: `${widthDigits}ch`,
              textAlign: "right",
            }}
          >
            {index + 1}
          </Typography>
          <Typography component="span" sx={{ flex: 1 }}>
            {text}
          </Typography>
        </Box>
      );
    },
    (prev, next) => prev.index === next.index, // no extra props to watch
  );

  /* data object for react-window */
  const rowData = useMemo<RowData>(
    () => ({ getLine, widthDigits }),
    [getLine, widthDigits],
  );

  /* render ----------------------------------------------------------- */
  if (!newlines) {
    return (
      <Box height="100%" display="flex" flexDirection="column">
        <LinearProgress variant="determinate" value={loadPct} />
        <Box
          flex={1}
          display="flex"
          alignItems="center"
          justifyContent="center"
          fontStyle="italic"
          color="text.secondary"
        >
          Indexing file… {loadPct} %
        </Box>
      </Box>
    );
  }

  const totalLines = newlines.length + 1;

  return (
    <Box height="100%" overflow="hidden">
      <List
        height={window.innerHeight} /* viewer fills its column */
        width="100%"
        itemCount={totalLines}
        itemSize={ROW_HEIGHT}
        itemData={rowData}
      >
        {Row}
      </List>
    </Box>
  );
};

export default RawViewer;
