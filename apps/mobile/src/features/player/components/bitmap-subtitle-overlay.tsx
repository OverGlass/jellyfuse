// Renders bitmap-subtitle events (PGS / VobSub / DVB) on a sibling
// layer above the video. Phase 3 of the native video pipeline
// migration — see docs/native-video-pipeline.md. Text subs are handled
// by `subtitle-overlay.tsx`; this one consumes the `imageUri` data URI
// coming off `addBitmapSubtitleListener`.
//
// Subscribes to the mpv listeners directly so caption changes re-render
// ONLY this component — routing the event through `useMpvPlayer` state
// would re-render the whole player screen (controls, overlay, picker,
// etc.) on every PGS transition.
//
// Positioning: rects ship in source-video coordinates (e.g. 1920×1080
// for Titanic's PGS, 3840×2160 for 4K Blu-ray, 720×480 for DVD VobSub).
// Each `MpvBitmapSubtitle` event now carries the composition grid it was
// authored against (`sourceWidth` / `sourceHeight`, pulled straight off
// the ffmpeg codec context), so we letterbox against the real source
// resolution instead of guessing. The 1920×1080 fallback only kicks in
// if the codec didn't publish a size — enough to avoid a divide-by-zero
// while we wait for the next event.

import type { MpvBitmapSubtitle, NativeMpv } from "@jellyfuse/native-mpv";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";

interface Props {
  /** Active mpv player instance; `null` before attach or after teardown. */
  mpv: NativeMpv | null;
}

export function BitmapSubtitleOverlay({ mpv }: Props) {
  const [event, setEvent] = useState<MpvBitmapSubtitle | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    if (!mpv) return;
    const show = mpv.addBitmapSubtitleListener(setEvent);
    const clear = mpv.addBitmapSubtitleClearListener(() => setEvent(null));
    return () => {
      show.remove();
      clear.remove();
    };
  }, [mpv]);

  if (!event || !containerSize) {
    // Keep the container mounted even when idle so onLayout fires once
    // and we don't miss the first rect after a caption comes on screen.
    return (
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setContainerSize({ width, height });
        }}
      />
    );
  }

  // Letterbox math — aspectFill the source into the container while
  // preserving AR. If the container is wider than the source AR we get
  // vertical bars; taller, horizontal bars. Bitmap subs render inside
  // the video rect, so the same transform maps their coords.
  const sourceWidth = event.sourceWidth > 0 ? event.sourceWidth : 1920;
  const sourceHeight = event.sourceHeight > 0 ? event.sourceHeight : 1080;
  const scale = Math.min(containerSize.width / sourceWidth, containerSize.height / sourceHeight);
  const displayedWidth = sourceWidth * scale;
  const displayedHeight = sourceHeight * scale;
  const offsetX = (containerSize.width - displayedWidth) / 2;
  const offsetY = (containerSize.height - displayedHeight) / 2;

  const left = offsetX + event.x * scale;
  const top = offsetY + event.y * scale;
  const width = event.width * scale;
  const height = event.height * scale;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w !== containerSize.width || h !== containerSize.height) {
          setContainerSize({ width: w, height: h });
        }
      }}
    >
      <Image
        source={{ uri: event.imageUri }}
        style={{ position: "absolute", left, top, width, height }}
        // PGS rects can overlap frame-to-frame; disable the default
        // fade-in so captions snap instantly to their new content.
        fadeDuration={0}
      />
    </View>
  );
}
