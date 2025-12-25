// thanatology/src/HexViewer.tsx
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
  useLayoutEffect,
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
  fileId: number;
  fileSize: number;

  /** Height of the viewer (default "100%") */
  height?: number | string;

  /** Called when selection changes (debounced while dragging) */
  onSelectionChange?: (range: ByteRange | null) => void;

  /** Debounce delay for onSelectionChange while dragging (default 120ms) */
  selectionDebounceMs?: number;
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
  anchor: number | null;
  range: ByteRange | null;
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
      if (action.toggle && state.range) return { anchor: null, range: null };
      if (action.extend && state.anchor !== null) {
        const start = Math.min(state.anchor, action.offset);
        const end = Math.max(state.anchor, action.offset);
        return { anchor: state.anchor, range: { start, end } };
      }
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
  fileSize: number;
}

function clampOffset(off: number, fileSize: number): number | null {
  if (fileSize <= 0) return null;
  if (off < 0) return 0;
  if (off >= fileSize) return fileSize - 1;
  return off;
}

/* ───────────────────────── Resize observer hook ─────────────────────────── */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({ width: cr.width, height: cr.height });
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

/* ───────────────────────────── Row renderer ─────────────────────────────── */
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

const HexRow = memo(
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
      fileSize,
    } = data;

    const [bytes, setBytes] = useState<Uint8Array>();

    useEffect(() => {
      let cancelled = false;
      void getRowSlice(index)
        .then((b) => {
          if (!cancelled) setBytes(b);
        })
        .catch(console.error);
      return () => {
        cancelled = true;
      };
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
        {/* Offset */}
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          onMouseDown={(e) => onByteMouseDown(e, rowOffset)}
          onMouseEnter={(e) => onByteMouseEnter(e, rowOffset)}
          sx={{ cursor: "pointer" }}
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

        {/* Hex bytes */}
        <Box className="select-none" sx={HEX_GRID_CSS}>
          {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
            const globalOffset = rowOffset + i;
            const b = bytes[i];
            const outOfFile = globalOffset >= fileSize;
            const isCursor = cursor === globalOffset;
            const isSel = !outOfFile && byteSelected(globalOffset);

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
                  opacity: outOfFile ? 0.35 : 1,
                }}
                onMouseDown={
                  outOfFile
                    ? undefined
                    : (e) => onByteMouseDown(e, globalOffset)
                }
                onMouseEnter={
                  outOfFile
                    ? undefined
                    : (e) => onByteMouseEnter(e, globalOffset)
                }
                style={{ cursor: outOfFile ? "default" : "pointer" }}
              >
                {b === undefined ? "  " : hex(b, 2)}
              </Box>
            );
          })}
        </Box>

        {/* ASCII */}
        <Box display="flex" alignItems="center" gap={1}>
          <Divider orientation="vertical" flexItem />
          <Box className="select-none" sx={ASCII_GRID_CSS}>
            {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
              const globalOffset = rowOffset + i;
              const b = bytes[i];
              const outOfFile = globalOffset >= fileSize;
              const isCursor = cursor === globalOffset;
              const isSel = !outOfFile && byteSelected(globalOffset);

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
                    opacity: outOfFile ? 0.35 : 1,
                  }}
                  onMouseDown={
                    outOfFile
                      ? undefined
                      : (e) => onByteMouseDown(e, globalOffset)
                  }
                  onMouseEnter={
                    outOfFile
                      ? undefined
                      : (e) => onByteMouseEnter(e, globalOffset)
                  }
                  style={{ cursor: outOfFile ? "default" : "pointer" }}
                >
                  {b === undefined
                    ? " "
                    : isPrintable(b)
                      ? String.fromCharCode(b)
                      : "."}
                </Typography>
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  },
  // Keep it simple: let selection/cursor changes re-render visible rows.
  // The big perf win comes from debouncing onSelectionChange (parent work).
  (prev, next) => {
    if (prev.index !== next.index) return false;

    // IMPORTANT: style changes as you scroll
    const ps = prev.style as any;
    const ns = next.style as any;
    if (
      ps.top !== ns.top ||
      ps.left !== ns.left ||
      ps.height !== ns.height ||
      ps.width !== ns.width
    ) {
      return false;
    }

    if (prev.data.fileSize !== next.data.fileSize) return false;
    if (prev.data.cursor !== next.data.cursor) return false;

    const a = prev.data.selRange;
    const b = next.data.selRange;
    return a?.start === b?.start && a?.end === b?.end;
  },
);

/* ───────────────────────────── Component ────────────────────────────────── */
const HexViewer = forwardRef(
  (props: HexViewerProps, ref: ForwardedRef<HexViewerHandle>) => {
    const {
      fileId,
      fileSize,
      height = "100%",
      onSelectionChange,
      selectionDebounceMs = 120,
    } = props;

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
    useEffect(() => {
      cacheRef.current = new LRU<number, Uint8Array>(CACHE_CAPACITY);
    }, [fileId, fileSize]);

    const fetchChunk = useCallback(
      async (chunkStart: number): Promise<Uint8Array> => {
        const cached = cacheRef.current.get(chunkStart);
        if (cached) return cached;

        const length = Math.min(CHUNK_SIZE, Math.max(0, fileSize - chunkStart));
        if (length <= 0) return new Uint8Array();

        const data: number[] = await invoke("read_file_slice_bytes", {
          fileId,
          offset: chunkStart,
          length,
        });

        const buf = Uint8Array.from(data);
        cacheRef.current.set(chunkStart, buf);
        return buf;
      },
      [fileId, fileSize],
    );

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

    /* ─────────────── refs & focus/scroll ─────────────── */
    const listRef = useRef<List>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const focusRowRef = useRef(0);

    const ensureVisible = useCallback(
      (row: number) =>
        listRef.current?.scrollToItem(
          Math.min(Math.max(row, 0), Math.max(0, totalRows - 1)),
          "smart",
        ),
      [totalRows],
    );

    /* ─────────────── mouse-drag selection ─────────────── */
    const [dragging, setDragging] = useState(false);

    // Debounced selection emitter (prevents parent work during drag)
    const emitTimerRef = useRef<number | null>(null);
    const latestRangeRef = useRef<ByteRange | null>(null);

    const flushSelection = useCallback(() => {
      if (!onSelectionChange) return;
      if (emitTimerRef.current !== null) {
        window.clearTimeout(emitTimerRef.current);
        emitTimerRef.current = null;
      }
      onSelectionChange(latestRangeRef.current ?? null);
    }, [onSelectionChange]);

    const scheduleSelection = useCallback(
      (delayMs: number) => {
        if (!onSelectionChange) return;
        if (emitTimerRef.current !== null)
          window.clearTimeout(emitTimerRef.current);
        emitTimerRef.current = window.setTimeout(() => {
          emitTimerRef.current = null;
          onSelectionChange(latestRangeRef.current ?? null);
        }, delayMs);
      },
      [onSelectionChange],
    );

    useEffect(() => {
      return () => {
        if (emitTimerRef.current !== null)
          window.clearTimeout(emitTimerRef.current);
      };
    }, []);

    // End drag + flush selection on global mouse-up
    useEffect(() => {
      const onUp = () => {
        if (dragging) {
          setDragging(false);
          flushSelection();
        }
      };
      window.addEventListener("mouseup", onUp);
      return () => window.removeEventListener("mouseup", onUp);
    }, [dragging, flushSelection]);

    const onByteMouseDown = useCallback(
      (e: MouseEvent, byteOffset: number) => {
        e.preventDefault();
        e.stopPropagation();

        const clamped = clampOffset(byteOffset, fileSize);
        if (clamped === null) return;

        containerRef.current?.focus();

        dispatchSel({
          type: "click",
          offset: clamped,
          extend: e.shiftKey,
          toggle: e.ctrlKey || (e as unknown as KeyboardEvent).metaKey,
        });

        // Start drag only for primary button
        if (
          e.button === 0 &&
          !e.ctrlKey &&
          !(e as unknown as KeyboardEvent).metaKey
        ) {
          setDragging(true);
        }
      },
      [fileSize],
    );

    const onByteMouseEnter = useCallback(
      (_e: MouseEvent, byteOffset: number) => {
        if (!dragging) return;
        const clamped = clampOffset(byteOffset, fileSize);
        if (clamped === null) return;
        dispatchSel({ type: "extend", offset: clamped });
      },
      [dragging, fileSize],
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

        const nextClamped = clampOffset(cursor + delta, fileSize);
        if (nextClamped === null) return;

        if (e.shiftKey) {
          dispatchSel({ type: "extend", offset: nextClamped });
        } else {
          dispatchSel({
            type: "click",
            offset: nextClamped,
            extend: false,
            toggle: false,
          });
        }

        const nextRow = Math.floor(nextClamped / BYTES_PER_ROW);
        focusRowRef.current = nextRow;
        ensureVisible(nextRow);
      },
      [cursor, fileSize, ensureVisible],
    );

    /* ─────────────── emit selection (debounced while dragging) ─────────────── */
    useEffect(() => {
      latestRangeRef.current = selState.range;

      if (!onSelectionChange) return;

      // If not dragging, emit immediately (click, keyboard)
      if (!dragging) {
        flushSelection();
        return;
      }

      // While dragging, debounce
      scheduleSelection(selectionDebounceMs);
    }, [
      selState.range?.start,
      selState.range?.end,
      selState.range,
      dragging,
      onSelectionChange,
      flushSelection,
      scheduleSelection,
      selectionDebounceMs,
    ]);

    /* ─────────────── imperative API ─────────────── */
    const gotoInternal = (offset: number) => {
      const clamped = clampOffset(offset, fileSize);
      if (clamped === null) return;

      const row = Math.floor(clamped / BYTES_PER_ROW);
      focusRowRef.current = row;
      ensureVisible(row);
      containerRef.current?.focus();
      dispatchSel({
        type: "click",
        offset: clamped,
        extend: false,
        toggle: false,
      });
    };

    const searchInternal = useCallback(
      async (
        pattern: Uint8Array,
        opts?: { backward?: boolean },
      ): Promise<number | null> => {
        if (!pattern.length || fileSize <= 0) return null;

        const dir = opts?.backward ? -1 : 1;
        let pos = selState.range ? selState.range.start : 0;
        if (dir === 1) pos += 1;

        const start = clampOffset(pos, fileSize);
        if (start === null) return null;

        const limit = dir === 1 ? fileSize - pattern.length : 0;
        const step = dir * CHUNK_SIZE;

        for (
          let off = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE;
          dir === 1 ? off <= limit : off >= limit;
          off += step
        ) {
          const readLen = Math.min(
            CHUNK_SIZE + pattern.length - 1,
            Math.max(0, fileSize - off),
          );
          if (readLen <= 0) break;

          const data: number[] = await invoke("read_file_slice_bytes", {
            fileId,
            offset: off,
            length: readLen,
          });

          const view = Uint8Array.from(data);
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
      [fileId, fileSize, selState.range],
    );

    useImperativeHandle(ref, () => ({
      goto: gotoInternal,
      search: searchInternal,
    }));

    /* ─────────────── dynamic list height ─────────────── */
    const { ref: outerRef, size: outerSize } = useElementSize<HTMLDivElement>();
    const headerRef = useRef<HTMLDivElement | null>(null);
    const [headerH, setHeaderH] = useState(0);

    useLayoutEffect(() => {
      const h = headerRef.current?.getBoundingClientRect().height ?? 0;
      setHeaderH(h);
    }, [outerSize.width, outerSize.height]);

    const listHeight = Math.max(0, outerSize.height - headerH - 1);

    /* ─────────────── header ─────────────── */
    const rootTemplate = `${offsetDigits}ch auto 1fr`;
    const HEADER_HEX = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
      hex(i, 2),
    );

    const headerSx: CSSProperties = {
      display: "grid",
      gridTemplateColumns: rootTemplate,
      padding: "0.25rem 0.5rem",
      fontFamily: FONT_STACK,
      flexShrink: 0,
    };

    const itemData = useMemo<RowData>(
      () => ({
        getRowSlice,
        selRange: selState.range,
        cursor,
        onByteMouseDown,
        onByteMouseEnter,
        offsetDigits,
        fileSize,
      }),
      [
        getRowSlice,
        selState.range?.start,
        selState.range?.end,
        cursor,
        onByteMouseDown,
        onByteMouseEnter,
        offsetDigits,
        fileSize,
      ],
    );

    return (
      <Box
        ref={outerRef}
        sx={{
          height,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          role="grid"
          className="select-none"
          tabIndex={0}
          ref={containerRef}
          onKeyDown={handleKeyDown}
          sx={{
            outline: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            minHeight: 0,
          }}
        >
          {/* Header */}
          <Box ref={headerRef} sx={headerSx}>
            <Box display="flex" alignItems="center" gap={1}>
              <Typography component="span" sx={{ paddingRight: 1 }} />
            </Box>

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

          <Divider />

          {/* Body */}
          <Box sx={{ height: listHeight, minHeight: 0 }}>
            <List
              height={listHeight}
              width="100%"
              itemCount={totalRows}
              itemSize={ROW_HEIGHT}
              ref={listRef}
              itemData={itemData}
            >
              {HexRow}
            </List>
          </Box>
        </Box>
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
