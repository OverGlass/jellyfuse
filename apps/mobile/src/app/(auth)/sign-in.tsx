import { colors, fontSize, fontWeight, layout, opacity, radius, spacing } from "@jellyfuse/theme";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
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
import { CloseButton } from "@/features/auth/components/close-button";
import { AuthServerNotConfiguredError, useAuth } from "@/services/auth/state";
import { useScreenGutters } from "@/services/responsive";

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
  const gutters = useScreenGutters();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isAddUserMode = params.mode === "add-user";
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
      setError(buildErrorMessage(err));
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
        <View
          style={[styles.container, { paddingLeft: gutters.left, paddingRight: gutters.right }]}
        >
          <AuthScreenHeader
            title={isAddUserMode ? "Add another account" : "Sign in"}
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
                  <Text style={styles.changeServer}>Change server</Text>
                </Pressable>
              )
            }
          />

          <View style={styles.inputBlock}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="alice"
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
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
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
            style={({ pressed }) => [styles.button, (!canSubmit || pressed) && styles.buttonMuted]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.buttonLabel}>Sign in</Text>
            )}
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function buildErrorMessage(err: unknown): string {
  if (err instanceof AuthServerNotConfiguredError) {
    return "No server configured. Go back to the server step.";
  }
  if (err instanceof Error) {
    if (err.name === "AuthenticateHttpError") {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) return "Wrong username or password.";
      return `Sign-in failed (HTTP ${status ?? "error"}).`;
    }
    if (err.name === "AuthenticateParseError") {
      return "The server responded but the data didn't look right.";
    }
    return err.message;
  }
  return "Sign in failed.";
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
