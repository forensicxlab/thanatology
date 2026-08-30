import { invoke } from "@tauri-apps/api/core";
import type {
  MainSpatiotemporalRangeRequest,
  MainSpatiotemporalSyncRequest,
  OpenSpatiotemporalWindowsResult,
  SpatiotemporalIdentity,
  SpatiotemporalOpenOptions,
  SpatiotemporalSnapshot,
  SpatiotemporalStatePatch,
  SpatiotemporalSyncSeed,
} from "./types";

export const SPATIOTEMPORAL_EVENT_NAME = "spatiotemporal-state";

function openArgs(options: SpatiotemporalOpenOptions) {
  return {
    evidenceId: options.evidenceId,
    partitionId: options.partitionId,
    initialRangeStartMs: options.initialRangeStartMs ?? null,
    initialRangeEndMs: options.initialRangeEndMs ?? null,
  };
}

export const openTimelineWindow = (options: SpatiotemporalOpenOptions) =>
  invoke<string>("open_timeline_window", openArgs(options));

export const openLocationWindow = (options: SpatiotemporalOpenOptions) =>
  invoke<string>("open_location_window", openArgs(options));

export const openSpatiotemporalWindows = (options: SpatiotemporalOpenOptions) =>
  invoke<OpenSpatiotemporalWindowsResult>(
    "open_spatiotemporal_windows",
    openArgs(options),
  );

export const getSpatiotemporalSnapshot = (
  evidenceId: number,
  partitionId: number,
) =>
  invoke<SpatiotemporalSnapshot | null>("get_spatiotemporal_snapshot", {
    evidenceId,
    partitionId,
  });

export const updateSpatiotemporalRangeFromMain = (
  request: MainSpatiotemporalRangeRequest,
) =>
  invoke<SpatiotemporalSnapshot | null>(
    "update_spatiotemporal_range_from_main",
    { request },
  );

export const setSpatiotemporalSyncFromMain = (
  request: MainSpatiotemporalSyncRequest,
) =>
  invoke<SpatiotemporalSnapshot | null>(
    "set_spatiotemporal_sync_from_main",
    { request },
  );

export const registerSpatiotemporalWindow = (identity: SpatiotemporalIdentity) =>
  invoke<SpatiotemporalSnapshot>("register_spatiotemporal_window", {
    request: identity,
  });

export const updateSpatiotemporalState = (
  identity: SpatiotemporalIdentity,
  patch: SpatiotemporalStatePatch,
) =>
  invoke<SpatiotemporalSnapshot>("update_spatiotemporal_state", {
    request: { ...identity, ...patch },
  });

export const updateSpatiotemporalPlaybackCursor = (
  identity: SpatiotemporalIdentity,
  cursorMs: number,
  playbackGeneration: number,
  playbackTickSequence: number,
) =>
  invoke<SpatiotemporalSnapshot>("update_spatiotemporal_state", {
    request: {
      ...identity,
      cursorMs,
      playbackGeneration,
      playbackTickSequence,
    },
  });

export const setSpatiotemporalSync = (
  identity: SpatiotemporalIdentity,
  syncEnabled: boolean,
  seed: SpatiotemporalSyncSeed,
) =>
  invoke<SpatiotemporalSnapshot>("set_spatiotemporal_sync", {
    request: { ...identity, syncEnabled, ...seed },
  });
