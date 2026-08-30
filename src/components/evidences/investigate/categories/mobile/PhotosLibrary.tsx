import * as React from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import StarIcon from "@mui/icons-material/Star";
import PlaceIcon from "@mui/icons-material/Place";

import Pagination from "@mui/material/Pagination";
import MediaGallery, { MediaEntry } from "../media/MediaGallery";
import { getIosPhotoAssetsPage } from "../../../../../dbutils/sqlite";
import { IosPhotoAssetRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";
import TimeFilterBanner from "../../TimeFilterBanner";

interface PhotosLibraryProps {
  evidenceId: number;
  partitionId: number;
}

/**
 * Mime from the filename extension.
 *
 * Signature identification currently reports HEIC/HEIF as
 * application/octet-stream, which would make the gallery treat the bulk of an
 * iPhone camera roll as non-media. The library knows these are photos, so the
 * extension is the more reliable signal here.
 */
function mimeFromName(name: string | null): { mime: string; kind: MediaEntry["kind"] } {
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "heic":
    case "heif":
      return { mime: "image/heic", kind: "image" };
    case "jpg":
    case "jpeg":
      return { mime: "image/jpeg", kind: "image" };
    case "png":
      return { mime: "image/png", kind: "image" };
    case "gif":
      return { mime: "image/gif", kind: "image" };
    case "webp":
      return { mime: "image/webp", kind: "image" };
    case "dng":
    case "tif":
    case "tiff":
      return { mime: "image/tiff", kind: "image" };
    case "mov":
      return { mime: "video/quicktime", kind: "video" };
    case "mp4":
    case "m4v":
      return { mime: "video/mp4", kind: "video" };
    case "m4a":
    case "aac":
      return { mime: "audio/mp4", kind: "audio" };
    default:
      return { mime: "application/octet-stream", kind: "image" };
  }
}

type LibraryEntry = MediaEntry & { asset: IosPhotoAssetRow };

const PAGE_SIZE = 60;

export default function PhotosLibrary({ evidenceId, partitionId }: PhotosLibraryProps) {
  const { start, end } = useTimeFilter();
  const [entries, setEntries] = React.useState<LibraryEntry[]>([]);
  const [missingInPage, setMissingInPage] = React.useState(0);
  const [rowCount, setRowCount] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  // A new evidence, partition or time window restarts paging.
  React.useEffect(() => {
    setPage(0);
  }, [evidenceId, partitionId, start, end]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosPhotoAssetsPage(evidenceId, partitionId, page * PAGE_SIZE, PAGE_SIZE)
      .then(({ rows, rowCount: total }) => {
        if (!alive) return;
        const resolved: LibraryEntry[] = [];
        let missing = 0;
        for (const a of rows) {
          if (a.file_id == null) {
            missing += 1;
            continue;
          }
          const { mime, kind } = mimeFromName(a.filename);
          resolved.push({
            id: a.file_id,
            kind: a.kind === "video" ? "video" : kind,
            mime,
            label: a.filename ?? undefined,
            hostPath: a.host_path,
            // The device's own rendered JPEG, when the extraction captured it.
            thumbId: a.thumb_file_id ?? undefined,
            thumbHostPath: a.thumb_host_path,
            thumbMime: "image/jpeg",
            asset: a,
          });
        }
        setEntries(resolved);
        setMissingInPage(missing);
        setRowCount(total);
      })
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, page, start, end]);

  const renderBadges = React.useCallback((entry: MediaEntry) => {
    const asset = (entry as LibraryEntry).asset;
    if (!asset) return null;
    const badges: React.ReactNode[] = [];
    const pill = (bg: string) => ({
      bgcolor: bg,
      color: "#fff",
      borderRadius: "50%",
      width: 22,
      height: 22,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: 1,
    });
    if (asset.trashed === 1) {
      badges.push(
        <Tooltip key="t" title="Deleted by the user — still recoverable from the library">
          <Box sx={pill("error.main")}>
            <DeleteForeverIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>,
      );
    }
    if (asset.hidden === 1) {
      badges.push(
        <Tooltip key="h" title="Hidden album">
          <Box sx={pill("warning.main")}>
            <VisibilityOffIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>,
      );
    }
    if (asset.favorite === 1) {
      badges.push(
        <Tooltip key="f" title="Marked favourite">
          <Box sx={pill("info.main")}>
            <StarIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>,
      );
    }
    if (typeof asset.latitude === "number" && typeof asset.longitude === "number") {
      badges.push(
        <Tooltip
          key="g"
          title={`Geotagged ${asset.latitude.toFixed(5)}, ${asset.longitude.toFixed(5)}`}
        >
          <Box sx={pill("success.main")}>
            <PlaceIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>,
      );
    }
    return badges.length > 0 ? <>{badges}</> : null;
  }, []);

  const selectedAsset = React.useMemo(
    () => entries.find((e) => e.id === selectedId)?.asset ?? null,
    [entries, selectedId],
  );

  if (error) return <Alert severity="error">Failed to load photo library: {error}</Alert>;
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading photo library…</Typography>
      </Box>
    );
  }
  const pageCount = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const trashed = entries.filter((e) => e.asset.trashed === 1).length;
  const hidden = entries.filter((e) => e.asset.hidden === 1).length;

  if (rowCount === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <TimeFilterBanner
          noun="photo assets"
          timestampLabel="capture or library-added time"
        />
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">
            No parsed photo library assets found for this partition.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <TimeFilterBanner
        noun="photo assets"
        timestampLabel="capture or library-added time"
      />
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1, pb: 1, alignItems: "center", flexWrap: "wrap" }}
      >
        <Chip
          size="small"
          variant="outlined"
          label={`${rowCount.toLocaleString()} assets`}
        />
        {trashed > 0 && (
          <Chip size="small" color="error" label={`${trashed} deleted`} icon={<DeleteForeverIcon />} />
        )}
        {hidden > 0 && (
          <Chip size="small" color="warning" label={`${hidden} hidden`} icon={<VisibilityOffIcon />} />
        )}
        {missingInPage > 0 && (
          <Tooltip title="Recorded in the Photos library but the file itself was not found on disk">
            <Chip size="small" variant="outlined" label={`${missingInPage} without file`} />
          </Tooltip>
        )}
        {selectedAsset && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {selectedAsset.filename}
            {selectedAsset.created_ms
              ? ` \u00b7 captured ${unixToISO8601UTCString(selectedAsset.created_ms)
                  .replace(/\.\d+Z$/, "Z")
                  .replace("T", " ")} UTC`
              : ""}
            {selectedAsset.relative_path ? ` \u00b7 ${selectedAsset.relative_path}` : ""}
          </Typography>
        )}
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
        <MediaGallery
          media={entries}
          selectedId={selectedId}
          onSelect={(e) => setSelectedId(e.id)}
          renderBadges={renderBadges}
        />
      </Box>

      {pageCount > 1 && (
        <Stack direction="row" sx={{ justifyContent: "center", py: 1, flexShrink: 0 }}>
          <Pagination
            size="small"
            count={pageCount}
            page={page + 1}
            onChange={(_, v) => setPage(v - 1)}
          />
        </Stack>
      )}
    </Box>
  );
}
