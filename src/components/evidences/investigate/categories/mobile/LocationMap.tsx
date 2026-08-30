import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@mui/material/styles";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import {
  getIosLocationCoverage,
  getIosLocationContext,
  getIosLocationObservations,
  type LocationCoverage,
  type LocationContextPoint,
  type LocationContextResult,
  type LocationTimeRange,
} from "../../../../../dbutils/location";
import { useTimeFilter } from "../../../../../store/timeFilterStore";
import { unixToISO8601UTCString } from "../../../common/UnixToUTC";
import { getMapStorageStatus } from "../../../../../maps/mapPacks";
import type { MapStorageStatus } from "../../../../../maps/types";
import {
  createLocalMapStyle,
  OFFLINE_BLANK_STYLE,
  type LocalMapStyleResult,
} from "../../../../../maps/localMapStyle";
import type { LocationCursorChangeReason } from "./locationControl";
import {
  DEFAULT_MAX_TRACK_SPEED_MPS,
  DEFAULT_OBSERVATION_MAX_AGE_MS,
  DEFAULT_TRACK_GAP_MS,
  observationAtOrBefore,
  segmentLocationTrack,
  validateLocationObservations,
  type ValidLocationObservation,
} from "./locationModel";

export interface LocationMapProps {
  evidenceId: number;
  partitionId: number;
  /**
   * Explicit UTC scope for detached windows. `undefined` preserves the current
   * in-main behavior by reading the investigation store; `null` is explicitly
   * unbounded.
   */
  range?: LocationTimeRange | null;
  cursorMs?: number | null;
  playing?: boolean;
  playbackRate?: number;
  /** artifact_objects.id for the selected Routined observation. */
  selectedObservationId?: number | null;
  onCursorChange?: (
    cursorMs: number,
    reason: LocationCursorChangeReason,
  ) => void;
  onPlayingChange?: (playing: boolean) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onObservationSelect?: (artifactObjectId: number | null) => void;
  observationMaxAgeMs?: number;
  trackGapMs?: number;
  maxTrackSpeedMps?: number;
}

const TRAIL_WINDOW_MS = 60 * 60 * 1_000;
const PLAYBACK_TICK_MS = 200; // at most five cross-window cursor messages/sec
const PLAYBACK_RATES = [1, 10, 60, 600, 3_600];

type FixFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>;

function accuracyCircle(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const earth = 6_378_137;
  const dLat = (radiusMeters / earth) * (180 / Math.PI);
  // Avoid an infinite longitude radius for a fix at either pole.
  const cosLatitude = Math.max(
    Math.abs(Math.cos((Math.PI * lat) / 180)),
    1e-6,
  );
  const dLng = (radiusMeters / (earth * cosLatitude)) * (180 / Math.PI);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  };
}

function emptyPoints(): FixFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function emptyLines(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return { type: "FeatureCollection", features: [] };
}

function normalizedRange(range: LocationTimeRange): LocationTimeRange {
  if (
    range.startMs != null &&
    range.endMs != null &&
    range.startMs > range.endMs
  ) {
    return { startMs: range.endMs, endMs: range.startMs };
  }
  return range;
}

function rangeDescription(range: LocationTimeRange): string {
  if (range.startMs == null && range.endMs == null) return "all time";
  const start =
    range.startMs == null
      ? "…"
      : unixToISO8601UTCString(range.startMs);
  const end =
    range.endMs == null ? "…" : unixToISO8601UTCString(range.endMs);
  return `${start} → ${end}`;
}

function playbackRateLabel(rate: number): string {
  if (rate < 60) return `${rate}×`;
  if (rate === 60) return "1 min/s";
  if (rate === 600) return "10 min/s";
  if (rate === 3_600) return "1 hour/s";
  return `${rate}×`;
}

export default function LocationMap({
  evidenceId,
  partitionId,
  range,
  cursorMs,
  playing,
  playbackRate,
  selectedObservationId,
  onCursorChange,
  onPlayingChange,
  onPlaybackRateChange,
  onObservationSelect,
  observationMaxAgeMs = DEFAULT_OBSERVATION_MAX_AGE_MS,
  trackGapMs = DEFAULT_TRACK_GAP_MS,
  maxTrackSpeedMps = DEFAULT_MAX_TRACK_SPEED_MPS,
}: LocationMapProps) {
  const theme = useTheme();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const observationsRef = React.useRef<ValidLocationObservation[]>([]);
  const photoContextRef = React.useRef<LocationContextPoint[]>([]);
  const sharedLocationContextRef = React.useRef<LocationContextPoint[]>([]);
  const seekObservationRef = React.useRef<(index: number) => void>(() => {});
  const selectPhotoContextRef = React.useRef<(index: number) => void>(() => {});
  const selectSharedContextRef = React.useRef<(index: number) => void>(() => {});
  const cursorRef = React.useRef<number | null>(cursorMs ?? null);

  const [mapReady, setMapReady] = React.useState(false);
  const [mapStatusLoaded, setMapStatusLoaded] = React.useState(false);
  const [mapStatus, setMapStatus] = React.useState<MapStorageStatus | null>(null);
  const [mapStyleInfo, setMapStyleInfo] =
    React.useState<LocalMapStyleResult | null>(null);
  const [basemapError, setBasemapError] = React.useState<string | null>(null);

  const storeRange = useTimeFilter();
  const effectiveRange = React.useMemo(
    () =>
      normalizedRange(
        range === undefined
          ? { startMs: storeRange.start, endMs: storeRange.end }
          : range ?? { startMs: null, endMs: null },
      ),
    [range, storeRange.start, storeRange.end],
  );

  const [rawObservations, setRawObservations] = React.useState<
    Awaited<ReturnType<typeof getIosLocationObservations>>
  >([]);
  const [coverage, setCoverage] = React.useState<LocationCoverage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [coverageLoading, setCoverageLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [contextResult, setContextResult] =
    React.useState<LocationContextResult>({
      points: [],
      limitPerKind: 10_000,
      truncatedKinds: [],
    });
  const [contextLoading, setContextLoading] = React.useState(true);
  const [contextError, setContextError] = React.useState<string | null>(null);
  const [selectedContext, setSelectedContext] =
    React.useState<LocationContextPoint | null>(null);

  const [presentedCursor, setPresentedCursor] = React.useState<number | null>(
    cursorMs ?? null,
  );
  const [presentedPlaying, setPresentedPlaying] = React.useState(
    playing ?? false,
  );
  const [presentedRate, setPresentedRate] = React.useState(
    playbackRate ?? 60,
  );
  const [presentedSelectedObservationId, setPresentedSelectedObservationId] =
    React.useState<number | null>(selectedObservationId ?? null);
  const [showTrack, setShowTrack] = React.useState(true);
  const [showPoints, setShowPoints] = React.useState(true);
  const [showHeatmap, setShowHeatmap] = React.useState(false);
  const [showPhotoContext, setShowPhotoContext] = React.useState(true);
  const [showSharedLocationContext, setShowSharedLocationContext] =
    React.useState(true);
  const [show3d, setShow3d] = React.useState(false);
  const [followCurrent, setFollowCurrent] = React.useState(false);

  React.useEffect(() => {
    if (cursorMs !== undefined) {
      setPresentedCursor(cursorMs);
      cursorRef.current = cursorMs;
    }
  }, [cursorMs]);

  React.useEffect(() => {
    if (playing !== undefined) setPresentedPlaying(playing);
  }, [playing]);

  React.useEffect(() => {
    if (playbackRate !== undefined && Number.isFinite(playbackRate)) {
      setPresentedRate(Math.max(0.001, playbackRate));
    }
  }, [playbackRate]);

  React.useEffect(() => {
    if (selectedObservationId !== undefined) {
      setPresentedSelectedObservationId(selectedObservationId);
    }
  }, [selectedObservationId]);

  const validated = React.useMemo(
    () => validateLocationObservations(rawObservations),
    [rawObservations],
  );
  const points = validated.observations;
  observationsRef.current = points;

  const excludedCount =
    validated.summary.inputCount - validated.summary.usableCount;
  const exclusionDescription = [
    [validated.summary.missingTimestamp, "missing/unset timestamp"],
    [validated.summary.missingCoordinate, "missing coordinate"],
    [validated.summary.invalidCoordinate, "out-of-range coordinate"],
    [validated.summary.explicitlyInvalid, "marked invalid by Routined"],
    [validated.summary.invalidAccuracy, "invalid accuracy"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join("; ");

  const trackSegments = React.useMemo(
    () =>
      segmentLocationTrack(points, {
        maxGapMs: trackGapMs,
        maxSpeedMps: maxTrackSpeedMps,
      }),
    [points, trackGapMs, maxTrackSpeedMps],
  );

  const pointsFc = React.useMemo<FixFeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: points.map((observation, index) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [observation.longitude, observation.latitude],
        },
        properties: {
          idx: index,
          artifact_object_id: observation.artifactObjectId,
          ts: observation.timestampMs,
          speed:
            observation.speedMps != null && observation.speedMps >= 0
              ? observation.speedMps
              : -1,
          accuracy: observation.horizontalAccuracyMeters,
        },
      })),
    }),
    [points],
  );

  const photoContext = React.useMemo(
    () =>
      contextResult.points.filter((point) => point.contextKind === "photo"),
    [contextResult.points],
  );
  const sharedLocationContext = React.useMemo(
    () =>
      contextResult.points.filter(
        (point) => point.contextKind === "shared_location",
      ),
    [contextResult.points],
  );
  photoContextRef.current = photoContext;
  sharedLocationContextRef.current = sharedLocationContext;

  const contextFeatureCollection = React.useCallback(
    (contextPoints: LocationContextPoint[]): FixFeatureCollection => ({
      type: "FeatureCollection",
      features: contextPoints.map((point, index) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          idx: index,
          artifact_object_id: point.artifactObjectId,
          ts: point.timestampMs,
        },
      })),
    }),
    [],
  );
  const photoContextFc = React.useMemo(
    () => contextFeatureCollection(photoContext),
    [contextFeatureCollection, photoContext],
  );
  const sharedLocationContextFc = React.useMemo(
    () => contextFeatureCollection(sharedLocationContext),
    [contextFeatureCollection, sharedLocationContext],
  );

  const trackFc = React.useMemo<
    GeoJSON.FeatureCollection<GeoJSON.LineString>
  >(
    () => ({
      type: "FeatureCollection",
      features: trackSegments
        .filter((segment) => segment.length >= 2)
        .map((segment, index) => ({
          type: "Feature",
          id: index,
          geometry: {
            type: "LineString",
            coordinates: segment.map((observation) => [
              observation.longitude,
              observation.latitude,
            ]),
          },
          properties: {},
        })),
    }),
    [trackSegments],
  );
  const trackLineCount = React.useMemo(
    () => trackSegments.filter((segment) => segment.length >= 2).length,
    [trackSegments],
  );

  const playbackStartMs = React.useMemo(() => {
    if (effectiveRange.startMs != null) return effectiveRange.startMs;
    return points[0]?.timestampMs ?? null;
  }, [effectiveRange.startMs, points]);
  const playbackEndMs = React.useMemo(() => {
    if (effectiveRange.endMs != null) return effectiveRange.endMs;
    return points[points.length - 1]?.timestampMs ?? null;
  }, [effectiveRange.endMs, points]);
  const hasPlayableSpan =
    playbackStartMs != null &&
    playbackEndMs != null &&
    playbackEndMs > playbackStartMs &&
    points.length > 0;

  const publishCursor = React.useCallback(
    (nextCursor: number, reason: LocationCursorChangeReason) => {
      const rounded = Math.round(nextCursor);
      cursorRef.current = rounded;
      setPresentedCursor(rounded);
      onCursorChange?.(rounded, reason);
    },
    [onCursorChange],
  );

  const publishPlaying = React.useCallback(
    (nextPlaying: boolean) => {
      setPresentedPlaying(nextPlaying);
      onPlayingChange?.(nextPlaying);
    },
    [onPlayingChange],
  );

  const publishRate = React.useCallback(
    (nextRate: number) => {
      const safeRate = Math.max(0.001, nextRate);
      setPresentedRate(safeRate);
      onPlaybackRateChange?.(safeRate);
    },
    [onPlaybackRateChange],
  );

  const publishObservationSelection = React.useCallback(
    (artifactObjectId: number | null) => {
      setPresentedSelectedObservationId(artifactObjectId);
      onObservationSelect?.(artifactObjectId);
    },
    [onObservationSelect],
  );

  // An uncontrolled in-main map starts at the first instant in its scope.
  React.useEffect(() => {
    if (cursorMs !== undefined || playbackStartMs == null || playbackEndMs == null) {
      return;
    }
    const cursor = cursorRef.current;
    if (cursor == null || cursor < playbackStartMs || cursor > playbackEndMs) {
      publishCursor(playbackStartMs, "restart");
    }
  }, [cursorMs, playbackStartMs, playbackEndMs, publishCursor]);

  const current = React.useMemo(
    () =>
      observationAtOrBefore(points, presentedCursor, observationMaxAgeMs),
    [points, presentedCursor, observationMaxAgeMs],
  );

  seekObservationRef.current = (index: number) => {
    const observation = observationsRef.current[index];
    if (!observation) return;
    publishPlaying(false);
    publishObservationSelection(observation.artifactObjectId);
    publishCursor(observation.timestampMs, "observation");
  };

  // Context markers never drive the evidence clock and are never promoted to
  // a Routined observation. Selecting one only opens its provenance summary.
  selectPhotoContextRef.current = (index: number) => {
    setSelectedContext(photoContextRef.current[index] ?? null);
  };
  selectSharedContextRef.current = (index: number) => {
    setSelectedContext(sharedLocationContextRef.current[index] ?? null);
  };

  React.useEffect(() => {
    if (
      selectedContext &&
      !contextResult.points.some(
        (point) => point.artifactObjectId === selectedContext.artifactObjectId,
      )
    ) {
      setSelectedContext(null);
    }
  }, [contextResult.points, selectedContext]);

  React.useEffect(() => {
    let alive = true;
    getMapStorageStatus()
      .then((status) => {
        if (alive) setMapStatus(status);
      })
      .catch((caught) => {
        if (alive) {
          setBasemapError(
            caught instanceof Error ? caught.message : String(caught),
          );
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

  React.useEffect(() => {
    let alive = true;
    setCoverageLoading(true);
    getIosLocationCoverage(evidenceId, partitionId)
      .then((result) => {
        if (alive) setCoverage(result);
      })
      .catch(() => {
        if (alive) setCoverage(null);
      })
      .finally(() => {
        if (alive) setCoverageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getIosLocationObservations({
      evidenceId,
      partitionId,
      range: effectiveRange,
    })
      .then((data) => {
        if (alive) setRawObservations(data);
      })
      .catch((caught) => {
        if (alive) {
          setRawObservations([]);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    evidenceId,
    partitionId,
    effectiveRange.startMs,
    effectiveRange.endMs,
  ]);

  React.useEffect(() => {
    let alive = true;
    setContextLoading(true);
    setContextError(null);
    getIosLocationContext({
      evidenceId,
      partitionId,
      range: effectiveRange,
    })
      .then((result) => {
        if (alive) setContextResult(result);
      })
      .catch((caught) => {
        if (alive) {
          setContextResult({
            points: [],
            limitPerKind: 10_000,
            truncatedKinds: [],
          });
          setContextError(
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      })
      .finally(() => {
        if (alive) setContextLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    evidenceId,
    partitionId,
    effectiveRange.startMs,
    effectiveRange.endMs,
  ]);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapStatusLoaded) return;
    const localStyle = mapStatus
      ? createLocalMapStyle(mapStatus, theme.palette.mode)
      : null;
    setMapStyleInfo(localStyle);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: localStyle?.style ?? OFFLINE_BLANK_STYLE,
        center: [0, 20],
        zoom: 1,
        maxPitch: 85,
        attributionControl: { compact: true },
      });
    } catch (caught) {
      setError(
        `Failed to initialise map: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        visualizePitch: true,
      }),
      "top-right",
    );

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      map.addSource("track", { type: "geojson", data: emptyLines() });
      map.addSource("fixes", { type: "geojson", data: emptyPoints() });
      map.addSource("photo-context", {
        type: "geojson",
        data: emptyPoints(),
      });
      map.addSource("shared-location-context", {
        type: "geojson",
        data: emptyPoints(),
      });
      map.addSource("trail", { type: "geojson", data: emptyLines() });
      map.addSource("accuracy", { type: "geojson", data: emptyLines() });
      map.addSource("current", { type: "geojson", data: emptyPoints() });
      map.addSource("selected-observation", {
        type: "geojson",
        data: emptyPoints(),
      });
      map.addSource("selected-context", {
        type: "geojson",
        data: emptyPoints(),
      });

      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#4f8cff",
          "line-width": 1.5,
          "line-opacity": 0.35,
        },
      });
      map.addLayer({
        id: "fixes-heat",
        type: "heatmap",
        source: "fixes",
        layout: { visibility: "none" },
        paint: { "heatmap-radius": 18, "heatmap-opacity": 0.7 },
      });
      map.addLayer({
        id: "fixes-points",
        type: "circle",
        source: "fixes",
        paint: {
          "circle-radius": 3,
          "circle-opacity": 0.7,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "speed"],
            -1,
            "#8892a6",
            0,
            "#2ecc71",
            5,
            "#f1c40f",
            15,
            "#e74c3c",
          ],
        },
      });
      map.addLayer({
        id: "photo-context-points",
        type: "circle",
        source: "photo-context",
        paint: {
          "circle-radius": 5,
          "circle-color": "#b26cff",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: "shared-location-context-points",
        type: "circle",
        source: "shared-location-context",
        paint: {
          "circle-radius": 6,
          "circle-color": "#00a7a7",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
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
        paint: {
          "line-color": "#ffcc00",
          "line-width": 3,
          "line-opacity": 0.9,
        },
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
      map.addLayer({
        id: "selected-observation-ring",
        type: "circle",
        source: "selected-observation",
        paint: {
          "circle-radius": 11,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": "#b26cff",
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "selected-context-ring",
        type: "circle",
        source: "selected-context",
        paint: {
          "circle-radius": 12,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.on("mouseenter", "fixes-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "fixes-points", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "fixes-points", (event) => {
        const rawIndex = event.features?.[0]?.properties?.idx;
        const index = Number(rawIndex);
        if (Number.isInteger(index)) seekObservationRef.current(index);
      });
      for (const layerId of [
        "photo-context-points",
        "shared-location-context-points",
      ]) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      map.on("click", "photo-context-points", (event) => {
        const index = Number(event.features?.[0]?.properties?.idx);
        if (Number.isInteger(index)) selectPhotoContextRef.current(index);
      });
      map.on("click", "shared-location-context-points", (event) => {
        const index = Number(event.features?.[0]?.properties?.idx);
        if (Number.isInteger(index)) selectSharedContextRef.current(index);
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

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("fixes") as maplibregl.GeoJSONSource | undefined)?.setData(
      pointsFc,
    );
    (map.getSource("track") as maplibregl.GeoJSONSource | undefined)?.setData(
      trackFc,
    );
    (
      map.getSource("photo-context") as
        | maplibregl.GeoJSONSource
        | undefined
    )?.setData(photoContextFc);
    (
      map.getSource("shared-location-context") as
        | maplibregl.GeoJSONSource
        | undefined
    )?.setData(sharedLocationContextFc);

    const spatialPoints = [
      ...points,
      ...photoContext,
      ...sharedLocationContext,
    ];
    if (spatialPoints.length === 1) {
      map.jumpTo({
        center: [spatialPoints[0].longitude, spatialPoints[0].latitude],
        zoom: 14,
      });
    } else if (spatialPoints.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      spatialPoints.forEach((point) =>
        bounds.extend([point.longitude, point.latitude]),
      );
      try {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
      } catch {
        // Degenerate bounds still leave individual points available.
      }
    }
  }, [
    mapReady,
    pointsFc,
    trackFc,
    points,
    photoContextFc,
    sharedLocationContextFc,
    photoContext,
    sharedLocationContext,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const selected =
      presentedSelectedObservationId == null
        ? null
        : points.find(
            (point) =>
              point.artifactObjectId === presentedSelectedObservationId,
          ) ?? null;
    (
      map.getSource("selected-observation") as
        | maplibregl.GeoJSONSource
        | undefined
    )?.setData({
      type: "FeatureCollection",
      features: selected
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [selected.longitude, selected.latitude],
              },
              properties: {
                artifact_object_id: selected.artifactObjectId,
              },
            },
          ]
        : [],
    });
  }, [mapReady, points, presentedSelectedObservationId]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const selectedIsVisible =
      selectedContext != null &&
      ((selectedContext.contextKind === "photo" && showPhotoContext) ||
        (selectedContext.contextKind === "shared_location" &&
          showSharedLocationContext));
    (
      map.getSource("selected-context") as
        | maplibregl.GeoJSONSource
        | undefined
    )?.setData({
      type: "FeatureCollection",
      features:
        selectedContext && selectedIsVisible
          ? [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [
                    selectedContext.longitude,
                    selectedContext.latitude,
                  ],
                },
                properties: {
                  artifact_object_id: selectedContext.artifactObjectId,
                },
              },
            ]
          : [],
    });
  }, [
    mapReady,
    selectedContext,
    showPhotoContext,
    showSharedLocationContext,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const setVisibility = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    };
    setVisibility("track-line", showTrack);
    setVisibility("fixes-points", showPoints);
    setVisibility("fixes-heat", showHeatmap);
    setVisibility("photo-context-points", showPhotoContext);
    setVisibility(
      "shared-location-context-points",
      showSharedLocationContext,
    );
  }, [
    mapReady,
    showTrack,
    showPoints,
    showHeatmap,
    showPhotoContext,
    showSharedLocationContext,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !mapStyleInfo) return;
    if (mapStyleInfo.hasTerrain) {
      map.setTerrain(
        show3d ? { source: "thanatology-terrain", exaggeration: 1 } : null,
      );
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

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const currentSource = map.getSource("current") as
      | maplibregl.GeoJSONSource
      | undefined;
    const accuracySource = map.getSource("accuracy") as
      | maplibregl.GeoJSONSource
      | undefined;
    const trailSource = map.getSource("trail") as
      | maplibregl.GeoJSONSource
      | undefined;

    if (presentedCursor == null || !current) {
      currentSource?.setData(emptyPoints());
      accuracySource?.setData(emptyLines());
    } else {
      currentSource?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [current.longitude, current.latitude],
            },
            properties: {
              ts: current.timestampMs,
              age_ms: presentedCursor - current.timestampMs,
            },
          },
        ],
      });
      const accuracy = current.horizontalAccuracyMeters;
      accuracySource?.setData({
        type: "FeatureCollection",
        features:
          accuracy != null && accuracy > 0
            ? [accuracyCircle(current.longitude, current.latitude, accuracy)]
            : [],
      });
      if (followCurrent) {
        map.easeTo({
          center: [current.longitude, current.latitude],
          duration: Math.min(PLAYBACK_TICK_MS, 180),
        });
      }
    }

    const trailPoints =
      presentedCursor == null
        ? []
        : points.filter(
            (point) =>
              point.timestampMs <= presentedCursor &&
              presentedCursor - point.timestampMs <= TRAIL_WINDOW_MS,
          );
    const trailSegments = segmentLocationTrack(trailPoints, {
      maxGapMs: trackGapMs,
      maxSpeedMps: maxTrackSpeedMps,
    });
    trailSource?.setData({
      type: "FeatureCollection",
      features: trailSegments
        .filter((segment) => segment.length >= 2)
        .map((segment, index) => ({
          type: "Feature",
          id: index,
          geometry: {
            type: "LineString",
            coordinates: segment.map((point) => [
              point.longitude,
              point.latitude,
            ]),
          },
          properties: {},
        })),
    });
  }, [
    mapReady,
    presentedCursor,
    current,
    points,
    followCurrent,
    trackGapMs,
    maxTrackSpeedMps,
  ]);

  // UTC evidence-clock playback. The elapsed wall-clock delta is measured with
  // performance.now(), so throttled timers do not make evidence time drift.
  React.useEffect(() => {
    if (
      !presentedPlaying ||
      !hasPlayableSpan ||
      playbackStartMs == null ||
      playbackEndMs == null
    ) {
      return;
    }
    let lastWallMs = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedWallMs = Math.max(0, now - lastWallMs);
      lastWallMs = now;
      let base = cursorRef.current;
      if (base == null || base < playbackStartMs || base > playbackEndMs) {
        base = playbackStartMs;
      }
      const next = base + elapsedWallMs * presentedRate;
      if (next >= playbackEndMs) {
        publishCursor(playbackEndMs, "playback");
        publishPlaying(false);
      } else {
        publishCursor(next, "playback");
      }
    }, PLAYBACK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [
    presentedPlaying,
    presentedRate,
    hasPlayableSpan,
    playbackStartMs,
    playbackEndMs,
    publishCursor,
    publishPlaying,
  ]);

  const speedKmh =
    current?.speedMps != null && current.speedMps >= 0
      ? (current.speedMps * 3.6).toFixed(1)
      : null;
  const observationAgeMs =
    current && presentedCursor != null
      ? Math.max(0, presentedCursor - current.timestampMs)
      : null;
  const basemapConfigured = !!mapStyleInfo;
  const hasMovementData = !loading && !error && points.length > 0;
  const hasContextData =
    !contextLoading && !contextError && contextResult.points.length > 0;
  const hasData = hasMovementData || hasContextData;
  const sliderSpan =
    playbackStartMs != null && playbackEndMs != null
      ? playbackEndMs - playbackStartMs
      : 0;
  const sliderValue =
    playbackStartMs != null && playbackEndMs != null
      ? Math.min(
          playbackEndMs,
          Math.max(playbackStartMs, presentedCursor ?? playbackStartMs),
        )
      : 0;
  const playbackRateOptions = React.useMemo(
    () =>
      PLAYBACK_RATES.includes(presentedRate)
        ? PLAYBACK_RATES
        : [presentedRate, ...PLAYBACK_RATES].sort((left, right) => left - right),
    [presentedRate],
  );

  const emptyMessage = React.useMemo(() => {
    if (coverageLoading || contextLoading) {
      return "Checking device-location and spatial-context coverage…";
    }
    if (!coverage || coverage.totalRecords === 0) {
      return "No Routined device-location observations, geotagged Photos, or explicitly classified communication locations were found for this partition and time range.";
    }
    if (rawObservations.length === 0) {
      const coverageRange =
        coverage.startMs != null && coverage.endMs != null
          ? `${unixToISO8601UTCString(coverage.startMs)} → ${unixToISO8601UTCString(
              coverage.endMs,
            )}`
          : "an unknown time span";
      return `Location observations exist on this partition (${coverageRange}), but none fall inside the selected range (${rangeDescription(
        effectiveRange,
      )}).`;
    }
    return `${rawObservations.length.toLocaleString()} location record(s) fall inside the selected range, but none passed coordinate, timestamp, validity, and accuracy checks.`;
  }, [
    coverageLoading,
    contextLoading,
    coverage,
    rawObservations.length,
    effectiveRange,
  ]);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        flexGrow: 1,
        minHeight: 0,
        display: "flex",
      }}
    >
      <Box ref={containerRef} sx={{ position: "absolute", inset: 0 }} />

      <Stack
        spacing={0.75}
        sx={{ position: "absolute", top: 8, left: 8, right: 80, zIndex: 3 }}
      >
        {error && (
          <Alert severity="error">Failed to load location data: {error}</Alert>
        )}
        {contextError && (
          <Alert severity="warning">
            Failed to load secondary spatial context: {contextError}. Routined
            observations remain available.
          </Alert>
        )}
        {basemapError && hasData && (
          <Alert severity="warning">
            Local basemap unavailable: {basemapError}. The observed track and
            synchronized clock remain available on the blank canvas.
          </Alert>
        )}
        {hasData && !basemapConfigured && (
          <Alert severity="info" variant="filled" sx={{ opacity: 0.92 }}>
            {mapStatus && !mapStatus.available
              ? "Map storage is unavailable — showing the observed track on a blank canvas."
              : "No local map pack is active — showing the observed track on a blank canvas. Install one under Settings › Location Basemap."}
          </Alert>
        )}
        {hasData && points.length === 1 && (
          <Alert severity="info">
            One usable observation is available. It can be inspected, but it
            does not establish a movement track.
          </Alert>
        )}
        {hasContextData && points.length === 0 && (
          <Alert severity="info">
            Only secondary context is available in this scope. Photo and shared
            location markers are artefacts at coordinates; they are not joined
            into a movement track and never become the device playhead.
          </Alert>
        )}
        {contextResult.truncatedKinds.length > 0 && (
          <Alert severity="warning">
            Context overlay capped at {contextResult.limitPerKind.toLocaleString()}
            {" "}records per source for: {contextResult.truncatedKinds
              .map((kind) =>
                kind === "photo" ? "geotagged Photos" : "shared locations",
              )
              .join(", ")}.
          </Alert>
        )}
      </Stack>

      {!hasData && (loading || contextLoading) && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            bgcolor: "background.default",
          }}
        >
          <CircularProgress size={20} />
          <Typography variant="body2">
            Loading location observations and spatial context…
          </Typography>
        </Box>
      )}

      {!loading && !contextLoading && !hasData && (
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
          <Stack spacing={1} sx={{ maxWidth: 720, textAlign: "center" }}>
            <Typography color="text.secondary">{emptyMessage}</Typography>
            {excludedCount > 0 && (
              <Typography variant="caption" color="text.secondary">
                Excluded records: {exclusionDescription}.
              </Typography>
            )}
          </Stack>
        </Box>
      )}

      {selectedContext && (
        <Paper
          elevation={5}
          sx={{
            position: "absolute",
            top: 56,
            right: 48,
            zIndex: 5,
            width: 360,
            maxWidth: "calc(100% - 72px)",
            p: 1.25,
            backdropFilter: "blur(10px)",
            bgcolor: "background.paper",
          }}
        >
          <Stack spacing={0.75}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start" }}
            >
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  {selectedContext.contextKind === "photo"
                    ? "Geotagged Photos context"
                    : "Communication shared-location context"}
                </Typography>
                <Typography variant="subtitle2" noWrap title={selectedContext.label}>
                  {selectedContext.label}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label="Close context details"
                onClick={() => setSelectedContext(null)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ flexWrap: "wrap" }}
              useFlexGap
            >
              <Chip
                size="small"
                variant="outlined"
                label={`${selectedContext.latitude.toFixed(6)}, ${selectedContext.longitude.toFixed(6)}`}
              />
              {selectedContext.timestampMs != null && (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={unixToISO8601UTCString(selectedContext.timestampMs)}
                />
              )}
              {selectedContext.direction && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={selectedContext.direction}
                />
              )}
            </Stack>
            {(selectedContext.assetPath || selectedContext.conversation) && (
              <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                {selectedContext.assetPath ??
                  `Conversation: ${selectedContext.conversation}`}
              </Typography>
            )}
            {selectedContext.sender && (
              <Typography variant="caption">
                Sender: {selectedContext.sender}
              </Typography>
            )}
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Parser: {selectedContext.parser} · object #
              {selectedContext.artifactObjectId}
              {selectedContext.sourceTable
                ? ` · ${selectedContext.sourceTable}${
                    selectedContext.sourceRowId != null
                      ? ` row ${selectedContext.sourceRowId}`
                      : ""
                  }`
                : ""}
            </Typography>
            {selectedContext.sourcePath && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: "anywhere" }}
              >
                Source: {selectedContext.sourcePath}
              </Typography>
            )}
            <Typography variant="caption" color="warning.main">
              Context marker only — it is not evidence of a continuous device
              position and does not move the synchronized time cursor.
            </Typography>
          </Stack>
        </Paper>
      )}

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
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Tooltip title={presentedPlaying ? "Pause" : "Play UTC evidence clock"}>
                <span>
                  <IconButton
                    size="small"
                    disabled={!hasPlayableSpan}
                    onClick={() => {
                      if (!presentedPlaying && presentedCursor == null && playbackStartMs != null) {
                        publishCursor(playbackStartMs, "restart");
                      }
                      publishPlaying(!presentedPlaying);
                    }}
                  >
                    {presentedPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Restart at the beginning of the selected UTC range">
                <span>
                  <IconButton
                    size="small"
                    disabled={playbackStartMs == null}
                    onClick={() => {
                      publishPlaying(false);
                      if (playbackStartMs != null) {
                        publishCursor(playbackStartMs, "restart");
                      }
                    }}
                  >
                    <RestartAltIcon />
                  </IconButton>
                </span>
              </Tooltip>

              <Box sx={{ flexGrow: 1, px: 1, minWidth: 240 }}>
                <Slider
                  size="small"
                  min={playbackStartMs ?? 0}
                  max={
                    sliderSpan > 0
                      ? (playbackEndMs as number)
                      : (playbackStartMs ?? 0) + 1
                  }
                  step={Math.max(1_000, Math.floor(Math.max(sliderSpan, 1) / 10_000))}
                  value={sliderValue}
                  disabled={sliderSpan <= 0}
                  onChange={(_, value) => {
                    if (presentedPlaying) publishPlaying(false);
                    const nextCursor = Math.round(value as number);
                    cursorRef.current = nextCursor;
                    setPresentedCursor(nextCursor);
                  }}
                  onChangeCommitted={(_, value) =>
                    publishCursor(value as number, "scrub")
                  }
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) =>
                    unixToISO8601UTCString(value as number)
                  }
                />
              </Box>

              <FormControl size="small" sx={{ minWidth: 112 }}>
                <InputLabel id="location-playback-rate-label">Clock rate</InputLabel>
                <Select
                  labelId="location-playback-rate-label"
                  label="Clock rate"
                  value={presentedRate}
                  onChange={(event) => publishRate(Number(event.target.value))}
                >
                  {playbackRateOptions.map((rateOption) => (
                    <MenuItem key={rateOption} value={rateOption}>
                      {playbackRateLabel(rateOption)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={followCurrent}
                    onChange={(event) => setFollowCurrent(event.target.checked)}
                  />
                }
                label="Follow"
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showTrack}
                    onChange={(event) => setShowTrack(event.target.checked)}
                  />
                }
                label="Track"
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showPoints}
                    onChange={(event) => setShowPoints(event.target.checked)}
                  />
                }
                label="Points"
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showHeatmap}
                    onChange={(event) => setShowHeatmap(event.target.checked)}
                  />
                }
                label="Heatmap"
              />
              <Tooltip title="Geotagged Photos are independent context markers and are never joined into the Routined movement track">
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={showPhotoContext}
                      disabled={photoContext.length === 0}
                      onChange={(event) =>
                        setShowPhotoContext(event.target.checked)
                      }
                    />
                  }
                  label={`Photos (${photoContext.length.toLocaleString()})`}
                />
              </Tooltip>
              <Tooltip title="Only communication records explicitly classified by their parser as shared locations are shown; they never drive the playhead">
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={showSharedLocationContext}
                      disabled={sharedLocationContext.length === 0}
                      onChange={(event) =>
                        setShowSharedLocationContext(event.target.checked)
                      }
                    />
                  }
                  label={`Shared (${sharedLocationContext.length.toLocaleString()})`}
                />
              </Tooltip>
              {mapStyleInfo && (
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={show3d}
                      onChange={(event) => setShow3d(event.target.checked)}
                    />
                  }
                  label={mapStyleInfo.hasTerrain ? "3D terrain" : "3D buildings"}
                />
              )}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Chip
                size="small"
                label={`${points.length.toLocaleString()} usable fix${
                  points.length === 1 ? "" : "es"
                } in range`}
                variant="outlined"
              />
              {contextResult.points.length > 0 && (
                <Tooltip title="Secondary spatial artefacts in the current evidence, partition and UTC range; excluded from all movement lines">
                  <Chip
                    size="small"
                    color="secondary"
                    variant="outlined"
                    label={`${contextResult.points.length.toLocaleString()} context marker${
                      contextResult.points.length === 1 ? "" : "s"
                    }`}
                  />
                </Tooltip>
              )}
              {contextLoading && (
                <Chip
                  size="small"
                  variant="outlined"
                  label="Loading context…"
                />
              )}
              {coverage && (
                <Tooltip title="Partition-wide Routined records, independent of the selected time range">
                  <Chip
                    size="small"
                    label={`${coverage.totalRecords.toLocaleString()} partition records`}
                    variant="outlined"
                  />
                </Tooltip>
              )}
              {excludedCount > 0 && (
                <Tooltip title={exclusionDescription}>
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={`${excludedCount.toLocaleString()} excluded`}
                  />
                </Tooltip>
              )}
              {trackLineCount > 1 && (
                <Tooltip title="Movement lines are deliberately broken at long gaps, the antimeridian, and implausible jumps">
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${trackLineCount.toLocaleString()} track segments`}
                  />
                </Tooltip>
              )}
              {mapStyleInfo && (
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={mapStyleInfo.packName}
                />
              )}
              {presentedCursor != null && (
                <Chip
                  size="small"
                  color="primary"
                  label={unixToISO8601UTCString(presentedCursor)}
                />
              )}
              {presentedCursor != null && !current && (
                <Tooltip
                  title={`No valid Routined observation at or before the cursor within ${Math.round(
                    observationMaxAgeMs / 60_000,
                  )} minutes. No position is interpolated.`}
                >
                  <Chip
                    size="small"
                    color="warning"
                    label="No observed position at cursor"
                  />
                </Tooltip>
              )}
              {current && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${current.latitude.toFixed(5)}, ${current.longitude.toFixed(5)}`}
                />
              )}
              {presentedSelectedObservationId != null && (
                <Chip
                  size="small"
                  color="secondary"
                  variant="outlined"
                  label={`Selected object #${presentedSelectedObservationId}`}
                  onDelete={() => publishObservationSelection(null)}
                />
              )}
              {observationAgeMs != null && observationAgeMs > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`last observed ${Math.round(observationAgeMs / 1_000)} s earlier`}
                />
              )}
              {speedKmh != null && (
                <Chip size="small" variant="outlined" label={`${speedKmh} km/h`} />
              )}
              {current?.horizontalAccuracyMeters != null && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`±${Math.round(current.horizontalAccuracyMeters)} m`}
                />
              )}
            </Stack>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
