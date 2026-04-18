import {
  colors,
  fontSize,
  fontWeight,
  layout,
  opacity,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Bottom-sheet modal that re-authenticates the active user against
 * Jellyseerr. Surfaced from Settings when the row reads
 * "Disconnected" — the cookie jar's `connect.sid` has expired or the
 * server rotated sessions, but the Jellyfin half is still valid so we
 * only need the password to mint a new cookie.
 *
 * Pure component: parent owns visibility and supplies the active
 * user's display name (read-only) plus an `onSubmit(password)` callback
 * that returns a promise. Loading + error UX is local — the parent
 * doesn't have to thread mutation state through.
 */
interface Props {
  visible: boolean;
  username: string;
  baseUrl: string;
  /** Last server-reported error to seed the modal — usually a 401 hint. */
  initialError?: string | undefined;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}

export function JellyseerrReconnectModal({
  visible,
  username,
  baseUrl,
  initialError,
  onSubmit,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  const canSubmit = !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(password);
      setPassword("");
      onClose();
    } catch (err: unknown) {
      setError(buildErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (busy) return;
    setPassword("");
    setError(undefined);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={handleClose} accessibilityRole="none">
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => {}}
            style={[styles.sheet, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}
            accessibilityRole="none"
          >
            <View style={styles.header}>
              <Text style={styles.title}>Reconnect to Jellyseerr</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {baseUrl.replace(/^https?:\/\//, "")}
              </Text>
            </View>

            <View style={styles.body}>
              <View style={styles.inputBlock}>
                <Text style={styles.label}>Username</Text>
                <View style={[styles.input, styles.inputDisabled]}>
                  <Text style={styles.inputDisabledText} numberOfLines={1}>
                    {username}
                  </Text>
                </View>
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
                  autoFocus
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.submitButton,
                  (!canSubmit || pressed) && styles.submitButtonMuted,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.accentContrast} />
                ) : (
                  <Text style={styles.submitLabel}>Reconnect</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={handleClose}
                disabled={busy}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && { opacity: opacity.pressed },
                ]}
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function buildErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "JellyseerrHttpError") {
      const status = (err as Error & { status?: number }).status;
      if (status === 401 || status === 403) return "Wrong password.";
      return `Jellyseerr rejected the request (HTTP ${status ?? "error"}).`;
    }
    return err.message;
  }
  return "Reconnect failed.";
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    backgroundColor: withAlpha(colors.black, opacity.overlay),
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: "center",
    gap: 4,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  body: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
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
    backgroundColor: colors.background,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputDisabled: {
    opacity: opacity.disabled,
  },
  inputDisabledText: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: layout.buttonHeight,
    paddingVertical: spacing.md,
  },
  submitButtonMuted: {
    opacity: opacity.disabled,
  },
  submitLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  cancelLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
