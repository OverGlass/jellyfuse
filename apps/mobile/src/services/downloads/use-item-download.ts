/**
 * `useItemDownload` — shared download dispatch for any `MediaItem`
 * (movie or episode). Factored out so the movie detail action row
 * and each episode row in the series detail screen run identical
 * logic.
 *
 * Returned `handleDownloadPress(item, record)`:
 *   done        → play the item locally (`/player/:id`)
 *   downloading → pause
 *   paused      → resume
 *   queued      → no-op
 *   failed      → remove the stale record, then fall through to enqueue
 *   undefined   → fetch PlaybackInfo, resolve, enqueue a fresh download
 *
 * The enqueue branch fetches a per-user `AuthContext` through React
 * Query (cached), fetches `/Items/{id}/PlaybackInfo`, resolves a
 * stream, and calls `buildDownloadOptions` — identical to the Rust
 * `handle_download` pipeline.
 */
import { buildAuthHeader, fetchPlaybackInfo, type AuthContext } from "@jellyfuse/api";
import type { MediaItem, DownloadRecord } from "@jellyfuse/models";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/services/auth/state";
import { apiFetchAuthenticated } from "@/services/api/client";
import { resolvePlayback } from "@/services/playback/resolver";
import { buildDownloadOptions } from "./enqueue";
import { useDownloaderActions } from "./use-local-downloads";

export function useItemDownload() {
  const actions = useDownloaderActions();
  const queryClient = useQueryClient();
  const { serverUrl, activeUser } = useAuth();

  return useCallback(
    async (item: MediaItem, record: DownloadRecord | undefined) => {
      const jellyfinId =
        item.id.kind === "jellyfin" || item.id.kind === "both" ? item.id.jellyfinId : undefined;
      if (!jellyfinId) return;

      if (record?.state === "done") {
        router.push(`/player/${jellyfinId}`);
        return;
      }
      if (record?.state === "downloading") {
        actions.pause(record.id);
        return;
      }
      if (record?.state === "paused") {
        actions.resume(record.id);
        return;
      }
      if (record?.state === "queued") {
        return;
      }
      if (record?.state === "failed") {
        actions.remove(record.id);
      }
      if (!serverUrl || !activeUser) return;

      try {
        const authCtx = await queryClient.fetchQuery<AuthContext>({
          queryKey: ["auth", "context", activeUser.userId] as const,
          queryFn: async () => {
            const { buildAuthContextForUser } =
              await import("@/services/auth/auth-context-builder");
            return buildAuthContextForUser(activeUser);
          },
        });
        const playbackInfo = await fetchPlaybackInfo(
          {
            baseUrl: serverUrl,
            userId: activeUser.userId,
            token: activeUser.token,
            itemId: jellyfinId,
          },
          apiFetchAuthenticated,
        );
        const resolved = resolvePlayback({
          playbackInfo,
          settings: { preferredAudioLanguage: "eng", subtitleMode: "OnlyForced" },
        });
        const options = buildDownloadOptions(
          item,
          resolved,
          buildAuthHeader(authCtx),
          queryClient,
          { baseUrl: serverUrl, token: activeUser.token },
        );
        actions.enqueue(options);
      } catch (e) {
        Alert.alert("Download failed", e instanceof Error ? e.message : "Unknown error");
      }
    },
    [actions, queryClient, serverUrl, activeUser],
  );
}
