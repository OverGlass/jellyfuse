import type { AuthenticatedUser } from "@jellyfuse/api";
import { colors, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthScreenHeader } from "@/features/auth/components/auth-screen-header";
import { CloseButton } from "@/features/auth/components/close-button";
import { AddUserTile, ProfileTile } from "@/features/profile/components/profile-tile";
import { useAuth } from "@/services/auth/state";
import { useScreenGutters } from "@/services/responsive";

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
  const { users, activeUser, serverUrl, serverVersion, switchUser, removeUser } = useAuth();
  const gutters = useScreenGutters();

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

  // Only show a close button when there's somewhere to dismiss *to* —
  // i.e. when the picker was pushed over (app) as a modal from the
  // home header. On cold launch "who's watching" is the only thing on
  // the stack and a close button would strand the user.
  const canDismiss = router.canGoBack();

  function handleDismiss() {
    router.back();
  }

  async function performRemove(user: AuthenticatedUser) {
    await removeUser(user.userId);
    // After the mutation resolves the auth cache is already reseated
    // with the post-remove shape. If this was the last account — or
    // just removed the currently active one with no remaining users —
    // the picker has nothing to pick, so route back through the root
    // decision tree. `replace("/")` dismisses the modal and lands on
    // `/(auth)/sign-in` when the list is empty, or the picker again
    // when another user became active.
    const stillHasUsers = users.some((u) => u.userId !== user.userId);
    if (!stillHasUsers) {
      router.replace("/");
    }
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
            void performRemove(user);
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ paddingLeft: gutters.left, paddingRight: gutters.right }}>
        <AuthScreenHeader
          title="Who's watching?"
          subtitle={`${serverUrl ? serverUrl.replace(/^https?:\/\//, "") : "—"}${
            serverVersion ? ` · ${serverVersion}` : ""
          }`}
          rightAction={canDismiss ? <CloseButton onPress={handleDismiss} /> : null}
        />
      </View>
      <FlashList
        data={items}
        keyExtractor={(item) => (item.kind === "user" ? item.user.userId : "add-user")}
        numColumns={2}
        contentContainerStyle={{
          paddingLeft: gutters.left,
          paddingRight: gutters.right,
          paddingTop: spacing.xl,
        }}
        renderItem={({ item }) =>
          item.kind === "user" ? (
            <View style={styles.cell}>
              <ProfileTile
                colorSeed={item.user.userId}
                displayName={item.user.displayName}
                avatarUrl={item.user.avatarUrl}
                isActive={activeUser?.userId === item.user.userId}
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
  cell: {
    alignItems: "center",
    paddingBottom: spacing.xl,
  },
});
