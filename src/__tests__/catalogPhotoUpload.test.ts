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
  pickCatalogPhoto,
  uploadCatalogPhoto,
  removeCatalogPhoto,
  uploadPendingCatalogPhoto,
  promotePendingPhoto,
  assertUploadablePhoto,
} from '@/utils/catalogPhotoUpload';
import { PHOTO_BUCKET, type PickedPhoto } from '@/utils/catalogPhoto';

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockMove = jest.fn();
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
        move: (...args: unknown[]) => mockMove(bucket, ...args),
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
  mockMove.mockResolvedValue({ error: null });
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

describe('pickCatalogPhoto size guard', () => {
  const picker = jest.requireMock('expo-image-picker');

  const pickReturning = (base64: string) => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///huge.jpg', base64, mimeType: 'image/jpeg' }],
    });
  };

  it('refuses an absurd file before anything decodes it', async () => {
    // ~48 MB. The point is that this is rejected on the raw base64 length,
    // BEFORE the crop and resize touch it — decoding a file this size is
    // where a browser tab visibly hangs, and the admin's only clue would be a
    // frozen form.
    pickReturning('A'.repeat(64 * 1024 * 1024));

    await expect(pickCatalogPhoto()).rejects.toThrow(/far too large/);
  });

  it('lets an ordinary large photo through to be resized', async () => {
    // 3 MB raw: over nothing, and crop + resize normally bring it well under
    // the bucket cap. Rejecting early on raw size would throw away pictures
    // that were about to become fine.
    pickReturning('A'.repeat(4 * 1024 * 1024));

    await expect(pickCatalogPhoto()).resolves.toBeTruthy();
  });

  it('returns null when the picker is cancelled', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    await expect(pickCatalogPhoto()).resolves.toBeNull();
  });

  it('returns null when library permission is refused', async () => {
    // An ordinary outcome, not an error — callers should simply do nothing.
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(pickCatalogPhoto()).resolves.toBeNull();
  });
});

describe('uploadPendingCatalogPhoto', () => {
  it('writes to the pending key, not the live one', async () => {
    await uploadPendingCatalogPhoto(9, jpeg);

    expect(mockUpload).toHaveBeenCalledWith(
      'essentials-photos',
      'pending/9.jpg',
      expect.anything(),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('does not touch the row', async () => {
    // This is the whole promise of a gated edit: the listing keeps selling
    // with its CURRENT picture until an admin approves the new one. Writing
    // image_path or image_updated_at here would publish the proposed photo
    // immediately and make the review pointless.
    await uploadPendingCatalogPhoto(9, jpeg);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('applies the same format and size rules as a live upload', async () => {
    await expect(
      uploadPendingCatalogPhoto(9, { ...jpeg, mimeType: 'image/heic' }),
    ).rejects.toThrow(/HEIC/);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('promotePendingPhoto', () => {
  it('moves the pending object onto the live key', async () => {
    await promotePendingPhoto(9);

    expect(mockMove).toHaveBeenCalledWith('essentials-photos', 'pending/9.jpg', '9.jpg');
  });

  it('throws when the move fails, so the decision is not recorded', async () => {
    // The caller promotes BEFORE recording approval. If this silently
    // succeeded, image_updated_at would be stamped while the old bytes were
    // still live — a fresh URL pointing at the previous picture, cached for
    // the full 30 days.
    mockMove.mockResolvedValue({ error: { message: 'not found' } });

    await expect(promotePendingPhoto(9)).rejects.toThrow('not found');
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
