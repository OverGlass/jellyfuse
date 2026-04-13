// Trickplay thumbnail shown above the scrubber during drag.
// Crops a single tile from a sprite sheet image using the
// tile math from `trickplayTileFor`.
//
// Shows a gray skeleton while the tile sheet loads so there's
// never a blank flash during drag. Positioning is done by the
// parent (`previewAnchor` in PlayerScrubber) — this component
// just renders the tile at `trickplay.width × trickplay.height`.

import { trickplayTileFor, type TrickplayData } from "@jellyfuse/api";
import { colors, radius } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

interface Props {
  trickplay: TrickplayData;
  positionSeconds: number;
}

export function TrickplayThumbnail({ trickplay, positionSeconds }: Props) {
  const { sheetUrl, cropX, cropY } = trickplayTileFor(trickplay, positionSeconds);
  const { width, height } = trickplay;

  return (
    <View style={[styles.container, { width, height }]}>
      {/* Skeleton background — visible while image loads */}
      <View style={styles.skeleton} />

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
        transition={0}
      />
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
