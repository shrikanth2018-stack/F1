/**
 * ZoneMap — native (iOS / Android)
 * Tap to add polygon vertices. react-native-maps.
 * Search bar uses Google Geocoding API to re-center the map.
 */

import React, { useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert } from 'react-native';
import MapView, { Polygon, Marker, MapPressEvent, Region } from 'react-native-maps';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface ZoneMapProps {
  vertices: { lat: number; lng: number }[];
  onChange: (vertices: { lat: number; lng: number }[]) => void;
  initialRegion: Region;
}

export function ZoneMap({ vertices, onChange, initialRegion }: ZoneMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  const mapCoords = vertices.map((v) => ({ latitude: v.lat, longitude: v.lng }));

  const onPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onChange([...vertices, { lat: latitude, lng: longitude }]);
  };

  const handleSearch = async () => {
    const q = searchText.trim();
    if (!q) return;
    setSearching(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`;
      const res = await fetch(url);
      const json = await res.json();
      const status: string = json?.status ?? 'UNKNOWN';
      const hit = json?.results?.[0]?.geometry?.location;

      if (status === 'OK' && hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
        mapRef.current?.animateToRegion({
          latitude: hit.lat,
          longitude: hit.lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }, 500);
        return;
      }

      // Surface Google's real status + message so API-key misconfig is visible.
      const googleMsg = json?.error_message ? `\n\n${json.error_message}` : '';
      if (status === 'ZERO_RESULTS') {
        Alert.alert('Not found', `No location matched "${q}".`);
      } else if (status === 'REQUEST_DENIED') {
        Alert.alert(
          'Geocoding API not enabled',
          `Google returned REQUEST_DENIED.${googleMsg}\n\n` +
          `In Google Cloud Console: enable "Geocoding API" on the project using key ${apiKey.slice(0, 8)}… and make sure the key's API restrictions include it.`
        );
      } else if (status === 'OVER_QUERY_LIMIT') {
        Alert.alert('Over quota', `Google rate limit hit.${googleMsg}`);
      } else {
        Alert.alert(`Search failed — ${status}`, googleMsg || 'Unexpected response from Google.');
      }
    } catch (err: any) {
      Alert.alert('Search failed', err?.message ?? 'Could not reach location service. Check connection.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={(m) => { mapRef.current = m; }}
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

      {/* Search bar overlay */}
      <View style={styles.searchBar}>
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
            : <ThemedText variant="small" color="mint">Search</ThemedText>
          }
        </TouchableOpacity>
      </View>

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
  searchBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(26,26,26,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
  },
  searchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
    backgroundColor: 'rgba(26,26,26,0.9)',
  },
  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    backgroundColor: Theme.colors.layout.overlayMid,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
