/**
 * 1stOne F1 — BannerCarousel
 *
 * Auto-scrolling horizontal banner at top of HomeScreen.
 * Images fetched from Supabase Storage 'banners' bucket.
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Image,
  FlatList,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { Theme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_WIDTH = SCREEN_WIDTH - Theme.spacing.md * 2;
const BANNER_HEIGHT = 140;

interface BannerItem {
  id: number;
  image_url: string;
}

interface BannerCarouselProps {
  banners: BannerItem[];
}

export function BannerCarousel({ banners }: BannerCarouselProps) {
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;

    const timer = setInterval(() => {
      const nextIndex = (currentIndex + 1) % banners.length;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    }, 4000);

    return () => clearInterval(timer);
  }, [currentIndex, banners.length]);

  if (banners.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={banners}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id.toString()}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / BANNER_WIDTH
          );
          setCurrentIndex(index);
        }}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.image_url }}
            style={styles.banner}
            resizeMode="cover"
          />
        )}
        getItemLayout={(_, index) => ({
          length: BANNER_WIDTH,
          offset: BANNER_WIDTH * index,
          index,
        })}
      />

      {banners.length > 1 && (
        <View style={styles.dots}>
          {banners.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Theme.spacing.sm,
    alignItems: 'center',
  },
  banner: {
    width: BANNER_WIDTH,
    height: BANNER_HEIGHT,
    borderRadius: Theme.components.inputRadius,
  },
  dots: {
    flexDirection: 'row',
    marginTop: Theme.spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Theme.colors.text.muted,
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: Theme.colors.action.primary,
    width: 18,
  },
});
