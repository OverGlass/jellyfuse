import { View } from "react-native";
import { colors, radius } from "@jellyfuse/theme";

import { webStyles } from "./web-styles";

// Hand-rolled bezel frames for each platform. Pure View + StyleSheet —
// no external device-frame npm package. Each variant exports the
// component AND a screen container so the mock UI inside lays out
// correctly relative to the bezel cut-outs (notch, punch hole, base).

const SHADOW = {
  // Layered shadow: outer hairline + dropped shadow + accent halo.
  // RNW maps `boxShadow` straight through to CSS so multi-shadow works.
  boxShadow:
    "0 0 0 2px #2a2f37, 0 30px 60px -10px rgba(0,0,0,0.6), 0 60px 120px -30px rgba(97,175,239,0.18)",
};

const ANDROID_SHADOW = {
  boxShadow:
    "0 0 0 2px #2a2f37, 0 30px 60px -10px rgba(0,0,0,0.6), 0 60px 120px -30px rgba(152,195,121,0.16)",
};

type FrameProps = { children: React.ReactNode };

export function IPhoneFrame({ children }: FrameProps) {
  return (
    <View style={[styles.iphone, SHADOW]}>
      <View style={styles.iphoneScreen}>
        <View style={styles.notch} />
        {children}
      </View>
    </View>
  );
}

export function IPadFrame({ children }: FrameProps) {
  return (
    <View style={[styles.ipad, SHADOW]}>
      <View style={styles.ipadScreen}>{children}</View>
    </View>
  );
}

export function TvFrame({ children }: FrameProps) {
  return (
    <View style={styles.tvWrap}>
      <View style={[styles.tv, SHADOW]}>
        <View style={styles.tvScreen}>{children}</View>
      </View>
      <View style={styles.tvStand} />
    </View>
  );
}

export function MacFrame({ children }: FrameProps) {
  return (
    <View style={styles.macWrap}>
      <View style={[styles.macLid, SHADOW]}>
        <View style={styles.macHinge} />
        <View style={styles.macScreen}>{children}</View>
      </View>
      <View style={styles.macBase}>
        <View style={styles.macBaseNotch} />
      </View>
    </View>
  );
}

export function AndroidFrame({ children }: FrameProps) {
  return (
    <View style={[styles.android, ANDROID_SHADOW]}>
      <View style={styles.androidScreen}>
        <View style={styles.punch} />
        {children}
      </View>
    </View>
  );
}

const styles = webStyles({
  // ─── iPhone ───────────────────────────────────────────────────────
  iphone: {
    width: "clamp(220px, 26vw, 310px)",
    aspectRatio: 9 / 19,
    backgroundColor: "#0d0f12",
    borderRadius: 42,
    padding: 8,
  },
  iphoneScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 34,
    overflow: "hidden",
    position: "relative",
  },
  notch: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    left: "50%",
    width: 90,
    height: 24,
    backgroundColor: "#000",
    borderRadius: radius.full,
    transform: [{ translateX: -45 }],
    zIndex: 4,
  },
  // ─── iPad ─────────────────────────────────────────────────────────
  ipad: {
    width: "clamp(380px, 48vw, 600px)",
    aspectRatio: 4 / 3,
    backgroundColor: "#0d0f12",
    borderRadius: 26,
    padding: 12,
  },
  ipadScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  // ─── TV ───────────────────────────────────────────────────────────
  tvWrap: {
    alignItems: "center",
  },
  tv: {
    width: "clamp(420px, 55vw, 660px)",
    aspectRatio: 16 / 9,
    backgroundColor: "#0d0f12",
    borderRadius: 14,
    padding: 10,
  },
  tvScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 6,
    overflow: "hidden",
    position: "relative",
  },
  tvStand: {
    width: "38%",
    height: 16,
    background: "linear-gradient(180deg, #2a2f37, #1a1d22)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: -1,
  },
  // ─── Mac ──────────────────────────────────────────────────────────
  macWrap: {
    width: "clamp(420px, 55vw, 680px)",
    alignItems: "center",
  },
  macLid: {
    width: "100%",
    aspectRatio: 16 / 10,
    backgroundColor: "#0d0f12",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    padding: 16,
    overflow: "hidden",
  },
  macHinge: {
    alignSelf: "center",
    width: 70,
    height: 5,
    backgroundColor: "#1a1d22",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginBottom: 6,
    marginTop: -6,
  },
  macScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
  },
  macBase: {
    width: "110%",
    height: 12,
    background: "linear-gradient(180deg, #2a2f37, #1a1d22)",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginLeft: "-5%",
    position: "relative",
  },
  macBaseNotch: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    width: "16%",
    height: 3,
    backgroundColor: "#0d0f12",
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  // ─── Android ──────────────────────────────────────────────────────
  android: {
    width: "clamp(220px, 26vw, 300px)",
    aspectRatio: 9 / 19.5,
    backgroundColor: "#0d0f12",
    borderRadius: 36,
    padding: 6,
  },
  androidScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 30,
    overflow: "hidden",
    position: "relative",
  },
  punch: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    width: 12,
    height: 12,
    borderRadius: radius.full,
    backgroundColor: "#000",
    zIndex: 3,
    transform: [{ translateX: -6 }],
  },
});
