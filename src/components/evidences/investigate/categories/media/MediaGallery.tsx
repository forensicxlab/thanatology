"use client";
import Lightbox from "yet-another-react-lightbox";
import Video from "yet-another-react-lightbox/plugins/video";
import "yet-another-react-lightbox/styles.css";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

type MediaKind = "image" | "video" | "audio";

export interface MediaEntry {
  id: number;
  kind: MediaKind;
  mime: string;
  posterId?: number;
  label?: string;
}

interface MediaGalleryProps {
  media: MediaEntry[];
  /** If provided, opens the lightbox focusing on the item with this source id. */
  openById?: number | null;
  onClose?: () => void;
}

const mimeFromKind = (kind: MediaKind) => {
  switch (kind) {
    case "image":
      return "image/*";
    case "video":
      return "video/*";
    case "audio":
      return "audio/*";
    default:
      return "application/octet-stream";
  }
};

const loadFile = async (id: number, mime = "application/octet-stream") => {
  const bytes = (await invoke<number[]>("read_file_bytes", {
    fileId: id,
  })) as number[];
  const uint8 = Uint8Array.from(bytes);
  const blob = new Blob([uint8], { type: mime });
  return URL.createObjectURL(blob);
};

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

export default function MediaGallery({
  media,
  openById,
  onClose,
}: MediaGalleryProps) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // Load blobs for current media set
  useEffect(() => {
    let mounted = true;
    let urlsToRevoke: string[] = [];

    (async () => {
      const loaded = await Promise.all(
        media.map(async (entry): Promise<Slide> => {
          const src = await loadFile(
            entry.id,
            entry.mime ?? mimeFromKind(entry.kind),
          );
          urlsToRevoke.push(src);

          if (entry.kind === "image") {
            return { _id: entry.id, src, alt: entry.label };
          }
          if (entry.kind === "video") {
            const poster = entry.posterId
              ? await loadFile(entry.posterId, "image/*")
              : undefined;
            if (poster) urlsToRevoke.push(poster);
            return {
              _id: entry.id,
              type: "video",
              poster,
              sources: [{ src, type: entry.mime }],
              label: entry.label,
            };
          }
          // audio
          return { _id: entry.id, type: "audio", src, label: entry.label };
        }),
      );

      if (mounted) setSlides(loaded);
    })();

    return () => {
      mounted = false;
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [media]);

  // If parent asks to open by id, find its current index and open.
  useEffect(() => {
    if (!openById) return;
    const i = slides.findIndex((s) => s._id === openById);
    if (i >= 0) {
      setIndex(i);
      setOpen(true);
    }
  }, [openById, slides]);

  const handleOpen = useCallback((i: number) => {
    setIndex(i);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  return (
    <>
      {/* Thumbnails */}
      <Grid container spacing={1}>
        {slides.map((slide, i) => (
          <Grid
            sx={{
              xs: 6,
              sm: 4,
              md: 3,
              lg: 3,
            }}
            key={slide._id}
          >
            <Card elevation={2}>
              <CardActionArea onClick={() => handleOpen(i)}>
                {slide.type === "video" ? (
                  <CardMedia
                    component="img"
                    image={slide.poster ?? slide.sources?.[0]?.src}
                    alt={slide.label ?? `Video ${i + 1}`}
                    sx={{ height: 160, objectFit: "cover" }}
                    loading="lazy"
                  />
                ) : slide.type === "audio" ? (
                  <Box
                    sx={{
                      height: 160,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "grey.900",
                      color: "common.white",
                      px: 1,
                      textAlign: "center",
                    }}
                  >
                    <Typography variant="body2">
                      {slide.label ?? `Audio ${i + 1}`}
                    </Typography>
                  </Box>
                ) : (
                  <CardMedia
                    component="img"
                    image={slide.src}
                    alt={slide.alt ?? `Image ${i + 1}`}
                    sx={{ height: 160, objectFit: "cover" }}
                    loading="lazy"
                  />
                )}
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Lightbox */}
      <Lightbox
        open={open}
        close={handleClose}
        index={index}
        slides={slides as any}
        plugins={[Video]}
        render={{
          slide: ({ slide }) =>
            slide.type === "audio" ? (
              <Box
                sx={{
                  height: "50%",
                  width: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "black",
                }}
              >
                <audio
                  src={slide.src}
                  controls
                  style={{ width: "50%", maxWidth: 520 }}
                />
              </Box>
            ) : undefined,
        }}
      />
    </>
  );
}
