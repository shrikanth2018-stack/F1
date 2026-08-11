/**
 * 1stOne F1 — what the customer's plan builder is allowed to offer.
 *
 * Two admin-owned settings, both read by the builder and edited at
 * Manage → Subscriptions:
 *
 *   the DISCOUNT SCHEDULE — how much a length is worth
 *   ELIGIBILITY           — which catalogue items may go in a plan at all
 *
 * Eligibility exists because not everything on the menu belongs in a
 * subscription: a vendor's goods and anything that is not house-brand need a
 * decision per item. It defaults to FALSE, so the safe failure is an empty
 * builder an admin has to fill, never a customer locking in thirty days of
 * something nobody meant to offer that way.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_STALE_TIME } from '../utils/constants';

// ── Discount schedule ────────────────────────────────────────

export interface DiscountSlab {
  id: number;
  min_days: number;
  max_days: number;
  percent: number;
  is_active: boolean;
}

export const SLABS_KEY = ['subscription_discount_slabs'] as const;

export function useDiscountSlabs() {
  return useSupabaseQuery<DiscountSlab>(
    SLABS_KEY,
    () =>
      supabase
        .from('subscription_discount_slabs')
        .select('id, min_days, max_days, percent, is_active')
        .order('min_days', { ascending: true }),
    { staleTime: QUERY_STALE_TIME },
  );
}

export function useUpdateSlab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; min_days: number; max_days: number; percent: number }) => {
      const { data, error } = await supabase
        .from('subscription_discount_slabs')
        .update({
          min_days: p.min_days,
          max_days: p.max_days,
          percent: p.percent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id)
        // A refused RLS write is not an error — zero rows, success code. Read
        // the id back and throw on empty, or a non-admin gets a silent no-op
        // that looks exactly like a save.
        .select('id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('Not saved — you may not have permission to change the discount schedule.');
      }
      return data[0];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SLABS_KEY }),
  });
}

/**
 * The discount a length earns, mirroring the plan_discount_percent SQL.
 *
 * Highest wins where slabs overlap, and an uncovered length is 0 rather than
 * an error: a gap in the schedule must mean "no discount", never a builder
 * that refuses to price. The server recomputes this at creation — this copy
 * is only so the customer sees the number move as they change the length.
 */
export function discountForDays(days: number, slabs: DiscountSlab[]): number {
  let best = 0;
  for (const s of slabs) {
    if (!s.is_active) continue;
    if (days < s.min_days || days > s.max_days) continue;
    const pct = Number(s.percent) || 0;
    if (pct > best) best = pct;
  }
  return best;
}

// ── Eligibility ──────────────────────────────────────────────

export interface EligibleItem {
  id: number;
  name: string;
  price: number;
  cycle_id: number | null;
  plan_eligible: boolean;
  item_type: 'food' | 'essential';
}

export const ELIGIBILITY_KEY = ['plan_eligibility'] as const;

/**
 * Every item an admin could offer to the builder, both catalogues.
 *
 * FOOD IS FILTERED TO is_customer_visible. A building block — Idli, Sambar —
 * is an ingredient priced for back-office use, and an admin composing a
 * LISTED plan builds from those deliberately. A customer never sees one, so
 * offering blocks here would let an admin grant something the builder could
 * not show, or worse, could.
 */
export function usePlanEligibility() {
  return useSupabaseQuery<EligibleItem>(
    ELIGIBILITY_KEY,
    async () => {
      const [menu, ess] = await Promise.all([
        supabase
          .from('menu_items')
          .select('id, name, price, cycle_id, plan_eligible')
          .eq('is_active', true)
          .eq('is_customer_visible', true)
          .order('sort_order'),
        supabase
          .from('essentials_catalog')
          .select('id, name, price, cycle_id, plan_eligible')
          .eq('is_active', true)
          .order('sort_order'),
      ]);
      const error = menu.error ?? ess.error;
      if (error) return { data: null, error };
      const rows: EligibleItem[] = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(menu.data ?? []).map((m: any) => ({ ...m, price: Number(m.price), item_type: 'food' as const })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(ess.data ?? []).map((e: any) => ({ ...e, price: Number(e.price), item_type: 'essential' as const })),
      ];
      return { data: rows, error: null };
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

export function useSetPlanEligible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; item_type: 'food' | 'essential'; eligible: boolean }) => {
      const table = p.item_type === 'food' ? 'menu_items' : 'essentials_catalog';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from(table)
        .update({ plan_eligible: p.eligible })
        .eq('id', p.id)
        .select('id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('Not saved — you may not have permission to change plan eligibility.');
      }
      return data[0];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ELIGIBILITY_KEY }),
  });
}
