import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  displayName: string;
  avatarUrl: string | undefined;
  onPress: () => void;
  onLongPress: () => void;
}

export function ProfileTile({ displayName, avatarUrl, onPress, onLongPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      {avatarUrl ? (
        <Image
          source={avatarUrl}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
          recyclingKey={avatarUrl}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackLetter}>{displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add user"
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={[styles.avatarFallback, styles.addAvatar]}>
        <Text style={styles.addGlyph}>+</Text>
      </View>
      <Text style={styles.name}>Add user</Text>
    </Pressable>
  );
}

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: spacing.sm,
    width: PROFILE_TILE_SIZE,
  },
  rootPressed: {
    opacity: 0.75,
  },
  avatar: {
    backgroundColor: colors.surface,
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    justifyContent: "center",
    width: AVATAR_SIZE,
  },
  avatarFallbackLetter: {
    color: colors.textSecondary,
    fontSize: 40,
    fontWeight: fontWeight.semibold,
  },
  addAvatar: {
    borderColor: colors.textMuted,
    borderStyle: "dashed",
    borderWidth: 2,
  },
  addGlyph: {
    color: colors.textMuted,
    fontSize: 40,
    fontWeight: fontWeight.medium,
  },
  name: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    maxWidth: PROFILE_TILE_SIZE,
    textAlign: "center",
  },
});
