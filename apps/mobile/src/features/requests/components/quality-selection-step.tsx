import type { MediaServer } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Step 2 of the request flow — pure component. Lists every quality
 * profile across every Radarr / Sonarr server registered in
 * Jellyseerr and lets the user pick one. Default profile is
 * pre-selected by the parent screen via `pickInitialProfile`.
 *
 * When Jellyseerr only has one server (the common case) the server
 * label is hidden and the rows look like a flat radio list. With
 * multiple servers the rows are grouped by server name to disambiguate
 * profiles that share names across servers.
 */
interface Props {
  servers: MediaServer[];
  selected: { serverId: number; profileId: number } | undefined;
  onSelect: (serverId: number, profileId: number) => void;
}

export function QualitySelectionStep({ servers, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const showServerNames = servers.length > 1;
  return (
    <View style={styles.root}>
      <Text style={styles.headerTitle}>{t("requests.flow.quality.title")}</Text>
      {servers.length === 0 ? (
        <Text style={styles.empty}>{t("requests.flow.empty.noProfiles")}</Text>
      ) : null}
      {servers.map((server) => (
        <View key={server.id} style={styles.serverGroup}>
          {showServerNames ? <Text style={styles.serverLabel}>{server.name}</Text> : null}
          {server.profiles.length === 0 ? (
            <Text style={styles.empty}>{t("requests.flow.empty.noServerProfiles")}</Text>
          ) : (
            <View style={styles.list}>
              {server.profiles.map((profile) => {
                const isSelected =
                  selected?.serverId === server.id && selected.profileId === profile.id;
                return (
                  <Pressable
                    key={profile.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={profile.name}
                    onPress={() => onSelect(server.id, profile.id)}
                    style={({ pressed }) => [
                      styles.row,
                      isSelected && styles.rowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.radio, isSelected && styles.radioSelected]}>
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={styles.rowLabel}>{profile.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  serverGroup: {
    gap: spacing.sm,
  },
  serverLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowSelected: {
    backgroundColor: colors.surfaceElevated,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  radio: {
    alignItems: "center",
    borderColor: colors.textMuted,
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioSelected: {
    borderColor: colors.accent,
  },
  radioDot: {
    backgroundColor: colors.accent,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  rowLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.md,
  },
});
