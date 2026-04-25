import type { MediaItem } from "@jellyfuse/api";
import { colors, fontSize, fontWeight, layout, opacity, radius, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BackButton } from "@/features/common/components/back-button";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { DetailMetaRow } from "@/features/detail/components/detail-meta-row";
import { useTmdbDetail } from "@/services/query";
import { useScreenGutters } from "@/services/responsive";

/**
 * Detail screen for Jellyseerr-only items not yet in the Jellyfin
 * library (TMDB-sourced). Reached from the requests list and from
 * Jellyseerr search results.
 *
 * Mirrors `MovieDetailScreen` / `SeriesDetailScreen` in layout — same
 * `<DetailHero>` + `<DetailMetaRow>` + overview + action row — but the
 * action is "Request" (or a status badge if already requested/available)
 * rather than "Play".
 *
 * When the user taps "Request" we push the formSheet at
 * `/request/[tmdbId]?mediaType=…&title=…` — same flow as the search
 * screen, so the request modal is reused without duplication.
 */
interface Props {
  tmdbId: number;
  mediaType: "movie" | "tv";
}

export function TmdbDetailScreen({ tmdbId, mediaType }: Props) {
  const { t } = useTranslation();
  const query = useTmdbDetail(tmdbId, mediaType);
  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const scrollRestore = useRestoredScroll(`/detail/tmdb/${tmdbId}`);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  if (query.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
        <BackButton />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>{t("detail.error.tmdbTitle")}</Text>
          <Text style={styles.errorBody}>
            {query.error instanceof Error ? query.error.message : t("detail.error.unknown")}
          </Text>
        </View>
        <BackButton />
      </SafeAreaView>
    );
  }

  const item = query.data;

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <Animated.ScrollView
        ref={scrollRestore.ref}
        onContentSizeChange={scrollRestore.onContentSizeChange}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + layout.screenPaddingBottom },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <DetailHero item={item} scrollY={scrollY} />
        <View style={[styles.body, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <DetailMetaRow item={item} />
          <TmdbActionRow item={item} tmdbId={tmdbId} mediaType={mediaType} />
          {item.overview ? <Text style={styles.overview}>{item.overview}</Text> : null}
        </View>
      </Animated.ScrollView>
      <StatusBarScrim />
      <BackButton />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Action row — Request button or status badge depending on availability
// ──────────────────────────────────────────────────────────────────────

interface ActionRowProps {
  item: MediaItem;
  tmdbId: number;
  mediaType: "movie" | "tv";
}

function TmdbActionRow({ item, tmdbId, mediaType }: ActionRowProps) {
  const { t } = useTranslation();
  const availability = item.availability;

  if (availability.kind === "available") {
    return (
      <View style={styles.actionRow}>
        <View style={[styles.badge, styles.badgeAvailable]}>
          <Text style={styles.badgeLabel}>{t("detail.tmdb.availableInLibrary")}</Text>
        </View>
      </View>
    );
  }

  if (availability.kind === "requested") {
    const statusLabel =
      availability.status === "pending"
        ? t("detail.tmdb.status.pending")
        : availability.status === "approved"
          ? t("detail.tmdb.status.approved")
          : t("detail.tmdb.status.declined");
    return (
      <View style={styles.actionRow}>
        <View style={[styles.badge, styles.badgeRequested]}>
          <Text style={styles.badgeLabel}>{statusLabel}</Text>
        </View>
      </View>
    );
  }

  // missing — show the Request CTA
  return (
    <View style={styles.actionRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("detail.action.request")}
        onPress={() =>
          router.push({
            pathname: "/request/[tmdbId]",
            params: { tmdbId: String(tmdbId), mediaType, title: item.title },
          })
        }
        style={({ pressed }) => [styles.requestButton, pressed && styles.requestButtonPressed]}
      >
        <Text style={styles.requestButtonLabel}>{t("detail.action.request")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {},
  body: {
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  overview: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  badge: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  badgeAvailable: {
    backgroundColor: colors.surface,
  },
  badgeRequested: {
    backgroundColor: colors.surface,
  },
  badgeLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  requestButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  requestButtonPressed: {
    opacity: opacity.pressed,
  },
  requestButtonLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
});
