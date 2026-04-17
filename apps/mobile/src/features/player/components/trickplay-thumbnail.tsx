// Trickplay thumbnail shown above the scrubber during drag.
// Crops a single tile from a sprite sheet image using the
// tile math from `trickplayTileFor`.
//
// Shows a gray skeleton while the tile sheet loads so there's
// never a blank flash during drag. Positioning is done by the
// parent (`previewAnchor` in PlayerScrubber) — this component
// just renders the tile at `trickplay.width × trickplay.height`.

import type { TrickplayData } from "@jellyfuse/api";
import { colors, radius } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

interface Props {
  trickplay: TrickplayData;
  progress: SharedValue<number>;
  duration: number;
}

// Crop offsets animate on the UI thread from the shared progress
// value. The sheet URL only re-renders when the tile index crosses
// into a new sprite sheet — rare compared to the 120Hz drag.
export function TrickplayThumbnail({ trickplay, progress, duration }: Props) {
  const { width, height, tileWidth, tileHeight, thumbnailCount, interval, sheetUrlTemplate } =
    trickplay;
  const tilesPerSheet = tileWidth * tileHeight;

  const [sheetIndex, setSheetIndex] = useState(0);

  useAnimatedReaction(
    () => {
      const positionSeconds = progress.value * duration;
      const tileIndex = Math.floor((positionSeconds * 1000) / interval);
      const clamped = Math.max(0, Math.min(tileIndex, thumbnailCount - 1));
      return Math.floor(clamped / tilesPerSheet);
    },
    (next, prev) => {
      if (next !== prev) runOnJS(setSheetIndex)(next);
    },
    [duration, interval, thumbnailCount, tilesPerSheet],
  );

  const cropStyle = useAnimatedStyle(() => {
    const positionSeconds = progress.value * duration;
    const tileIndex = Math.floor((positionSeconds * 1000) / interval);
    const clamped = Math.max(0, Math.min(tileIndex, thumbnailCount - 1));
    const indexInSheet = clamped % tilesPerSheet;
    const col = indexInSheet % tileWidth;
    const row = Math.floor(indexInSheet / tileWidth);
    return {
      left: -col * width,
      top: -row * height,
    };
  });

  const sheetUrl = sheetUrlTemplate.replace("{sheet}", String(sheetIndex));

  return (
    <View style={[styles.container, { width, height }]}>
      <View style={styles.skeleton} />

      <Animated.View
        style={[
          {
            width: tileWidth * width,
            height: tileHeight * height,
            position: "absolute",
          },
          cropStyle,
        ]}
      >
        <Image
          source={sheetUrl}
          style={{ width: tileWidth * width, height: tileHeight * height }}
          contentFit="none"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  skeleton: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
  },
});
