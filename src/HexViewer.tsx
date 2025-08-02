import React, {
  CSSProperties,
  ForwardedRef,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  memo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FixedSizeList as List } from "react-window";
import { Box, Divider, Typography } from "@mui/material";

/* ─────────────────────────────── Types ──────────────────────────────────── */
export interface ByteRange {
  start: number;
  end: number;
}
export interface HexViewerProps {
  path: string;
  onSelectionChange?: (range: ByteRange | null) => void;
  pollIntervalMs?: number;
  onFileChanged?: () => void;
}
export interface HexViewerHandle {
  goto(offset: number): void;
  search(
    pattern: Uint8Array,
    opts?: { backward?: boolean },
  ): Promise<number | null>;
}

/* ──────────────────────────── Constants & utils ─────────────────────────── */
const BYTES_PER_ROW = 16;
const CHUNK_SIZE = 64 * 1024;
const CACHE_CAPACITY = 128;
const ROW_HEIGHT = 20;

const CURSOR_STYLE: CSSProperties = {
  outline: "2px solid #1976d2",
  outlineOffset: "-1px",
  borderRadius: "2px",
};

const SELECT_BG_STYLE: CSSProperties = {
  backgroundColor: "#194a5c",
};

const hex = (n: number, len: number) =>
  n.toString(16).toUpperCase().padStart(len, "0");
const isPrintable = (b: number) => b >= 32 && b <= 126;

/* ───────────────────────────── LRU cache ────────────────────────────────── */
class LRU<K, V> {
  readonly #map = new Map<K, V>();
  constructor(private readonly capacity: number) {}
  get(key: K): V | undefined {
    const v = this.#map.get(key);
    if (v !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.capacity) {
      const first = this.#map.keys().next().value;
      this.#map.delete(first);
    }
  }
}

/* ─────────────────────── Reducer for selection ──────────────────────────── */
interface SelState {
  anchor: number | null; // first byte clicked when starting / extending a range
  range: ByteRange | null; // highlighted range (null = none)
}
type SelAction =
  | { type: "clear" }
  | { type: "click"; offset: number; extend: boolean; toggle: boolean }
  | { type: "extend"; offset: number };

const selReducer = (state: SelState, action: SelAction): SelState => {
  switch (action.type) {
    case "clear":
      return { anchor: null, range: null };

    case "click": {
      /* Ctrl / Cmd toggles selection off if we already have one */
      if (action.toggle && state.range) return { anchor: null, range: null };

      /* Shift extends an existing anchor */
      if (action.extend && state.anchor !== null) {
        const start = Math.min(state.anchor, action.offset);
        const end = Math.max(state.anchor, action.offset);
        return { anchor: state.anchor, range: { start, end } };
      }

      /* Plain click = single-byte cursor/range */
      return {
        anchor: action.offset,
        range: { start: action.offset, end: action.offset },
      };
    }

    case "extend": {
      if (state.anchor === null) return state;
      const start = Math.min(state.anchor, action.offset);
      const end = Math.max(state.anchor, action.offset);
      return { anchor: state.anchor, range: { start, end } };
    }
  }
};

/* ───────────────────────────── Row types ─────────────────────────────────── */
interface RowData {
  getRowSlice: (row: number) => Promise<Uint8Array>;
  selRange: ByteRange | null;
  cursor: number | null;
  onByteMouseDown: (e: MouseEvent, off: number) => void;
  onByteMouseEnter: (e: MouseEvent, off: number) => void;
  offsetDigits: number;
}

/* ───────────────────────────── Component ────────────────────────────────── */
const HexViewer = forwardRef(
  (props: HexViewerProps, ref: ForwardedRef<HexViewerHandle>) => {
    const {
      path,
      onSelectionChange,
      pollIntervalMs = 5000,
      onFileChanged,
    } = props;

    /* ─────────────── file-level state ─────────────── */
    const [fileSize, setFileSize] = useState(0);
    const offsetDigits = useMemo(
      () => Math.max(8, Math.ceil(Math.log2(Math.max(fileSize, 1)) / 4)),
      [fileSize],
    );
    const totalRows = useMemo(
      () => Math.ceil(fileSize / BYTES_PER_ROW),
      [fileSize],
    );

    /* ─────────────── chunk cache ─────────────── */
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

    /* ─────────────── helpers ─────────────── */
    const getRowSlice = useCallback(
      async (rowIdx: number) => {
        const offset = rowIdx * BYTES_PER_ROW;
        const chunkStart = Math.floor(offset / CHUNK_SIZE) * CHUNK_SIZE;
        const chunk = await fetchChunk(chunkStart);
        return chunk.slice(
          offset - chunkStart,
          offset - chunkStart + BYTES_PER_ROW,
        );
      },
      [fetchChunk],
    );

    const initialLoad = useCallback(async () => {
      const size: number = await invoke("file_size", { path });
      setFileSize(size);
    }, [path]);

    /* ─────────────── polling ─────────────── */
    useEffect(() => {
      initialLoad().catch(console.error);
      const id = window.setInterval(async () => {
        try {
          const newSize: number = await invoke("file_size", { path });
          if (newSize !== fileSize) {
            setFileSize(newSize);
            cacheRef.current = new LRU<number, Uint8Array>(CACHE_CAPACITY);
            onFileChanged?.();
          }
        } catch (e) {
          console.error(e);
        }
      }, pollIntervalMs);
      return () => window.clearInterval(id);
    }, [path, pollIntervalMs, fileSize, onFileChanged, initialLoad]);

    /* ─────────────── selection state (+ cursor) ─────────────── */
    const [selState, dispatchSel] = useReducer(selReducer, {
      anchor: null,
      range: null,
    });
    const cursor =
      selState.range && selState.range.start === selState.range.end
        ? selState.range.start
        : selState.range
          ? selState.range.end
          : null;

    useEffect(
      () => onSelectionChange?.(selState.range),
      [selState.range, onSelectionChange],
    );

    /* ─────────────── refs & helpers for focus/scroll ─────────────── */
    const listRef = useRef<List>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusRowRef = useRef(0);
    const ensureVisible = (row: number) =>
      listRef.current?.scrollToItem(
        Math.min(Math.max(row, 0), totalRows - 1),
        "smart",
      );

    /* ─────────────── mouse-drag selection ─────────────── */
    const [dragging, setDragging] = useState(false);

    // End drag on global mouse-up
    useEffect(() => {
      const endDrag = () => setDragging(false);
      window.addEventListener("mouseup", endDrag);
      return () => window.removeEventListener("mouseup", endDrag);
    }, []);

    const onByteMouseDown = useCallback((e: MouseEvent, byteOffset: number) => {
      // Prevent the browser's native text-selection
      e.preventDefault();
      e.stopPropagation();

      containerRef.current?.focus();

      dispatchSel({
        type: "click",
        offset: byteOffset,
        extend: e.shiftKey,
        toggle: e.ctrlKey || (e as unknown as KeyboardEvent).metaKey,
      });

      // Start drag only for primary button
      if (
        e.button === 0 &&
        !e.ctrlKey &&
        !(e as unknown as KeyboardEvent).metaKey
      )
        setDragging(true);
    }, []);

    const onByteMouseEnter = useCallback(
      (_e: MouseEvent, byteOffset: number) => {
        if (dragging) dispatchSel({ type: "extend", offset: byteOffset });
      },
      [dragging],
    );

    /* ─────────────── keyboard navigation ─────────────── */
    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent) => {
        let delta: number | null = null;
        switch (e.key) {
          case "ArrowLeft":
            delta = -1;
            break;
          case "ArrowRight":
            delta = 1;
            break;
          case "ArrowUp":
            delta = -BYTES_PER_ROW;
            break;
          case "ArrowDown":
            delta = BYTES_PER_ROW;
            break;
          default:
            return;
        }

        if (delta === null || cursor === null) return;
        e.preventDefault();

        let next = cursor + delta;
        if (next < 0) next = 0;
        if (next >= fileSize) next = fileSize - 1;

        if (e.shiftKey) {
          dispatchSel({ type: "extend", offset: next });
        } else {
          dispatchSel({
            type: "click",
            offset: next,
            extend: false,
            toggle: false,
          });
        }

        const nextRow = Math.floor(next / BYTES_PER_ROW);
        focusRowRef.current = nextRow;
        ensureVisible(nextRow);
      },
      [cursor, fileSize],
    );

    /* ─────────────── grid helpers ─────────────── */
    /** Root-row grid: Offset | Hex grid | ASCII  */
    const rootTemplate = `${offsetDigits}ch auto 1fr`;

    /** Header cells for bytes 00-0F */
    const HEADER_HEX = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
      hex(i, 2),
    );

    const FONT_STACK =
      'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

    const HEX_GRID_CSS: CSSProperties = {
      display: "grid",
      gridTemplateColumns: `repeat(${BYTES_PER_ROW}, minmax(2ch, 2.5ch))`,
      columnGap: "0.1ch",
      fontFamily: FONT_STACK,
    };

    const ASCII_GRID_CSS: CSSProperties = {
      display: "grid",
      gridTemplateColumns: `repeat(${BYTES_PER_ROW}, 1ch)`,
      columnGap: "0.1ch",
      fontFamily: FONT_STACK,
    };

    /* ───────────────────── Row renderer (memoised) ──────────────────── */
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
        const {
          getRowSlice,
          selRange,
          cursor,
          onByteMouseDown,
          onByteMouseEnter,
          offsetDigits,
        } = data;

        const [bytes, setBytes] = useState<Uint8Array>();
        useEffect(() => {
          void getRowSlice(index).then(setBytes).catch(console.error);
        }, [index, getRowSlice]);

        const rowOffset = index * BYTES_PER_ROW;

        const rowSx = {
          ...style,
          display: "grid",
          gridTemplateColumns: `${offsetDigits}ch auto 1fr`,
          alignItems: "center",
          fontFamily: FONT_STACK,
          paddingLeft: "0.5rem",
          paddingRight: "0.5rem",
          cursor: "default",
        } as const;

        const byteSelected = (globalOffset: number) =>
          selRange &&
          globalOffset >= selRange.start &&
          globalOffset <= selRange.end;

        if (!bytes) {
          return (
            <Box sx={rowSx} className="font-mono text-sm leading-5">
              …
            </Box>
          );
        }

        return (
          <Box role="row" aria-rowindex={index + 1} sx={rowSx}>
            {/* ───────── Offset column ───────── */}
            <Box
              display="flex"
              alignItems="center"
              gap={1}
              onMouseDown={(e) => onByteMouseDown(e, rowOffset)}
              onMouseEnter={(e) => onByteMouseEnter(e, rowOffset)}
              sx={{
                cursor: "pointer",
              }}
            >
              <Typography
                component="span"
                color="text.secondary"
                sx={{ fontSize: "0.75rem", paddingRight: 1 }}
              >
                {hex(rowOffset, offsetDigits)}
              </Typography>
              <Divider orientation="vertical" flexItem />
            </Box>

            {/* ───────── Hexadecimal bytes ───────── */}
            <Box className="select-none" sx={HEX_GRID_CSS}>
              {Array.from(bytes).map((b, i) => {
                const globalOffset = rowOffset + i;
                const isCursor = cursor === globalOffset;
                const isSel = byteSelected(globalOffset);
                return (
                  <Box
                    key={i}
                    component="span"
                    sx={{
                      textAlign: "center",
                      fontSize: "0.75rem",
                      lineHeight: "1.25rem",
                      display: "inline-block",
                      width: "100%",
                      ...(i === 7 ? { marginRight: "1ch" } : {}),
                      ...(isSel ? SELECT_BG_STYLE : {}),
                      ...(isCursor ? CURSOR_STYLE : {}),
                    }}
                    onMouseDown={(e) => onByteMouseDown(e, globalOffset)}
                    onMouseEnter={(e) => onByteMouseEnter(e, globalOffset)}
                    style={{ cursor: "pointer" }}
                  >
                    {hex(b, 2)}
                  </Box>
                );
              })}
            </Box>

            {/* ───────── ASCII bytes ───────── */}
            <Box display="flex" alignItems="center" gap={1}>
              <Divider orientation="vertical" flexItem />
              <Box className="select-none" sx={ASCII_GRID_CSS}>
                {Array.from(bytes).map((b, i) => {
                  const globalOffset = rowOffset + i;
                  const isCursor = cursor === globalOffset;
                  const isSel = byteSelected(globalOffset);
                  return (
                    <Typography
                      component="span"
                      key={i}
                      sx={{
                        textAlign: "center",
                        fontSize: "0.75rem",
                        lineHeight: "1.25rem",
                        display: "inline-block",
                        width: "100%",
                        ...(i === 7 ? { marginRight: "1ch" } : {}),
                        ...(isSel ? SELECT_BG_STYLE : {}),
                        ...(isCursor ? CURSOR_STYLE : {}),
                      }}
                      onMouseDown={(e) => onByteMouseDown(e, globalOffset)}
                      onMouseEnter={(e) => onByteMouseEnter(e, globalOffset)}
                      style={{ cursor: "pointer" }}
                    >
                      {isPrintable(b) ? String.fromCharCode(b) : "."}
                    </Typography>
                  );
                })}
              </Box>
            </Box>
          </Box>
        );
      },
      (prev, next) => {
        if (prev.index !== next.index) return false; // different row
        if (prev.data.cursor !== next.data.cursor) return false; // cursor moved

        const a = prev.data.selRange;
        const b = next.data.selRange;

        // Re-render iff the selection really changed
        return a?.start === b?.start && a?.end === b?.end;
      },
    );

    /* ─────────────── imperative API ─────────────── */
    const gotoInternal = (offset: number) => {
      const row = Math.floor(offset / BYTES_PER_ROW);
      focusRowRef.current = row;
      ensureVisible(row);
      containerRef.current?.focus();
      dispatchSel({ type: "click", offset, extend: false, toggle: false });
    };

    const searchInternal = useCallback(
      async (
        pattern: Uint8Array,
        opts?: { backward?: boolean },
      ): Promise<number | null> => {
        if (!pattern.length) return null;
        const dir = opts?.backward ? -1 : 1;
        let pos = selState.range ? selState.range.start : 0;
        if (dir === 1) pos += 1;
        const limit = dir === 1 ? fileSize - pattern.length : 0;
        const delta = dir * CHUNK_SIZE;

        const buffer = new Uint8Array(CHUNK_SIZE + pattern.length);
        for (
          let off = Math.floor(pos / CHUNK_SIZE) * CHUNK_SIZE;
          dir === 1 ? off <= limit : off >= limit;
          off += delta
        ) {
          const chunk = await fetchChunk(Math.max(0, off));
          buffer.set(chunk, 0);
          if (chunk.length < CHUNK_SIZE && dir === 1)
            buffer.fill(0, chunk.length);
          const view = buffer.subarray(0, chunk.length);
          const idx =
            dir === 1
              ? forwardFind(view, pattern)
              : backwardFind(view, pattern);
          if (idx !== -1) {
            const found = off + idx;
            gotoInternal(found);
            return found;
          }
        }
        return null;
      },
      [fetchChunk, fileSize, selState.range],
    );

    useImperativeHandle(ref, () => ({
      goto: gotoInternal,
      search: searchInternal,
    }));

    /* ─────────────────────────── render ─────────────────────────── */
    const headerSx: CSSProperties = {
      display: "grid",
      gridTemplateColumns: rootTemplate,
      padding: "0.25rem 0.5rem",
      fontFamily: FONT_STACK,
    };

    const itemData = useMemo<RowData>(
      () => ({
        getRowSlice,
        selRange: selState.range,
        cursor,
        onByteMouseDown,
        onByteMouseEnter,
        offsetDigits,
      }),
      [
        getRowSlice,
        selState.range?.start,
        selState.range?.end,
        cursor,
        onByteMouseDown,
        onByteMouseEnter,
        offsetDigits,
      ],
    );

    return (
      <Box
        role="grid"
        className="select-none"
        tabIndex={0}
        ref={containerRef}
        onKeyDown={handleKeyDown}
        sx={{ outline: "none", userSelect: "none", WebkitUserSelect: "none" }}
      >
        {/* Header */}
        <Box
          sx={headerSx}
          className="text-xs text-gray-500 border-b border-slate-500/40 sticky top-0 bg-white/80 backdrop-blur"
        >
          <Box display="flex" alignItems="center" gap={1}>
            <Typography component="span" sx={{ paddingRight: 1 }} />
          </Box>
          {/* Hex header */}
          <Box sx={HEX_GRID_CSS}>
            {HEADER_HEX.map((h, i) => (
              <Typography
                component="span"
                key={i}
                sx={{
                  textAlign: "center",
                  display: "inline-block",
                  width: "100%",
                  fontSize: "0.75rem",
                  lineHeight: "1.25rem",
                  ...(i === 7 ? { marginRight: "1ch" } : {}),
                }}
              >
                {h}
              </Typography>
            ))}
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Divider orientation="vertical" flexItem />
          </Box>
        </Box>
        <Divider flexItem />

        {/* Body */}
        <List
          height={1000}
          width="100%"
          itemCount={totalRows}
          itemSize={ROW_HEIGHT}
          ref={listRef}
          itemData={itemData}
        >
          {Row}
        </List>
      </Box>
    );
  },
);

export default HexViewer;

/* ───────────────────────── search helpers ───────────────────────── */
const forwardFind = (buf: Uint8Array, pat: Uint8Array): number => {
  outer: for (let i = 0; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++)
      if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
};
const backwardFind = (buf: Uint8Array, pat: Uint8Array): number => {
  outer: for (let i = buf.length - pat.length; i >= 0; i--) {
    for (let j = 0; j < pat.length; j++)
      if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
};
