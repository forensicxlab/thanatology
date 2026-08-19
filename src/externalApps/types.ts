export type ExternalApplicationOpenMode = "managed" | "browser";

export interface ExternalApplication {
  id: number;
  name: string;
  description: string;
  url: string;
  openMode: ExternalApplicationOpenMode;
  allowInsecureHttp: boolean;
  enabled: boolean;
  showDashboard: boolean;
  showSidebar: boolean;
  iconDataUrl: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type ExternalApplicationInput = Omit<
  ExternalApplication,
  "id" | "sortOrder" | "createdAt" | "updatedAt"
>;

export interface ExternalApplicationProbeResult {
  reachable: boolean;
  status: number;
  statusText: string;
  finalUrl: string;
}

export const DEFAULT_EXTERNAL_APPLICATION_INPUT: ExternalApplicationInput = {
  name: "",
  description: "",
  url: "",
  openMode: "managed",
  allowInsecureHttp: false,
  enabled: true,
  showDashboard: true,
  showSidebar: true,
  iconDataUrl: null,
};

export function toExternalApplicationInput(
  application: ExternalApplication,
): ExternalApplicationInput {
  return {
    name: application.name,
    description: application.description,
    url: application.url,
    openMode: application.openMode,
    allowInsecureHttp: application.allowInsecureHttp,
    enabled: application.enabled,
    showDashboard: application.showDashboard,
    showSidebar: application.showSidebar,
    iconDataUrl: application.iconDataUrl,
  };
}

export function isLocalOrPrivateHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:") return false;

    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }

    const octets = host.split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return false;
    }

    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  } catch {
    return false;
  }
}

export function validateExternalApplication(
  input: ExternalApplicationInput,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const rawUrl = input.url.trim();

  if (!name) errors.name = "Name is required.";
  else if (name.length > 64) errors.name = "Name cannot exceed 64 characters.";

  if (input.description.length > 256) {
    errors.description = "Description cannot exceed 256 characters.";
  }

  if (!rawUrl) {
    errors.url = "Endpoint URL is required.";
  } else if (rawUrl.length > 2_048) {
    errors.url = "Endpoint URL cannot exceed 2,048 characters.";
  } else {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.url = "Only HTTP and HTTPS endpoints are supported.";
      } else if (!url.hostname) {
        errors.url = "The endpoint must include a hostname.";
      } else if (url.username || url.password) {
        errors.url = "Do not embed credentials in the endpoint URL.";
      } else if (
        url.protocol === "http:" &&
        !isLocalOrPrivateHttpUrl(rawUrl) &&
        !input.allowInsecureHttp
      ) {
        errors.url = "Acknowledge unencrypted HTTP before saving this public endpoint.";
      }
    } catch {
      errors.url = "Enter a valid absolute endpoint URL.";
    }
  }

  if (input.iconDataUrl) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(input.iconDataUrl)) {
      errors.icon = "The custom icon format is invalid.";
    } else if (input.iconDataUrl.length > 700_000) {
      errors.icon = "The processed icon is too large.";
    }
  }

  return errors;
}
