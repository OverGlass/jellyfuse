import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient. Defaults match the "hydrate-as-stale" rule from
 * CLAUDE.md: persisted entries come back marked stale on boot so the
 * UI renders immediately from cache while a background revalidation
 * kicks off. Per-query `staleTime` overrides from `@jellyfuse/query-keys`
 * take precedence on the hooks that set them.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Revalidate on focus / reconnect / mount, but always serve cache first.
      staleTime: 0,
      gcTime: 24 * 60 * 60 * 1000, // keep in memory for a day
      retry: 2,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
