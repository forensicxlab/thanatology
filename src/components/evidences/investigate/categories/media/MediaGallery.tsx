"use client";
import Lightbox from "yet-another-react-lightbox";
import Video from "yet-another-react-lightbox/plugins/video";
import "yet-another-react-lightbox/styles.css";

import React, { useState, useEffect, useCallback, useRef } from "react";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";

import { getMediaSourceUrl } from "../../../common/mediaSource";



/* ═══════════════════════════════════════════════════════════════════ *
 *  Types                                                             *
 * ═══════════════════════════════════════════════════════════════════ */

type MediaKind = "image" | "video" | "audio";

export interface MediaEntry {
  id: number;
  kind: MediaKind;
  mime: string;
  posterId?: number;
  label?: string;
  size?: number;
  absolutePath?: string;
  hostPath?: string | null;
  /**
   * Optional already-small stand-in used for the tile only (the lightbox still
   * opens `id`). Avoids pulling a multi-megabyte original to paint a thumbnail.
   */
  thumbId?: number;
  thumbHostPath?: string | null;
  thumbMime?: string;
}

interface MediaGalleryProps {
  media: MediaEntry[];
  /** If set, highlights and scrolls to this item */
  selectedId?: number | null;
  /** Called when user clicks a thumbnail */
  onSelect?: (entry: MediaEntry) => void;
  /** Optional per-tile overlay, e.g. forensic state flags. */
  renderBadges?: (entry: MediaEntry) => React.ReactNode;
}

/* ═══════════════════════════════════════════════════════════════════ *
 *  Helpers                                                           *
 * ═══════════════════════════════════════════════════════════════════ */

const loadFile = async (
  id: number,
  mime = "application/octet-stream",
  hostPath?: string | null,
  preview = false,
) => {
  return getMediaSourceUrl({
    fileId: id,
    path: hostPath ?? undefined,
    mime,
    preview,
  });
};

const THUMB_HEIGHT = 180;
const COLUMN_MIN_WIDTH = 200;

/* ═══════════════════════════════════════════════════════════════════ *
 *  Thumbnail card                                                    *
 * ═══════════════════════════════════════════════════════════════════ */

const ThumbnailCard = React.memo(function ThumbnailCard({
  entry,
  isSelected,
  onSelect,
  onLightbox,
  badges,
}: {
  entry: MediaEntry;
  isSelected: boolean;
  onSelect: (e: MediaEntry) => void;
  onLightbox: (e: MediaEntry) => void;
  badges?: React.ReactNode;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(false);

    if (entry.kind !== "image") {
      setLoading(false);
      return;
    }

    // Prefer a supplied thumbnail: it is already small, so it also skips the
    // server-side downscale (which cannot decode HEIC anyway).
    const useThumb = entry.thumbId != null;
    loadFile(
      useThumb ? (entry.thumbId as number) : entry.id,
      useThumb ? (entry.thumbMime ?? "image/jpeg") : entry.mime,
      useThumb ? entry.thumbHostPath : entry.hostPath,
      !useThumb,
    )
      .then((u) => {
        if (mountedRef.current) {
          setBlobUrl(u);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [entry.hostPath, entry.id, entry.kind, entry.mime, entry.thumbId, entry.thumbHostPath, entry.thumbMime]);

  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onLightbox(entry);
  }, [entry, onLightbox]);

  const selectedGlow = isSelected
    ? {
      boxShadow: "0 0 0 2px rgba(10, 132, 255, 0.7), 0 0 16px rgba(10, 132, 255, 0.25)",
      transform: "scale(1.02)",
    }
    : {};

  return (
    <Card
      elevation={2}
      sx={{
        height: THUMB_HEIGHT,
        position: "relative",
        borderRadius: 2,
        overflow: "hidden",
        transition: "box-shadow 0.2s ease, transform 0.15s ease",
        cursor: "pointer",
        "&:hover": {
          boxShadow: isSelected
            ? "0 0 0 2px rgba(10, 132, 255, 0.8), 0 4px 20px rgba(10, 132, 255, 0.3)"
            : "0 4px 20px rgba(0, 0, 0, 0.5)",
          transform: "scale(1.02)",
        },
        ...selectedGlow,
      }}
    >
      {badges && (
        <Box
          sx={{
            position: "absolute",
            top: 6,
            left: 6,
            zIndex: 2,
            display: "flex",
            gap: 0.5,
            pointerEvents: "none",
          }}
        >
          {badges}
        </Box>
      )}
      <CardActionArea
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        sx={{ height: "100%" }}
      >
        {/* Image thumbnail */}
        {entry.kind === "image" && (
          <>
            {loading && (
              <Box
                sx={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(255,255,255,0.03)",
                }}
              >
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Loading…
                </Typography>
              </Box>
            )}
            {error && (
              <Box
                sx={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(255,59,48,0.06)",
                }}
              >
                <Typography variant="caption" sx={{ color: "error.main" }}>
                  Failed
                </Typography>
              </Box>
            )}
            {!loading && !error && blobUrl && (
              <CardMedia
                component="img"
                image={blobUrl}
                alt={entry.label ?? "Image"}
                sx={{ height: "100%", objectFit: "cover" }}
              />
            )}
          </>
        )}

        {/* Video thumbnail */}
        {entry.kind === "video" && (
          <Box sx={{ height: "100%", position: "relative" }}>
            {blobUrl ? (
              <CardMedia
                component="img"
                image={blobUrl}
                alt={entry.label ?? "Video"}
                sx={{ height: "100%", objectFit: "cover" }}
              />
            ) : (
              <Box
                sx={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(48, 209, 88, 0.06)",
                }}
              >
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {loading ? "Loading…" : "Video"}
                </Typography>
              </Box>
            )}
            {/* Play overlay */}
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.3)",
                opacity: 0.85,
                transition: "opacity 0.15s",
                "&:hover": { opacity: 1 },
              }}
            >
              <PlayCircleOutlineIcon
                sx={{ fontSize: 48, color: "rgba(255,255,255,0.9)", filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))" }}
              />
            </Box>
          </Box>
        )}

        {/* Audio card */}
        {entry.kind === "audio" && (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(255, 149, 0, 0.06)",
              px: 2,
              gap: 1,
            }}
          >
            <GraphicEqIcon sx={{ fontSize: 40, color: "warning.main", opacity: 0.7 }} />
            <Typography
              variant="caption"
              noWrap
              sx={{ color: "text.secondary", maxWidth: "100%", textAlign: "center", fontSize: "0.72rem" }}
            >
              {entry.label ?? "Audio file"}
            </Typography>
          </Box>
        )}

        {/* Label overlay */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            px: 1,
            py: 0.5,
            background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          }}
        >
          <Typography
            variant="caption"
            noWrap
            sx={{ color: "rgba(255,255,255,0.85)", fontSize: "0.68rem" }}
          >
            {entry.label}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
});

/* ═══════════════════════════════════════════════════════════════════ *
 *  Lightbox slides builder                                           *
 * ═══════════════════════════════════════════════════════════════════ */

type Slide =
  | { _id: number; type?: undefined; src: string; alt?: string; label?: string }
  | {
    _id: number;
    type: "video";
    poster?: string;
    sources: { src: string; type: string }[];
    label?: string;
  }
  | { _id: number; type: "audio"; src: string; label?: string };

/* ═══════════════════════════════════════════════════════════════════ *
 *  Gallery component                                                 *
 * ═══════════════════════════════════════════════════════════════════ */

export default function MediaGallery({
  media,
  selectedId,
  onSelect,
  renderBadges,
}: MediaGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxSlides, setLightboxSlides] = useState<Slide[]>([]);
  const galleryRef = useRef<HTMLDivElement>(null);

  // Build lightbox slides on demand when opening
  const openLightbox = useCallback(
    async (entry: MediaEntry) => {
      const idx = media.findIndex((m) => m.id === entry.id);
      if (idx < 0) return;

      // Load slides for current page of media
      const slides = await Promise.all(
        media.map(async (m): Promise<Slide> => {
          const src = await loadFile(m.id, m.mime, m.hostPath);
          if (m.kind === "image") {
            return { _id: m.id, src, alt: m.label };
          }
          if (m.kind === "video") {
            return {
              _id: m.id,
              type: "video",
              sources: [{ src, type: m.mime }],
              label: m.label,
            };
          }
          return { _id: m.id, type: "audio", src, label: m.label };
        }),
      );

      setLightboxSlides(slides);
      setLightboxIndex(idx);
      setLightboxOpen(true);
    },
    [media],
  );

  const handleSelect = useCallback(
    (entry: MediaEntry) => {
      onSelect?.(entry);
    },
    [onSelect],
  );

  // Scroll to selected item
  useEffect(() => {
    if (selectedId == null || !galleryRef.current) return;
    const el = galleryRef.current.querySelector(`[data-media-id="${selectedId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedId]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxOpen) return;
      if (!onSelect || media.length === 0) return;

      const currentIdx = selectedId ? media.findIndex((m) => m.id === selectedId) : -1;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, media.length - 1);
        onSelect(media[next]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        onSelect(media[prev]);
      } else if (e.key === "Enter" && currentIdx >= 0) {
        e.preventDefault();
        openLightbox(media[currentIdx]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media, selectedId, onSelect, lightboxOpen, openLightbox]);

  return (
    <Box
      ref={galleryRef}
      sx={{
        flexGrow: 1,
        overflow: "auto",
        p: 1.5,
      }}
    >
      {media.length === 0 ? (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Stack spacing={1} sx={{ alignItems: "center" }}>
            <AudioFileIcon sx={{ fontSize: 48, color: "text.secondary", opacity: 0.4 }} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No media files found
            </Typography>
          </Stack>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${COLUMN_MIN_WIDTH}px, 1fr))`,
            gap: 1.5,
          }}
        >
          {media.map((entry) => (
            <Box key={entry.id} data-media-id={entry.id}>
              <ThumbnailCard
                entry={entry}
                isSelected={entry.id === selectedId}
                onSelect={handleSelect}
                onLightbox={openLightbox}
                badges={renderBadges?.(entry)}
              />
            </Box>
          ))}
        </Box>
      )}

      {/* Lightbox */}
      <Lightbox
        open={lightboxOpen}
        close={() => setLightboxOpen(false)}
        index={lightboxIndex}
        slides={lightboxSlides as any}
        plugins={[Video]}
        render={{
          slide: ({ slide }) =>
            (slide as any).type === "audio" ? (
              <Box
                sx={{
                  height: "50%",
                  width: "50%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "black",
                  borderRadius: 2,
                  gap: 2,
                }}
              >
                <GraphicEqIcon sx={{ fontSize: 64, color: "warning.main", opacity: 0.6 }} />
                <audio
                  src={(slide as any).src}
                  controls
                  style={{ width: "80%", maxWidth: 520 }}
                />
              </Box>
            ) : undefined,
        }}
      />
    </Box>
  );
}
