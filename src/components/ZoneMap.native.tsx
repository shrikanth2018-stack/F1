/**
 * ZoneMap — native (iOS / Android)
 * Tap to add polygon vertices. react-native-maps.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Polygon, Marker, MapPressEvent, Region } from 'react-native-maps';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface ZoneMapProps {
  vertices: { lat: number; lng: number }[];
  onChange: (vertices: { lat: number; lng: number }[]) => void;
  initialRegion: Region;
}

export function ZoneMap({ vertices, onChange, initialRegion }: ZoneMapProps) {
  const mapCoords = vertices.map((v) => ({ latitude: v.lat, longitude: v.lng }));

  const onPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onChange([...vertices, { lat: latitude, lng: longitude }]);
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={initialRegion}
        onPress={onPress}
      >
        {mapCoords.length >= 3 && (
          <Polygon
            coordinates={mapCoords}
            fillColor="rgba(56,189,248,0.2)"
            strokeColor={Theme.colors.text.mint}
            strokeWidth={2}
          />
        )}
        {mapCoords.map((c, i) => (
          <Marker key={i} coordinate={c} anchor={{ x: 0.5, y: 0.5 }} pinColor={Theme.colors.text.mint} />
        ))}
      </MapView>

      <View style={styles.hint} pointerEvents="none">
        <ThemedText variant="small" color="muted" style={styles.hintText}>
          {vertices.length < 3
            ? `Tap to add points  (${vertices.length}/3 minimum)`
            : `${vertices.length} points  ·  polygon closed`}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 320, position: 'relative' },
  map: { flex: 1 },
  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
