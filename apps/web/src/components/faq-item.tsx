import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

import { HAIRLINE } from "./layout";
import { webStyles } from "./web-styles";

type Props = {
  question: string;
  answer: string;
  initiallyOpen?: boolean;
};

// Accessible disclosure. Keyboard-operable (Pressable maps Enter / Space)
// and exposes `aria-expanded` so screen readers announce the open / closed
// state. The "+" → "×" rotation is pure transform.
export function FaqItem({ question, answer, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        style={styles.summary}
      >
        <Text style={styles.question}>{question}</Text>
        <View style={styles.plus}>
          <View style={styles.plusBarH} />
          <View style={[styles.plusBarV, open ? styles.plusBarVOpen : null]} />
        </View>
      </Pressable>
      {open ? <Text style={styles.answer}>{answer}</Text> : null}
    </View>
  );
}

const styles = webStyles({
  item: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingVertical: spacing.lg,
  },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    cursor: "pointer",
  },
  question: {
    flex: 1,
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 19,
    fontWeight: fontWeight.medium,
    color: colors.textPrimary,
    letterSpacing: "-0.01em",
    lineHeight: 19 * 1.3,
  },
  plus: {
    width: 24,
    height: 24,
    position: "relative",
  },
  plusBarH: {
    position: "absolute",
    backgroundColor: colors.textSecondary,
    borderRadius: 1,
    left: 0,
    right: 0,
    top: 11,
    height: 2,
  },
  plusBarV: {
    position: "absolute",
    backgroundColor: colors.textSecondary,
    borderRadius: 1,
    top: 0,
    bottom: 0,
    left: 11,
    width: 2,
    transform: [{ rotate: "0deg" }],
    transitionProperty: "transform, opacity",
    transitionDuration: "200ms",
  },
  plusBarVOpen: {
    transform: [{ rotate: "90deg" }],
    opacity: 0,
  },
  answer: {
    marginTop: spacing.md,
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 16 * 1.55,
    maxWidth: "64ch",
  },
});
