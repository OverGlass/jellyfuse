/**
 * Phase 6 Settings screen.
 *
 * Splits preferences into two persistence tiers:
 *
 * 1. **Server-persisted** — every field that Jellyfin's
 *    `UserConfiguration` schema carries (audio/subtitle language,
 *    subtitle mode, remember selections, auto-play next episode, …).
 *    Edits run through `useUpdateUserConfiguration` which fires an
 *    optimistic mutation: the cache flips immediately, a `POST
 *    /Users/Configuration?userId={guid}` replays in the background,
 *    and `onError` rolls back to the previous snapshot. Changes
 *    follow the user to every other Jellyfin client.
 *
 * 2. **Local-only** — the streaming bitrate cap (`maxStreamingBitrateMbps`).
 *    Jellyfin's schema has no field for a per-network cap, so this
 *    lives in MMKV keyed per-user. Changes invalidate every cached
 *    `PlaybackInfo` so the next resolve picks against the new ceiling.
 *
 * The screen is a pure composition of `SettingsSection` + `SettingsRow`;
 * each picker opens a bottom-sheet `SettingsPickerModal`. No screen-
 * local async work — every read goes through React Query / MMKV
 * subscriptions (see memory: `feedback_no_async_useeffect`).
 */
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedScrollHandler } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useQueryClient } from "@tanstack/react-query";
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  profileColorFor,
  radius,
  spacing,
} from "@jellyfuse/theme";
import { Image } from "expo-image";
import { router } from "expo-router";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { PILL_TAB_CLEARANCE } from "@/features/common/components/pill-tab-bar";
import { useAuth } from "@/services/auth/state";
import {
  useUpdateUserConfiguration,
  useUserConfigurationOrDefault,
} from "@/services/query/hooks/use-user-configuration";
import { useLocalSettings, useUpdateLocalSettings } from "@/services/settings/use-local-settings";
import { useScreenGutters } from "@/services/responsive";
import { JellyseerrReconnectModal } from "../components/jellyseerr-reconnect-modal";
import { SettingsPickerModal } from "../components/settings-picker-modal";
import { SettingsRow } from "../components/settings-row";
import { SettingsSection } from "../components/settings-section";
import { LANGUAGE_OPTIONS, labelForLanguageCode } from "../data/language-options";
import { SUBTITLE_MODE_OPTIONS, labelForSubtitleMode } from "../data/subtitle-mode-options";
import { STREAMING_BITRATE_OPTIONS, labelForBitrate } from "../data/bitrate-options";

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

type PickerKind =
  | "audioLang"
  | "subtitleLang"
  | "subtitleMode"
  | "bitrate"
  | "jellyseerrReconnect"
  | null;

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const gutters = useScreenGutters();
  const queryClient = useQueryClient();
  const {
    activeUser,
    serverUrl,
    serverVersion,
    jellyseerrUrl,
    jellyseerrStatus,
    jellyseerrLastError,
    signOutAll,
    reconnectJellyseerr,
  } = useAuth();
  const { config } = useUserConfigurationOrDefault();
  const updateConfig = useUpdateUserConfiguration();
  const local = useLocalSettings();
  const updateLocal = useUpdateLocalSettings();
  const [picker, setPicker] = useState<PickerKind>(null);

  const { headerHeight, onHeaderHeightChange, scrollY, backdropStyle } = useFloatingHeaderScroll();
  const scrollRestore = useRestoredScroll("/settings");
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  const pillBottom = insets.bottom > 0 ? insets.bottom - 8 : 8;
  const listPaddingBottom = pillBottom + PILL_TAB_CLEARANCE + spacing.xl;

  function patchConfig<K extends keyof typeof config>(key: K, value: (typeof config)[K]): void {
    updateConfig.mutate({ patch: { [key]: value } });
  }

  function handleSelectBitrate(mbps: number): void {
    // `0` is the Auto sentinel — store as `undefined` so the DeviceProfile
    // falls back to Jellyfin's default.
    const next = mbps === 0 ? undefined : mbps;
    updateLocal({ maxStreamingBitrateMbps: next });
    // Every cached PlaybackInfo was resolved against the previous cap —
    // drop them so the next resolve runs against the new ceiling.
    queryClient.invalidateQueries({ queryKey: ["playback"] });
    setPicker(null);
  }

  function handleSignOut(): void {
    Alert.alert("Sign out of all profiles?", "This clears every user on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          // Run the mutation first — its onSuccess flips
          // PERSISTED_AUTH_KEY to the signed-out shape, which triggers
          // every useAuth observer (incl. the (app) layout guard) to
          // redirect through the root. Firing router.replace("/")
          // before the mutation would mount IndexRoute while still
          // authenticated, bouncing back to (app) before the state
          // flipped.
          void signOutAll();
        },
      },
    ]);
  }

  function handleChangeServer(): void {
    Alert.alert(
      "Change server?",
      "You'll be signed out of every profile on this device and redirected to pick a new server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Change server",
          style: "destructive",
          onPress: () => {
            // (auth) has no auth-based redirect, so we can navigate
            // straight to the server screen and fire sign-out in the
            // background. It runs while the server screen is mounted,
            // which is fine — it doesn't read per-user data.
            router.replace("/(auth)/server");
            void signOutAll();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <AnimatedScrollView
        ref={scrollRestore.ref}
        onContentSizeChange={scrollRestore.onContentSizeChange}
        contentContainerStyle={{
          paddingTop: headerHeight + spacing.md,
          paddingBottom: listPaddingBottom,
          paddingHorizontal: gutters.left,
          gap: spacing.lg,
        }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Account header card — who's signed in + server identity. */}
        {activeUser ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch profile"
            onPress={() => router.push("/profile-picker")}
            style={({ pressed }) => [styles.accountCard, pressed && { opacity: opacity.pressed }]}
          >
            {activeUser.avatarUrl ? (
              <Image
                source={activeUser.avatarUrl}
                style={styles.accountAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={activeUser.avatarUrl}
              />
            ) : (
              <View
                style={[
                  styles.accountAvatar,
                  styles.accountAvatarFallback,
                  { backgroundColor: profileColorFor(activeUser.userId) },
                ]}
              >
                <Text style={styles.accountAvatarLetter}>
                  {activeUser.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.accountCol}>
              <Text style={styles.accountName} numberOfLines={1}>
                {activeUser.displayName}
              </Text>
              <Text style={styles.accountServer} numberOfLines={1}>
                {serverUrl ?? "—"}
                {serverVersion ? ` · v${serverVersion}` : ""}
              </Text>
            </View>
            <Text style={styles.accountSwitch}>Switch</Text>
          </Pressable>
        ) : null}

        <SettingsSection
          title="Playback"
          footer="Preferences are saved to your Jellyfin account and applied across every device signed in."
        >
          <SettingsRow
            label="Audio language"
            value={labelForLanguageCode(config.audioLanguagePreference)}
            onPress={() => setPicker("audioLang")}
            hasDivider={false}
          />
          <SettingsRow
            label="Subtitle language"
            value={labelForLanguageCode(config.subtitleLanguagePreference)}
            onPress={() => setPicker("subtitleLang")}
          />
          <SettingsRow
            label="Subtitle mode"
            value={labelForSubtitleMode(config.subtitleMode)}
            onPress={() => setPicker("subtitleMode")}
          />
          <SettingsRow
            label="Play default audio track"
            sublabel="Use the track marked default regardless of language preference"
            trailing={
              <Switch
                value={config.playDefaultAudioTrack}
                onValueChange={(v) => patchConfig("playDefaultAudioTrack", v)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            }
          />
          <SettingsRow
            label="Remember audio selections"
            sublabel="Keep the audio track you pick across sessions"
            trailing={
              <Switch
                value={config.rememberAudioSelections}
                onValueChange={(v) => patchConfig("rememberAudioSelections", v)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            }
          />
          <SettingsRow
            label="Remember subtitle selections"
            sublabel="Keep the subtitle track you pick across sessions"
            trailing={
              <Switch
                value={config.rememberSubtitleSelections}
                onValueChange={(v) => patchConfig("rememberSubtitleSelections", v)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            }
          />
          <SettingsRow
            label="Auto-play next episode"
            trailing={
              <Switch
                value={config.enableNextEpisodeAutoPlay}
                onValueChange={(v) => patchConfig("enableNextEpisodeAutoPlay", v)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="Streaming"
          footer="Only applied on this device. The cap lets the server transcode down when your network is constrained."
        >
          <SettingsRow
            label="Max streaming bitrate"
            value={labelForBitrate(local.maxStreamingBitrateMbps)}
            onPress={() => setPicker("bitrate")}
            hasDivider={false}
          />
        </SettingsSection>

        <SettingsSection
          title="Advanced"
          footer="Routes video through VideoToolbox directly instead of mpv's readback path. Unlocks 10-bit HDR and Dolby Vision tagging. Experimental — disable if playback glitches."
        >
          <SettingsRow
            label="Native video pipeline"
            sublabel="HDR / Dolby Vision"
            trailing={
              <Switch
                value={local.nativeVideoPipelineEnabled ?? false}
                onValueChange={(v) =>
                  updateLocal({ nativeVideoPipelineEnabled: v ? true : undefined })
                }
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            }
            hasDivider={false}
          />
        </SettingsSection>

        {jellyseerrUrl ? (
          <SettingsSection
            title="Requests"
            footer={
              jellyseerrStatus === "disconnected"
                ? (jellyseerrLastError ??
                  "Your Jellyseerr session expired. Reconnect with your Jellyfin password.")
                : undefined
            }
          >
            <SettingsRow
              label="Jellyseerr"
              sublabel={jellyseerrUrl}
              value={jellyseerrStatus === "connected" ? "Connected" : "Disconnected"}
              showChevron={jellyseerrStatus === "disconnected"}
              onPress={
                jellyseerrStatus === "disconnected"
                  ? () => setPicker("jellyseerrReconnect")
                  : undefined
              }
              hasDivider={false}
            />
          </SettingsSection>
        ) : null}

        <SettingsSection title="Account">
          <SettingsRow
            label="Switch profile"
            onPress={() => router.push("/profile-picker")}
            hasDivider={false}
          />
          <SettingsRow label="Change server" onPress={handleChangeServer} />
          <SettingsRow label="Sign out of all profiles" destructive onPress={handleSignOut} />
        </SettingsSection>
      </AnimatedScrollView>

      <ScreenHeader
        title="Settings"
        backdropStyle={backdropStyle}
        onTotalHeightChange={onHeaderHeightChange}
      />
      <StatusBarScrim />

      <SettingsPickerModal
        visible={picker === "audioLang"}
        title="Audio language"
        options={LANGUAGE_OPTIONS}
        selectedValue={config.audioLanguagePreference ?? ""}
        onSelect={(code) => {
          patchConfig("audioLanguagePreference", code === "" ? null : code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <SettingsPickerModal
        visible={picker === "subtitleLang"}
        title="Subtitle language"
        options={LANGUAGE_OPTIONS}
        selectedValue={config.subtitleLanguagePreference ?? ""}
        onSelect={(code) => {
          patchConfig("subtitleLanguagePreference", code === "" ? null : code);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <SettingsPickerModal
        visible={picker === "subtitleMode"}
        title="Subtitle mode"
        options={SUBTITLE_MODE_OPTIONS}
        selectedValue={config.subtitleMode}
        onSelect={(mode) => {
          patchConfig("subtitleMode", mode);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <SettingsPickerModal
        visible={picker === "bitrate"}
        title="Max streaming bitrate"
        options={STREAMING_BITRATE_OPTIONS}
        selectedValue={local.maxStreamingBitrateMbps ?? 0}
        onSelect={handleSelectBitrate}
        onClose={() => setPicker(null)}
      />
      {jellyseerrUrl && activeUser ? (
        <JellyseerrReconnectModal
          visible={picker === "jellyseerrReconnect"}
          username={activeUser.displayName}
          baseUrl={jellyseerrUrl}
          initialError={jellyseerrLastError}
          onSubmit={(password) => reconnectJellyseerr({ password })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </View>
  );
}

const ACCOUNT_AVATAR = 56;

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  accountCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  accountAvatar: {
    borderRadius: ACCOUNT_AVATAR / 2,
    height: ACCOUNT_AVATAR,
    width: ACCOUNT_AVATAR,
  },
  accountAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  accountAvatarLetter: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: fontWeight.bold,
  },
  accountCol: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  accountServer: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  accountSwitch: {
    color: colors.accent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
