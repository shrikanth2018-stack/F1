/**
 * 1stOne F1 — Square crop contract
 *
 * The crop step decides what customers actually see in a tile, and it behaves
 * differently per platform for good reasons — native leans on the OS cropper,
 * web has to provide one. What must NOT vary is the contract around it: a
 * cancel is a cancel, a missing host degrades instead of blocking, and the
 * ratio is 1:1 everywhere.
 *
 * Jest resolves the NATIVE build here (testEnvironment: node), so these pin
 * the pass-through half plus the shared contract. The web dialog's canvas work
 * has no coverage for the same reason imageResize's does not — there is no
 * canvas in this environment.
 */

import { cropToSquare, _registerCropHandler, PHOTO_ASPECT } from '@/utils/photoCrop';
import type { PickedPhoto } from '@/utils/photoFormat';

const photo: PickedPhoto = {
  uri: 'file:///a.jpg',
  base64: 'AAECAwQF',
  mimeType: 'image/jpeg',
};

describe('PHOTO_ASPECT', () => {
  it('is square', () => {
    // The tile, the crop and the render endpoint's resize=cover all assume
    // 1:1. If this ever changes, all three change together or photos start
    // arriving letterboxed or centre-cropped by something nobody chose.
    expect(PHOTO_ASPECT).toBe(1);
  });
});

describe('cropToSquare on native', () => {
  it('passes the photo straight through', async () => {
    // expo-image-picker runs the OS cropper with aspect [1,1] before it
    // returns, so the image is already square. Re-cropping would be a second
    // lossy pass over an image that is already correct.
    await expect(cropToSquare(photo)).resolves.toEqual(photo);
  });

  it('ignores a registered handler', async () => {
    // Native must not route through the web dialog even if something
    // registers one — the platform branch is the guarantee, not the absence
    // of a handler.
    const handler = jest.fn().mockResolvedValue(null);
    _registerCropHandler(handler);

    await expect(cropToSquare(photo)).resolves.toEqual(photo);
    expect(handler).not.toHaveBeenCalled();
  });

  it('never rejects', async () => {
    // pickCatalogPhoto awaits this between the picker and the upload. A throw
    // here would surface as "could not set the photo" for a photo that was
    // perfectly fine.
    await expect(cropToSquare({ uri: '', base64: '', mimeType: '' })).resolves.toBeTruthy();
  });
});
