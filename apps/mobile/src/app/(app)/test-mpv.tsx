import { createNativeMpv, type NativeMpv, type MpvListener } from "@jellyfuse/native-mpv";
import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "@/features/common/components/back-button";

/**
 * Throwaway test screen for Phase 3a audio-only validation.
 * Creates a NativeMpv hybrid object, loads a public audio URL,
 * and displays the state + progress from the native event stream.
 * Delete this file once Phase 3b ships the real player screen.
 */

// Public domain audio — Big Buck Bunny soundtrack (MP3)
const TEST_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

export default function TestMpvScreen() {
  const mpvRef = useRef<NativeMpv | null>(null);
  const listenersRef = useRef<MpvListener[]>([]);
  const [state, setState] = useState("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      for (const l of listenersRef.current) l.remove();
      listenersRef.current = [];
      mpvRef.current?.release();
      mpvRef.current = null;
    };
  }, []);

  function handleCreate() {
    if (mpvRef.current) return;
    try {
      const mpv = createNativeMpv();
      mpvRef.current = mpv;

      const subs: MpvListener[] = [];
      subs.push(
        mpv.addProgressListener((pos, dur) => {
          setPosition(pos);
          setDuration(dur);
        }),
      );
      subs.push(
        mpv.addStateChangeListener((s) => {
          console.log("[test-mpv] state:", s);
          setState(s);
        }),
      );
      subs.push(
        mpv.addEndedListener(() => {
          console.log("[test-mpv] ended");
          setState("ended");
        }),
      );
      subs.push(
        mpv.addErrorListener((msg) => {
          console.error("[test-mpv] error:", msg);
          setError(msg);
        }),
      );
      subs.push(
        mpv.addTracksListener((audio, subtitle) => {
          console.log("[test-mpv] tracks:", { audio, subtitle });
        }),
      );
      listenersRef.current = subs;
      setState("created");
    } catch (e) {
      setError(String(e));
    }
  }

  function handleLoad() {
    if (!mpvRef.current) return;
    mpvRef.current.load(TEST_URL, {});
  }

  function handlePlay() {
    mpvRef.current?.play();
  }

  function handlePause() {
    mpvRef.current?.pause();
  }

  function handleRelease() {
    for (const l of listenersRef.current) l.remove();
    listenersRef.current = [];
    mpvRef.current?.release();
    mpvRef.current = null;
    setState("released");
    setPosition(0);
    setDuration(0);
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>MPV Audio Test</Text>
        <Text style={styles.subtitle}>Phase 3a — audio-only smoke test</Text>

        <View style={styles.status}>
          <Text style={styles.label}>State</Text>
          <Text style={styles.value}>{state}</Text>
        </View>
        <View style={styles.status}>
          <Text style={styles.label}>Position</Text>
          <Text style={styles.value}>
            {fmt(position)} / {fmt(duration)}
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.buttons}>
          <Btn label="Create" onPress={handleCreate} />
          <Btn label="Load" onPress={handleLoad} />
          <Btn label="Play" onPress={handlePlay} />
          <Btn label="Pause" onPress={handlePause} />
          <Btn label="Release" onPress={handleRelease} />
        </View>

        <Text style={styles.url} numberOfLines={2}>
          {TEST_URL}
        </Text>
      </View>
      <BackButton />
    </SafeAreaView>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
    >
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.lg },
  title: { color: colors.textPrimary, fontSize: fontSize.display, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  status: { flexDirection: "row", gap: spacing.md },
  label: { color: colors.textMuted, fontSize: fontSize.body, width: 80 },
  value: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  error: { color: colors.danger, fontSize: fontSize.body },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  btn: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  btnPressed: { opacity: 0.75 },
  btnLabel: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  url: { color: colors.textMuted, fontSize: fontSize.caption, marginTop: spacing.lg },
});
