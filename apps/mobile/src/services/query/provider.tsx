import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { queryClient } from "./client";
import { PERSIST_MAX_AGE_MS, queryPersister } from "./persister";

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app in a React Query provider with MMKV-backed persistence.
 * Per CLAUDE.md's "hydrate-as-stale" rule, every persisted entry comes back
 * with `dataUpdatedAt = 0`, so hooks see `isStale === true` on first render
 * and kick off a background revalidation automatically.
 */
export function QueryProvider({ children }: Props) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: PERSIST_MAX_AGE_MS,
        // `buster` is a hard version key — bump this string to invalidate
        // every persisted entry on next boot (e.g. after a schema change).
        buster: "0",
        dehydrateOptions: {
          // Only persist successful queries; failures re-run next boot.
          shouldDehydrateQuery: (query) => query.state.status === "success",
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
