import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

import { CtaButton } from "../components/cta-button";
import { Heading } from "../components/heading";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={styles.root}>
        <Heading level={1} style={styles.headline}>
          404
        </Heading>
        <Text style={styles.body}>
          The page you&apos;re looking for doesn&apos;t exist. Maybe try the homepage.
        </Text>
        <View style={styles.cta}>
          <CtaButton href="/" label="Back to home" variant="primary" />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: "100vh" as unknown as number,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  headline: {
    fontWeight: fontWeight.bold,
  },
  body: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: 18,
    textAlign: "center",
    maxWidth: "48ch" as unknown as number,
  },
  cta: {
    marginTop: spacing.xl,
  },
});
