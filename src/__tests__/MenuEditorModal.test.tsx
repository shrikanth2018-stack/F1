/**
 * Smoke tests for the Menu editor — the FIRST test in this project that
 * renders a screen rather than a hook.
 *
 * WHY THIS ONE FIRST. 83 screens and 36 components had no test of any kind,
 * and the owner has walked most of them by hand repeatedly. This editor is the
 * exception: the count model shipped yesterday and had not been opened on a
 * device. So these are regression guards for the part with the least human
 * evidence behind it.
 *
 * WHAT THEY GUARD, and it is deliberately narrow:
 *   1. a recipe line reads as a COUNT of the item's own portion
 *   2. an untouched part-portion line is NOT rewritten on save — the
 *      0.667 x 150 = 100.05 drift that would corrupt five real recipes
 *   3. typing a count writes back count x portion
 *   4. the unit is displayed, never editable
 *
 * They do NOT test styling, layout or navigation. A screen test that asserts
 * on cosmetics fails on every innocent change and gets deleted within a month.
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// ── The module boundary this screen sits on ──────────────────
// Blocks come from useMenuBlocks; the four mutations are what a save calls.
// Mocking the hook module (not supabase) keeps the test about the editor.
const mockUpdate = jest.fn((_p?: Record<string, unknown>) => Promise.resolve({}));
const mockAdd = jest.fn((_p?: Record<string, unknown>) => Promise.resolve({ id: 99 }));
const mockRemove = jest.fn((_p?: Record<string, unknown>) => Promise.resolve('deleted'));

const BLOCKS = [
  { id: 1, name: 'Idli',    price: 0, unit: 'nos', base_quantity: 1,   is_active: true, is_customer_visible: false },
  { id: 2, name: 'Sambar',  price: 20, unit: 'ml', base_quantity: 150, is_active: true, is_customer_visible: false },
  { id: 3, name: 'Chutney', price: 0, unit: 'gms', base_quantity: 100, is_active: true, is_customer_visible: false },
];

jest.mock('@/hooks/useMenuManagement', () => ({
  useMenuBlocks: () => ({ data: BLOCKS }),
  useAddMenuItem: () => ({ mutateAsync: mockAdd }),
  useUpdateMenuItem: () => ({ mutateAsync: mockUpdate }),
  useRemoveMenuItem: () => ({ mutateAsync: mockRemove }),
}));

jest.mock('@/utils/catalogPhotoUpload', () => ({
  pickCatalogPhoto: jest.fn(() => Promise.resolve(null)),
  uploadCatalogPhoto: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/components/CatalogPhotoThumb', () => ({
  CatalogPhotoThumb: () => null,
}));

const mockInfo = jest.fn((..._a: unknown[]) => Promise.resolve(undefined));
jest.mock('@/utils/confirmDialog', () => ({
  infoDialog: (...a: unknown[]) => mockInfo(...a),
  confirmDialog: jest.fn(() => Promise.resolve(true)),
}));

import { MenuEditorModal } from '@/screens/admin/components/MenuEditorModal';

const DISH = {
  id: 500,
  name: 'Idli Vada',
  price: 60,
  cycle_id: 2,
  is_active: true,
  is_customer_visible: true,
  // Sambar's portion is 150 ml, so 150 reads as x1. Chutney's is 100 gms -> x1.
  // Idli has no portion of its own (1 nos), so 4 reads as x4.
  ingredients: 'Idli:4 nos;Sambar:150 ml;Chutney:100 gms',
  description: null,
  image_path: null,
} as never;

const open = (item: unknown = DISH) =>
  render(
    <MenuEditorModal
      visible
      item={item as never}
      cycleId={2}
      cycleName="Lunch"
      onClose={jest.fn()}
      onChanged={jest.fn()}
    />,
  );

beforeEach(() => jest.clearAllMocks());

describe('MenuEditorModal — a line is a count of the item’s portion', () => {
  it('shows each part’s own portion, and a count of it', () => {
    open();
    // The portion is stated as a fact...
    expect(screen.getByText('150 ml')).toBeTruthy();
    expect(screen.getByText('100 gms')).toBeTruthy();
    expect(screen.getByText('1 nos')).toBeTruthy();
    // ...and one portion of each reads as x1, four idlis as x4.
    const counts = screen.getAllByPlaceholderText('1').map((i) => i.props.value);
    expect(counts).toEqual(['4', '1', '1']);
  });

  it('does not offer the unit as an editable control', () => {
    open();
    // The unit words are present as text, but nothing renders them as an
    // input — changing a unit is a cascade and belongs on the Menu Items tab.
    expect(screen.queryByDisplayValue('ml')).toBeNull();
    expect(screen.queryByDisplayValue('gms')).toBeNull();
    expect(screen.queryByDisplayValue('nos')).toBeNull();
  });

  it('writes back count x portion when a count is typed', async () => {
    open();
    // Sambar is the second count box; ask for two portions.
    fireEvent.changeText(screen.getAllByPlaceholderText('1')[1], '2');
    fireEvent.press(screen.getByText(/Save/));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    // 2 x 150 ml = 300 ml.
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      id: 500,
      ingredients: 'Idli:4 nos;Sambar:300 ml;Chutney:100 gms',
    });
  });

  it('leaves an untouched part-portion line EXACTLY as it was', async () => {
    // THE REGRESSION THIS EXISTS FOR. Masala Dosa takes 100 ml of a 150 ml
    // sambar, which reads 0.667 — and 0.667 x 150 is 100.05. Opening a dish
    // and saving it without touching that row must not shave a hundredth off
    // it. Five real recipes are in this shape.
    open({ ...(DISH as object), ingredients: 'Sambar:100 ml' });
    expect(screen.getAllByPlaceholderText('1')[0].props.value).toBe('0.667');

    fireEvent.press(screen.getByText(/Save/));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ ingredients: 'Sambar:100 ml' });
  });

  it('refuses to save a menu with no contents', async () => {
    open({ ...(DISH as object), ingredients: null });
    fireEvent.press(screen.getByText(/Save/));
    await waitFor(() => expect(mockInfo).toHaveBeenCalled());
    expect(String(mockInfo.mock.calls[0][0])).toMatch(/contents/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
