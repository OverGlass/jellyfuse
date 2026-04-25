import { colors, fontSize, fontWeight, layout, opacity, radius, spacing } from "@jellyfuse/theme";
import { router, useLocalSearchParams } from "expo-router";
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
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthScreenHeader } from "@/features/auth/components/auth-screen-header";
import { CloseButton } from "@/features/auth/components/close-button";
import { LoginDecorativePanel } from "@/features/auth/components/login-decorative-panel";
import { AuthServerNotConfiguredError, useAuth } from "@/services/auth/state";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Phase 1b.2 sign-in screen — step 2 of the two-step flow. The server
 * URL is already set in `AuthProvider` by the time we get here (root
 * router redirects to `/(auth)/server` otherwise), so this screen only
 * asks for Jellyfin credentials.
 *
 * Submit calls `signInWithCredentials` which chains
 * `authenticateByName` → `upsertUser` → flip status to `authenticated`
 * → root router redirects to `(app)`.
 */
export default function SignInScreen() {
  const { serverUrl, serverVersion, signInWithCredentials } = useAuth();
  const { t } = useTranslation();
  const gutters = useScreenGutters();
  const { breakpoint } = useBreakpoint();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // iPad-class split layout only when there's actual room — tablet+
  // breakpoint AND the window is in landscape orientation. Add-user
  // (modal) flow keeps the compact vertical layout regardless so the
  // sheet doesn't double-present a decorative panel.
  const params = useLocalSearchParams<{ mode?: string }>();
  const isAddUserMode = params.mode === "add-user";
  const useSplitLayout = !isAddUserMode && breakpoint !== "phone" && windowWidth > windowHeight;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Jellyfin allows users with empty passwords (common on home-lab
  // installs and the public demo server) — only require the username.
  // The server returns 401 if this specific account actually needs one.
  const canSubmit = Boolean(username.trim()) && !busy;

  // React Compiler handles memoisation — plain function declarations,
  // no useCallback per CLAUDE.md.
  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      await signInWithCredentials({ username: username.trim(), password });
      // Explicitly re-evaluate the root decision tree. On cold sign-in
      // this lands on (app) via the root redirect chain; in add-user
      // mode (where we were already authenticated) this dismisses the
      // pushed (auth) stack so the newly added user lands back on home.
      router.replace("/");
    } catch (err: unknown) {
      setError(buildErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  function handleChangeServer() {
    router.replace("/(auth)/server");
  }

  function handleCancel() {
    // Add-user mode opened from the profile picker — back preserves
    // picker state by popping the navigation stack.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  // Root router (app/index.tsx) owns the three-way routing decision
  // (loading / unauth+no-server → /(auth)/server / unauth+server →
  // /(auth)/sign-in / authenticated → /(app)). Don't second-guess it
  // here — a defensive <Redirect> race-condition'd against the RQ
  // subscription propagation when landing from the server screen.

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={useSplitLayout ? styles.split : styles.flex}>
          {useSplitLayout ? (
            <View style={styles.splitArt}>
              <LoginDecorativePanel />
            </View>
          ) : null}
          <View
            style={[
              useSplitLayout ? styles.splitForm : styles.container,
              !useSplitLayout && {
                paddingLeft: gutters.left,
                paddingRight: gutters.right,
              },
            ]}
          >
            <AuthScreenHeader
              title={isAddUserMode ? t("auth.signIn.addUser") : t("auth.signIn.title")}
              rightAction={isAddUserMode ? <CloseButton onPress={handleCancel} /> : null}
              extras={
                isAddUserMode ? (
                  <Text style={styles.subtitle}>
                    {serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "—"}
                    {serverVersion ? ` · ${serverVersion}` : ""}
                  </Text>
                ) : (
                  <Pressable accessibilityRole="button" onPress={handleChangeServer}>
                    <Text style={styles.subtitle}>
                      {serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "—"}
                      {serverVersion ? ` · ${serverVersion}` : ""}
                    </Text>
                    <Text style={styles.changeServer}>{t("auth.signIn.changeServer")}</Text>
                  </Pressable>
                )
              }
            />

            <View style={styles.inputBlock}>
              <Text style={styles.label}>{t("auth.signIn.username")}</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder={t("auth.signIn.usernamePlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
                style={styles.input}
                editable={!busy}
              />
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.label}>{t("auth.signIn.password")}</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t("auth.signIn.passwordPlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                style={styles.input}
                editable={!busy}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.button,
                (!canSubmit || pressed) && styles.buttonMuted,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={styles.buttonLabel}>{t("auth.signIn.submit")}</Text>
              )}
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type TFunction = ReturnType<typeof useTranslation>["t"];

function buildErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof AuthServerNotConfiguredError) {
    return t("auth.signIn.error.noServer");
  }
  if (err instanceof Error) {
    if (err.name === "AuthenticateHttpError") {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) return t("auth.signIn.error.invalid");
      return t("auth.signIn.error.http", { status: status ?? "error" });
    }
    if (err.name === "AuthenticateParseError") {
      return t("auth.signIn.error.parse");
    }
    return err.message;
  }
  return t("auth.signIn.error.generic");
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
  split: {
    flex: 1,
    flexDirection: "row",
  },
  splitArt: {
    flex: 1,
  },
  splitForm: {
    width: 460,
    paddingHorizontal: 56,
    paddingVertical: 64,
    gap: spacing.lg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.background,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
  },
  changeServer: {
    color: colors.accent,
    fontSize: fontSize.caption,
    marginTop: 2,
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
    minHeight: layout.buttonHeight,
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
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
  },
});
