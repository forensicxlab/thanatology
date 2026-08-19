import * as React from "react";
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import MovieIcon from "@mui/icons-material/Movie";
import PlaceIcon from "@mui/icons-material/Place";

import { getMediaSourceUrl } from "../../../../common/mediaSource";
import type { DiscussionAttachmentRow } from "../../../../../../dbutils/types";

interface MediaAttachmentPreviewProps {
  attachment: DiscussionAttachmentRow;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fallbackIcon(kind: DiscussionAttachmentRow["kind"]) {
  if (kind === "video") return <MovieIcon fontSize="small" />;
  if (kind === "audio") return <AudioFileIcon fontSize="small" />;
  if (kind === "location") return <PlaceIcon fontSize="small" />;
  if (kind === "image" || kind === "sticker") {
    return <BrokenImageIcon fontSize="small" />;
  }
  return <AttachFileIcon fontSize="small" />;
}

function fallbackLabel(attachment: DiscussionAttachmentRow): string {
  if (
    attachment.remote_url &&
    attachment.fs_identifier == null &&
    !attachment.local_path
  ) {
    if (attachment.kind === "image") return "Remote image";
    if (attachment.kind === "video") return "Remote video";
    if (attachment.kind === "audio") return "Remote audio";
    return "Remote media";
  }

  return (
    attachment.file_name ??
    attachment.local_path ??
    attachment.remote_url ??
    attachment.mime ??
    "Attachment"
  );
}

async function loadAttachmentUrl(attachment: DiscussionAttachmentRow) {
  if (attachment.fs_identifier == null) return null;

  return getMediaSourceUrl({
    fileId: attachment.fs_identifier,
    path: attachment.host_path ?? attachment.absolute_path ?? undefined,
    mime: attachment.mime ?? attachment.sig_mime ?? undefined,
    preview: false,
  });
}

export default function MediaAttachmentPreview({
  attachment,
}: MediaAttachmentPreviewProps) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const coordinateLabel =
    attachment.latitude != null && attachment.longitude != null
      ? `${attachment.latitude.toFixed(6)}, ${attachment.longitude.toFixed(6)}`
      : null;
  const label =
    (attachment.kind === "location" ? coordinateLabel : null) ??
    fallbackLabel(attachment);
  const sizeLabel = formatBytes(attachment.file_size);
  const previewUrl =
    attachment.preview_mime && attachment.preview_base64
      ? `data:${attachment.preview_mime};base64,${attachment.preview_base64}`
      : null;
  const canLoadOriginal =
    attachment.fs_identifier != null &&
    ["image", "video", "audio", "sticker"].includes(attachment.kind);

  React.useEffect(() => {
    if (!canLoadOriginal) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setUrl(null);
    loadAttachmentUrl(attachment)
      .then((result) => {
        if (!cancelled) setUrl(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, canLoadOriginal]);

  const retryLoad = () => {
    setLoading(true);
    setFailed(false);
    loadAttachmentUrl(attachment)
      .then((result) => setUrl(result))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  if (url && (attachment.kind === "image" || attachment.kind === "sticker")) {
    return (
      <Tooltip title={attachment.absolute_path ?? label}>
        <Box
          component="img"
          src={url}
          alt={label}
          loading="lazy"
          onClick={(event) => event.stopPropagation()}
          sx={{
            display: "block",
            mt: 1,
            maxWidth: { xs: 240, sm: 320 },
            maxHeight: 260,
            objectFit: "contain",
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        />
      </Tooltip>
    );
  }

  if (url && attachment.kind === "video") {
    return (
      <Box
        component="video"
        src={url}
        controls
        preload="metadata"
        onClick={(event) => event.stopPropagation()}
        sx={{
          display: "block",
          mt: 1,
          width: { xs: 240, sm: 340 },
          maxHeight: 260,
          bgcolor: "background.default",
          border: 1,
          borderColor: "divider",
        }}
      />
    );
  }

  if (url && attachment.kind === "audio") {
    return (
      <Box
        component="audio"
        src={url}
        controls
        preload="metadata"
        onClick={(event) => event.stopPropagation()}
        sx={{ display: "block", mt: 1, width: { xs: 220, sm: 300 } }}
      />
    );
  }

  if (
    previewUrl &&
    (attachment.kind === "image" || attachment.kind === "sticker")
  ) {
    return (
      <Tooltip title={attachment.absolute_path ?? label}>
        <Box
          component="img"
          src={previewUrl}
          alt={label}
          loading="lazy"
          sx={{
            display: "block",
            mt: 1,
            maxWidth: { xs: 240, sm: 320 },
            maxHeight: 260,
            objectFit: "contain",
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={attachment.absolute_path ?? attachment.local_path ?? ""}>
      <Stack
        direction="row"
        sx={{
          mt: 1,
          gap: 1,
          alignItems: "center",
          maxWidth: { xs: 240, sm: 340 },
          p: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: "background.default",
        }}
      >
        {fallbackIcon(attachment.kind)}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {label}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
            {[attachment.mime ?? attachment.sig_mime, sizeLabel]
              .filter(Boolean)
              .join(" · ") ||
              (attachment.fs_identifier == null
                ? "Unresolved media reference"
                : "Resolved media reference")}
          </Typography>
          {canLoadOriginal && loading ? (
            <CircularProgress size={14} sx={{ display: "block", mt: 0.75 }} />
          ) : null}
          {canLoadOriginal && failed ? (
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => {
                e.stopPropagation();
                retryLoad();
              }}
              sx={{ mt: 0.75 }}
            >
              Retry
            </Button>
          ) : null}
          {failed ? (
            <Typography variant="caption" sx={{ color: "error.main" }}>
              Could not load local media
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </Tooltip>
  );
}
