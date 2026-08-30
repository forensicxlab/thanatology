import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadMapPackRequest,
  ImportMapPackRequest,
  MapPackManifest,
  MapStorageStatus,
} from "./types";

export const getMapStorageStatus = () =>
  invoke<MapStorageStatus>("get_map_storage_status");

export const setMapStorageRoot = (
  selectedDirectory: string | null,
  moveExisting: boolean,
) =>
  invoke<MapStorageStatus>("set_map_storage_root", {
    selectedDirectory,
    moveExisting,
  });

export const activateMapPack = (packId: string) =>
  invoke<void>("activate_map_pack", { packId });

export const removeMapPack = (packId: string) =>
  invoke<void>("remove_map_pack", { packId });

export const discardMapDownload = (downloadId: string) =>
  invoke<void>("discard_map_download", { downloadId });

export const downloadMapPack = (request: DownloadMapPackRequest) =>
  invoke<MapPackManifest>("download_map_pack", { request });

export const importMapPack = (request: ImportMapPackRequest) =>
  invoke<MapPackManifest>("import_map_pack", { request });

export const cancelMapDownload = () =>
  invoke<boolean>("cancel_map_download");

export const readMapRange = (
  kind: "basemap" | "terrain",
  offset: number,
  length: number,
) => invoke<number[]>("read_map_range", { kind, offset, length });

export const readMapAsset = (relativePath: string) =>
  invoke<number[]>("read_map_asset", { relativePath });
