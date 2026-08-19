import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Pagination from "@mui/material/Pagination";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import MediaGallery, { MediaEntry } from "./MediaGallery";
import MediaSidebar, { MediaTypeFilter } from "./MediaSidebar";
import {
  searchMediaFiltered,
  getMediaStats,
  type MediaStats,
} from "../../../../../dbutils/sqlite";
import type { File } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";

/* ─── helpers ─────────────────────────────────────────────────────── */

const PAGE_SIZE = 60;

const isMediaMime = (mime?: string | null) =>
  !!mime && /^(image|video|audio)\//i.test(mime);

const kindFromMime = (mime: string): MediaEntry["kind"] =>
  mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : "audio";

const basename = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : "");

/* ─── props ───────────────────────────────────────────────────────── */

interface MediaProps {
  evidenceId: number;
  partitionId: number;
}

/* ─── component ───────────────────────────────────────────────────── */

const Media: React.FC<MediaProps> = ({ evidenceId, partitionId }) => {
  const { start: tfStart, end: tfEnd, fileTimeField } = useTimeFilter();
  // Filter state
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>({
    images: true,
    videos: true,
    audio: true,
  });

  // Data state
  const [files, setFiles] = useState<File[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<MediaStats>({ images: 0, videos: 0, audio: 0, total: 0 });

  // Selection state
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);

  // Debounce timer
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchText);
      setPage(0); // reset to first page on search change
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText]);

  // Reset page on filter change
  useEffect(() => {
    setPage(0);
  }, [typeFilter]);

  // Fetch stats (once per partition)
  useEffect(() => {
    getMediaStats(evidenceId, partitionId)
      .then(setStats)
      .catch(console.error);
  }, [evidenceId, partitionId, tfStart, tfEnd, fileTimeField]);

  // Fetch filtered data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    searchMediaFiltered(evidenceId, partitionId, page * PAGE_SIZE, PAGE_SIZE, {
      searchText: debouncedSearch || undefined,
      includeImages: typeFilter.images,
      includeVideos: typeFilter.videos,
      includeAudio: typeFilter.audio,
    })
      .then(({ rows, rowCount: total }) => {
        if (cancelled) return;
        setFiles(rows);
        setRowCount(total);
        setLoading(false);
      })
      .catch((err) => {
        console.error("searchMediaFiltered error:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [evidenceId, partitionId, page, debouncedSearch, typeFilter, tfStart, tfEnd, fileTimeField]);

  // Convert files → gallery entries
  const media: MediaEntry[] = useMemo(
    () =>
      files
        .filter((r) => isMediaMime(r.sig_mime))
        .map((r) => ({
          id: r.identifier,
          kind: kindFromMime(r.sig_mime!),
          mime: r.sig_mime!,
          label: basename(r.absolute_path) || r.identifier?.toString() || `File ${r.identifier}`,
          size: r.size,
          absolutePath: r.absolute_path,
          hostPath: r.host_path ?? null,
        })),
    [files],
  );

  // Sidebar file click → select + scroll gallery
  const handleSidebarFileSelect = useCallback((file: File) => {
    setSelectedFileId(file.identifier);
  }, []);

  // Gallery click → select + scroll sidebar
  const handleGallerySelect = useCallback((entry: MediaEntry) => {
    setSelectedFileId(entry.id);
  }, []);

  const totalPages = Math.ceil(rowCount / PAGE_SIZE);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        gap: 1,
      }}
    >
      {/* Main content: Sidebar + Gallery */}
      <Box
        sx={{
          display: "flex",
          flexGrow: 1,
          minHeight: 0,
          gap: 1.5,
          overflow: "hidden",
        }}
      >
        {/* Sidebar */}
        <MediaSidebar
          searchText={searchText}
          onSearchChange={setSearchText}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          stats={stats}
          files={files}
          selectedFileId={selectedFileId}
          onFileSelect={handleSidebarFileSelect}
        />

        {/* Gallery */}
        <Box
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.08)",
            backgroundColor: "rgba(28, 28, 30, 0.4)",
          }}
        >
          {/* Gallery header */}
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              px: 2,
              py: 1,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: "0.82rem" }}>
              Media Gallery
              {rowCount > 0 && (
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ color: "text.secondary", ml: 1 }}
                >
                  {rowCount} results
                </Typography>
              )}
            </Typography>
            {loading && (
              <Typography variant="caption" sx={{ color: "primary.main" }}>
                Loading…
              </Typography>
            )}
          </Stack>

          {/* Gallery grid */}
          <MediaGallery
            media={media}
            selectedId={selectedFileId}
            onSelect={handleGallerySelect}
          />
        </Box>
      </Box>

      {/* Pagination */}
      {totalPages > 1 && (
        <Stack direction="row" sx={{ justifyContent: "center", py: 0.5, flexShrink: 0 }}>
          <Pagination
            count={totalPages}
            page={page + 1}
            onChange={(_, p) => setPage(p - 1)}
            size="small"
            shape="rounded"
            sx={{
              "& .MuiPaginationItem-root": {
                color: "text.secondary",
                fontSize: "0.75rem",
                "&.Mui-selected": {
                  backgroundColor: "rgba(10, 132, 255, 0.2)",
                  color: "primary.main",
                },
              },
            }}
          />
        </Stack>
      )}
    </Box>
  );
};

export default Media;
