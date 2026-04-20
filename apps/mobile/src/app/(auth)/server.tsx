import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { AuthScreenHeader } from "@/features/auth/components/auth-screen-header";
import { useAuth } from "@/services/auth/state";
import { useSystemInfo } from "@/services/query";
import { useScreenGutters } from "@/services/responsive";

/**
 * Phase 1b.3 server-connect screen. First step of the two-step sign-in
 * flow — the user enters a Jellyfin server URL, we ping `/System/Info/
 * Public` to validate + identify it, show the server name + version
 * inline, and enable "Continue" only when the ping resolved.
 *
 * An optional Jellyseerr URL field sits below. Per the Rust spec
 * Jellyseerr is per-server (not per-user), so we persist it alongside
 * the Jellyfin URL here rather than asking for it again on the sign-in
 * screen. The actual Jellyseerr login runs during
 * `signInWithCredentials` with the same credentials the user enters
 * for Jellyfin — see `AuthProvider`.
 */
export default function ServerScreen() {
  const { setServer } = useAuth();
  const { t } = useTranslation();
  const gutters = useScreenGutters();
  const [urlDraft, setUrlDraft] = useState("");
  const [jellyseerrDraft, setJellyseerrDraft] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | undefined>(undefined);

  const systemInfo = useSystemInfo(submittedUrl);

  // React Compiler handles memoisation — plain function declarations,
  // no useCallback per CLAUDE.md.
  function handleCheck() {
    const normalized = normalizeUrl(urlDraft);
    if (!normalized) return;
    setSubmittedUrl(normalized);
  }

  async function handleContinue() {
    if (!submittedUrl || !systemInfo.data) return;
    const jellyseerrUrl = normalizeUrl(jellyseerrDraft);
    await setServer({
      url: submittedUrl,
      version: systemInfo.data.version,
      jellyseerrUrl,
    });
    router.replace("/(auth)/sign-in");
  }

  const errorMessage = buildErrorMessage(systemInfo, t);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[styles.container, { paddingLeft: gutters.left, paddingRight: gutters.right }]}
        >
          <AuthScreenHeader title={t("auth.server.title")} subtitle={t("auth.server.subtitle")} />

          <View style={styles.inputBlock}>
            <Text style={styles.label}>{t("auth.server.urlLabel")}</Text>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder={t("auth.server.placeholder")}
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

          <View style={styles.inputBlock}>
            <Text style={styles.label}>{t("auth.server.jellyseerrLabel")}</Text>
            <TextInput
              value={jellyseerrDraft}
              onChangeText={setJellyseerrDraft}
              placeholder={t("auth.server.jellyseerrPlaceholder")}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={handleCheck}
              style={styles.input}
            />
            <Text style={styles.helper}>{t("auth.server.jellyseerrHelper")}</Text>
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
            <Text style={styles.buttonLabel}>{t("auth.server.check")}</Text>
          </Pressable>

          {submittedUrl && systemInfo.isLoading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.statusText}>{t("auth.server.contacting")}</Text>
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
                <Text style={styles.continueLabel}>{t("auth.server.submit")}</Text>
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

type TFunction = ReturnType<typeof useTranslation>["t"];

function buildErrorMessage(
  query: ReturnType<typeof useSystemInfo>,
  t: TFunction,
): string | undefined {
  if (query.isError) {
    const err = query.error as Error;
    if (err.name === "SystemInfoHttpError") {
      const status = (err as Error & { status?: number }).status ?? "HTTP error";
      return t("auth.server.error.http", { status });
    }
    if (err.name === "SystemInfoParseError") {
      return t("auth.server.error.parse");
    }
    return t("auth.server.error.network");
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
    paddingBottom: spacing.lg,
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
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  buttonMuted: {
    opacity: opacity.disabled,
  },
  buttonLabel: {
    color: colors.accentContrast,
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
    borderRadius: radius.md,
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
  helper: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
  },
  continueButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
  },
  continueButtonPressed: {
    opacity: opacity.pressed,
  },
  continueLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
  },
});
