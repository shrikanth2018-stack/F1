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

  const [center, setCenter] = useState({
    lat: initialRegion.latitude,
    lng: initialRegion.longitude,
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const onMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      onChange([...vertices, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
    },
    [vertices, onChange]
  );

  const handleSearch = async () => {
    const q = searchText.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`;
      const res = await fetch(url);
      const json = await res.json();
      const status: string = json?.status ?? 'UNKNOWN';
      const hit = json?.results?.[0]?.geometry?.location;

      if (status === 'OK' && hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
        const next = { lat: hit.lat, lng: hit.lng };
        setCenter(next);
        mapRef.current?.panTo(next);
        mapRef.current?.setZoom(15);
        return;
      }

      if (status === 'ZERO_RESULTS') setSearchError('No location found');
      else if (status === 'REQUEST_DENIED') setSearchError(`REQUEST_DENIED — enable Geocoding API on this key. ${json?.error_message ?? ''}`);
      else setSearchError(`${status}${json?.error_message ? ': ' + json.error_message : ''}`);
    } catch (err: any) {
      setSearchError(err?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  };

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
      {/* Search bar overlay — Geocoding API recenter */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8, zIndex: 2,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Search a place or area…"
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid #2d2d2d', background: 'rgba(26,26,26,0.9)',
            color: '#fff', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #38bdf8',
            background: 'rgba(26,26,26,0.9)', color: '#38bdf8',
            fontSize: 14, cursor: 'pointer',
          }}
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>
      {searchError && (
        <div style={{
          position: 'absolute', top: 54, left: 8, zIndex: 2,
          color: '#f87171', fontSize: 12,
          background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 4,
        }}>{searchError}</div>
      )}

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={13}
        options={{
          ...MAP_OPTIONS,
          styles: DARK_MAP_STYLE,
        }}
        onClick={onMapClick}
        onLoad={(map) => { mapRef.current = map; }}
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
