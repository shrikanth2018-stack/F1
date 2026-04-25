/**
 * PinMap — native (iOS / Android)
 * Single draggable delivery pin. Tap anywhere on map to reposition.
 * GPS centering is handled by the parent via the latitude/longitude props.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, MapPressEvent, Region } from 'react-native-maps';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface PinMapProps {
  latitude: number | undefined;
  longitude: number | undefined;
  onLocationChange: (lat: number, lng: number) => void;
}

const DEFAULT_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

export function PinMap({ latitude, longitude, onLocationChange }: PinMapProps) {
  const region: Region =
    latitude != null && longitude != null
      ? { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : DEFAULT_REGION;

  const onPress = (e: MapPressEvent) => {
    const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
    onLocationChange(lat, lng);
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        onPress={onPress}
      >
        {latitude != null && longitude != null && (
          <Marker
            coordinate={{ latitude, longitude }}
            draggable
            onDragEnd={(e) => {
              const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
              onLocationChange(lat, lng);
            }}
            pinColor={Theme.colors.text.mint}
          />
        )}
      </MapView>

      <View style={styles.hint} pointerEvents="none">
        <ThemedText variant="small" color="muted" style={styles.hintText}>
          {latitude != null
            ? 'Drag pin or tap to adjust delivery location'
            : 'Tap map to set delivery location'}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 220, position: 'relative' },
  map: { flex: 1 },
  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    backgroundColor: Theme.colors.layout.overlayMid,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
