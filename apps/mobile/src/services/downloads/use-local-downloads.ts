/**
 * `useLocalDownloads` — syncs the Downloader Nitro module state into
 * React Query so components can subscribe to download list changes.
 *
 * Design:
 * - NOT a standard `useQuery` — the downloader Nitro module is the
 *   source of truth, not a network endpoint.
 * - Uses `useSyncExternalStore` to subscribe to Nitro `onProgress` and
 *   `onStateChange` events. Each event triggers a `queryClient.setQueryData`
 *   so any `useQuery(localDownloads())` subscriber re-renders.
 * - Returns the current snapshot from the RQ cache (which starts as the
 *   result of `downloader.list()` called at mount).
 *
 * Mirrors the plan's ARK-26 note:
 *   "NOT a normal RQ query; uses useSyncExternalStore listening to Nitro
 *   onProgress + onStateChange events, calls queryClient.setQueryData
 *   on each event"
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NativeDownloadRecord } from "@jellyfuse/downloader";
import type { DownloadRecord } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { useAuth } from "@/services/auth/state";
import { useDownloader } from "./context";

/** Cast from Nitro's `NativeDownloadRecord` to the canonical `DownloadRecord`. */
function toRecord(native: NativeDownloadRecord): DownloadRecord {
  return native as unknown as DownloadRecord;
}

/**
 * Initialises download state from disk on mount and keeps it in sync
 * with Nitro events. Call once in a high-level component (e.g. the app
 * `_layout.tsx`) — the data is shared via React Query so all consumers
 * just call `useQuery(queryKeys.localDownloads(userId))`.
 */
export function useLocalDownloadsSync() {
  const downloader = useDownloader();
  const queryClient = useQueryClient();
  const { activeUser } = useAuth();
  const userId = activeUser?.userId ?? "";

  useEffect(() => {
    if (!userId) return;

    const key = queryKeys.localDownloads(userId);

    // Hydrate from disk on mount
    const initial = downloader.list().map(toRecord);
    queryClient.setQueryData(key, initial);

    // Subscribe to progress events — update the matching record in cache
    const progressSub = downloader.addProgressListener((id, downloaded, total) => {
      queryClient.setQueryData(key, (old: DownloadRecord[] | undefined) => {
        if (!old) return old;
        return old.map((r) =>
          r.id === id ? { ...r, bytesDownloaded: downloaded, bytesTotal: total } : r,
        );
      });
    });

    // Subscribe to state change events — update state, or add/remove record
    const stateSub = downloader.addStateChangeListener((id, state) => {
      queryClient.setQueryData(key, (old: DownloadRecord[] | undefined) => {
        if (!old) return old;
        const idx = old.findIndex((r) => r.id === id);
        if (idx === -1) {
          // New record not yet in cache — refetch from disk to pick it up
          const fresh = downloader.list().map(toRecord);
          return fresh;
        }
        return old.map((r) => (r.id === id ? { ...r, state } : r));
      });
    });

    return () => {
      progressSub.remove();
      stateSub.remove();
    };
  }, [downloader, queryClient, userId]);
}

/**
 * Returns all local download records for the active user, sorted newest-first.
 * Sourced from the React Query cache that `useLocalDownloadsSync` maintains.
 */
export function useLocalDownloads(): DownloadRecord[] {
  const { data } = useLocalDownloadsQuery();
  return data ?? [];
}

/**
 * Returns the raw React Query result for `localDownloads`. Use when you
 * need `isLoading` or `isFetching` flags in addition to the data.
 */
export function useLocalDownloadsQuery() {
  const { activeUser } = useAuth();
  const userId = activeUser?.userId ?? "";
  const queryClient = useQueryClient();
  const key = queryKeys.localDownloads(userId);
  const data = queryClient.getQueryData<DownloadRecord[]>(key);
  return { data: data ?? [] };
}

/**
 * Returns the download record for a specific (itemId, mediaSourceId)
 * pair, or `undefined` if not downloaded.
 */
export function useDownloadRecord(
  itemId: string,
  mediaSourceId: string,
): DownloadRecord | undefined {
  const records = useLocalDownloads();
  return records.find((r) => r.itemId === itemId && r.mediaSourceId === mediaSourceId);
}
