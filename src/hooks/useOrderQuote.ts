/**
 * 1stOne F1 — useOrderQuote
 *
 * Server-authoritative cart/checkout preview. Calls the `quote-order` Edge
 * Function and returns the exact groups, dispatch dates, tax, delivery fee and
 * totals that `place-order` will use — nothing about price or scheduling is
 * computed on the device.
 *
 * The cart screen calls it (optionally with the default address, for a full
 * pre-pass); the checkout screen re-calls it against the actually-selected
 * address, and that quote is what gets echoed to `place-order` for the drift
 * check. React Query staleness debounces repeat calls for an unchanged cart.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';

export interface QuoteItemInput {
  item_id: number;
  item_type: 'food' | 'essential';
  quantity: number;
}

export interface QuoteDispatch {
  cycle_id: number | null;
  dispatch_date: string;
  group_total_paise: number;
}

export interface QuoteGroup {
  cycle_id: number | null;
  dispatch_date: string;
  scenario: 'A' | 'B' | 'C' | null;
  items: { item_id: number; item_type: string; item_name: string; quantity: number; price_at_time: number }[];
  subtotal: number;
  tax_amount: number;
  delivery_fee: number;
  total_amount: number;
}

export interface OrderQuote {
  groups: QuoteGroup[];
  order_type: 'food' | 'essential';
  subtotal_total: number;
  tax_total: number;
  delivery_fee: number;
  grand_total: number;
  /** Echoed verbatim to place-order for the drift check. */
  total_paise: number;
  dispatches: QuoteDispatch[];
  has_scenario_c: boolean;
  storm_mode: boolean;
  serviceable: boolean;
  fee_pending: boolean;
}

interface UseOrderQuoteParams {
  items: QuoteItemInput[];
  subscriptionPlans?: { plan_id: number; start_date: string }[];
  /** Omit / null for an address-less pre-pass (delivery fee comes back pending). */
  deliveryAddressId?: number | null;
  enabled?: boolean;
}

export function useOrderQuote({
  items,
  subscriptionPlans = [],
  deliveryAddressId = null,
  enabled = true,
}: UseOrderQuoteParams) {
  return useQuery({
    queryKey: ['order_quote', items, subscriptionPlans, deliveryAddressId],
    queryFn: async (): Promise<OrderQuote> => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('quote-order', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: {
          items,
          subscription_plans: subscriptionPlans,
          delivery_address_id: deliveryAddressId,
        },
      });
      if (error) {
        let message = 'Could not price your cart. Please try again.';
        try {
          const ctx = (error as any).context;
          if (ctx) {
            const text = await (ctx.clone ? ctx.clone() : ctx).text();
            const parsed = JSON.parse(text);
            if (parsed?.error) message = parsed.error;
          }
        } catch {}
        throw new Error(message);
      }
      return data.quote as OrderQuote;
    },
    enabled: enabled && (items.length > 0 || subscriptionPlans.length > 0),
    staleTime: 30_000,
  });
}
