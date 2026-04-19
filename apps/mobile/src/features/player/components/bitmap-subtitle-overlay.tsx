// Renders bitmap-subtitle events (PGS / VobSub / DVB) on a sibling
// layer above the video. Phase 3 of the native video pipeline
// migration — see docs/native-video-pipeline.md. Text subs are handled
// by `subtitle-overlay.tsx`; this one consumes the `imageUri` data URI
// coming off `addBitmapSubtitleListener`.
//
// Positioning: rects ship in source-video coordinates (e.g. 1920×1080
// for Titanic's PGS). We compute the letterboxed video rect inside the
// container and map the sub rect into on-screen space. Default source
// is 1080p which covers every HD Blu-ray rip; 4K rips come through as
// 3840×2160 PGS and the player screen should pass the actual dims from
// mpv's `width` / `height` once the first frame lands.

import type { MpvBitmapSubtitle } from "@jellyfuse/native-mpv";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

interface Props {
  /** Latest event from `addBitmapSubtitleListener`, or `null` to hide. */
  event: MpvBitmapSubtitle | null;
  /** Source video width in pixels. Defaults to 1920 (HD Blu-ray PGS). */
  sourceWidth?: number;
  /** Source video height in pixels. Defaults to 1080. */
  sourceHeight?: number;
}

export function BitmapSubtitleOverlay({ event, sourceWidth = 1920, sourceHeight = 1080 }: Props) {
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );

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
