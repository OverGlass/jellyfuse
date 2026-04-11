import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PERSISTED_SCHEMA_VERSION } from "./schema";
import { mmkvAsyncStorage } from "./storage";

/**
 * React Query persister backed by MMKV. Persisted queries are written on
 * every successful update and rehydrated on boot into the QueryClient.
 *
 * `maxAge` (from ./schema) caps how stale a persisted entry can be before
 * it's discarded on hydrate, independent of per-query `staleTime`. The
 * persist `key` is suffixed with `PERSISTED_SCHEMA_VERSION` so bumping
 * the schema version gives us a fresh MMKV entry instead of trying to
 * decode the old shape — cheaper than writing migration shims while the
 * model layer is still churning.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: `jellyfuse-rq-v${PERSISTED_SCHEMA_VERSION}`,
  throttleTime: 1000,
});

export { PERSIST_MAX_AGE_MS } from "./schema";
