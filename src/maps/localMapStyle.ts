import { invoke } from "@tauri-apps/api/core";
import { layers, namedFlavor } from "@protomaps/basemaps";
import maplibregl, { type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import { PMTiles, Protocol, type RangeResponse, type Source } from "pmtiles";
import type { MapStorageStatus } from "./types";

export const OFFLINE_BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0b1020" },
    },
  ],
};

class TauriPmtilesSource implements Source {
  constructor(
    private readonly key: string,
    private readonly kind: "basemap" | "terrain",
  ) {}

  getKey() {
    return this.key;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<RangeResponse> {
    signal?.throwIfAborted();
    const bytes = await invoke<number[]>("read_map_range", {
      kind: this.kind,
      offset,
      length,
    });
    signal?.throwIfAborted();
    const data = Uint8Array.from(bytes);
    return { data: data.buffer };
  }
}

const pmtilesProtocol = new Protocol({ metadata: true });
let protocolsRegistered = false;

function assetRelativePath(rawUrl: string): string {
  const url = new URL(rawUrl);
  const segments = [url.hostname, ...url.pathname.split("/")]
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return segments.join("/");
}

function ensureProtocolsRegistered() {
  if (protocolsRegistered) return;
  maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
  maplibregl.addProtocol("thanatology-map", async (request, abortController) => {
    abortController.signal.throwIfAborted();
    const bytes = await invoke<number[]>("read_map_asset", {
      relativePath: assetRelativePath(request.url),
    });
    abortController.signal.throwIfAborted();
    return { data: Uint8Array.from(bytes) };
  });
  protocolsRegistered = true;
}

function insertBeforeLabels(
  mapLayers: LayerSpecification[],
  layer: LayerSpecification,
) {
  const labelIndex = mapLayers.findIndex((candidate) => candidate.type === "symbol");
  if (labelIndex === -1) mapLayers.push(layer);
  else mapLayers.splice(labelIndex, 0, layer);
}

export interface LocalMapStyleResult {
  style: StyleSpecification;
  hasTerrain: boolean;
  packName: string;
}

export function createLocalMapStyle(
  status: MapStorageStatus,
  colorMode: "light" | "dark",
): LocalMapStyleResult | null {
  const pack = status.active_pack;
  if (!status.available || !pack?.available || !status.assets_installed) return null;

  ensureProtocolsRegistered();
  const basemapKey = `thanatology-basemap-${pack.id}`;
  pmtilesProtocol.add(new PMTiles(new TauriPmtilesSource(basemapKey, "basemap")));
  const mapLayers = layers("protomaps", namedFlavor(colorMode), { lang: "en" }) as LayerSpecification[];

  const sources: StyleSpecification["sources"] = {
    protomaps: {
      type: "vector",
      url: `pmtiles://${basemapKey}`,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  };

  insertBeforeLabels(mapLayers, {
    id: "thanatology-buildings-3d",
    type: "fill-extrusion",
    source: "protomaps",
    "source-layer": "buildings",
    minzoom: 14,
    layout: { visibility: "none" },
    filter: ["any", ["!", ["has", "kind"]], ["!=", ["get", "kind"], "address"]],
    paint: {
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-height": ["coalesce", ["get", "height"], 8],
      "fill-extrusion-color": colorMode === "dark" ? "#4e5562" : "#d3d0c9",
      "fill-extrusion-opacity": 0.82,
    },
  });

  if (pack.has_terrain) {
    const terrainKey = `thanatology-terrain-${pack.id}`;
    pmtilesProtocol.add(new PMTiles(new TauriPmtilesSource(terrainKey, "terrain")));
    sources["thanatology-terrain"] = {
      type: "raster-dem",
      url: `pmtiles://${terrainKey}`,
      tileSize: 512,
      encoding: "terrarium",
      attribution: '<a href="https://mapterhorn.com/attribution">Mapterhorn</a>',
    };
    insertBeforeLabels(mapLayers, {
      id: "thanatology-hillshade",
      type: "hillshade",
      source: "thanatology-terrain",
      paint: {
        "hillshade-exaggeration": 0.35,
        "hillshade-shadow-color": colorMode === "dark" ? "#05070b" : "#5f5548",
        "hillshade-highlight-color": colorMode === "dark" ? "#69758a" : "#ffffff",
        "hillshade-accent-color": colorMode === "dark" ? "#263146" : "#8a7d6b",
      },
    });
  }

  return {
    packName: pack.name,
    hasTerrain: pack.has_terrain,
    style: {
      version: 8,
      glyphs: "thanatology-map://fonts/{fontstack}/{range}.pbf",
      sprite: `thanatology-map://sprites/v4/${colorMode}`,
      sources,
      layers: mapLayers,
    },
  };
}
