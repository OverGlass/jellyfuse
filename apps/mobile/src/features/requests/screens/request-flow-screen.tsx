import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { type ReactNode, useReducer, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { QualitySelectionStep } from "@/features/requests/components/quality-selection-step";
import { SeasonSelectionStep } from "@/features/requests/components/season-selection-step";
import {
  initRequestFlow,
  pickInitialProfile,
  requestFlowReducer,
} from "@/features/requests/state/request-flow";
import { useAuth } from "@/services/auth/state";
import {
  useCreateRequestMutation,
  useQualityProfiles,
  useTmdbTvSeasons,
} from "@/services/query/hooks/use-request-flow";

/**
 * Screen for the Jellyseerr request flow modal. Mounted at
 * `(app)/request/[tmdbId]` with `presentation: "formSheet"` so the
 * route group renders it as the iOS native sheet — bottom sheet on
 * iPhone, centered card on iPad, modal window on Mac Catalyst,
 * standard modal on Android — without any platform branches.
 *
 * Backed by a `useReducer` over `requestFlowReducer`. The reducer is
 * 100% pure and unit-tested; this screen owns the React Query side
 * (quality profiles + TV season detail) and dispatches user intents.
 *
 * **RNScreens FormSheet layout rule**: the Screen's root may contain
 * at most two direct subviews — an optional header + one ScrollView.
 * To satisfy that we return a React **Fragment** with exactly
 * `[headerView (collapsable={false}), ScrollView (flex: 1)]`. Any
 * wrapping `<View>` at the root collapses both subviews into one
 * container which (a) re-triggers the RNScreens warning and (b)
 * breaks the sheet's internal height bounding, causing the
 * ScrollView to grow past the sheet's visible area and push the
 * header off-screen.
 *
 * Safe-area: we deliberately do NOT apply `useSafeAreaInsets().top`
 * inside the form sheet. On iOS that value reports the phone's
 * notch inset, but the sheet already renders below the notch, so
 * adding it as padding shoves the header off the sheet's top edge.
 * Bottom padding for the scroll content uses a fixed value for the
 * same reason — the sheet renders above the home indicator.
 *
 * Steps wire up by `state.step`:
 * - `seasons`     → `<SeasonSelectionStep>`  (TV with seasons only)
 * - `quality`     → `<QualitySelectionStep>`
 * - `submitting`  → spinner in the footer
 * - `done`        → success toast + auto-dismiss after 1.5 s
 * - `error`       → inline error + Retry
 */
interface Props {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
}

const SUCCESS_DISMISS_MS = 1500;

export function RequestFlowScreen({ tmdbId, mediaType, title }: Props) {
  const { jellyseerrStatus } = useAuth();

  const isTv = mediaType === "tv";
  const seasonsQuery = useTmdbTvSeasons(isTv ? tmdbId : undefined);
  const qualityQuery = useQualityProfiles(isTv ? "sonarr" : "radarr");
  const createRequest = useCreateRequestMutation();

  const seasons = seasonsQuery.data ?? [];
  const hasSeasonStep = isTv && seasons.length > 0;

  const [state, dispatch] = useReducer(
    requestFlowReducer,
    { mediaType, hasSeasonStep },
    initRequestFlow,
  );

  // Auto-pre-select all missing seasons the first time the season list
  // loads. The reducer is intent-driven so we issue a SELECT_ALL_SEASONS
  // action exactly once when the list arrives non-empty and the user
  // hasn't touched the selection yet. React Compiler memoizes the
  // dispatch identity, so this is cheap.
  const [seedDone, setSeedDone] = useState(false);
  if (
    isTv &&
    !seedDone &&
    seasons.length > 0 &&
    state.selectedSeasons.length === 0 &&
    state.step === "seasons"
  ) {
    dispatch({ type: "SELECT_ALL_SEASONS", seasons });
    setSeedDone(true);
  }

  // Pre-select default profile when servers + profiles arrive.
  if (state.selectedProfile === undefined && qualityQuery.data) {
    const initial = pickInitialProfile(qualityQuery.data);
    if (initial) {
      dispatch({
        type: "SELECT_PROFILE",
        serverId: initial.serverId,
        profileId: initial.profileId,
      });
    }
  }

  // Dismiss the modal a beat after a successful submit so the user
  // sees the success label flash.
  if (state.step === "done") {
    setTimeout(() => {
      if (router.canGoBack()) router.back();
    }, SUCCESS_DISMISS_MS);
  }

  function handleSubmit() {
    if (state.step !== "quality") return;
    if (jellyseerrStatus !== "connected") {
      dispatch({ type: "SUBMIT_ERROR", message: "Jellyseerr is not connected." });
      return;
    }
    dispatch({ type: "SUBMIT" });
    const seasonsArg = isTv && state.selectedSeasons.length > 0 ? state.selectedSeasons : undefined;
    createRequest.mutate(
      {
        tmdbId,
        mediaType,
        ...(seasonsArg !== undefined ? { seasons: seasonsArg } : {}),
        ...(state.selectedProfile !== undefined
          ? {
              serverId: state.selectedProfile.serverId,
              profileId: state.selectedProfile.profileId,
            }
          : {}),
      },
      {
        onSuccess: () => dispatch({ type: "SUBMIT_SUCCESS" }),
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Couldn&apos;t submit request.";
          dispatch({ type: "SUBMIT_ERROR", message });
        },
      },
    );
  }

  // ── Render ────────────────────────────────────────────────────────
  if (jellyseerrStatus !== "connected") {
    return (
      <SheetShell title={title} subtitle="Request media">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Jellyseerr not connected</Text>
          <Text style={styles.emptyBody}>
            Sign in to Jellyseerr from the auth flow to request new media.
          </Text>
        </View>
      </SheetShell>
    );
  }

  const isLoadingFirstFetch =
    (isTv && seasonsQuery.isPending) ||
    (state.step === "quality" && qualityQuery.isPending && !qualityQuery.data);

  const stepContent =
    state.step === "done" ? (
      <View style={styles.centered}>
        <NerdIcon name="check" size={32} color={colors.success} />
        <Text style={styles.successTitle}>Request submitted</Text>
        <Text style={styles.emptyBody}>Jellyseerr will start downloading shortly.</Text>
      </View>
    ) : state.step === "error" ? (
      <View style={styles.centered}>
        <NerdIcon name="warning" size={28} color={colors.danger} />
        <Text style={styles.errorTitle}>Couldn&apos;t submit request</Text>
        <Text style={styles.emptyBody}>{state.errorMessage ?? "Unknown error"}</Text>
      </View>
    ) : isLoadingFirstFetch ? (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    ) : state.step === "seasons" ? (
      <SeasonSelectionStep
        seasons={seasons}
        selected={state.selectedSeasons}
        onToggle={(seasonNumber) => dispatch({ type: "TOGGLE_SEASON", seasonNumber })}
        onSelectAll={() => dispatch({ type: "SELECT_ALL_SEASONS", seasons })}
        onClear={() => dispatch({ type: "CLEAR_SEASONS" })}
      />
    ) : (
      <QualitySelectionStep
        servers={qualityQuery.data ?? []}
        selected={state.selectedProfile}
        onSelect={(serverId, profileId) =>
          dispatch({ type: "SELECT_PROFILE", serverId, profileId })
        }
      />
    );

  return (
    <SheetShell
      title={title}
      subtitle="Request media"
      footer={
        <Footer
          state={state}
          hasSeasonStep={hasSeasonStep}
          canSubmit={state.selectedProfile !== undefined}
          onCancel={() => router.back()}
          onBack={() => dispatch({ type: "GO_BACK_TO_SEASONS" })}
          onNext={() => dispatch({ type: "GO_TO_QUALITY" })}
          onSubmit={handleSubmit}
          onRetry={() => dispatch({ type: "RETRY" })}
        />
      }
    >
      {stepContent}
    </SheetShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sheet shell
//
// A single root `<View collapsable={false}>` with `flex: 1` so it
// fills the Screen's native size, stacked column:
// ```
// root (flex: 1, collapsable: false)
//   ├─ header     (natural height, collapsable: false)
//   ├─ ScrollView (flex: 1, scrolls step content)
//   └─ footerSlot (natural height, always visible at bottom)
// ```
// `collapsable={false}` on the root is what keeps the RNScreens
// FormSheet warning silent: without it, React Native flattens the
// root out of the native hierarchy and its children become direct
// subviews of `RNSSafeAreaViewComponentView`, which trips the
// `FormSheet with ScrollView expects at most 2 subviews (got 8)`
// warning. With it, the Screen sees exactly 1 direct subview (the
// root View) and defers layout to its internal flexbox.
// ──────────────────────────────────────────────────────────────────────

interface ShellProps {
  title: string;
  subtitle: string;
  /** Pinned at the bottom of the body. Omit for info-only states. */
  footer?: ReactNode;
  children: ReactNode;
}

function SheetShell({ title, subtitle, footer, children }: ShellProps) {
  return (
    <View collapsable={false} style={styles.root}>
      <View collapsable={false} style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <NerdIcon name="close" size={14} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scrollRoot}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footerSlot}>{footer}</View> : null}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Footer — step-aware action buttons, pinned at the bottom of the body
// ──────────────────────────────────────────────────────────────────────

interface FooterProps {
  state: ReturnType<typeof initRequestFlow>;
  hasSeasonStep: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onRetry: () => void;
}

function Footer({
  state,
  hasSeasonStep,
  canSubmit,
  onCancel,
  onBack,
  onNext,
  onSubmit,
  onRetry,
}: FooterProps) {
  if (state.step === "done") return null;

  if (state.step === "submitting") {
    return (
      <View style={styles.footer}>
        <View style={[styles.primaryButton, styles.primaryButtonDisabled]}>
          <ActivityIndicator color={colors.accentContrast} />
        </View>
      </View>
    );
  }

  if (state.step === "error") {
    return (
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (state.step === "seasons") {
    const hasSelection = state.selectedSeasons.length > 0;
    return (
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasSelection }}
          disabled={!hasSelection}
          onPress={onNext}
          style={({ pressed }) => [
            styles.primaryButton,
            !hasSelection && styles.primaryButtonDisabled,
            pressed && hasSelection && styles.pressed,
          ]}
        >
          <Text style={styles.primaryLabel}>Next</Text>
        </Pressable>
      </View>
    );
  }

  // step === "quality"
  return (
    <View style={styles.footer}>
      <Pressable
        accessibilityRole="button"
        onPress={hasSeasonStep ? onBack : onCancel}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryLabel}>{hasSeasonStep ? "Back" : "Cancel"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.primaryButton,
          !canSubmit && styles.primaryButtonDisabled,
          pressed && canSubmit && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>Request</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xs,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollRoot: {
    flex: 1,
  },
  footerSlot: {
    // Pinned at the bottom of the body. Horizontal + bottom padding
    // live on the slot itself so it matches the ScrollView's gutter
    // and sits above the home indicator without re-measuring.
    backgroundColor: colors.background,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  scrollBody: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  centered: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  successTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: "center",
  },
  footer: {
    // Row of action buttons. Pinned inside the parent's `footerSlot`
    // which handles horizontal / bottom padding.
    flexDirection: "row",
    gap: spacing.md,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  secondaryLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  primaryButtonDisabled: {
    opacity: opacity.disabled,
  },
  primaryLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
});
