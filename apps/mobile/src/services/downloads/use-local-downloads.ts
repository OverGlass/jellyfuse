/**
 * `useLocalDownloads` — syncs the Downloader Nitro module state into
 * React Query so components can subscribe to download list changes.
 *
 * Design:
 * - The downloader Nitro module is the on-disk source of truth. React
 *   Query is just the shared in-memory fanout so every component that
 *   reads downloads re-renders on change.
 * - `useLocalDownloadsSync()` mounts once at the app root. It hydrates
 *   the RQ cache from `downloader.list()` and subscribes to Nitro's
 *   `onProgress` + `onStateChange` events, each of which calls
 *   `queryClient.setQueryData` to fan the change out to subscribers.
 * - `useLocalDownloads()` is a proper `useQuery` so components actually
 *   re-render when `setQueryData` runs. An earlier version used
 *   `getQueryData` which is a one-shot read (no subscription), so
 *   progress bars and state changes never reached the screen.
 * - Actions that remove records (`cancel`, `remove`, `clearAll`) don't
 *   currently round-trip through a native event, so `useDownloaderActions`
 *   wraps them to update the RQ cache optimistically as well.
 */
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DownloadOptions, NativeDownloadRecord } from "@jellyfuse/downloader";
import type { DownloadRecord } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { useAuth } from "@/services/auth/state";
import { useDownloader } from "./context";

/** Cast from Nitro's `NativeDownloadRecord` to the canonical `DownloadRecord`. */
function toRecord(native: NativeDownloadRecord): DownloadRecord {
  return native as unknown as DownloadRecord;
}

/**
 * Mounts the Nitro-event → React Query bridge. Call once at the app
 * root (inside a `<DownloaderProvider>` subtree). Safe to remount on
 * user switch — the effect re-subscribes with the new `userId` key.
 */
export function useLocalDownloadsSync() {
  const downloader = useDownloader();
  const queryClient = useQueryClient();
  const { activeUser } = useAuth();
  const userId = activeUser?.userId ?? "";

  useEffect(() => {
    if (!userId) return;

    const key = queryKeys.localDownloads(userId);

    // Hydrate from disk on mount. `downloader.list()` is synchronous —
    // the Swift impl reads all manifests into memory and returns.
    const initial = downloader.list().map(toRecord);
    queryClient.setQueryData(key, initial);

    // Progress events: update bytes on the matching record.
    const progressSub = downloader.addProgressListener((id, downloaded, total) => {
      queryClient.setQueryData<DownloadRecord[]>(key, (old) => {
        if (!old) return old;
        let changed = false;
        const next = old.map((r) => {
          if (r.id !== id) return r;
          changed = true;
          return { ...r, bytesDownloaded: downloaded, bytesTotal: total };
        });
        return changed ? next : old;
      });
    });

    // State change events: update the existing record's state, or add
    // a new one (which shouldn't happen since enqueue() is what mints
    // records — but we re-hydrate from disk as a safety net).
    const stateSub = downloader.addStateChangeListener((id, state) => {
      queryClient.setQueryData<DownloadRecord[]>(key, (old) => {
        if (!old) {
          return downloader.list().map(toRecord);
        }
        const idx = old.findIndex((r) => r.id === id);
        if (idx === -1) {
          return downloader.list().map(toRecord);
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
 * Subscribes the caller to the local-downloads query in the RQ cache.
 * Real `useQuery` — the `queryFn` seeds from `downloader.list()` on
 * first mount and the sync hook keeps it up-to-date via `setQueryData`.
 *
 * The key shape is `queryKeys.localDownloads(userId)` — per-user so a
 * user switch automatically resets the cache.
 */
export function useLocalDownloads(): DownloadRecord[] {
  const downloader = useDownloader();
  const { activeUser } = useAuth();
  const userId = activeUser?.userId ?? "";
  const { data } = useQuery<DownloadRecord[]>({
    queryKey: queryKeys.localDownloads(userId),
    queryFn: () => downloader.list().map(toRecord),
    enabled: userId !== "",
    // The Nitro module owns the data — React Query just stores it.
    // Never mark stale, never auto-refetch; all updates come through
    // `setQueryData` in `useLocalDownloadsSync` or the action wrappers.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return data ?? [];
}

/**
 * Returns the "active" download record for a Jellyfin item — the most
 * relevant record regardless of mediaSourceId. Used by the detail screen
 * to decide what the `DownloadButton` should show.
 *
 * Priority when multiple records exist for the same itemId:
 *   1. `downloading` (in progress)
 *   2. `queued`     (about to download)
 *   3. `paused`     (user paused)
 *   4. `done`       (already downloaded — offline-ready)
 *   5. `failed`     (last known state)
 *
 * Picking by state (not recency) keeps the button sticky on "downloading"
 * even if a stale failed record from an earlier attempt is still around.
 *
 * Matches by `itemId` alone — in practice a Jellyfin item has one active
 * mediaSource at a time for a user, and allowing duplicate downloads of
 * the same item is the bug this function is fixing.
 */
export function useDownloadForItem(itemId: string): DownloadRecord | undefined {
  const records = useLocalDownloads();
  const matching = records.filter((r) => r.itemId === itemId);
  if (matching.length === 0) return undefined;

  const priority: Record<DownloadRecord["state"], number> = {
    downloading: 0,
    queued: 1,
    paused: 2,
    done: 3,
    failed: 4,
  };
  return matching.reduce((best, r) => (priority[r.state] < priority[best.state] ? r : best));
}

/**
 * Action wrappers around `useDownloader()` that also update the RQ
 * cache optimistically. The native Nitro module currently doesn't emit
 * a state-change event for `cancel` / `remove` / `clearAll` — the record
 * directory is removed from disk but JS never hears about it. These
 * wrappers keep the UI in sync by filtering the record out of the cache
 * immediately, on top of calling the native method.
 *
 * Components should prefer these over calling `useDownloader()` directly
 * for any action that mutates the downloads list.
 */
export function useDownloaderActions() {
  const downloader = useDownloader();
  const queryClient = useQueryClient();
  const { activeUser } = useAuth();
  const userId = activeUser?.userId ?? "";
  const key = queryKeys.localDownloads(userId);

  // Re-read the full list from the native module and push it into the
  // RQ cache. Used after any action that creates or removes records,
  // since the native spec doesn't currently emit synthetic events for
  // those transitions.
  const hydrateFromNative = useCallback(() => {
    const fresh = downloader.list().map(toRecord);
    queryClient.setQueryData<DownloadRecord[]>(key, fresh);
  }, [downloader, queryClient, key]);

  const removeLocal = useCallback(
    (id: string) => {
      queryClient.setQueryData<DownloadRecord[]>(key, (old) =>
        old ? old.filter((r) => r.id !== id) : old,
      );
    },
    [queryClient, key],
  );

  const enqueue = useCallback(
    (options: DownloadOptions): string => {
      const id = downloader.enqueue(options);
      // Immediately hydrate from disk — the native enqueue() writes
      // the manifest synchronously before returning, so `list()` now
      // contains the new record. This adds the "downloading" row to
      // the screen instantly instead of waiting for the first progress
      // tick to arrive.
      hydrateFromNative();
      return id;
    },
    [downloader, hydrateFromNative],
  );

  const cancel = useCallback(
    (id: string) => {
      downloader.cancel(id);
      removeLocal(id);
    },
    [downloader, removeLocal],
  );

  const remove = useCallback(
    (id: string) => {
      downloader.remove(id);
      removeLocal(id);
    },
    [downloader, removeLocal],
  );

  const clearAll = useCallback(() => {
    downloader.clearAll();
    queryClient.setQueryData<DownloadRecord[]>(key, []);
  }, [downloader, queryClient, key]);

  const pause = useCallback(
    (id: string) => {
      downloader.pause(id);
    },
    [downloader],
  );

  const resume = useCallback(
    (id: string) => {
      downloader.resume(id);
    },
    [downloader],
  );

  return { enqueue, cancel, remove, clearAll, pause, resume };
}
