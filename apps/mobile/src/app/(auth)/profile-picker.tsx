import type { AuthenticatedUser } from "@jellyfuse/api";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddUserTile, ProfileTile } from "@/features/profile/components/profile-tile";
import { useAuth } from "@/services/auth/state";

/**
 * Phase 1b.4 profile picker. Rendered automatically by the root router
 * when the server is configured + users list is non-empty + no active
 * user is selected (e.g. after sign-out, or on cold launch if the user
 * removed the active one). Also reachable from the home header avatar
 * button to switch between active accounts.
 *
 * Grid of `ProfileTile`s + an `AddUserTile` that navigates to
 * `/(auth)/sign-in?mode=add-user`. Long-press on a tile prompts to
 * remove that account. All mutations go through `AuthProvider`.
 */

type PickerItem = { kind: "user"; user: AuthenticatedUser } | { kind: "add-user" };

export default function ProfilePickerScreen() {
  const { users, serverUrl, serverVersion, switchUser, removeUser } = useAuth();

  const items: PickerItem[] = [
    ...users.map((user): PickerItem => ({ kind: "user", user })),
    { kind: "add-user" },
  ];

  async function handleSelect(user: AuthenticatedUser) {
    await switchUser(user.userId);
    // Root router sees the new active user and redirects to (app).
    router.replace("/");
  }

  function handleAddUser() {
    router.push("/(auth)/sign-in?mode=add-user");
  }

  function handleRemove(user: AuthenticatedUser) {
    Alert.alert(
      `Remove ${user.displayName}?`,
      "This signs the account out of Jellyfuse but leaves the Jellyfin account itself untouched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void removeUser(user.userId);
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Who's watching?</Text>
        <Text style={styles.subtitle}>
          {serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "—"}
          {serverVersion ? ` · ${serverVersion}` : ""}
        </Text>
      </View>
      <FlashList
        data={items}
        keyExtractor={(item) => (item.kind === "user" ? item.user.userId : "add-user")}
        numColumns={2}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) =>
          item.kind === "user" ? (
            <View style={styles.cell}>
              <ProfileTile
                displayName={item.user.displayName}
                avatarUrl={item.user.avatarUrl}
                onPress={() => {
                  void handleSelect(item.user);
                }}
                onLongPress={() => {
                  handleRemove(item.user);
                }}
              />
            </View>
          ) : (
            <View style={styles.cell}>
              <AddUserTile onPress={handleAddUser} />
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.body,
  },
  grid: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  cell: {
    alignItems: "center",
    paddingBottom: spacing.xl,
  },
});
