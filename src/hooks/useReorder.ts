/**
 * 1stOne F1 — useReorder
 *
 * Rebuilds the cart from a past order.
 *
 * IT NEVER REPLAYS THE OLD PRICE. `order_items.price_at_time` is a record of
 * what was charged then, not an offer to charge it again. Every line is
 * re-read from the live catalogue, so a reorder is priced like any other
 * cart — and the server re-derives it once more at quote and again at
 * checkout, as it does for everything else.
 *
 * The CYCLE is re-read too. An item may have moved delivery window since the
 * original order; using the old row's cycle would promise a delivery time the
 * catalogue no longer offers.
 *
 * Anything no longer orderable is DROPPED AND NAMED. Silently omitting a
 * discontinued dish would hand the customer a cart that quietly differs from
 * what they asked to repeat.
 */

import { useCallback, useState } from 'react';
import { supabase } from '../api/supabaseClient';
import { useCartStore } from '../store/cartStore';
import type { CartItem } from '../types';

export interface ReorderResult {
  added: number;
  /** Names of lines that could not be reordered, for telling the customer. */
  dropped: string[];
}

export function useReorder() {
  const [isWorking, setIsWorking] = useState(false);
  const clearCart = useCartStore((s) => s.clearCart);

  const reorder = useCallback(
    async (orderIds: number[]): Promise<ReorderResult> => {
      setIsWorking(true);
      try {
        // 1. What was in the order. Subscription lines are excluded: a plan
        //    is bought once and runs, so "order again" means the goods.
        const { data: lines, error: lineErr } = await supabase
          .from('order_items')
          .select('item_id, item_type, item_name, quantity')
          .in('order_id', orderIds)
          .in('item_type', ['food', 'essential']);
        if (lineErr) throw lineErr;
        if (!lines || lines.length === 0) return { added: 0, dropped: [] };

        // Same item ordered across two rows of one checkout → one cart line.
        const wanted = new Map<string, { item_id: number; item_type: 'food' | 'essential'; item_name: string; quantity: number }>();
        for (const l of lines as any[]) {
          const key = `${l.item_id}:${l.item_type}`;
          const prev = wanted.get(key);
          if (prev) prev.quantity += Number(l.quantity) || 0;
          else wanted.set(key, {
            item_id: Number(l.item_id),
            item_type: l.item_type,
            item_name: l.item_name,
            quantity: Number(l.quantity) || 0,
          });
        }

        const foodIds = [...wanted.values()].filter((w) => w.item_type === 'food').map((w) => w.item_id);
        const essIds = [...wanted.values()].filter((w) => w.item_type === 'essential').map((w) => w.item_id);

        // 2. Today's catalogue — price, cycle and availability.
        const [menuRes, essRes] = await Promise.all([
          foodIds.length
            ? supabase.from('menu_items')
                .select('id, name, price, cycle_id, is_active, is_customer_visible')
                .in('id', foodIds)
            : Promise.resolve({ data: [], error: null } as any),
          essIds.length
            ? supabase.from('essentials_catalog')
                .select('id, name, price, cycle_id, unit, is_active, listing_status')
                .in('id', essIds)
            : Promise.resolve({ data: [], error: null } as any),
        ]);
        if (menuRes.error) throw menuRes.error;
        if (essRes.error) throw essRes.error;

        const menuById = new Map<number, any>((menuRes.data ?? []).map((r: any) => [r.id, r]));
        const essById = new Map<number, any>((essRes.data ?? []).map((r: any) => [r.id, r]));

        const items: Omit<CartItem, 'quantity'>[] = [];
        const quantities: number[] = [];
        const dropped: string[] = [];

        for (const w of wanted.values()) {
          if (w.item_type === 'food') {
            const m = menuById.get(w.item_id);
            // Same three gates the order builder applies, so a reorder can
            // never assemble a cart the server would refuse.
            const ok = m && m.is_active && m.is_customer_visible !== false && m.cycle_id != null;
            if (!ok) { dropped.push(w.item_name); continue; }
            items.push({
              item_id: m.id, item_type: 'food', cycle_id: m.cycle_id,
              name: m.name, display_price: Number(m.price),
            });
          } else {
            const e = essById.get(w.item_id);
            const ok = e && e.is_active && e.cycle_id != null
              && (e.listing_status ?? 'approved') === 'approved';
            if (!ok) { dropped.push(w.item_name); continue; }
            items.push({
              item_id: e.id, item_type: 'essential', cycle_id: e.cycle_id,
              name: e.name, display_price: Number(e.price), unit: e.unit ?? undefined,
            });
          }
          quantities.push(w.quantity);
        }

        // 3. Replace the cart. Replace, not merge: "order this again" is a
        //    statement about what the customer wants now, and silently adding
        //    to a half-built cart would produce an order neither of us meant.
        clearCart();
        const add = useCartStore.getState().addItem;
        const setQty = useCartStore.getState().updateQuantity;
        items.forEach((it, i) => {
          add(it);
          if (quantities[i] > 1) setQty(it.item_id, it.item_type, quantities[i]);
        });

        return { added: items.length, dropped };
      } finally {
        setIsWorking(false);
      }
    },
    [clearCart],
  );

  return { reorder, isWorking };
}
