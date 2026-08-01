/**
 * 1stOne F1 — catalogPhoto URL building
 *
 * Screens carry no coverage in this repo, so the parts of the photo feature
 * that can silently go wrong live in src/utils and are pinned here: the
 * cache-buster (a fixed object path means a replaced photo keeps its URL, so
 * without ?v= the CDN serves the old bytes for an hour) and the bucket-prefix
 * handling (rows store `menu-photos/12.jpg`, the storage API wants `12.jpg`).
 */

import {
  photoPath,
  objectKeyFromPath,
  photoUrl,
  PHOTO_BUCKET,
  PHOTO_PX,
} from '@/utils/catalogPhoto';

const MENU = PHOTO_BUCKET.menu;
const ESS = PHOTO_BUCKET.essentials;

const mockGetPublicUrl = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    storage: {
      from: (...args: unknown[]) => ({
        getPublicUrl: (...inner: unknown[]) => mockGetPublicUrl(...args, ...inner),
      }),
    },
  },
}));

beforeEach(() => {
  mockGetPublicUrl.mockReset();
  mockGetPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://x.supabase.co/storage/v1/render/image/public/menu-photos/12.jpg?width=240' },
  });
});

describe('menuPhotoPath', () => {
  it('keys the object by item id with a fixed extension', () => {
    // The fixed .jpg is what makes replacement atomic — a varying extension
    // would leave 12.jpg AND 12.webp behind, i.e. two photos for one item.
    expect(photoPath(MENU, 12)).toBe('menu-photos/12.jpg');
    expect(photoPath(MENU, 7)).toBe('menu-photos/7.jpg');
  });
});

describe('objectKeyFromPath', () => {
  it('strips the bucket prefix stored on the row', () => {
    expect(objectKeyFromPath(MENU, 'menu-photos/12.jpg')).toBe('12.jpg');
  });

  it('passes through a bare key unchanged', () => {
    expect(objectKeyFromPath(MENU, '12.jpg')).toBe('12.jpg');
  });

  it('does not strip a lookalike prefix mid-path', () => {
    expect(objectKeyFromPath(MENU, 'other/menu-photos/12.jpg')).toBe('other/menu-photos/12.jpg');
  });
});

describe('menuPhotoUrl', () => {
  it('returns null when the item has no photo', () => {
    expect(photoUrl(MENU, { image_path: null }, PHOTO_PX.row)).toBeNull();
    expect(photoUrl(MENU, {}, PHOTO_PX.row)).toBeNull();
    expect(mockGetPublicUrl).not.toHaveBeenCalled();
  });

  it('requests a square cover resize at the given size', () => {
    photoUrl(MENU, { image_path: 'menu-photos/12.jpg' }, 240);

    expect(mockGetPublicUrl).toHaveBeenCalledWith(
      MENU,
      '12.jpg',
      { transform: { width: 240, height: 240, resize: 'cover', quality: 70 } },
    );
  });

  it('appends the update stamp so a replaced photo is not served from cache', () => {
    const url = photoUrl(
      MENU,
      { image_path: 'menu-photos/12.jpg', image_updated_at: '2026-08-01T10:00:00.000Z' },
      240,
    );

    expect(url).toContain(`v=${Date.parse('2026-08-01T10:00:00.000Z')}`);
    // The transform already put a query string on the URL, so the stamp must
    // join with & — a second ? would break the resize params.
    expect(url).toContain('&v=');
    expect(url!.match(/\?/g)).toHaveLength(1);
  });

  it('uses ? when the base URL has no query string', () => {
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/menu-photos/12.jpg' },
    });

    const url = photoUrl(
      MENU,
      { image_path: 'menu-photos/12.jpg', image_updated_at: '2026-08-01T10:00:00.000Z' },
      240,
    );

    expect(url).toContain('.jpg?v=');
  });

  it('omits the stamp rather than emitting NaN when it is missing or unparseable', () => {
    // Rows written before this shipped have no stamp; a partially applied
    // upload could leave junk. Either way the URL must stay usable.
    expect(photoUrl(MENU, { image_path: 'menu-photos/12.jpg' }, 240)).not.toContain('v=');
    expect(
      photoUrl(MENU, { image_path: 'menu-photos/12.jpg', image_updated_at: 'not-a-date' }, 240),
    ).not.toContain('NaN');
  });

  it('changes the URL when the photo is replaced', () => {
    // The whole point of the stamp: same path, same transform, different URL.
    const before = photoUrl(
      MENU,
      { image_path: 'menu-photos/12.jpg', image_updated_at: '2026-08-01T10:00:00.000Z' },
      240,
    );
    const after = photoUrl(
      MENU,
      { image_path: 'menu-photos/12.jpg', image_updated_at: '2026-08-01T11:30:00.000Z' },
      240,
    );

    expect(before).not.toBe(after);
  });
});

describe('bucket separation', () => {
  it('keys each catalogue into its own bucket', () => {
    // Menu and essentials photos must never share a bucket: their write rules
    // differ (essentials becomes vendor-writable once the listing gate lands),
    // and one policy set doing both jobs would put the food menu at risk.
    expect(photoPath(MENU, 12)).toBe('menu-photos/12.jpg');
    expect(photoPath(ESS, 12)).toBe('essentials-photos/12.jpg');
    expect(MENU).not.toBe(ESS);
  });

  it('strips only its own bucket prefix', () => {
    // An essentials path handed to the menu bucket must not be silently
    // accepted as a bare key — it would resolve to the wrong object.
    expect(objectKeyFromPath(ESS, 'essentials-photos/3.jpg')).toBe('3.jpg');
    expect(objectKeyFromPath(MENU, 'essentials-photos/3.jpg')).toBe('essentials-photos/3.jpg');
  });
});
