/**
 * ZoneMap — web
 * Click to add polygon vertices. @react-google-maps/api + DrawingManager.
 * The .native.tsx sibling handles iOS/Android — Metro/webpack picks the right one.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  GoogleMap,
  useJsApiLoader,
  DrawingManager,
  Polygon,
  Marker,
} from '@react-google-maps/api';
type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const LIBRARIES: ('drawing')[] = ['drawing'];

export interface ZoneMapProps {
  vertices: { lat: number; lng: number }[];
  onChange: (vertices: { lat: number; lng: number }[]) => void;
  initialRegion: Region;
}

const containerStyle = { width: '100%', height: '400px' };

const MAP_OPTIONS = {
  disableDefaultUI: false,
  clickableIcons: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
};

export function ZoneMap({ vertices, onChange, initialRegion }: ZoneMapProps) {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES,
  });

  const center = {
    lat: initialRegion.latitude,
    lng: initialRegion.longitude,
  };

  const onMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      onChange([...vertices, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
    },
    [vertices, onChange]
  );

  if (loadError) {
    return (
      <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#94a3b8' }}>
        Failed to load Google Maps
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#94a3b8' }}>
        Loading map…
      </div>
    );
  }

  const polygonPath = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));

  return (
    <div style={{ position: 'relative' }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={13}
        options={{
          ...MAP_OPTIONS,
          styles: DARK_MAP_STYLE,
        }}
        onClick={onMapClick}
      >
        {polygonPath.length >= 3 && (
          <Polygon
            paths={polygonPath}
            options={{
              fillColor: 'rgba(56,189,248,0.2)',
              strokeColor: '#38bdf8',
              strokeWeight: 2,
            }}
          />
        )}
        {polygonPath.map((p, i) => (
          <Marker
            key={i}
            position={p}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: '#38bdf8',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 1.5,
            }}
          />
        ))}
      </GoogleMap>

      <div style={{
        position: 'absolute', bottom: 12, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.6)', color: '#94a3b8',
          padding: '4px 12px', borderRadius: 10, fontSize: 12,
        }}>
          {vertices.length < 3
            ? `Click map to add points  (${vertices.length}/3 minimum)`
            : `${vertices.length} points  ·  polygon closed`}
        </span>
      </div>
    </div>
  );
}

// Dark map style matching app theme
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d2d' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1a2e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
