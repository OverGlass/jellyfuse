// Port of the `/System/Info/Public` Jellyfin endpoint used during the
// server-connect flow. Matches the Rust call in crates/jf-api/src/jellyfin.rs.
// Pure function — takes an HTTP fetcher so tests can inject a fake fetch.

/**
 * Publicly-exposed Jellyfin server info. Enough to identify a server, version
 * it for compatibility checks, and display it to the user in the connect UI.
 */
export interface SystemInfoPublic {
  serverName: string;
  productName: string;
  version: string;
  id: string;
}

/** Minimal fetch-shaped function the client needs. Matches global `fetch`. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal | undefined },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Error thrown when the server responds but the payload is not a SystemInfo. */
export class SystemInfoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemInfoParseError";
  }
}

/** HTTP failure (4xx/5xx) from the /System/Info/Public endpoint. */
export class SystemInfoHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Jellyfin /System/Info/Public returned HTTP ${status}`);
    this.name = "SystemInfoHttpError";
    this.status = status;
  }
}

/**
 * Fetch `/System/Info/Public` from a Jellyfin base URL.
 *
 * The Jellyfin response uses PascalCase (`ServerName`, `Version`, …). This
 * function normalises it to our camelCase `SystemInfoPublic` domain type so
 * downstream hooks / views stay ergonomic.
 */
export async function getSystemInfoPublic(
  baseUrl: string,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<SystemInfoPublic> {
  const url = joinPath(baseUrl, "/System/Info/Public");
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new SystemInfoHttpError(response.status);
  }
  const raw = await response.json();
  if (!isRawSystemInfo(raw)) {
    throw new SystemInfoParseError("Unexpected response shape from /System/Info/Public");
  }
  return {
    serverName: raw.ServerName,
    productName: raw.ProductName,
    version: raw.Version,
    id: raw.Id,
  };
}

function joinPath(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

interface RawSystemInfo {
  ServerName: string;
  ProductName: string;
  Version: string;
  Id: string;
}

function isRawSystemInfo(value: unknown): value is RawSystemInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["ServerName"] === "string" &&
    typeof v["ProductName"] === "string" &&
    typeof v["Version"] === "string" &&
    typeof v["Id"] === "string"
  );
}
