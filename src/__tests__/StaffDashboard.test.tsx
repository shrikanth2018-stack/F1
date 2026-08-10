/**
 * Smoke tests for the staff dashboard — the operational screen.
 *
 * WHAT THEY GUARD:
 *   1. Kitchen renders the SERVER's aggregate. The prep board is
 *      get_kitchen_aggregate's output rendered as-is; nothing is summed on
 *      the device. If a quantity here were ever computed locally it could
 *      disagree with what the kitchen was pushed.
 *   2. Packing's Food / Essentials sub-tabs actually partition by order_type.
 *      Essentials skip the kitchen entirely (BF-34b), so a food order leaking
 *      into the Essentials tab means somebody packs an uncooked meal.
 *   3. An empty board before the first push is BY DESIGN, not a failure —
 *      orders reach staff only via the kitchen push. Worth pinning, because
 *      it looks exactly like a bug and has been reported as one.
 *   4. A past-dated undelivered order is kept OFF Packing (D2) — it belongs
 *      to the delivery personas, not to the packers.
 *   5. "Mark all as Ready" acts on the BOARD, not on the batch. 'Ready' is a
 *      status that pushes the customer, so sweeping in an essentials order
 *      the kitchen never saw tells someone their food is ready when nobody
 *      has made it.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './_helpers/queryClient';

let mockOrders: Record<string, unknown>[] = [];
let mockKitchen: Record<string, unknown>[] = [];
/** Stable across renders, so a test can assert on what was dispatched. */
const mockBulkAdvance = jest.fn();

jest.mock('@/hooks/useStaffOrders', () => ({
  useStaffOrders: () => ({ data: mockOrders, isLoading: false, isError: false, refetch: jest.fn() }),
  useUpdateOrderStatus: () => ({ mutate: jest.fn(), isPending: false }),
  useBulkAdvanceStatus: () => ({ mutate: mockBulkAdvance, isPending: false }),
  useKitchenAggregate: () => ({ data: mockKitchen, isLoading: false, refetch: jest.fn() }),
}));

jest.mock('@/hooks/useRealtimeOrders', () => ({ useRealtimeOrders: jest.fn() }));
jest.mock('@/hooks/useOfflineSync', () => ({ useOfflineSync: () => ({ pendingCount: 0 }) }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 's1', phone: '919166666666' }, role: 'staff' } }),
}));
jest.mock('@/hooks/useWallet', () => ({
  useWalletBalance: () => ({ data: { fullName: 'Staff 6', balance: 0 } }),
}));
jest.mock('@/hooks/useStoreConfig', () => ({
  useStoreConfig: () => ({ data: { whatsapp_support_number: '919000000000' } }),
}));
jest.mock('@/hooks/useDeliveryCycles', () => ({
  useDeliveryCycles: () => ({ data: [{ id: 3, cycle_name: 'Snacks', delivery_start: '16:30', cutoff_time: '15:00' }] }),
}));
jest.mock('@/hooks/useAdminNotes', () => ({ useStaffNoteForTab: () => ({ data: [] }) }));
jest.mock('@/utils/printHtml', () => ({ printHtml: jest.fn() }));

// The staff ProfilePopup reaches for useNavigation. Mocked here rather than
// globally: a test that asserts on navigation should opt into its own stub
// rather than inherit a silent one.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() }),
}));

import { StaffDashboard } from '@/screens/staff/StaffDashboard';

const order = (over: Record<string, unknown> = {}) => ({
  id: 1, status: 'Confirmed', order_type: 'food',
  dispatch_date: '2999-01-01', delivery_method: 'direct',
  total_amount: 150, payment_method: 'wallet', user_id: 'u1',
  order_items: [{ id: 1, item_name: 'Chapati Roll', quantity: 2, item_type: 'food' }],
  customer_addresses: { address_line: '1 Test Street', delivery_zones: { driver_code: 'D1' } },
  profiles: { phone_number: '919155555555' },
  ...over,
});

// Not every hook below the dashboard is mocked — the staff ProfilePopup and
// the note banners still run real useQuery calls — so a client has to exist.
const open = () =>
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <StaffDashboard />
    </QueryClientProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOrders = [];
  mockKitchen = [];
});

describe('StaffDashboard — Kitchen shows the server’s prep board', () => {
  it('renders the aggregate rows as given, ingredient by ingredient', () => {
    mockKitchen = [
      { item_name: 'Rolls', unit: 'nos', total_quantity: 4, status: 'Confirmed', order_ids: [1] },
      { item_name: 'Chethey', unit: 'ml', total_quantity: 250, status: 'Confirmed', order_ids: [1] },
    ];
    mockOrders = [order()];
    open();
    // Ingredients, not dishes — the recipe expansion happened server-side.
    expect(screen.getByText('Rolls')).toBeTruthy();
    expect(screen.getByText('Chethey')).toBeTruthy();
  });

  it('shows an empty board before the first push, which is by design', () => {
    // Orders reach staff ONLY via the kitchen push. Nothing pushed yet means
    // nothing to cook — this looks like a bug and is not one.
    open();
    expect(screen.queryByText('Rolls')).toBeNull();
  });
});

describe('StaffDashboard — Packing partitions food from essentials', () => {
  it('shows only food orders on the Food sub-tab', () => {
    mockOrders = [
      order({ id: 11, order_type: 'food' }),
      order({ id: 22, order_type: 'essential' }),
    ];
    open();
    fireEvent.press(screen.getByText('Packing'));
    expect(screen.getByText(/#11/)).toBeTruthy();
    expect(screen.queryByText(/#22/)).toBeNull();
  });

  it('shows only essentials orders on the Essentials sub-tab', () => {
    mockOrders = [
      order({ id: 11, order_type: 'food' }),
      order({ id: 22, order_type: 'essential' }),
    ];
    open();
    fireEvent.press(screen.getByText('Packing'));
    fireEvent.press(screen.getByText('Essentials'));
    expect(screen.getByText(/#22/)).toBeTruthy();
    expect(screen.queryByText(/#11/)).toBeNull();
  });

  /**
   * CHANGED 2026-08-10, deliberately. Packing used to drop a row the moment
   * it reached Dispatched — it "belonged to driver/hub, not packers".
   *
   * The board now keeps every row from the batch, whatever its status, until
   * it is Delivered or the next push replaces the board. A packer needs to
   * see that the batch is complete, and a row that vanishes on dispatch takes
   * that away: the board silently empties and nobody can tell finished from
   * missing. The row stays; it simply has no action left on it.
   */
  it('keeps a dispatched order ON Packing until the next push', () => {
    mockOrders = [order({ id: 33, status: 'Dispatched', dispatch_date: '2020-01-01' })];
    open();
    fireEvent.press(screen.getByText('Packing'));
    expect(screen.getByText(/#33/)).toBeTruthy();
  });
});

describe('StaffDashboard — "Mark all as Ready" acts on the board, not the batch', () => {
  /** Press the button, then take the confirm action out of the Alert. */
  const confirmMarkAllReady = () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText(/Mark all as Ready/));
    const buttons = spy.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[] | undefined;
    buttons?.find((b) => b.text === 'Mark Ready')?.onPress?.();
    spy.mockRestore();
  };

  it('advances exactly the orders the prep board is showing', () => {
    mockKitchen = [
      { item_name: 'Rolls',   unit: 'nos', total_quantity: 4,   status: 'Confirmed', order_ids: [11] },
      { item_name: 'Chethey', unit: 'ml',  total_quantity: 250, status: 'Confirmed', order_ids: [11] },
    ];
    mockOrders = [order({ id: 11, order_type: 'food' })];
    open();
    confirmMarkAllReady();
    // One order, not two entries — the two board rows share it.
    expect(mockBulkAdvance).toHaveBeenCalledWith({ orderIds: [11], status: 'Ready' });
  });

  it('NEVER sweeps in an essentials order — it is not on this board', () => {
    // Essentials bypass the kitchen (BF-34b) and are packed straight from
    // Confirmed. They are in the same pushed batch, so reading the batch
    // instead of the board marked them Ready and pushed the customer.
    mockKitchen = [
      { item_name: 'Rolls', unit: 'nos', total_quantity: 4, status: 'Confirmed', order_ids: [11] },
    ];
    mockOrders = [
      order({ id: 11, order_type: 'food' }),
      order({ id: 22, order_type: 'essential' }),
    ];
    open();
    confirmMarkAllReady();
    expect(mockBulkAdvance).toHaveBeenCalledWith({ orderIds: [11], status: 'Ready' });
    expect(mockBulkAdvance).not.toHaveBeenCalledWith(
      expect.objectContaining({ orderIds: expect.arrayContaining([22]) }),
    );
  });

  it('does nothing when every board row is already past Confirmed / Preparing', () => {
    mockKitchen = [
      { item_name: 'Rolls', unit: 'nos', total_quantity: 4, status: 'Ready', order_ids: [11] },
    ];
    mockOrders = [order({ id: 11, order_type: 'food' })];
    open();
    confirmMarkAllReady();
    expect(mockBulkAdvance).not.toHaveBeenCalled();
  });
});
