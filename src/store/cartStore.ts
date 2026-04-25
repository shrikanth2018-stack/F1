/**
 * 1stOne F1 — Cart Store (Zustand + AsyncStorage)
 *
 * Client-side cart for menu items (meals) + subscription plans (food type).
 * Cart is cycle-aware: items are grouped by delivery_cycle_id.
 * Pricing is display-only on client; server recalculates at checkout.
 *
 * Persisted to AsyncStorage so cart survives app restart.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem, CartPlan } from '../types';

interface CartState {
  items: CartItem[];
  plans: CartPlan[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (menuItemId: number) => void;
  updateQuantity: (menuItemId: number, quantity: number) => void;
  addPlan: (plan: CartPlan) => void;
  removePlan: (planId: number) => void;
  setSinglePlan: (plan: CartPlan) => void;
  clearPlans: () => void;
  clearCart: () => void;
  clearCycle: (cycleId: number) => void;
  getItemCount: () => number;
  getPlanCount: () => number;
  getCycleItems: (cycleId: number) => CartItem[];
  getDisplayTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      plans: [],

      addItem: (item) =>
        set((state) => {
          const existing = state.items.find(
            (i) => i.menu_item_id === item.menu_item_id
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.menu_item_id === item.menu_item_id
                  ? { ...i, quantity: i.quantity + 1 }
                  : i
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity: 1 }] };
        }),

      removeItem: (menuItemId) =>
        set((state) => ({
          items: state.items.filter((i) => i.menu_item_id !== menuItemId),
        })),

      updateQuantity: (menuItemId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter((i) => i.menu_item_id !== menuItemId),
            };
          }
          return {
            items: state.items.map((i) =>
              i.menu_item_id === menuItemId ? { ...i, quantity } : i
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

      // One-plan invariant per order: BUY flow replaces whatever is here.
      setSinglePlan: (plan) => set({ plans: [plan] }),

      clearPlans: () => set({ plans: [] }),

      clearCart: () => set({ items: [], plans: [] }),

      clearCycle: (cycleId) =>
        set((state) => ({
          items: state.items.filter((i) => i.cycle_id !== cycleId),
        })),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),

      getPlanCount: () => get().plans.length,

      getCycleItems: (cycleId) =>
        get().items.filter((i) => i.cycle_id === cycleId),

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
      version: 2,
      migrate: (persistedState, version) => {
        // v1 → v2: add plans[] (defaulted to empty)
        if (version < 2) {
          return { ...(persistedState as object), plans: [] };
        }
        return persistedState;
      },
    }
  )
);
