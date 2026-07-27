/**
 * 1stOne F1 — useAdminOrderEntry
 *
 * Back-office order entry: look a customer up by phone, read their wallet
 * and order history, and create an order on their behalf.
 *
 * The money lives entirely on the server. This layer sends item ids +
 * quantities, a discount percentage, an optional delivery-fee override and a
 * dispatch INTENT — never a price, never a date. The `admin-place-order`
 * edge function re-derives everything through the same builder the customer
 * checkout uses.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { invokeFunction } from '../api/invokeFunction';
import { QUERY_KEYS } from '../utils/constants';

/** profiles.phone_number / auth.users.phone are stored as 91XXXXXXXXXX. */
export function toStoredPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `91${ten}` : null;
}

export interface AdminCustomer {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  wallet_balance: number | null;
}

export interface AdminCustomerOrder {
  id: number;
  status: string | null;
  dispatch_date: string;
  total_amount: number;
  paid_at: string | null;
  placed_by: string | null;
  created_at: string | null;
}

/**
 * Find an existing customer by phone. Returns null when nobody matches —
 * that is a normal outcome (the order screen then offers to create them).
 */
export function useCustomerByPhone(phone: string) {
  const stored = toStoredPhone(phone);
  return useQuery({
    queryKey: ['admin_customer_by_phone', stored],
    queryFn: async (): Promise<AdminCustomer | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, wallet_balance')
        .eq('phone_number', stored!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as AdminCustomer) ?? null;
    },
    enabled: stored != null,
  });
}

/** A customer's orders, newest first — the phone-number order history. */
export function useCustomerOrders(userId?: string | null) {
  return useQuery({
    queryKey: ['admin_customer_orders', userId ?? 'none'],
    queryFn: async (): Promise<AdminCustomerOrder[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, status, dispatch_date, total_amount, paid_at, placed_by, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminCustomerOrder[];
    },
    enabled: !!userId,
  });
}

/** The customer's saved addresses — so the admin knows whether one exists. */
export function useCustomerAddresses(userId?: string | null) {
  return useQuery({
    queryKey: ['admin_customer_addresses', userId ?? 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_addresses')
        // zone_id / hub_id decide whether the order can actually be ROUTED.
        // is_serviceable alone is not enough — a legacy address can be
        // serviceable with neither set, which lands the order as
        // "Unassigned" on the admin board. The joined names let the order
        // screen show WHO delivers before anything is committed.
        .select(
          'id, label, address_line, is_default, is_serviceable, zone_id, hub_id,' +
          ' delivery_zones(zone_name), delivery_hubs(hub_name)',
        )
        .eq('user_id', userId!)
        .eq('is_active', true)
        .order('is_default', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!userId,
  });
}

/** Register or update a back-office customer + their delivery address. */
export interface AdminCustomerPayload {
  phone: string;
  full_name?: string;
  address: {
    label?: string;
    address_line: string;
    landmark?: string;
    city?: string;
    pincode?: string;
    latitude?: number;
    longitude?: number;
    /** Explicit delivery area — the escape hatch for an out-of-polygon B2B address. */
    zone_id?: number | null;
    hub_id?: number | null;
  };
  /** Edit an existing address instead of inserting a new one. */
  address_id?: number;
}

export interface AdminCustomerResult {
  user_id: string;
  created: boolean;
  address_id: number;
  zone_id: number | null;
  hub_id: number | null;
  is_serviceable: boolean;
}

/**
 * Create or update a customer + address from the back office. Serviceability
 * and routing are resolved and verified server-side — an address that maps to
 * neither a zone nor a hub is rejected there, not here.
 */
export function useCreateAdminCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminCustomerPayload) =>
      invokeFunction<AdminCustomerResult>(
        'admin-create-customer',
        payload as unknown as Record<string, unknown>,
        { fallbackMessage: 'Could not save the customer. Please try again.' },
      ),
    onSuccess: () => {
      // The order screen re-queries by phone when it regains focus.
      queryClient.invalidateQueries({ queryKey: ['admin_customer_by_phone'] });
      queryClient.invalidateQueries({ queryKey: ['admin_customer_addresses'] });
    },
  });
}

export interface AdminOrderPayload {
  /** Both must already exist — registration is a separate screen. */
  customer: { user_id: string; address_id?: number };
  cycle_id: number;
  items: Array<{ item_id: number; quantity: number }>;
  dispatch_target: 'auto' | 'current_run';
  discount_percent?: number;
  delivery_fee_override?: number | null;
  payment_mode: 'wallet' | 'link' | 'account';
  notes?: string;
  /** Run every check and calculation, return the figures, write nothing. */
  preview?: boolean;
}

/** What the server would charge — used for the confirmation dialog. */
export interface AdminOrderPreview {
  preview: true;
  cycle_id: number;
  cycle_name: string;
  dispatch_date: string;
  dispatch_note: string | null;
  item_count: number;
  unit_count: number;
  subtotal: number;
  discount_percent: number;
  delivery_fee: number;
  tax_amount: number;
  total_amount: number;
}

export interface AdminOrderResult {
  order_id: number;
  order_group_id: string;
  customer_id: string;
  cycle_id: number;
  cycle_name: string;
  dispatch_date: string;
  dispatch_note: string | null;
  subtotal: number;
  discount_percent: number;
  delivery_fee: number;
  tax_amount: number;
  total_amount: number;
  payment_mode: 'wallet' | 'link' | 'account';
  payment_state: 'paid' | 'unpaid' | 'link_sent';
  payment_error: string | null;
  payment_link_url: string | null;
}

/**
 * Ask the server what this order would cost, without writing anything. The
 * figures come from the same code path that will write the order, so the
 * confirmation dialog cannot disagree with what gets created.
 */
export function useAdminOrderPreview() {
  return useMutation({
    mutationFn: (payload: AdminOrderPayload) =>
      invokeFunction<AdminOrderPreview>(
        'admin-place-order',
        { ...payload, preview: true } as unknown as Record<string, unknown>,
        { fallbackMessage: 'Could not price the order. Please try again.' },
      ),
  });
}

/**
 * Create the order. Every figure in the result comes back from the server —
 * the screen renders them, it never computes a total of its own.
 */
export function useCreateAdminOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminOrderPayload) =>
      invokeFunction<AdminOrderResult>('admin-place-order', payload as unknown as Record<string, unknown>, {
        fallbackMessage: 'Could not create the order. Please try again.',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_orders_manage'] });
      queryClient.invalidateQueries({ queryKey: ['admin_customer_orders'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}
