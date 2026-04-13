import { NerdIcon } from "@/features/common/components/nerd-icon";
import { useScreenGutters } from "@/services/responsive";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { AnimatedStyle } from "react-native-reanimated";
import { FloatingBlurHeader } from "./floating-blur-header";

/**
 * **The** screen header used everywhere except the player and the
 * detail hero-driven screens (which have their own bespoke layout).
 * One row: optional back button on the left, title centered against
 * it, optional right action slot. Optional bottom slot below the row
 * for things like the search input on home + shelf grid.
 *
 * Pinned in a `FloatingBlurHeader` so content scrolls underneath
 * with the standard masked-blur backdrop. Consumers pass an animated
 * `backdropStyle` to fade the blur in as the user scrolls — the
 * children stay fully opaque so the title and search input remain
 * legible at all scroll positions.
 *
 * Layout rules:
 * - Row height fixed at `ROW_HEIGHT` so the header is always small.
 * - When `showBack` is false the back-button slot collapses entirely
 *   and the title hugs the screen gutter — no phantom whitespace on
 *   root screens like home.
 * - Title is bold but only `fontSize.bodyLarge` — not the screen
 *   display title. This is the small/compact header pattern; large
 *   page titles live in-flow inside the scroll content.
 *
 * Pure component: props in / callbacks out. Everything inside is
 * driven by props or imported helpers — no reach into parent state.
 */
interface Props {
  /** Title rendered next to the (optional) back button. */
  title?: string;
  /**
   * Whether to render the back button on the left. When `false` the
   * slot collapses entirely — root screens like home don't carry a
   * leading gap where the button would otherwise sit.
   */
  showBack?: boolean;
  /** Optional right-side action (avatar, icon button, etc.). */
  rightSlot?: ReactNode;
  /**
   * Optional row rendered below the title row — typically the
   * search input on home / shelf grid screens.
   */
  bottomSlot?: ReactNode;
  /**
   * Reanimated style applied to the masked blur backdrop. Use this
   * with `useAnimatedStyle` to fade the blur opacity from a scroll
   * position so the header reads as transparent at the top of the
   * page and as a frosted bar once content scrolls under it.
   */
  backdropStyle?: AnimatedStyle<ViewStyle>;
  /**
   * Fires with the total rendered header height in dp (safe-area
   * inset + content + fade-zone). Pipe this into your scroll
   * container's `contentContainerStyle.paddingTop` so nothing
   * starts hidden behind the blur.
   */
  onTotalHeightChange?: (height: number) => void;
}

const ROW_HEIGHT = 36;
const BACK_SLOT_WIDTH = 36;

export function ScreenHeader({
  title,
  showBack = false,
  rightSlot,
  bottomSlot,
  backdropStyle,
  onTotalHeightChange,
}: Props) {
  const gutters = useScreenGutters();
  return (
    <FloatingBlurHeader backdropStyle={backdropStyle} onTotalHeightChange={onTotalHeightChange}>
      <View style={[styles.body, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
        <View style={styles.row}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/");
                }
              }}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <NerdIcon name="chevronLeft" size={18} />
            </Pressable>
          ) : null}
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <View style={styles.titleSpacer} />
          )}
          <View style={styles.rightSlot}>{rightSlot}</View>
        </View>
        {bottomSlot ? <View style={styles.bottomRow}>{bottomSlot}</View> : null}
      </View>
    </FloatingBlurHeader>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
    // Clearance between the bottom slot (search input) and the
    // FloatingBlurHeader's fade zone, so the blur stays solid
    // underneath the input rather than fading out at its edge.
    paddingBottom: spacing.sm,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    height: ROW_HEIGHT,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 18,
    height: ROW_HEIGHT,
    justifyContent: "center",
    width: ROW_HEIGHT,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.bold,
  },
  titleSpacer: {
    flex: 1,
  },
  rightSlot: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: ROW_HEIGHT,
  },
  bottomRow: {
    // Empty wrapper kept for future bottom-slot styling tweaks.
  },
});
