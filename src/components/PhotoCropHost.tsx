/**
 * 1stOne F1 — Square crop dialog (WEB implementation)
 *
 * Platform split: `PhotoCropHost.native.tsx` renders nothing, because
 * `expo-image-picker` already runs the OS cropper on a phone. This is the web
 * build, where the picker silently ignores `allowsEditing` and `aspect` and a
 * photo would otherwise be uploaded exactly as it came off disk.
 *
 * Mounted once at app root next to DialogHost, and registers a handler with
 * photoCrop.ts, so callers get a promise instead of having to render a modal.
 * That is what keeps `pickCatalogPhoto` one async call and leaves every picker
 * call site — four admin screens and My Store — untouched.
 *
 * `react-easy-crop` does the gesture work: drag to reposition, scroll or pinch
 * to zoom, aspect locked to 1:1. It is imported HERE and nowhere else, so the
 * native bundle never sees a react-dom dependency.
 *
 * The crop is rendered through a canvas rather than trusting the library's
 * preview — react-easy-crop reports the selected region in source pixels and
 * leaves producing the image to the caller, which is the right split: it also
 * lets the output be capped at MAX_OUTPUT so a 6000px camera file does not
 * become a 6000px square.
 *
 * Deliberately plain DOM. This dialog only ever renders on web, so styling it
 * through react-native-web's abstraction would buy nothing and cost the
 * control needed for a full-bleed cropping surface.
 */

import React, { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Theme } from '../theme';
import { _registerCropHandler, PHOTO_ASPECT } from '../utils/photoCrop';
import type { PickedPhoto } from '../utils/photoFormat';

/**
 * Longest edge of the cropped output, in pixels.
 *
 * Matches MAX_EDGE in imageResize.ts. The crop runs BEFORE the resize step, so
 * without a cap here a large camera file would be drawn at full size into a
 * canvas first — briefly holding a very large bitmap in memory on a tab that
 * may not have it to spare.
 */
const MAX_OUTPUT = 1000;

/** JPEG quality for the cropped output. Matches imageResize.ts. */
const QUALITY = 0.7;

interface Pending {
  photo: PickedPhoto;
  resolve: (result: PickedPhoto | null) => void;
}

export function PhotoCropHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);

  React.useEffect(() => {
    _registerCropHandler(
      (photo: PickedPhoto) =>
        new Promise<PickedPhoto | null>((resolve) => {
          setCrop({ x: 0, y: 0 });
          setZoom(1);
          setAreaPixels(null);
          setPending({ photo, resolve });
        }),
    );
  }, []);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  const finish = (result: PickedPhoto | null) => {
    pending?.resolve(result);
    setPending(null);
    setWorking(false);
  };

  const handleConfirm = async () => {
    if (!pending || !areaPixels) return;
    setWorking(true);
    try {
      const cropped = await renderCrop(pending.photo, areaPixels);
      finish(cropped);
    } catch {
      // A failed crop must not lose the picked photo — fall through with the
      // original. resize=cover still squares it on delivery, so the customer
      // sees a correct tile; only the choice of WHICH square is lost.
      finish(pending.photo);
    }
  };

  if (!pending) return null;

  return (
    <div style={S.backdrop}>
      <div style={S.sheet}>
        <div style={S.title}>Crop to a square</div>
        <div style={S.hint}>
          Drag to reposition, scroll or pinch to zoom. Customers see this square.
        </div>

        <div style={S.cropArea}>
          <Cropper
            image={pending.photo.uri}
            crop={crop}
            zoom={zoom}
            aspect={PHOTO_ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            showGrid
          />
        </div>

        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={S.zoom}
          aria-label="Zoom"
        />

        <div style={S.actions}>
          <button style={S.cancel} onClick={() => finish(null)} disabled={working}>
            Cancel
          </button>
          <button style={S.confirm} onClick={handleConfirm} disabled={working || !areaPixels}>
            {working ? 'Cropping…' : 'Use this square'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Draw the selected region to a canvas and hand back a fresh PickedPhoto.
 *
 * `areaPixels` is in SOURCE pixel coordinates, which is why the source image
 * is decoded again here rather than reusing anything the cropper rendered.
 */
async function renderCrop(photo: PickedPhoto, area: Area): Promise<PickedPhoto> {
  const img = await loadImage(photo.uri);

  const size = Math.min(MAX_OUTPUT, Math.round(Math.min(area.width, area.height)));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');

  // A transparent PNG would otherwise flatten onto black once encoded as
  // JPEG. White is the safer default for a product photo; a photo with no
  // alpha is unaffected. Same reasoning as imageResize.ts.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0, 0, size, size,
  );

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('could not encode crop');

  // Always JPEG out of the canvas, whatever went in — so the type is
  // restamped, or the upload would declare the original type for these bytes.
  return { uri: dataUrl, base64, mimeType: 'image/jpeg' };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode picked image'));
    img.src = src;
  });
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: Theme.colors.layout.overlayHeavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16,
  },
  sheet: {
    width: 'min(440px, 100%)',
    background: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: 16,
    fontFamily: Theme.typography.fontFamily,
    boxSizing: 'border-box',
  },
  title: {
    color: Theme.colors.text.primary,
    fontSize: Theme.typography.sizes.subtitle,
    marginBottom: 4,
  },
  hint: {
    color: Theme.colors.text.muted,
    fontSize: Theme.typography.sizes.small + 2,
    marginBottom: 12,
  },
  // Square, matching the crop and the tile it ends up in.
  cropArea: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    background: Theme.colors.layout.black,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
  },
  zoom: { width: '100%', marginTop: 14, accentColor: Theme.colors.text.mint },
  actions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  cancel: {
    background: 'none',
    border: 'none',
    color: Theme.colors.text.muted,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    cursor: 'pointer',
    padding: 8,
  },
  confirm: {
    background: 'none',
    border: 'none',
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    cursor: 'pointer',
    padding: 8,
  },
};
