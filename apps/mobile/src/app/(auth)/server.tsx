import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/services/auth/state";
import { useSystemInfo } from "@/services/query";

/**
 * Phase 1b.2 server-connect screen. First step of the two-step sign-in
 * flow — the user enters a Jellyfin server URL, we ping `/System/Info/
 * Public` to validate + identify it, show the server name + version
 * inline, and enable "Continue" only when the ping resolved.
 *
 * On continue we persist the URL + version via `AuthProvider.setServer`,
 * which flips `serverUrl` in state. The root router then sends the user
 * to `(auth)/sign-in` because `activeUser` is still undefined.
 */
export default function ServerScreen() {
  const { setServer } = useAuth();
  const [urlDraft, setUrlDraft] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | undefined>(undefined);

  const systemInfo = useSystemInfo(submittedUrl);

  const handleCheck = useCallback(() => {
    const normalized = normalizeUrl(urlDraft);
    if (!normalized) return;
    setSubmittedUrl(normalized);
  }, [urlDraft]);

  const handleContinue = useCallback(async () => {
    if (!submittedUrl || !systemInfo.data) return;
    await setServer(submittedUrl, systemInfo.data.version);
    router.replace("/(auth)/sign-in");
  }, [submittedUrl, systemInfo.data, setServer]);

  const errorMessage = buildErrorMessage(systemInfo);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Connect to Jellyfin</Text>
          <Text style={styles.subtitle}>Enter your Jellyfin server URL to get started.</Text>

          <View style={styles.inputBlock}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="https://jellyfin.example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={handleCheck}
              style={styles.input}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleCheck}
            disabled={!urlDraft.trim()}
            style={({ pressed }) => [
              styles.button,
              (!urlDraft.trim() || pressed) && styles.buttonMuted,
            ]}
          >
            <Text style={styles.buttonLabel}>Check server</Text>
          </Pressable>

          {submittedUrl && systemInfo.isLoading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.statusText}>Contacting server…</Text>
            </View>
          ) : null}

          {systemInfo.data ? (
            <View style={styles.resultBlock}>
              <Text style={styles.resultName}>{systemInfo.data.serverName}</Text>
              <Text style={styles.resultMeta}>
                {systemInfo.data.productName} · {systemInfo.data.version}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleContinue}
                style={({ pressed }) => [
                  styles.continueButton,
                  pressed && styles.continueButtonPressed,
                ]}
              >
                <Text style={styles.continueLabel}>Continue</Text>
              </Pressable>
            </View>
          ) : null}

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const withoutTrailingSlash = withScheme.replace(/\/+$/, "");
  return withoutTrailingSlash;
}

function buildErrorMessage(query: ReturnType<typeof useSystemInfo>): string | undefined {
  if (query.isError) {
    const err = query.error as Error;
    if (err.name === "SystemInfoHttpError") {
      return `Server rejected the request (${(err as Error & { status?: number }).status ?? "HTTP error"}).`;
    }
    if (err.name === "SystemInfoParseError") {
      return "The server responded but the data didn't look like a Jellyfin server.";
    }
    return "Couldn't reach the server. Check the URL and your connection.";
  }
  return undefined;
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xxl,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
  },
  inputBlock: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  buttonMuted: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  resultBlock: {
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    gap: spacing.sm,
    padding: spacing.md,
  },
  resultName: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  resultMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  continueButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
  },
  continueButtonPressed: {
    opacity: 0.75,
  },
  continueLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  error: {
    color: "#ef4444",
    fontSize: fontSize.body,
  },
});
