import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { mmkvAsyncStorage } from "./storage";

/**
 * React Query persister backed by MMKV. Persisted queries are written on
 * every successful update and rehydrated on boot into the QueryClient.
 *
 * `maxAge` caps how stale a persisted entry can be before it's discarded
 * on hydrate (independent of per-query `staleTime`). One week is plenty
 * for shelves, posters, detail data — enough to boot offline after a
 * week-long break without showing empty state.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: "jellyfuse-rq",
  throttleTime: 1000,
});

/** Upper bound on how old a persisted cache entry is allowed to be. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
