import React, { useRef, useCallback, useEffect, useState } from "react";
import { FixedSizeList as List } from "react-window";
import { invoke } from "@tauri-apps/api/core";
// RawMonacoViewer.tsx
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";

import Editor, { OnMount } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";

function useTauriFileReader(
  fileId: number,
  fileSize: number,
  path?: string,
  chunkSize = 64 * 1024, // 64 KB default, tweak as needed
) {
  const [offset, setOffset] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Reset when file changes
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
  }, [fileId, fileSize, chunkSize, path]);

  const readNextChunk = useCallback(async () => {
    if (isReading || !hasMore) return "";

    setIsReading(true);
    try {
      const remaining = fileSize - offset;
      if (remaining <= 0) {
        setHasMore(false);
        return "";
      }

      const length = Math.min(chunkSize, remaining);
      let text = "";

      if (offset === 0) {
        // First read – prefix
        text = await invoke<string>("read_file_prefix", {
          fileId: fileId,
          length,
          path,
        });
      } else {
        text = await invoke<string>("read_file_slice", {
          fileId: fileId,
          offset,
          length,
          path,
        });
      }

      const newOffset = offset + length;
      setOffset(newOffset);

      if (!text || text.length === 0 || newOffset >= fileSize) {
        setHasMore(false);
      }

      return text;
    } finally {
      setIsReading(false);
    }
  }, [fileId, fileSize, chunkSize, offset, isReading, hasMore, path]);

  return { readNextChunk, hasMore, isReading, offset };
}

interface RawViewerProps {
  /** File identifier understood by your backend (same as before) */
  fileId: number;
  fileSize: number;
  path?: string;
  /** Height of the editor viewport in px */
  height?: number | string;
  /** Width of the editor viewport in px */
  width?: number | string;

  /** Bytes per chunk */
  chunkSize?: number;

  /** Monaco language id ("plaintext", "json", "log", etc.) */
  language?: string;

  /** Monaco theme ("vs-dark", "light", or a custom one) */
  theme?: string;

  /** Extra className for the wrapping Card */
  className?: string;

  /** Inline sx prop forwarded to MUI Card */
  sx?: object;

  /**
   * Optional safety limit: max bytes to load into Monaco.
   * If you deal with *very* large files you can cap it (e.g. 50 * 1024 * 1024).
   * If undefined, it will try to load the whole file.
   */
  maxBytesToLoad?: number;
}

const RawViewer: React.FC<RawViewerProps> = ({
  fileId,
  fileSize,
  path,
  height = "100%",
  width = "100%",
  chunkSize = 64 * 1024,
  language = "plaintext",
  theme = "vs-dark",
  className,
  sx,
  maxBytesToLoad,
}) => {
  const { readNextChunk, hasMore, isReading } = useTauriFileReader(
    fileId,
    fileSize,
    path,
    chunkSize,
  );

  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const monacoRef = useRef<typeof monacoEditor | null>(null);

  // We don't keep the full content in React state – just track length & errors.
  const contentLengthRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const canLoadMore = hasMore && !truncated;

  const resetEditorContent = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (model) {
      model.setValue("");
    }
    contentLengthRef.current = 0;
    setTruncated(false);
    setLoadError(null);
  }, []);

  const appendToEditor = useCallback(
    (chunk: string) => {
      if (!editorRef.current || !monacoRef.current || !chunk) return;

      const editor = editorRef.current;
      const monaco = monacoRef.current;
      const model = editor.getModel();
      if (!model) return;

      // Optional: enforce maxBytesToLoad
      const currentLength = contentLengthRef.current;
      if (
        typeof maxBytesToLoad === "number" &&
        currentLength >= maxBytesToLoad
      ) {
        setTruncated(true);
        return;
      }

      let textToInsert = chunk;
      if (
        typeof maxBytesToLoad === "number" &&
        currentLength + chunk.length > maxBytesToLoad
      ) {
        const remaining = maxBytesToLoad - currentLength;
        textToInsert = chunk.slice(0, remaining);
        setTruncated(true);
      }

      const lineCount = model.getLineCount();
      const lastLineLength = model.getLineMaxColumn(lineCount);

      // Efficient append using applyEdits
      model.applyEdits([
        {
          range: new monaco.Range(
            lineCount,
            lastLineLength,
            lineCount,
            lastLineLength,
          ),
          text: textToInsert,
          forceMoveMarkers: true,
        },
      ]);

      contentLengthRef.current = currentLength + textToInsert.length;
    },
    [maxBytesToLoad],
  );

  const loadMore = useCallback(async () => {
    if (!canLoadMore || isReading) return;
    try {
      const chunk = await readNextChunk();
      if (!chunk) return;
      appendToEditor(chunk);
    } catch (err) {
      console.error(err);
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [canLoadMore, isReading, readNextChunk, appendToEditor]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorReady(true);
  };
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  // When fileId changes and editor is ready: clear and load first chunk
  useEffect(() => {
    if (!isEditorReady) return;

    resetEditorContent();
    void loadMoreRef.current();
  }, [fileId, isEditorReady, resetEditorContent]);

  // Attach scroll listener to load more when near bottom
  useEffect(() => {
    if (!isEditorReady || !editorRef.current) return;

    const editor = editorRef.current;

    const disposable = editor.onDidScrollChange((e) => {
      const domNode = editor.getDomNode();
      if (!domNode) return;

      // Distance from bottom in px
      const clientHeight = domNode.clientHeight;
      const distanceFromBottom = e.scrollHeight - (e.scrollTop + clientHeight);

      // Tune this threshold as needed
      if (distanceFromBottom < 2000) {
        void loadMore();
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [isEditorReady, loadMore]);

  return (
    <Card className={className} sx={{ maxWidth: width, height: "100%", ...sx }}>
      <CardContent sx={{ p: 0, position: "relative", height: "100%" }}>
        <Editor
          height={height}
          width="100%"
          defaultLanguage={language}
          defaultValue=""
          theme={theme}
          onMount={handleEditorDidMount}
          options={{
            readOnly: true,
            wordWrap: "off",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: "boundary",
            renderLineHighlight: "none",
            automaticLayout: true,
          }}
        />

        {/* Loading indicator */}
        {isReading && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 0,
              right: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            <CircularProgress size={18} thickness={4} />
            <span style={{ fontSize: 14, color: "#666" }}>Loading…</span>
          </div>
        )}

        {/* EOF / truncated indicator */}
        {!canLoadMore && !isReading && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 12,
              color: "#999",
              pointerEvents: "none",
            }}
          >
            {truncated ? "Reached client size limit – view truncated" : "EOF"}
          </div>
        )}

        {/* Error indicator */}
        {loadError && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 12,
              color: "red",
              pointerEvents: "none",
            }}
          >
            Error while reading file: {loadError}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RawViewer;
