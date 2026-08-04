/**
 * Smoke tests for the Menu Item editor (Step 1 — the building blocks).
 *
 * Both behaviours here shipped in the last two days and neither has device
 * evidence yet:
 *   1. the price and the portion it buys, as one statement — "₹20 for 150 ml"
 *   2. Disable warning when the item is used by live menus
 *
 * (2) is the subtler one. Disabling a block does almost nothing visible: it
 * stays in every recipe, the menus keep selling and the kitchen keeps prepping
 * it, because the prep board is built from the recipe TEXT rather than the row.
 * An admin switching Sambar off to take it off the menu needs telling that,
 * and the test pins that they are told.
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

const mockCreate = jest.fn((_p?: Record<string, unknown>) => Promise.resolve(1));
const mockUpdate = jest.fn((_p?: Record<string, unknown>) => Promise.resolve({}));
const mockRename = jest.fn((_p?: Record<string, unknown>) => Promise.resolve(0));
const mockRemove = jest.fn((_p?: Record<string, unknown>) => Promise.resolve('deleted'));
const mockSetUnit = jest.fn((_p?: Record<string, unknown>) => Promise.resolve(0));
let mockUsedIn = 0;

jest.mock('@/hooks/useMenuManagement', () => ({
  useCreateMenuBlock: () => ({ mutateAsync: mockCreate }),
  useRenameMenuBlock: () => ({ mutateAsync: mockRename }),
  useUpdateMenuItem: () => ({ mutateAsync: mockUpdate }),
  useRemoveMenuItem: () => ({ mutateAsync: mockRemove }),
  useSetMenuBlockUnit: () => ({ mutateAsync: mockSetUnit }),
  useBlockUsage: () => ({ data: mockUsedIn }),
}));

const mockConfirm = jest.fn((..._a: unknown[]) => Promise.resolve(true));
const mockInfo = jest.fn((..._a: unknown[]) => Promise.resolve(undefined));
jest.mock('@/utils/confirmDialog', () => ({
  confirmDialog: (...a: unknown[]) => mockConfirm(...a),
  infoDialog: (...a: unknown[]) => mockInfo(...a),
}));

import { MenuItemEditorModal } from '@/screens/admin/components/MenuItemEditorModal';

const SAMBAR = {
  id: 2, name: 'Sambar', price: 20, unit: 'ml', base_quantity: 150,
  is_active: true, is_customer_visible: false, cycle_id: null,
} as never;

const open = (item: unknown = SAMBAR) =>
  render(<MenuItemEditorModal visible item={item as never} onClose={jest.fn()} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockUsedIn = 0;
});

describe('MenuItemEditorModal — the price is for a stated quantity', () => {
  it('shows the price and the portion it buys as one statement', () => {
    open();
    expect(screen.getByDisplayValue('20')).toBeTruthy();    // ₹
    expect(screen.getByDisplayValue('150')).toBeTruthy();   // for how much
    expect(screen.getByText('WHAT IT COSTS')).toBeTruthy();
    // Spelled out in the terms it is actually spent in.
    expect(screen.getByText(/bulk order of 2 gets 300 ml/)).toBeTruthy();
  });

  it('refuses a price with no quantity to price', async () => {
    open();
    fireEvent.changeText(screen.getByDisplayValue('150'), '0');
    fireEvent.press(screen.getByText(/Save/));
    await waitFor(() => expect(mockInfo).toHaveBeenCalled());
    expect(String(mockInfo.mock.calls[0][0])).toMatch(/Quantity required/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saves price and portion together, in one update', async () => {
    open();
    fireEvent.changeText(screen.getByDisplayValue('20'), '25');
    fireEvent.changeText(screen.getByDisplayValue('150'), '200');
    fireEvent.press(screen.getByText(/Save/));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    // One call, both columns — they are meaningless apart, so they must not
    // be able to half-save.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ id: 2, price: 25, base_quantity: 200 });
  });
});

describe('MenuItemEditorModal — Disable says what disabling actually does', () => {
  it('warns, and explains, when the item is used by live menus', async () => {
    mockUsedIn = 9;
    open();
    fireEvent.press(screen.getByText('Disable'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const msg = String((mockConfirm.mock.calls[0][0] as { message: string }).message);
    // The whole point: the menus do NOT change.
    expect(msg).toMatch(/9 menus/);
    expect(msg).toMatch(/does not change/i);
    expect(msg).toMatch(/kitchen still preps/i);
  });

  it('does not nag when nothing uses the item', async () => {
    mockUsedIn = 0;
    open();
    fireEvent.press(screen.getByText('Disable'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ id: 2, is_active: false });
  });

  it('leaves the item alone if the warning is declined', async () => {
    mockUsedIn = 3;
    mockConfirm.mockResolvedValueOnce(false);
    open();
    fireEvent.press(screen.getByText('Disable'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
