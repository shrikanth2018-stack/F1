/**
 * 1stOne F1 — catalogue photo upload/remove guarantees
 *
 * Screens carry no coverage in this repo, so the properties that decide
 * whether a photo actually reaches a customer are pinned here.
 *
 * The one that matters most: an UPDATE that RLS refuses is NOT an error. It
 * matches zero rows and returns success. Before this was checked, an admin
 * editing an item outside their branch uploaded the file, saw no message, and
 * watched nothing happen — and "remove photo" reported success while the
 * picture stayed on the customer menu. Both are asserted below, because
 * neither would show up in a type check or in any screen test.
 */

import {
  uploadCatalogPhoto,
  removeCatalogPhoto,
  assertUploadablePhoto,
} from '@/utils/catalogPhotoUpload';
import { PHOTO_BUCKET, type PickedPhoto } from '@/utils/catalogPhoto';

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockUpdate = jest.fn();
const mockCaptureError = jest.fn();

/**
 * Captures what `.update()` was given, and what `.select()` hands back.
 *
 * The `mock` prefix is required, not stylistic: babel-plugin-jest-hoist lifts
 * jest.mock() factories above every other statement, so a factory may only
 * close over variables whose names begin with `mock`.
 */
let mockUpdateResult: { data: unknown; error: unknown };
let mockUpdatePayload: Record<string, unknown> | null = null;

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => mockUpload(bucket, ...args),
        remove: (...args: unknown[]) => mockRemove(bucket, ...args),
      }),
    },
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        mockUpdatePayload = payload;
        mockUpdate(table, payload);
        return {
          eq: () => ({
            select: () => Promise.resolve(mockUpdateResult),
          }),
        };
      },
    }),
  },
}));

jest.mock('@/utils/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('base64-arraybuffer', () => ({
  decode: (s: string) => new ArrayBuffer(s.length),
}));

const jpeg: PickedPhoto = { uri: 'file:///a.jpg', base64: 'AAECAwQF', mimeType: 'image/jpeg' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdatePayload = null;
  mockUpdateResult = { data: [{ id: 12 }], error: null };
  mockUpload.mockResolvedValue({ error: null });
  mockRemove.mockResolvedValue({ error: null });
});

describe('assertUploadablePhoto', () => {
  it('accepts the formats the buckets allow', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(() => assertUploadablePhoto({ ...jpeg, mimeType })).not.toThrow();
    }
  });

  it('rejects HEIC by name, and says how to fix it', () => {
    // The web picker hands back whatever the file really is, and a Mac or
    // iPhone photo library is full of HEIC. It used to be uploaded declared as
    // JPEG, which the bucket accepted and the render endpoint then refused.
    expect(() => assertUploadablePhoto({ ...jpeg, mimeType: 'image/heic' })).toThrow(/HEIC/);
    expect(() => assertUploadablePhoto({ ...jpeg, mimeType: 'image/heic' })).toThrow(/JPG/);
  });

  it('rejects a photo past the bucket size limit', () => {
    // 8 MB limit; base64 carries 3 bytes per 4 characters.
    const tooBig = { ...jpeg, base64: 'A'.repeat(12 * 1024 * 1024) };
    expect(() => assertUploadablePhoto(tooBig)).toThrow(/limit is/);
  });

  it('allows a photo just under the limit', () => {
    const justUnder = { ...jpeg, base64: 'A'.repeat(10 * 1024 * 1024) };
    expect(() => assertUploadablePhoto(justUnder)).not.toThrow();
  });
});

describe('uploadCatalogPhoto', () => {
  it('throws when the row update affects nothing', async () => {
    // What RLS refusal looks like over PostgREST: no error, no rows.
    mockUpdateResult = { data: [], error: null };

    await expect(uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, jpeg)).rejects.toThrow(
      /could not be updated/i,
    );
  });

  it('stamps image_path and image_updated_at together', async () => {
    await uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, jpeg);

    // Both or neither: the path alone gives a URL that never changes, so the
    // CDN would serve the previous photo for the whole cache lifetime.
    expect(mockUpdatePayload).toMatchObject({ image_path: 'menu-photos/12.jpg' });
    expect(typeof mockUpdatePayload?.image_updated_at).toBe('string');
  });

  it('uploads with the real content type, not a hardcoded one', async () => {
    await uploadCatalogPhoto(PHOTO_BUCKET.essentials, 3, { ...jpeg, mimeType: 'image/png' });

    expect(mockUpload).toHaveBeenCalledWith(
      'essentials-photos',
      '3.jpg',
      expect.anything(),
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    );
  });

  it('upserts to a fixed key so an item cannot collect a second photo', async () => {
    await uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, jpeg);
    await uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, jpeg);

    const keys = mockUpload.mock.calls.map((c) => c[1]);
    expect(keys).toEqual(['12.jpg', '12.jpg']);
  });

  it('does not touch the row when the file upload failed', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network' } });

    await expect(uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, jpeg)).rejects.toThrow('network');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses an unusable photo before uploading anything', async () => {
    // Create screens hold a picked photo in state across a save, so the pick
    // and the upload can be a long way apart.
    await expect(
      uploadCatalogPhoto(PHOTO_BUCKET.menu, 12, { ...jpeg, mimeType: 'image/heic' }),
    ).rejects.toThrow(/HEIC/);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('removeCatalogPhoto', () => {
  it('clears the row before deleting the file', async () => {
    const order: string[] = [];
    mockUpdate.mockImplementation(() => order.push('row'));
    mockRemove.mockImplementation(() => {
      order.push('file');
      return Promise.resolve({ error: null });
    });

    await removeCatalogPhoto(PHOTO_BUCKET.menu, 12);

    // Row first: it is the write RLS can refuse, so a refusal must change
    // nothing. The old order deleted the file and only then discovered it was
    // not allowed to clear the row, leaving the item pointing at nothing.
    expect(order).toEqual(['row', 'file']);
  });

  it('throws and leaves the file alone when the row update affects nothing', async () => {
    mockUpdateResult = { data: [], error: null };

    await expect(removeCatalogPhoto(PHOTO_BUCKET.menu, 12)).rejects.toThrow(
      /could not be updated/i,
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('reports a file it could not delete instead of claiming success', async () => {
    // storage.remove() RESOLVES with an error field rather than rejecting, so
    // the previous `.catch()` never ran and the failure vanished. These
    // buckets are public with guessable keys, so a leftover file stays
    // fetchable by anyone who knows the item id.
    mockRemove.mockResolvedValue({ error: { message: 'not allowed' } });

    const result = await removeCatalogPhoto(PHOTO_BUCKET.essentials, 3);

    expect(result).toEqual({ fileRemoved: false });
    expect(mockCaptureError).toHaveBeenCalled();
  });

  it('reports success when both halves worked', async () => {
    await expect(removeCatalogPhoto(PHOTO_BUCKET.menu, 12)).resolves.toEqual({
      fileRemoved: true,
    });
    expect(mockUpdatePayload).toEqual({ image_path: null, image_updated_at: null });
  });
});
