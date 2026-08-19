import { invoke } from "@tauri-apps/api/core";
import type {
  ExternalApplication,
  ExternalApplicationInput,
  ExternalApplicationProbeResult,
} from "./types";

export async function openExternalApplication(
  application: ExternalApplication,
): Promise<void> {
  await invoke("open_external_application", {
    request: {
      id: application.id,
      name: application.name,
      url: application.url,
      openMode: application.openMode,
      allowInsecureHttp: application.allowInsecureHttp,
    },
  });
}

export async function testExternalApplication(
  input: Pick<ExternalApplicationInput, "url" | "allowInsecureHttp">,
): Promise<ExternalApplicationProbeResult> {
  return invoke<ExternalApplicationProbeResult>("test_external_application", {
    request: {
      url: input.url.trim(),
      allowInsecureHttp: input.allowInsecureHttp,
    },
  });
}
