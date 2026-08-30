import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import {
  activateMapPack,
  cancelMapDownload,
  discardMapDownload,
  downloadMapPack,
  getMapStorageStatus,
  importMapPack,
  removeMapPack,
  setMapStorageRoot,
} from "../../maps/mapPacks";
import type { MapDownloadProgress, MapStorageStatus } from "../../maps/types";
import { useSnackbar } from "../SnackbarProvider";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "Unknown";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PROTOMAPS_CATALOG_URL = "https://build-metadata.protomaps.dev/builds.json";
const MAPTERHORN_TERRAIN_URL = "https://download.mapterhorn.com/planet.pmtiles";
const MAPTERHORN_ATTRIBUTION_URL = "https://mapterhorn.com/attribution";

export default function MapSettingsPanel() {
  const { display_message } = useSnackbar();
  const [status, setStatus] = useState<MapStorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MapDownloadProgress | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const [downloadName, setDownloadName] = useState("Protomaps World");
  const [includeTerrain, setIncludeTerrain] = useState(true);
  const [customDownload, setCustomDownload] = useState(false);
  const [basemapUrl, setBasemapUrl] = useState("");
  const [terrainUrl, setTerrainUrl] = useState("");

  const [importName, setImportName] = useState("Regional Map");
  const [basemapPath, setBasemapPath] = useState("");
  const [terrainPath, setTerrainPath] = useState("");

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getMapStorageStatus();
      setStatus(nextStatus);
      setBusy(nextStatus.download_active);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    if (!status?.download_active) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.download_active]);

  useEffect(() => {
    void refresh();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MapDownloadProgress>("map-download-progress", (event) => {
      if (!disposed) setProgress(event.payload);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const progressValue = useMemo(() => {
    if (!progress?.totalBytes || progress.totalBytes <= 0) return undefined;
    return Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100);
  }, [progress]);

  const run = useCallback(
    async (operation: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setError(null);
      try {
        await operation();
        display_message?.("success", success);
        await refresh();
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        display_message?.("error", message);
        try {
          setStatus(await getMapStorageStatus());
        } catch {
          // Keep the actionable download error visible; the regular refresh can retry status later.
        }
      } finally {
        setBusy(false);
      }
    },
    [display_message, refresh],
  );

  const chooseStorage = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose map storage location" });
    if (typeof selected !== "string") return;
    if (status?.packs.length) setMoveTarget(selected);
    else await run(() => setMapStorageRoot(selected, false), "Map storage location updated.");
  };

  const choosePmtiles = async (terrain: boolean) => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: terrain ? "Choose terrain PMTiles" : "Choose vector basemap PMTiles",
      filters: [{ name: "PMTiles archive", extensions: ["pmtiles"] }],
    });
    if (typeof selected !== "string") return;
    if (terrain) setTerrainPath(selected);
    else setBasemapPath(selected);
  };

  const startDownload = async () => {
    if (customDownload && !basemapUrl.trim()) {
      setError("A vector basemap URL is required for a custom download.");
      return;
    }
    setDownloadOpen(false);
    setProgress(null);
    await run(
      () =>
        downloadMapPack({
          name: downloadName.trim(),
          includeTerrain,
          basemapUrl: customDownload ? basemapUrl.trim() : undefined,
          terrainUrl: customDownload && includeTerrain && terrainUrl.trim() ? terrainUrl.trim() : undefined,
        }),
      "Map pack installed and activated.",
    );
  };

  const startImport = async () => {
    if (!basemapPath.trim()) {
      setError("Choose a vector basemap PMTiles archive to import.");
      return;
    }
    setImportOpen(false);
    setProgress(null);
    await run(
      () =>
        importMapPack({
          name: importName.trim(),
          basemapPath: basemapPath.trim(),
          terrainPath: terrainPath.trim() || undefined,
        }),
      "Map pack imported and activated.",
    );
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <StorageIcon fontSize="small" color="primary" />
        <Typography variant="h6" sx={{ color: "text.primary" }}>
          Location Basemap
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Managed offline Protomaps vector maps with optional Mapterhorn 3D terrain.
        Map data is shared by all cases and never copied into evidence storage.
      </Typography>
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
          Default map data sources
        </Typography>
        <Typography variant="caption" component="div" sx={{ overflowWrap: "anywhere" }}>
          Protomaps build catalog: {PROTOMAPS_CATALOG_URL}
        </Typography>
        <Typography variant="caption" component="div" sx={{ overflowWrap: "anywhere" }}>
          Mapterhorn terrain archive: {MAPTERHORN_TERRAIN_URL}
        </Typography>
        <Button size="small" sx={{ mt: 0.5, px: 0 }} onClick={() => void openUrl(MAPTERHORN_ATTRIBUTION_URL)}>
          View Mapterhorn source attribution
        </Button>
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!status && !error && <LinearProgress sx={{ mb: 2 }} />}
      {status && !status.available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Map storage is unavailable. Reconnect the volume or choose another location.
        </Alert>
      )}

      {status && (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary">Storage location</Typography>
            <Typography
              variant="body2"
              title={status.root}
              sx={{ fontFamily: "monospace", overflowWrap: "anywhere", color: "text.primary" }}
            >
              {status.root}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: "wrap" }}>
              <Chip size="small" variant="outlined" label={`${formatBytes(status.free_bytes)} free`} />
              <Chip size="small" variant="outlined" label={`${formatBytes(status.used_bytes)} used`} />
              {status.is_default && <Chip size="small" color="primary" variant="outlined" label="Default" />}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="outlined" startIcon={<FolderOpenIcon />} onClick={chooseStorage} disabled={busy}>
              Change
            </Button>
            {!status.is_default && (
              <Button size="small" variant="outlined" onClick={() => void run(() => setMapStorageRoot(null, true), "Maps moved to default storage.")} disabled={busy}>
                Use default
              </Button>
            )}
            <Button size="small" variant="text" onClick={() => void openPath(status.root)} disabled={!status.available}>
              Open folder
            </Button>
          </Stack>

          <Divider />

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={() => setDownloadOpen(true)} disabled={busy || !status.available}>
              Download
            </Button>
            <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)} disabled={busy || !status.available}>
              Import PMTiles
            </Button>
          </Stack>

          {busy && (
            <Box>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                <Typography variant="caption">{progress?.message ?? "Preparing map pack…"}</Typography>
                <Button size="small" color="inherit" onClick={() => void cancelMapDownload()}>Cancel</Button>
              </Stack>
              <LinearProgress variant={progressValue == null ? "indeterminate" : "determinate"} value={progressValue} />
              {progress && (
                <Typography variant="caption" color="text.secondary">
                  {formatBytes(progress.downloadedBytes)}{progress.totalBytes ? ` of ${formatBytes(progress.totalBytes)}` : ""}
                </Typography>
              )}
            </Box>
          )}

          {(status.resumable_downloads ?? []).length > 0 && !busy && (
            <Alert severity="warning" variant="outlined">
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                Interrupted downloads available to resume
              </Typography>
              <Stack spacing={1}>
                {(status.resumable_downloads ?? []).map((download) => (
                  <Box key={download.id}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="body2">{download.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(download.downloaded_bytes)} retained
                          {download.include_terrain ? " · includes terrain" : ""}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => {
                          setProgress(null);
                          void run(
                            () => downloadMapPack(download.request),
                            "Map pack resumed, installed, and activated.",
                          );
                        }}
                      >
                        Resume
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => {
                          if (window.confirm(`Discard the retained bytes for “${download.name}”?`)) {
                            void run(
                              () => discardMapDownload(download.id),
                              `Retained download for ${download.name} discarded.`,
                            );
                          }
                        }}
                      >
                        Discard
                      </Button>
                    </Stack>
                    <Typography
                      variant="caption"
                      component="div"
                      color="text.secondary"
                      title={download.basemap_source_url}
                      sx={{ fontFamily: "monospace", overflowWrap: "anywhere", mt: 0.25 }}
                    >
                      {download.basemap_source_url}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Alert>
          )}

          {status.packs.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No local map pack is installed. The Location view will keep using its blank offline canvas.
            </Alert>
          ) : (
            <Stack spacing={1}>
              {status.packs.map((pack) => (
                <Box key={pack.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <Typography variant="subtitle2" sx={{ color: "text.primary" }}>{pack.name}</Typography>
                        {pack.is_active && <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label="Active" />}
                        {pack.has_terrain && <Chip size="small" variant="outlined" label="3D terrain" />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {pack.provider} · {formatBytes(pack.size_bytes)}
                      </Typography>
                    </Box>
                    {!pack.is_active && (
                      <Button size="small" onClick={() => void run(() => activateMapPack(pack.id), `${pack.name} activated.`)} disabled={busy || !pack.available}>
                        Activate
                      </Button>
                    )}
                    <Tooltip title="Remove map pack">
                      <IconButton
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove “${pack.name}” from local map storage?`)) {
                            void run(() => removeMapPack(pack.id), `${pack.name} removed.`);
                          }
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      <Dialog open={downloadOpen} onClose={() => setDownloadOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Download local map pack</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Map pack name" value={downloadName} onChange={(event) => setDownloadName(event.target.value)} fullWidth />
            <FormControlLabel
              control={<Switch checked={includeTerrain} onChange={(event) => setIncludeTerrain(event.target.checked)} />}
              label="Include Mapterhorn 3D terrain"
            />
            <FormControlLabel
              control={<Switch checked={customDownload} onChange={(event) => setCustomDownload(event.target.checked)} />}
              label="Use regional/custom PMTiles URLs"
            />
            {customDownload ? (
              <>
                <TextField
                  label="Vector basemap PMTiles URL"
                  value={basemapUrl}
                  onChange={(event) => setBasemapUrl(event.target.value)}
                  placeholder="https://maps.example.org/switzerland.pmtiles"
                  helperText="Use a Protomaps v4-compatible regional archive. Coordinates are not sent automatically."
                  fullWidth
                />
                {includeTerrain && (
                  <TextField
                    label="Terrain PMTiles URL (optional)"
                    value={terrainUrl}
                    onChange={(event) => setTerrainUrl(event.target.value)}
                    placeholder="https://maps.example.org/switzerland-terrain.pmtiles"
                    helperText="Leave empty to download the global Mapterhorn z0–12 terrain archive."
                    fullWidth
                  />
                )}
              </>
            ) : (
              <Alert severity="warning">
                <Typography variant="body2">
                  The default Protomaps download is the full planet archive (approximately 120 GB).
                  Terrain requires an additional global archive. For a country or case region, use custom URLs or import an extract made with the PMTiles CLI.
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>
                  Vector catalog: {PROTOMAPS_CATALOG_URL}
                </Typography>
                {includeTerrain && (
                  <Typography variant="caption" component="div" sx={{ overflowWrap: "anywhere" }}>
                    Terrain source: {MAPTERHORN_TERRAIN_URL}
                  </Typography>
                )}
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              Downloads automatically retry transient failures. Partial files and the resolved source URLs are retained under one stable download folder, so a later attempt resumes instead of starting over.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadOpen(false)} color="inherit">Cancel</Button>
          <Button
            onClick={() => void startDownload()}
            variant="contained"
            disabled={!downloadName.trim() || (customDownload && !basemapUrl.trim())}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Import regional PMTiles</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Map pack name" value={importName} onChange={(event) => setImportName(event.target.value)} fullWidth />
            <Stack direction="row" spacing={1}>
              <TextField label="Vector basemap" value={basemapPath} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />
              <Button variant="outlined" onClick={() => void choosePmtiles(false)}>Browse</Button>
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField label="Terrain (optional)" value={terrainPath} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />
              <Button variant="outlined" onClick={() => void choosePmtiles(true)}>Browse</Button>
            </Stack>
            <Alert severity="info" variant="outlined">
              The vector archive must use the Protomaps v4 layer schema. Terrain must be a Terrarium-encoded raster DEM PMTiles archive.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} color="inherit">Cancel</Button>
          <Button onClick={() => void startImport()} variant="contained" disabled={!importName.trim() || !basemapPath}>Import</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={moveTarget != null} onClose={() => setMoveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Change map storage</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Existing map packs are installed. Moving them may take some time and requires enough free space on the destination volume.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap" }}>
          <Button onClick={() => setMoveTarget(null)} color="inherit">Cancel</Button>
          <Button
            onClick={() => {
              const target = moveTarget;
              setMoveTarget(null);
              if (target) void run(() => setMapStorageRoot(target, false), "New map storage selected; old files were retained.");
            }}
          >
            Keep old files
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const target = moveTarget;
              setMoveTarget(null);
              if (target) void run(() => setMapStorageRoot(target, true), "Map storage moved and verified.");
            }}
          >
            Move maps
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
