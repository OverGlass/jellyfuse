import {
  colors,
  duration,
  fontSize,
  fontWeight,
  opacity,
  profileColorFor,
  radius,
  spacing,
} from "@jellyfuse/theme";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

/**
 * One user tile in the profile picker. Pure component — props in,
 * `onPress` / `onLongPress` callbacks out, no reach into parent state.
 * The picker screen composes these via FlashList.
 *
 * The avatar falls back to a circle showing the first letter of the
 * display name when no `avatarUrl` is available (user hasn't set a
 * Jellyfin avatar).
 */

export const PROFILE_TILE_SIZE = 140;

interface Props {
  /** Stable seed for the fallback avatar color (usually Jellyfin user id). */
  colorSeed: string;
  displayName: string;
  avatarUrl: string | undefined;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function ProfileTile({
  colorSeed,
  displayName,
  avatarUrl,
  isActive,
  onPress,
  onLongPress,
}: Props) {
  const fallbackColor = profileColorFor(colorSeed);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={[styles.avatarRing, isActive && styles.avatarRingActive]}>
        {avatarUrl ? (
          <Image
            source={avatarUrl}
            style={styles.avatar}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={avatarUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: fallbackColor }]}>
            <Text style={styles.avatarFallbackLetter}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.name, isActive && styles.nameActive]} numberOfLines={1}>
        {displayName}
      </Text>
    </Pressable>
  );
}

/**
 * "Add user" tile. Same visual footprint as a ProfileTile but with a
 * dashed border and a "+" glyph. Keeps picker grid alignment tidy.
 */
interface AddTileProps {
  onPress: () => void;
}

export function AddUserTile({ onPress }: AddTileProps) {
  const { t } = useTranslation();
  const label = t("profile.addUser");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={[styles.avatarFallback, styles.addAvatar]}>
        <NerdIcon name="plus" size={40} color={colors.textSecondary} />
      </View>
      <Text style={styles.name}>{label}</Text>
    </Pressable>
  );
}

const AVATAR_SIZE = 96;
const RING_PADDING = 4;
const RING_SIZE = AVATAR_SIZE + RING_PADDING * 2;

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: spacing.sm,
    width: PROFILE_TILE_SIZE,
  },
  rootPressed: {
    opacity: opacity.pressed,
  },
  avatarRing: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.full,
    borderWidth: 2,
    height: RING_SIZE,
    justifyContent: "center",
    padding: RING_PADDING - 2,
    width: RING_SIZE,
  },
  avatarRingActive: {
    borderColor: colors.accent,
  },
  avatar: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  avatarFallback: {
    alignItems: "center",
    borderRadius: radius.full,
    height: AVATAR_SIZE,
    justifyContent: "center",
    width: AVATAR_SIZE,
  },
  avatarFallbackLetter: {
    color: colors.textPrimary,
    fontSize: 40,
    fontWeight: fontWeight.bold,
  },
  addAvatar: {
    borderColor: colors.textMuted,
    borderStyle: "dashed",
    borderWidth: 2,
  },
  name: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    maxWidth: PROFILE_TILE_SIZE,
    textAlign: "center",
  },
  nameActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
});
