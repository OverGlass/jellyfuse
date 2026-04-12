// Trickplay thumbnail shown above the scrubber during drag.
// Crops a single tile from a sprite sheet image using the
// tile math from `trickplayTileFor`.

import { trickplayTileFor, type TrickplayData } from "@jellyfuse/api";
import { colors, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

interface Props {
  trickplay: TrickplayData;
  positionSeconds: number;
  /** Horizontal offset to center the thumbnail on the scrub position. */
  offsetX: number;
}

export function TrickplayThumbnail({ trickplay, positionSeconds, offsetX }: Props) {
  const { sheetUrl, cropX, cropY } = trickplayTileFor(trickplay, positionSeconds);
  const { width, height } = trickplay;

  // Clamp so the thumbnail doesn't go off-screen
  const clampedLeft = Math.max(0, offsetX - width / 2);

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height,
          left: clampedLeft,
        },
      ]}
    >
      <Image
        source={sheetUrl}
        style={{
          width: trickplay.tileWidth * width,
          height: trickplay.tileHeight * height,
          position: "absolute",
          left: -cropX,
          top: -cropY,
        }}
        contentFit="none"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: "100%",
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
});
