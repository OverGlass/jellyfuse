import { onlineManager, QueryClient } from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";

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

// Wire TanStack's onlineManager to expo-network. When the OS reports
// offline, queries with `networkMode: "online"` (the default) pause
// instead of firing and flipping to an error state. That means
// navigating to a persisted detail screen while offline renders the
// cached shape without a "couldn't load" flash — the background
// revalidation simply waits until connectivity returns.
onlineManager.setEventListener((setOnline) => {
  getNetworkStateAsync()
    .then((s) => setOnline(s.isConnected !== false))
    .catch(() => setOnline(true));
  const sub = addNetworkStateListener(({ isConnected }) => {
    setOnline(isConnected !== false);
  });
  return () => sub.remove();
});
