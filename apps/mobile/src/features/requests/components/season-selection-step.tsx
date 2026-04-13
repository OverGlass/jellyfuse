import type { SeasonInfo } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

/**
 * Step 1 of the TV request flow — pure component. Lists the show's
 * seasons with their availability and lets the user toggle the
 * `missing` ones into a selection. Already-`available` and
 * already-`requested` seasons are rendered disabled with a status
 * label, mirroring the Rust `render_season_step`.
 *
 * Bulk toggle: a single 'Select all missing' / 'Clear' button at the
 * top so power users can bypass the per-row checkboxes.
 */
interface Props {
  seasons: SeasonInfo[];
  selected: number[];
  onToggle: (seasonNumber: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function SeasonSelectionStep({ seasons, selected, onToggle, onSelectAll, onClear }: Props) {
  const requestable = seasons.filter((s) => s.availability === "missing");
  const allRequestableSelected =
    requestable.length > 0 && requestable.every((s) => selected.includes(s.seasonNumber));

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Pick seasons to request</Text>
        {requestable.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={allRequestableSelected ? onClear : onSelectAll}
            style={({ pressed }) => [styles.bulkButton, pressed && styles.pressed]}
          >
            <Text style={styles.bulkLabel}>{allRequestableSelected ? "Clear" : "Select all"}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.list}>
        {seasons.map((season) => {
          const isSelected = selected.includes(season.seasonNumber);
          const isDisabled = season.availability !== "missing";
          const statusLabel =
            season.availability === "available"
              ? "Available"
              : season.availability === "requested"
                ? "Requested"
                : undefined;
          return (
            <Pressable
              key={season.seasonNumber}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected, disabled: isDisabled }}
              accessibilityLabel={`${season.name}${statusLabel ? `, ${statusLabel}` : ""}`}
              disabled={isDisabled}
              onPress={() => onToggle(season.seasonNumber)}
              style={({ pressed }) => [
                styles.row,
                isDisabled && styles.rowDisabled,
                pressed && !isDisabled && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.checkbox,
                  isSelected && styles.checkboxChecked,
                  isDisabled && styles.checkboxDisabled,
                ]}
              >
                {isSelected ? (
                  <NerdIcon name="check" size={12} color={colors.accentContrast} />
                ) : null}
              </View>
              <Text style={[styles.rowLabel, isDisabled && styles.rowLabelDisabled]}>
                {season.name}
              </Text>
              {statusLabel ? <Text style={styles.statusLabel}>{statusLabel}</Text> : null}
            </Pressable>
          );
        })}
        {seasons.length === 0 ? (
          <Text style={styles.empty}>Jellyseerr returned no seasons for this show.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  bulkButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bulkLabel: {
    color: colors.accent,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
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
  rowDisabled: {
    backgroundColor: colors.surfaceElevated,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  checkbox: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.textMuted,
    borderRadius: 4,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxDisabled: {
    opacity: opacity.disabled,
  },
  rowLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  rowLabelDisabled: {
    color: colors.textMuted,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
});
