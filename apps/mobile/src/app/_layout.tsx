import { DarkTheme, ThemeProvider } from "@react-navigation/native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

/**
 * Root layout. Phase 0b.1 only wires the navigation theme + expo-router Stack.
 * Phase 0b.2 adds the TanStack Query provider, MMKV persister, and the
 * connection/auth providers. Phase 0b.3 adds the native-tabs layout under
 * `(app)` and the auth-guarded `(auth)` group.
 */
export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  )
}
