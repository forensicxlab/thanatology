import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@mui/material/styles";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { getIosLocationFixes } from "../../../../../dbutils/sqlite";
import { IosLocationFixRow } from "../../../../../dbutils/types";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";
import { getMapStorageStatus } from "../../../../../maps/mapPacks";
import type { MapStorageStatus } from "../../../../../maps/types";
import {
  createLocalMapStyle,
  OFFLINE_BLANK_STYLE,
  type LocalMapStyleResult,
} from "../../../../../maps/localMapStyle";

interface LocationMapProps {
  evidenceId: number;
  partitionId: number;
}

const TRAIL_WINDOW_MS = 60 * 60 * 1000; // trail shows the last hour of movement

type FixFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>;

/** Geodesic-ish circle polygon approximating a horizontal-accuracy radius. */
function accuracyCircle(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const earth = 6378137;
  const dLat = (radiusMeters / earth) * (180 / Math.PI);
  const dLng =
    (radiusMeters / (earth * Math.cos((Math.PI * lat) / 180))) * (180 / Math.PI);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

function emptyFc(): FixFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export default function LocationMap({ evidenceId, partitionId }: LocationMapProps) {
  const theme = useTheme();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapStatusLoaded, setMapStatusLoaded] = React.useState(false);
  const [mapStatus, setMapStatus] = React.useState<MapStorageStatus | null>(null);
  const [mapStyleInfo, setMapStyleInfo] = React.useState<LocalMapStyleResult | null>(null);
  const [basemapError, setBasemapError] = React.useState<string | null>(null);
  const { start: filterStart, end: filterEnd } = useTimeFilter();

  const [fixes, setFixes] = React.useState<IosLocationFixRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [tIndex, setTIndex] = React.useState(0); // index into ordered fixes
  const [playing, setPlaying] = React.useState(false);
  const [showTrack, setShowTrack] = React.useState(true);
  const [showPoints, setShowPoints] = React.useState(true);
  const [showHeatmap, setShowHeatmap] = React.useState(false);
  const [show3d, setShow3d] = React.useState(false);

  // Only fixes with numeric coordinates and timestamps drive the map.
  const points = React.useMemo(
    () =>
      fixes.filter(
        (f) =>
          typeof f.latitude === "number" &&
          typeof f.longitude === "number" &&
          typeof f.ts === "number",
      ),
    [fixes],
  );

  const pointsFc = React.useMemo<FixFeatureCollection>(() => {
    return {
      type: "FeatureCollection",
      features: points.map((f, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.longitude as number, f.latitude as number] },
        properties: {
          idx: i,
          ts: f.ts,
          // -1 encodes "unknown" for the color ramp (null can't be styled).
          speed: typeof f.speed === "number" ? f.speed : -1,
          accuracy: f.horizontal_accuracy ?? null,
        },
      })),
    };
  }, [points]);

  const trackFc = React.useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (points.length < 2) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: points.map((f) => [f.longitude as number, f.latitude as number]),
          },
          properties: {},
        },
      ],
    };
  }, [points]);

  React.useEffect(() => {
    let alive = true;
    getMapStorageStatus()
      .then((status) => {
        if (alive) setMapStatus(status);
      })
      .catch((caught) => {
        if (alive) {
          setBasemapError(caught instanceof Error ? caught.message : String(caught));
          setMapStatus(null);
        }
      })
      .finally(() => {
        if (alive) setMapStatusLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // ---- data load ----
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosLocationFixes(evidenceId, partitionId)
      .then((data) => {
        if (!alive) return;
        setFixes(data);
        setTIndex(0);
      })
      .catch((e) => alive && setError(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, filterStart, filterEnd]);

  // ---- map init (once) ----
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapStatusLoaded) return;
    const localStyle = mapStatus
      ? createLocalMapStyle(mapStatus, theme.palette.mode)
      : null;
    setMapStyleInfo(localStyle);
    const style = localStyle?.style ?? OFFLINE_BLANK_STYLE;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [0, 20],
        zoom: 1,
        maxPitch: 85,
        attributionControl: { compact: true },
      });
    } catch (e: any) {
      setError(`Failed to initialise map: ${e?.message ?? String(e)}`);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );

    // Keep the GL canvas sized to its container (tab switches / late layout).
    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.addSource("track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("fixes", { type: "geojson", data: emptyFc() });
      map.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("current", { type: "geojson", data: emptyFc() });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: { "line-color": "#4f8cff", "line-width": 1.5, "line-opacity": 0.35 },
      });
      map.addLayer({
        id: "fixes-heat",
        type: "heatmap",
        source: "fixes",
        layout: { visibility: "none" },
        paint: {
          "heatmap-radius": 18,
          "heatmap-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "fixes-points",
        type: "circle",
        source: "fixes",
        paint: {
          "circle-radius": 3,
          "circle-opacity": 0.7,
          // color by speed (m/s); -1 = unknown -> grey
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "speed"],
            -1, "#8892a6",
            0, "#2ecc71",
            5, "#f1c40f",
            15, "#e74c3c",
          ],
        },
      });
      map.addLayer({
        id: "accuracy-fill",
        type: "fill",
        source: "accuracy",
        paint: { "fill-color": "#ffcc00", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        paint: { "line-color": "#ffcc00", "line-width": 3, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "current-point",
        type: "circle",
        source: "current",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ff3b30",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      setMapReady(true);
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [mapStatus, mapStatusLoaded, theme.palette.mode]);

  // ---- push static data + fit bounds when fixes/map ready ----
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    (map.getSource("fixes") as maplibregl.GeoJSONSource | undefined)?.setData(pointsFc);
    (map.getSource("track") as maplibregl.GeoJSONSource | undefined)?.setData(trackFc as any);

    if (points.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const f of points) {
        bounds.extend([f.longitude as number, f.latitude as number]);
      }
      try {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
      } catch {
        /* single-point or degenerate bounds */
      }
    }
  }, [mapReady, pointsFc, trackFc, points]);

  // ---- layer visibility toggles ----
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const setVis = (id: string, on: boolean) =>
      map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    setVis("track-line", showTrack);
    setVis("fixes-points", showPoints);
    setVis("fixes-heat", showHeatmap);
  }, [mapReady, showTrack, showPoints, showHeatmap]);

  // ---- investigator-selectable 2D / 3D presentation ----
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mapStyleInfo) return;
    if (mapStyleInfo.hasTerrain) {
      map.setTerrain(show3d ? { source: "thanatology-terrain", exaggeration: 1 } : null);
    }
    if (map.getLayer("thanatology-buildings-3d")) {
      map.setLayoutProperty(
        "thanatology-buildings-3d",
        "visibility",
        show3d ? "visible" : "none",
      );
    }
    map.easeTo({ pitch: show3d ? 55 : 0, duration: 350 });
  }, [mapReady, mapStyleInfo, show3d]);

  // ---- update current position + trail + accuracy on scrub ----
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || points.length === 0) return;

    const idx = Math.min(tIndex, points.length - 1);
    const cur = points[idx];
    const curTs = cur.ts as number;
    const lng = cur.longitude as number;
    const lat = cur.latitude as number;

    (map.getSource("current") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {},
        },
      ],
    });

    const trailCoords: [number, number][] = [];
    for (let i = idx; i >= 0; i--) {
      const p = points[i];
      if ((curTs - (p.ts as number)) > TRAIL_WINDOW_MS) break;
      trailCoords.unshift([p.longitude as number, p.latitude as number]);
    }
    (map.getSource("trail") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features:
        trailCoords.length >= 2
          ? [{ type: "Feature", geometry: { type: "LineString", coordinates: trailCoords }, properties: {} }]
          : [],
    });

    const acc = cur.horizontal_accuracy;
    (map.getSource("accuracy") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features:
        typeof acc === "number" && acc > 0 ? [accuracyCircle(lng, lat, acc)] : [],
    });
  }, [mapReady, tIndex, points]);

  // ---- playback ----
  React.useEffect(() => {
    if (!playing || points.length === 0) return;
    const timer = window.setInterval(() => {
      setTIndex((prev) => {
        if (prev >= points.length - 1) {
          return prev; // stop advancing at the end
        }
        return prev + 1;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [playing, points.length]);

  // Stop playback once the end is reached.
  React.useEffect(() => {
    if (playing && points.length > 0 && tIndex >= points.length - 1) {
      setPlaying(false);
    }
  }, [playing, tIndex, points.length]);

  const current = points[Math.min(tIndex, Math.max(points.length - 1, 0))];
  const basemapConfigured = !!mapStyleInfo;
  const speedKmh =
    current && typeof current.speed === "number" && current.speed >= 0
      ? (current.speed * 3.6).toFixed(1)
      : null;
  const hasData = !loading && !error && points.length > 0;

  // The map container is ALWAYS rendered so the init effect finds it; loading,
  // error and empty states are drawn as overlays on top of the canvas.
  return (
    <Box sx={{ position: "relative", width: "100%", flexGrow: 1, minHeight: 0, display: "flex" }}>
      <Box ref={containerRef} sx={{ position: "absolute", inset: 0 }} />

      {error && (
        <Box sx={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 3 }}>
          <Alert severity="error">Failed to load location data: {error}</Alert>
        </Box>
      )}

      {basemapError && hasData && (
        <Box sx={{ position: "absolute", top: 8, left: 8, right: 80, zIndex: 3 }}>
          <Alert severity="warning">Local basemap unavailable: {basemapError}</Alert>
        </Box>
      )}

      {loading && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            bgcolor: "background.default",
          }}
        >
          <CircularProgress size={20} />
          <Typography variant="body2">Loading location fixes…</Typography>
        </Box>
      )}

      {!loading && !error && points.length === 0 && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 4,
            bgcolor: "background.default",
          }}
        >
          <Typography color="text.secondary">
            No geolocated fixes found for this partition (routined Cache.sqlite).
          </Typography>
        </Box>
      )}

      {hasData && !basemapConfigured && (
        <Alert
          severity="info"
          variant="filled"
          sx={{ position: "absolute", top: 8, left: 8, right: 80, zIndex: 2, opacity: 0.92 }}
        >
          {mapStatus && !mapStatus.available
            ? "Map storage is unavailable — showing the raw track on a blank canvas."
            : "No local map pack is active — showing the raw track on a blank canvas. Install one under Settings › Location Basemap."}
        </Alert>
      )}

      {/* Controls overlay */}
      {hasData && (
      <Paper
        elevation={3}
        sx={{
          position: "absolute",
          left: 8,
          bottom: 8,
          right: 8,
          zIndex: 2,
          p: 1.5,
          backdropFilter: "blur(8px)",
          bgcolor: "background.paper",
        }}
      >
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Tooltip title={playing ? "Pause" : "Play"}>
              <IconButton size="small" onClick={() => setPlaying((p) => !p)}>
                {playing ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Restart">
              <IconButton
                size="small"
                onClick={() => {
                  setPlaying(false);
                  setTIndex(0);
                }}
              >
                <RestartAltIcon />
              </IconButton>
            </Tooltip>

            <Box sx={{ flexGrow: 1, px: 1, minWidth: 200 }}>
              <Slider
                size="small"
                min={0}
                max={Math.max(points.length - 1, 0)}
                value={Math.min(tIndex, points.length - 1)}
                onChange={(_, v) => {
                  setPlaying(false);
                  setTIndex(v as number);
                }}
                valueLabelDisplay="off"
              />
            </Box>

            <FormControlLabel
              control={<Switch size="small" checked={showTrack} onChange={(e) => setShowTrack(e.target.checked)} />}
              label="Track"
            />
            <FormControlLabel
              control={<Switch size="small" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} />}
              label="Points"
            />
            <FormControlLabel
              control={<Switch size="small" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />}
              label="Heatmap"
            />
            {mapStyleInfo && (
              <FormControlLabel
                control={<Switch size="small" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} />}
                label={mapStyleInfo.hasTerrain ? "3D terrain" : "3D buildings"}
              />
            )}
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Chip
              size="small"
              label={`${points.length} fixes`}
              variant="outlined"
            />
            {mapStyleInfo && (
              <Chip size="small" color="success" variant="outlined" label={mapStyleInfo.packName} />
            )}
            {current?.ts != null && (
              <Chip
                size="small"
                color="primary"
                label={unixToISO8601UTCString(current.ts)}
              />
            )}
            {current && (
              <Chip
                size="small"
                variant="outlined"
                label={`${(current.latitude as number).toFixed(5)}, ${(current.longitude as number).toFixed(5)}`}
              />
            )}
            {speedKmh != null && (
              <Chip size="small" variant="outlined" label={`${speedKmh} km/h`} />
            )}
            {typeof current?.horizontal_accuracy === "number" && (
              <Chip
                size="small"
                variant="outlined"
                label={`±${Math.round(current.horizontal_accuracy)} m`}
              />
            )}
          </Stack>
        </Stack>
      </Paper>
      )}
    </Box>
  );
}
