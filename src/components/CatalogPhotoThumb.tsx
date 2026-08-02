/**
 * 1stOne F1 — Catalogue photo tile
 *
 * The one place a catalogue item's picture is rendered — customer Home rows
 * (food and essentials), both admin managers, the vendor's My Store and the
 * listing review queue — so a photo looks identical wherever it is checked.
 *
 * THREE STATES, ONE FOOTPRINT. No photo, loading, loaded. All three occupy
 * exactly the same square, so a list never reflows as pictures stream in and
 * a gap always looks deliberate rather than broken. That is also why the size
 * is a required prop rather than something inferred from the image.
 *
 * WHY A ROUNDED TILE. The supplied icon sets are rendered on pure black
 * (#000000); the app background is #151515. Those are close but not equal, so
 * a borderless photo would show a faintly darker square. A rounded rect with
 * a brightened edge reads as a deliberate photo tile instead, and — the
 * reason it was chosen over cutting the images out to transparency — it works
 * identically for a phone photo of real food, which can never have an alpha
 * channel. The treatment does not depend on what is behind it.
 *
 * FALLBACK. No photo yet → the item's Ionicon, centred. Photos are added
 * gradually and a vendor listing has none until it is approved, so mixed rows
 * are the normal state.
 *
 * LOADING. The same tile with the icon dimmed, until the image reports back.
 * Deliberately a skeleton rather than a blur-up preview: a blur-up needs
 * either a second network request per tile or a blurhash stored on the row,
 * and the thumbnails here are ~3-5 KB WebP — small enough that the placeholder
 * would routinely outlive its usefulness before it earned the extra fetch.
 * Revisit if a full-bleed detail image ever lands, where the trade changes.
 *
 * Fixed width/height on the Image is what prevents layout shift (the React
 * Native equivalent of declaring dimensions on an <img> — there is no
 * loading="lazy" here; react-native-web does not expose it, and the RN
 * equivalent is list windowing, deliberately not done at this catalogue size).
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
  /** Ionicon shown when the item has no photo, and while one loads. */
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
  const [loaded, setLoaded] = useState(false);
  const url = photoUrl(bucket, item, requestPx);

  // Forget an earlier failure, and go back to the loading state, whenever the
  // URL changes. Without this one bad load pinned the tile to the fallback
  // icon for as long as the component lived — including after the admin
  // replaced the photo with a good one (the ?v= stamp changes, so it IS a
  // different URL), and for whatever item took this slot next when the list
  // re-rendered with different data.
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [url]);

  const uri = failed ? null : url;
  const box = [styles.tile, { width: size, height: size }];
  const icon = Math.round(size * 0.42);

  // No photo at all, or one that could not be fetched.
  if (!uri) {
    return (
      <View style={[...box, styles.centre]}>
        <Ionicons name={fallbackIcon} size={icon} color={Theme.colors.text.mint} />
      </View>
    );
  }

  return (
    <View style={[...box, styles.centre]}>
      {/* Skeleton, shown until the image reports it has decoded. Sits BEHIND
          the image rather than being swapped for it, so there is no frame
          where the tile is empty between the two. */}
      {!loaded ? (
        <Ionicons
          name={fallbackIcon}
          size={icon}
          color={Theme.colors.text.mint}
          style={styles.skeletonIcon}
        />
      ) : null}
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, !loaded && styles.hidden]}
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </View>
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
    // Keeps the absolutely-positioned image inside the rounded corners.
    overflow: 'hidden',
  },
  centre: { alignItems: 'center', justifyContent: 'center' },
  // Dimmer than the no-photo state, so "still arriving" reads differently
  // from "there isn't one" rather than the two being indistinguishable.
  skeletonIcon: { opacity: 0.35 },
  // Held invisible rather than unmounted: unmounting would cancel the decode
  // and onLoad would never fire.
  hidden: { opacity: 0 },
});
