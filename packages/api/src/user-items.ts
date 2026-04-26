// Jellyfin per-user item state — today, just the played-state toggle.
// `POST /Users/{userId}/PlayedItems/{itemId}` marks an item watched;
// `DELETE` clears it. The server returns a 204 with no body, so the
// wrappers resolve to `void` on success and throw `UserItemHttpError`
// on a non-2xx. Mirrors the wide-fetcher pattern from `user-config.ts`.

import type { FetchLike } from "./system-info";

export interface MarkItemPlayedArgs {
  baseUrl: string;
  userId: string;
  itemId: string;
}

export class UserItemHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Jellyfin played-items call returned HTTP ${status}`);
    this.name = "UserItemHttpError";
    this.status = status;
  }
}

/**
 * `POST /Users/{userId}/PlayedItems/{itemId}` — marks the item as
 * played for the active user. Sets `UserData.Played = true`,
 * `PlayCount = max(1, current)`, and `LastPlayedDate = now`. The server
 * keeps `PlaybackPositionTicks` intact so resume points survive (the
 * item simply stops appearing in Continue Watching after the next
 * shelf refetch).
 */
export async function markItemPlayed(
  args: MarkItemPlayedArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<void> {
  await sendPlayedItemsRequest(args, "POST", fetcher, signal);
}

/**
 * `DELETE /Users/{userId}/PlayedItems/{itemId}` — clears the played
 * flag. Resets `UserData.Played = false`, `PlayCount = 0`,
 * `PlaybackPositionTicks = 0`, and `PlayedPercentage = 0`.
 */
export async function unmarkItemPlayed(
  args: MarkItemPlayedArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<void> {
  await sendPlayedItemsRequest(args, "DELETE", fetcher, signal);
}

async function sendPlayedItemsRequest(
  args: MarkItemPlayedArgs,
  method: "POST" | "DELETE",
  fetcher: FetchLike,
  signal: AbortSignal | undefined,
): Promise<void> {
  const url = `${trimTrailingSlash(args.baseUrl)}/Users/${encodeURIComponent(
    args.userId,
  )}/PlayedItems/${encodeURIComponent(args.itemId)}`;

  // Widen the fetcher locally — `FetchLike` is signal-only at the type
  // level, but Nitro Fetch and `globalThis.fetch` both accept the full
  // init at runtime. Same pattern as `user-config.ts::updateUserConfiguration`.
  const wideFetcher = fetcher as (
    input: string,
    init: { method: string; signal?: AbortSignal },
  ) => Promise<{ ok: boolean; status: number }>;

  const response = await wideFetcher(url, { method, ...(signal ? { signal } : {}) });
  if (!response.ok) {
    throw new UserItemHttpError(response.status);
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
