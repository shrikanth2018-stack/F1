/**
 * 1stOne F1 — Cart Store (Zustand + AsyncStorage)
 *
 * THE ONE CART. Holds menu items, essentials and subscription plans together,
 * across any number of delivery cycles, paid for once.
 *
 * There used to be two stores, and the split was never a server constraint —
 * `buildAuthoritativeOrder` has always taken a single `items[]` and sorted
 * food from essentials itself. The split only ever existed here, and it
 * surfaced to the customer as two Checkout buttons on one cart screen: ₹85 of
 * shopping in one place, asked to pay twice.
 *
 * IDENTITY IS (item_id, item_type). `menu_items` and `essentials_catalog`
 * have independent id sequences, so menu item 31 and essential 31 are
 * different products. Two stores kept them apart structurally; one store has
 * to do it with the key. Every lookup, update and removal takes both.
 *
 * The server still decides money. Prices here are display-only.
 *
 * Persisted to AsyncStorage so the cart survives an app restart.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem, CartPlan } from '../types';

export type CartItemType = CartItem['item_type'];

/** The composite key, in one place so it cannot be spelled two ways. */
const sameLine = (i: CartItem, itemId: number, type: CartItemType) =>
  i.item_id === itemId && i.item_type === type;

interface CartState {
  items: CartItem[];
  plans: CartPlan[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (itemId: number, itemType: CartItemType) => void;
  updateQuantity: (itemId: number, itemType: CartItemType, quantity: number) => void;
  addPlan: (plan: CartPlan) => void;
  removePlan: (planId: number) => void;
  setSinglePlan: (plan: CartPlan) => void;
  clearPlans: () => void;
  clearCart: () => void;
  clearCycle: (cycleId: number) => void;
  getItemCount: () => number;
  getPlanCount: () => number;
  getQuantity: (itemId: number, itemType: CartItemType) => number;
  /** Lines in a cycle, optionally narrowed to one type — the cart renders a
   *  section per (cycle, type), mirroring the order rows the server writes. */
  getCycleItems: (cycleId: number, itemType?: CartItemType) => CartItem[];
  getDisplayTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      plans: [],

      addItem: (item) =>
        set((state) => {
          const existing = state.items.find((i) => sameLine(i, item.item_id, item.item_type));
          if (existing) {
            return {
              items: state.items.map((i) =>
                sameLine(i, item.item_id, item.item_type)
                  ? { ...i, quantity: i.quantity + 1 }
                  : i,
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity: 1 }] };
        }),

      removeItem: (itemId, itemType) =>
        set((state) => ({
          items: state.items.filter((i) => !sameLine(i, itemId, itemType)),
        })),

      updateQuantity: (itemId, itemType, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            return { items: state.items.filter((i) => !sameLine(i, itemId, itemType)) };
          }
          return {
            items: state.items.map((i) =>
              sameLine(i, itemId, itemType) ? { ...i, quantity } : i,
            ),
          };
        }),

      addPlan: (plan) =>
        set((state) => {
          if (state.plans.some((p) => p.plan_id === plan.plan_id)) return state;
          return { plans: [...state.plans, plan] };
        }),

      removePlan: (planId) =>
        set((state) => ({
          plans: state.plans.filter((p) => p.plan_id !== planId),
        })),

      // BUY flow replaces whatever is here — "buy this plan" is a single
      // intent, not an addition to a list.
      setSinglePlan: (plan) => set({ plans: [plan] }),

      clearPlans: () => set({ plans: [] }),

      clearCart: () => set({ items: [], plans: [] }),

      clearCycle: (cycleId) =>
        set((state) => ({
          items: state.items.filter((i) => i.cycle_id !== cycleId),
        })),

      getItemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

      getPlanCount: () => get().plans.length,

      getQuantity: (itemId, itemType) =>
        get().items.find((i) => sameLine(i, itemId, itemType))?.quantity ?? 0,

      getCycleItems: (cycleId, itemType) =>
        get().items.filter(
          (i) => i.cycle_id === cycleId && (itemType == null || i.item_type === itemType),
        ),

      /** Display-only total — items + plans. Server recalculates at checkout. */
      getDisplayTotal: () => {
        const { items, plans } = get();
        const itemsTotal = items.reduce((sum, i) => sum + i.display_price * i.quantity, 0);
        const plansTotal = plans.reduce((sum, p) => sum + p.price, 0);
        return itemsTotal + plansTotal;
      },
    }),
    {
      name: '1stone-cart',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: (persistedState, version) => {
        const s = { ...(persistedState as any) };
        // v1 → v2: add plans[] (defaulted to empty)
        if (version < 2) s.plans = [];
        // v2 → v3: the one cart. Lines were menu items only and keyed on
        // `menu_item_id`; they become food lines under the composite key.
        //
        // A cart left in the OLD essentials store is not migrated — a
        // Zustand migration is synchronous and cannot read another key out of
        // AsyncStorage. That drops any essentials mid-cart on the update that
        // ships this. Acceptable precisely once: the app is on tester phones
        // with no real customers. It would not be acceptable later.
        if (version < 3) {
          s.items = ((s.items ?? []) as any[]).map((i) => ({
            item_id: i.item_id ?? i.menu_item_id,
            item_type: i.item_type ?? 'food',
            cycle_id: i.cycle_id,
            name: i.name,
            display_price: i.display_price,
            quantity: i.quantity,
          }));
        }
        return s;
      },
    },
  ),
);
