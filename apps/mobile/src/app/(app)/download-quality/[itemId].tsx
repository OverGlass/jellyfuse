/**
 * `(app)/download-quality/[itemId]` — native formSheet that asks the
 * user which bitrate to download, then runs the enqueue pipeline.
 *
 * The parent `(app)/_layout.tsx` presents this route as `formSheet`,
 * so it renders as a native bottom sheet on iPhone, centered card on
 * iPad, modal window on Mac Catalyst, and standard modal on Android.
 *
 * The `MediaItem` to download is stashed in the RQ cache at
 * `queryKeys.pendingDownload(itemId)` by `useItemDownload` before
 * navigation. We read it here instead of re-fetching the detail query
 * — the item already has series/episode metadata that we want to
 * carry into the download manifest.
 */
import { buildAuthHeader, fetchPlaybackInfo, type AuthContext } from "@jellyfuse/api";
import type { MediaItem } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { colors } from "@jellyfuse/theme";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, View } from "react-native";
import { apiFetchAuthenticated } from "@/services/api/client";
import { buildAuthContextForUser } from "@/services/auth/auth-context-builder";
import { useAuth } from "@/services/auth/state";
import { useDownloader } from "@/services/downloads/context";
import { buildDownloadOptions } from "@/services/downloads/enqueue";
import { downloadSidecars } from "@/services/downloads/sidecar-download";
import { useDownloaderActions } from "@/services/downloads/use-local-downloads";
import { resolvePlayback } from "@/services/playback/resolver";
import { useResolverSettings } from "@/services/settings/use-resolver-settings";
import {
  type DownloadQuality,
  QualityPicker,
} from "@/features/downloads/components/quality-picker";

export default function DownloadQualityRoute() {
  const { t } = useTranslation();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const queryClient = useQueryClient();
  const { serverUrl, activeUser } = useAuth();
  const actions = useDownloaderActions();
  const downloader = useDownloader();
  const resolverSettings = useResolverSettings();

  const pendingItem = queryClient.getQueryData<MediaItem>(queryKeys.pendingDownload(itemId ?? ""));
  const durationSeconds = (pendingItem?.runtimeMinutes ?? 0) * 60;

  const handleSelect = useCallback(
    async (quality: DownloadQuality) => {
      if (!itemId || !serverUrl || !activeUser) {
        router.dismiss();
        return;
      }
      const item = queryClient.getQueryData<MediaItem>(queryKeys.pendingDownload(itemId));
      // Dismiss optimistically — the enqueue pipeline runs in the
      // background and any error surfaces as an Alert on the parent
      // screen, not stuck behind a half-closed sheet.
      queryClient.removeQueries({ queryKey: queryKeys.pendingDownload(itemId) });
      router.dismiss();
      if (!item) return;

      try {
        const authCtx = await queryClient.fetchQuery<AuthContext>({
          queryKey: ["auth", "context", activeUser.userId] as const,
          queryFn: () => buildAuthContextForUser(activeUser),
        });
        const playbackInfo = await fetchPlaybackInfo(
          {
            baseUrl: serverUrl,
            userId: activeUser.userId,
            token: activeUser.token,
            itemId,
          },
          apiFetchAuthenticated,
        );
        const resolved = resolvePlayback({
          playbackInfo,
          settings: resolverSettings,
        });
        const authHeader = buildAuthHeader(authCtx);
        const options = buildDownloadOptions(
          item,
          resolved,
          authHeader,
          queryClient,
          { baseUrl: serverUrl, token: activeUser.token },
          { maxBitrate: quality.maxBitrate },
        );
        const id = actions.enqueue(options);
        // Strip the trailing `/media` segment — sidecars live next to
        // the media file under the same `downloads/<id>-<msid>/` parent.
        const folderRelative = options.destRelativePath.replace(/\/media$/, "");
        void downloadSidecars({
          id,
          jellyfinId: itemId,
          folderRelative,
          resolved,
          authHeader,
          queryClient,
          downloader,
        });
      } catch (e) {
        Alert.alert(
          t("downloads.enqueue.error.title"),
          e instanceof Error ? e.message : t("downloads.enqueue.error.unknown"),
        );
      }
    },
    [itemId, serverUrl, activeUser, queryClient, actions, downloader, resolverSettings, t],
  );

  return (
    <View style={styles.root}>
      <QualityPicker onSelect={handleSelect} durationSeconds={durationSeconds} />
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` — the parent Stack presents this as a `fitToContents`
  // formSheet. Claiming flex:1 here makes the sheet stretch to the full
  // available detent (leaving a gap under the list); letting the root
  // hug its content lets the sheet size to the picker's actual height.
  root: {
    backgroundColor: colors.surface,
  },
});
