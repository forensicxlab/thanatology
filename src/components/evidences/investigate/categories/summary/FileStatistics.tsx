import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import FolderIcon from "@mui/icons-material/Folder";
import StorageIcon from "@mui/icons-material/Storage";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import ImageIcon from "@mui/icons-material/Image";
import VideocamIcon from "@mui/icons-material/Videocam";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import ArticleIcon from "@mui/icons-material/Article";
import FeedIcon from "@mui/icons-material/Feed";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import TerminalIcon from "@mui/icons-material/Terminal";
import HelpOutlineIcon from "@mui/icons-material/QuestionMark";
import CategoryIcon from "@mui/icons-material/Category";
import DnsIcon from "@mui/icons-material/Dns";
import WifiIcon from "@mui/icons-material/Wifi";
import PersonIcon from "@mui/icons-material/Person";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import AppsIcon from "@mui/icons-material/Apps";
import {
  getFileStats,
  getMimeTypeDistribution,
  getArtifactCategoryCounts,
  getTopFileSignatures,
  type InvestigationTimeScope,
} from "../../../../../dbutils/sqlite";
import type {
  FileStats,
  MimeTypeCount,
  ArtifactCategoryCount,
  TopSignature,
} from "../../../../../dbutils/types";
import {
  useTimeFilter,
  useTimeFilterStore,
} from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";

/* ------------------------------------------------------------------ */

interface Props {
  evidenceId: number;
  partitionId: number;
  imageSize?: number;
}

/* ── Colour maps ──────────────────────────────────────────────────── */

const MIME_META: Record<
  string,
  { color: string; icon: React.ReactNode }
> = {
  Images:      { color: "#FF9500", icon: <ImageIcon     fontSize="small" /> },
  Video:       { color: "#FF453A", icon: <VideocamIcon  fontSize="small" /> },
  Audio:       { color: "#BF5AF2", icon: <AudiotrackIcon fontSize="small" /> },
  Text:        { color: "#30D158", icon: <ArticleIcon   fontSize="small" /> },
  Documents:   { color: "#0A84FF", icon: <FeedIcon      fontSize="small" /> },
  Archives:    { color: "#64D2FF", icon: <FolderZipIcon fontSize="small" /> },
  Executables: { color: "#FF3B30", icon: <TerminalIcon  fontSize="small" /> },
  Unknown:     { color: "#8E8E93", icon: <HelpOutlineIcon fontSize="small" /> },
  Other:       { color: "#636366", icon: <CategoryIcon  fontSize="small" /> },
};

const ARTIFACT_META: Record<
  string,
  { color: string; icon: React.ReactNode }
> = {
  System:      { color: "#0A84FF", icon: <DnsIcon          fontSize="small" /> },
  Network:     { color: "#30D158", icon: <WifiIcon          fontSize="small" /> },
  Users:       { color: "#FF9500", icon: <PersonIcon        fontSize="small" /> },
  Media:       { color: "#BF5AF2", icon: <PhotoLibraryIcon  fontSize="small" /> },
  Application: { color: "#FF453A", icon: <AppsIcon          fontSize="small" /> },
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTs(ts: number | null): string {
  if (!ts || ts <= 0) return "—";
  const ms = ts < 1e10 ? ts * 1000 : ts;
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/* ── Sub-components ───────────────────────────────────────────────── */

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}> = ({ icon, label, value, sub }) => (
  <Paper
    sx={{
      p: 2,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 0.5,
    }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        color: "text.secondary",
      }}
    >
      {icon}
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </Typography>
    </Box>
    <Typography
      variant="h5"
      sx={{ fontWeight: 700, color: "text.primary", lineHeight: 1.15 }}
    >
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {sub}
      </Typography>
    )}
  </Paper>
);

const HorizBar: React.FC<{
  label: string;
  count: number;
  maxCount: number;
  color: string;
  icon?: React.ReactNode;
}> = ({ label, count, maxCount, color, icon }) => (
  <Box sx={{ mb: 1.5 }}>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        mb: 0.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Box sx={{ color, display: "flex", alignItems: "center" }}>{icon}</Box>
        <Typography
          variant="body2"
          sx={{ fontWeight: 500, color: "text.primary" }}
        >
          {label}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{ color: "text.secondary", fontWeight: 500 }}
      >
        {count.toLocaleString()}
      </Typography>
    </Box>
    <Box
      sx={{
        height: 6,
        borderRadius: 3,
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          height: "100%",
          width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
          bgcolor: color,
          borderRadius: 3,
          transition: "width 0.6s ease",
        }}
      />
    </Box>
  </Box>
);

/* ── Main component ───────────────────────────────────────────────── */

const FileStatistics: React.FC<Props> = ({ evidenceId, partitionId, imageSize }) => {
  const { start: tfStart, end: tfEnd, fileTimeField } = useTimeFilter();
  const scopeEvidenceId = useTimeFilterStore((state) => state.evidenceId);
  const scopePartitionId = useTimeFilterStore((state) => state.partitionId);
  const timeScope = useMemo<InvestigationTimeScope | undefined>(
    () =>
      scopeEvidenceId === evidenceId && scopePartitionId === partitionId
        ? {
            evidenceId,
            partitionId,
            startMs: tfStart,
            endMs: tfEnd,
            fileTimeField,
          }
        : undefined,
    [
      scopeEvidenceId,
      scopePartitionId,
      evidenceId,
      partitionId,
      tfStart,
      tfEnd,
      fileTimeField,
    ],
  );
  const [stats, setStats]           = useState<FileStats | null>(null);
  const [mimeData, setMimeData]     = useState<MimeTypeCount[]>([]);
  const [artifactData, setArtifactData] = useState<ArtifactCategoryCount[]>([]);
  const [signatures, setSignatures] = useState<TopSignature[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getFileStats(evidenceId, partitionId, timeScope),
      getMimeTypeDistribution(evidenceId, partitionId, timeScope),
      getArtifactCategoryCounts(evidenceId, partitionId, timeScope),
      getTopFileSignatures(evidenceId, partitionId, 12, timeScope),
    ])
      .then(([s, m, a, sig]) => {
        if (!cancelled) {
          setStats(s);
          setMimeData(m.filter((d) => d.mime_category !== "Unknown" || d.count > 0));
          setArtifactData(a);
          setSignatures(sig);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setStats(null);
          setMimeData([]);
          setArtifactData([]);
          setSignatures([]);
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [evidenceId, partitionId, timeScope]);

  /* ── Loading skeleton ─────────────────────────────────────────── */
  if (loading) {
    return (
      <Box sx={{ mt: 3 }}>
        <Skeleton variant="text" width={160} height={28} sx={{ mb: 1.5 }} />
        <TimeFilterBanner
          mode="source-file"
          noun="file and artifact statistics"
          sx={{ px: 0, pt: 0, mb: 1.5 }}
        />
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {[0, 1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (error || !stats || stats.total_files + stats.total_dirs === 0) {
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: "text.primary", mb: 1.5 }}>
          File Statistics
        </Typography>
        <TimeFilterBanner
          mode="source-file"
          noun="file and artifact statistics"
          sx={{ px: 0, pt: 0, mb: 1.5 }}
        />
        <Alert severity={error ? "error" : "info"} variant="outlined">
          {error
            ? `Failed to load file statistics: ${error}`
            : "No files or directories match the current investigation scope."}
        </Alert>
      </Box>
    );
  }

  const mimeMax     = mimeData.reduce((m, d) => Math.max(m, d.count), 0);
  const artifactMax = artifactData.reduce((m, d) => Math.max(m, d.count), 0);
  const totalArtifacts = artifactData.reduce((s, d) => s + d.count, 0);

  // Separate "Unknown" for the footer note, keep rest for bars
  const knownMime   = mimeData.filter((d) => d.mime_category !== "Unknown");
  const unknownMime = mimeData.find((d) => d.mime_category === "Unknown");

  return (
    <Box sx={{ mt: 3 }}>
      <Typography
        variant="h6"
        sx={{ fontWeight: 600, color: "text.primary", mb: 1.5 }}
      >
        File Statistics
      </Typography>
      <TimeFilterBanner
        mode="source-file"
        noun="file and artifact statistics"
        sx={{ px: 0, pt: 0, mb: 1.5 }}
      />

      {/* ── Metric cards ─────────────────────────────────────────── */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            icon={<InsertDriveFileIcon sx={{ fontSize: 16 }} />}
            label="Files"
            value={stats.total_files.toLocaleString()}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            icon={<FolderIcon sx={{ fontSize: 16 }} />}
            label="Directories"
            value={stats.total_dirs.toLocaleString()}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            icon={<StorageIcon sx={{ fontSize: 16 }} />}
            label={imageSize != null && imageSize > 0 ? "Image Size" : "Total Size"}
            value={imageSize != null && imageSize > 0 ? formatBytes(imageSize) : formatBytes(stats.total_size)}
            sub={imageSize != null && imageSize > 0 ? `Indexed: ${formatBytes(stats.total_size)}` : undefined}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            icon={<CalendarTodayIcon sx={{ fontSize: 16 }} />}
            label="Timestamp Range (UTC)"
            value={formatTs(stats.earliest_ts)}
            sub={
              stats.latest_ts && stats.latest_ts !== stats.earliest_ts
                ? `→ ${formatTs(stats.latest_ts)}`
                : undefined
            }
          />
        </Grid>
      </Grid>

      {/* ── Charts row ───────────────────────────────────────────── */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>

        {/* File type breakdown */}
        {knownMime.length > 0 && (
          <Grid size={{ xs: 12, md: artifactData.length > 0 ? 6 : 12 }}>
            <Paper sx={{ p: 2.5, height: "100%" }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 600, color: "text.primary", mb: 2 }}
              >
                File Type Breakdown
              </Typography>
              {knownMime.map((d) => {
                const meta = MIME_META[d.mime_category] ?? MIME_META["Other"];
                return (
                  <HorizBar
                    key={d.mime_category}
                    label={d.mime_category}
                    count={d.count}
                    maxCount={mimeMax}
                    color={meta.color}
                    icon={meta.icon}
                  />
                );
              })}
              {unknownMime && unknownMime.count > 0 && (
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", mt: 0.5, display: "block" }}
                >
                  + {unknownMime.count.toLocaleString()} files with no detected signature
                </Typography>
              )}
            </Paper>
          </Grid>
        )}

        {/* Detected artefacts */}
        {artifactData.length > 0 && (
          <Grid size={{ xs: 12, md: knownMime.length > 0 ? 6 : 12 }}>
            <Paper sx={{ p: 2.5, height: "100%" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 1,
                  mb: 2,
                }}
              >
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 600, color: "text.primary" }}
                >
                  Detected Artefacts
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {totalArtifacts.toLocaleString()} total
                </Typography>
              </Box>
              {artifactData.map((d) => {
                const meta =
                  ARTIFACT_META[d.category] ?? {
                    color: "#8E8E93",
                    icon: <CategoryIcon fontSize="small" />,
                  };
                return (
                  <HorizBar
                    key={d.category}
                    label={d.category}
                    count={d.count}
                    maxCount={artifactMax}
                    color={meta.color}
                    icon={meta.icon}
                  />
                );
              })}
            </Paper>
          </Grid>
        )}
      </Grid>

      {/* ── Top file signatures ───────────────────────────────────── */}
      {signatures.length > 0 && (
        <Paper sx={{ p: 2.5 }}>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 600, color: "text.primary", mb: 1.5 }}
          >
            Top Detected Signatures
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {signatures.map((sig) => (
              <Chip
                key={sig.sig_name}
                label={`${sig.sig_name} · ${sig.count.toLocaleString()}`}
                size="small"
                variant="outlined"
              />
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
};

export default FileStatistics;
