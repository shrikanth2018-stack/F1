/**
 * PinMap — native (iOS / Android)
 * Single draggable delivery pin. Tap anywhere on map to reposition.
 * Search bar uses Google Geocoding API (same as admin's ZoneMap).
 * GPS centering is handled by the parent via the latitude/longitude props.
 */

import React, { useRef, useState } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Keyboard } from 'react-native';
import MapView, { Marker, MapPressEvent, Region } from 'react-native-maps';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface PinMapProps {
  latitude: number | undefined;
  longitude: number | undefined;
  onLocationChange: (lat: number, lng: number) => void;
}

const DEFAULT_REGION: Region = {
  latitude: 14.3437,    // Siddapur, Uttara Kannada
  longitude: 74.8917,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export function PinMap({ latitude, longitude, onLocationChange }: PinMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  const region: Region =
    latitude != null && longitude != null
      ? { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : DEFAULT_REGION;

  const onPress = (e: MapPressEvent) => {
    const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
    onLocationChange(lat, lng);
  };

  const handleSearch = async () => {
    const q = searchText.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`;
      const res = await fetch(url);
      const json = await res.json();
      const status: string = json?.status ?? 'UNKNOWN';
      const hit = json?.results?.[0]?.geometry?.location;

      if (status === 'OK' && hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
        mapRef.current?.animateToRegion(
          { latitude: hit.lat, longitude: hit.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
          500,
        );
        // Also drop the pin at the search result so the address is captured immediately.
        onLocationChange(hit.lat, hit.lng);
        return;
      }

      const googleMsg = json?.error_message ? `\n\n${json.error_message}` : '';
      if (status === 'ZERO_RESULTS') {
        Alert.alert('Not found', `No location matched "${q}".`);
      } else {
        Alert.alert(`Search failed — ${status}`, googleMsg || 'Please try a different query.');
      }
    } catch (err: any) {
      Alert.alert('Search failed', err?.message ?? 'Could not reach location service.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={(m) => { mapRef.current = m; }}
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

      {/* Search bar overlay (top) */}
      <View style={styles.searchBar} pointerEvents="box-none">
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
          placeholder="Search a place or area…"
          placeholderTextColor={Theme.colors.text.muted}
          style={styles.searchInput}
          returnKeyType="search"
        />
        <TouchableOpacity onPress={handleSearch} disabled={searching} style={styles.searchBtn} activeOpacity={0.7}>
          {searching
            ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
            : <ThemedText variant="small" color="mint">Search</ThemedText>}
        </TouchableOpacity>
      </View>

      {/* Hint (bottom) */}
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
  searchBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 2,
    paddingVertical: 8,
  },
  searchBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    backgroundColor: Theme.colors.layout.overlayMid,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
