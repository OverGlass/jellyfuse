import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { queryClient } from "./client";
import { PERSIST_MAX_AGE_MS, queryPersister } from "./persister";
import { PERSISTED_SCHEMA_VERSION } from "./schema";
import { shouldDehydrateQuery } from "./should-dehydrate";

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app in a React Query provider with MMKV-backed persistence.
 *
 * Two rules enforced here:
 *
 * 1. **Hydrate-as-stale** — on boot, every rehydrated query gets its
 *    `dataUpdatedAt` set to 0 so hooks see `isStale === true` on first
 *    render and fire a silent background revalidation. This mirrors
 *    the Rust `QueryCache::hydrate()` behaviour: UI renders the cached
 *    shape immediately, then revalidates without a spinner flash.
 *
 * 2. **Narrow dehydrate** — only home / detail / shelf / system-info /
 *    quality-profiles keys are persisted (see `shouldDehydrateQuery`).
 *    Auth, playback-info, download progress, local-downloads, and
 *    search are explicitly excluded. `search` is ephemeral; the rest
 *    live in secure-storage / Nitro modules / the live server and
 *    would be wrong to rehydrate from an old MMKV snapshot.
 *
 * `buster` bumps on any schema change (via `PERSISTED_SCHEMA_VERSION`)
 * so old entries are dropped on next boot instead of deserialising into
 * an incompatible shape.
 */
export function QueryProvider({ children }: Props) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: PERSISTED_SCHEMA_VERSION,
        dehydrateOptions: {
          shouldDehydrateQuery,
        },
      }}
      onSuccess={() => {
        // Mark every rehydrated query as stale so it revalidates on mount.
        queryClient
          .getQueryCache()
          .getAll()
          .forEach((query) => {
            query.setState({
              ...query.state,
              dataUpdatedAt: 0,
              isInvalidated: true,
            });
          });
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
