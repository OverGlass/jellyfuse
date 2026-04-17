import { NerdIcon } from "@/features/common/components/nerd-icon";
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Generic single-select picker rendered as a bottom sheet over a dimmed
 * scrim. Used for every "pick one value" setting (audio language,
 * subtitle mode, bitrate cap, …).
 *
 * Pure component: the parent owns visibility + currently-selected value
 * and receives a `onSelect(value)` callback; the modal doesn't touch
 * state. `onClose` is called when the user dismisses via scrim tap or
 * swipe. `onSelect` also closes the modal implicitly — the parent
 * should flip `visible=false` in its handler.
 *
 * The option list scrolls when it exceeds the sheet's max height so
 * long lists (full ISO-639 language table) remain usable without
 * overflowing the screen.
 */
export interface PickerOption<T extends string | number> {
  label: string;
  /** Secondary descriptor rendered under the label (e.g. "Up to 8 Mbps"). */
  sublabel?: string;
  value: T;
}

interface Props<T extends string | number> {
  visible: boolean;
  title: string;
  options: PickerOption<T>[];
  selectedValue: T | undefined;
  onSelect: (value: T) => void;
  onClose: () => void;
}

export function SettingsPickerModal<T extends string | number>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: Props<T>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="none">
        {/* Stop the press bubble so taps inside the sheet don't dismiss. */}
        <Pressable
          onPress={() => {}}
          style={[styles.sheet, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}
          accessibilityRole="none"
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              return (
                <Pressable
                  key={String(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{option.label}</Text>
                    {option.sublabel ? (
                      <Text style={styles.rowSublabel}>{option.sublabel}</Text>
                    ) : null}
                  </View>
                  {isSelected ? <NerdIcon name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: withAlpha(colors.black, opacity.overlay),
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "80%",
    paddingTop: spacing.md,
  },
  header: {
    alignItems: "center",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  rowSublabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
});
