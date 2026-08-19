export interface MapPackSummary {
  id: string;
  name: string;
  provider: string;
  created_at_unix: number;
  size_bytes: number;
  has_terrain: boolean;
  is_active: boolean;
  available: boolean;
  attribution: string[];
}

export interface MapStorageStatus {
  root: string;
  is_default: boolean;
  available: boolean;
  free_bytes: number | null;
  used_bytes: number;
  active_pack_id: string | null;
  active_pack: MapPackSummary | null;
  packs: MapPackSummary[];
  assets_installed: boolean;
  download_active: boolean;
}

export interface MapPackFile {
  file_name: string;
  size_bytes: number;
  sha256: string;
  source_url: string | null;
}

export interface MapPackManifest {
  id: string;
  name: string;
  created_at_unix: number;
  provider: string;
  basemap: MapPackFile;
  terrain: MapPackFile | null;
  attribution: string[];
  assets_version: number;
}

export interface DownloadMapPackRequest {
  name: string;
  includeTerrain: boolean;
  basemapUrl?: string;
  terrainUrl?: string;
}

export interface ImportMapPackRequest {
  name: string;
  basemapPath: string;
  terrainPath?: string;
}

export interface MapDownloadProgress {
  packId: string;
  phase: "basemap" | "terrain" | "assets" | "complete" | string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number | null;
  message: string;
}
