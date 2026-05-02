import { StyleSheet, View } from "react-native";
import { colors } from "@jellyfuse/theme";

import { Faq } from "../sections/faq";
import { FeatureGrid } from "../sections/feature-grid";
import { Footer } from "../sections/footer";
import { Fusion } from "../sections/fusion";
import { Hero } from "../sections/hero";
import { Nav } from "../sections/nav";
import { OnePlayer } from "../sections/one-player";
import { Platforms } from "../sections/platforms";
import { Privacy } from "../sections/privacy";

// Single-page landing site. Sections are composed top-to-bottom — keep
// the order: nav, hero, fusion, one-player, platforms, privacy, features,
// FAQ, footer. (Ports `Jellyfuse Landing.html`'s SECTION markers verbatim.)
export default function LandingPage() {
  return (
    <View style={styles.page}>
      <Nav />
      <View nativeID="top">
        <Hero />
        <Fusion />
        <OnePlayer />
        <Platforms />
        <Privacy />
        <FeatureGrid />
        <Faq />
      </View>
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
