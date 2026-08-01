/**
 * 1stOne F1 — Catalogue photo tile
 *
 * The one place a catalogue item's picture is rendered — customer Home rows
 * (food and essentials) and both admin managers use it, so a photo looks
 * identical wherever an admin checks their work.
 *
 * WHY A ROUNDED TILE. The supplied icon sets are rendered on pure black
 * (#000000); the app background is #151515. Those are close but not equal, so
 * a borderless photo would show a faintly darker square. A rounded rect with
 * a brightened edge reads as a deliberate photo tile instead, and — the
 * reason it was chosen over cutting the images out to transparency — it works
 * identically for a phone photo of real food, which can never have an alpha
 * channel. The treatment does not depend on what is behind it.
 *
 * FALLBACK. No photo yet → the item's Ionicon, centred in a tile of exactly
 * the same size. Photos are added gradually and vendor items will not have
 * one until the listing gate lands, so mixed rows are the normal state;
 * keeping the footprint identical means the list never reflows and a gap
 * looks intentional rather than broken.
 *
 * Fixed width/height on the Image is what prevents layout shift as photos
 * stream in (the React Native equivalent of declaring dimensions on an
 * <img> — there is no loading="lazy" here; deferring offscreen work would
 * mean SectionList windowing, deliberately not done at this catalogue size).
 */

import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { photoUrl, type PhotoSource, type PhotoBucket } from '../utils/catalogPhoto';

interface CatalogPhotoThumbProps {
  /** Which catalogue's bucket this item's photo lives in. */
  bucket: PhotoBucket;
  item: PhotoSource;
  /** Rendered edge length in points. */
  size: number;
  /** Pixel width requested from the resizing endpoint. */
  requestPx: number;
  /** Ionicon shown when the item has no photo. */
  fallbackIcon: keyof typeof Ionicons.glyphMap;
}

export function CatalogPhotoThumb({
  bucket,
  item,
  size,
  requestPx,
  fallbackIcon,
}: CatalogPhotoThumbProps) {
  // A broken URL must degrade to the icon, not to an empty box — the photo is
  // decoration, the row still has to be orderable.
  const [failed, setFailed] = useState(false);
  const url = photoUrl(bucket, item, requestPx);

  // Forget an earlier failure whenever the URL changes. Without this one bad
  // load pinned the tile to the fallback icon for as long as the component
  // lived — including after the admin replaced the photo with a good one (the
  // ?v= stamp changes, so it IS a different URL), and for whatever item took
  // this slot next when the list re-rendered with different data.
  useEffect(() => setFailed(false), [url]);

  const uri = failed ? null : url;

  const box = [styles.tile, { width: size, height: size }];

  if (!uri) {
    return (
      <View style={[...box, styles.fallback]}>
        <Ionicons
          name={fallbackIcon}
          size={Math.round(size * 0.42)}
          color={Theme.colors.text.mint}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={box}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: Theme.components.inputRadius,
    // Full pixel, not hairline — a hairline at 0.25 opacity all but vanishes
    // on a 3x screen, which defeats the point of brightening it.
    borderWidth: 1,
    borderColor: Theme.colors.layout.photoEdge,
    backgroundColor: Theme.colors.background.secondary,
    flexShrink: 0,
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
