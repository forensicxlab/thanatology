import { invoke } from "@tauri-apps/api/core";

interface MediaSourceUrlResponse {
  url: string;
}

export interface MediaSourceUrlParams {
  fileId: number;
  path?: string | null;
  rootPath?: string | null;
  mime?: string | null;
  preview?: boolean;
}

export async function getMediaSourceUrl({
  fileId,
  path,
  rootPath,
  mime,
  preview,
}: MediaSourceUrlParams): Promise<string> {
  const response = await invoke<MediaSourceUrlResponse>("register_media_source", {
    fileId,
    path: path ?? undefined,
    rootPath: rootPath ?? undefined,
    mime: mime ?? undefined,
    preview: preview ?? undefined,
  });
  return response.url;
}
