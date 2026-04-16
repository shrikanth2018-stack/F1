/**
 * PinMap — web
 * Single draggable delivery pin via @react-google-maps/api.
 * Click anywhere on map to reposition.
 */

import React from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';

export interface PinMapProps {
  latitude: number | undefined;
  longitude: number | undefined;
  onLocationChange: (lat: number, lng: number) => void;
}

const containerStyle = { width: '100%', height: '220px' };

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  styles: DARK_MAP_STYLE,
};

export function PinMap({ latitude, longitude, onLocationChange }: PinMapProps) {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';
  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: apiKey });

  const center =
    latitude != null && longitude != null
      ? { lat: latitude, lng: longitude }
      : DEFAULT_CENTER;

  const zoom = latitude != null ? 16 : 5;

  const onMapClick = (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    onLocationChange(e.latLng.lat(), e.latLng.lng());
  };

  if (loadError) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#94a3b8', fontSize: 13 }}>
        Failed to load Google Maps
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', color: '#94a3b8', fontSize: 13 }}>
        Loading map…
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        options={MAP_OPTIONS as any}
        onClick={onMapClick}
      >
        {latitude != null && longitude != null && (
          <Marker
            position={{ lat: latitude, lng: longitude }}
            draggable
            onDragEnd={(e: google.maps.MapMouseEvent) => {
              if (e.latLng) onLocationChange(e.latLng.lat(), e.latLng.lng());
            }}
          />
        )}
      </GoogleMap>

      <div style={{
        position: 'absolute', bottom: 10, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.6)', color: '#94a3b8',
          padding: '4px 12px', borderRadius: 10, fontSize: 12,
        }}>
          {latitude != null
            ? 'Drag pin or click to adjust delivery location'
            : 'Click map to set delivery location'}
        </span>
      </div>
    </div>
  );
}

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
