import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import { colors } from "@jellyfuse/theme";

import { SITE } from "../lib/content";

// Root layout. Sets the head meta (title, description, OG, theme color),
// injects the global reset / reduced-motion CSS, then hosts the
// Expo Router stack. The marketing page is a single route — the stack
// just gives us 404 routing for free.
export default function RootLayout() {
  return (
    <View style={styles.root}>
      <Head>
        <title>{`${SITE.name} — ${SITE.tagline}`}</title>
        <meta name="description" content={SITE.description} />
        <meta name="theme-color" content={colors.background} />
        <meta name="color-scheme" content="dark" />
        <meta property="og:title" content={`${SITE.name} — ${SITE.tagline}`} />
        <meta property="og:description" content={SITE.description} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="favicon.png" />
        <style>{GLOBAL_CSS}</style>
      </Head>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </View>
  );
}

// Reset for the few things RNW doesn't already handle, plus the
// `prefers-reduced-motion` opt-out (kills all transitions and the platform
// stage cross-fade — the active frame stays visible on its own).
//
// Expo Router's static-render injects `<style id="expo-reset">` AFTER our
// styles, and that reset hard-codes `body{overflow:hidden}` plus
// `html,body,#root{height:100%}`. Those two rules kill the page scroll
// and break `position:sticky` on the platforms stage. We override with
// `!important` so the marketing page can grow taller than the viewport
// and the body scrolls naturally.
const GLOBAL_CSS = `
  html, body { margin: 0; padding: 0; }
  html, body, #root {
    background-color: ${colors.background};
    height: auto !important;
    min-height: 100% !important;
  }
  body {
    color: ${colors.textPrimary};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    overflow-y: auto !important;
    overflow-x: hidden;
  }
  #root { display: block !important; min-height: 100vh; }
  *::selection { background: ${colors.accent}; color: ${colors.accentContrast}; }
  a:focus-visible, button:focus-visible, summary:focus-visible, [role="button"]:focus-visible, [role="link"]:focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 3px;
    border-radius: 2px;
  }
  @keyframes drift {
    0%   { transform: translate3d(-2%, -1%, 0) scale(1); }
    50%  { transform: translate3d(3%, 2%, 0) scale(1.04); }
    100% { transform: translate3d(-3%, 3%, 0) scale(1.02); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
