/**
 * 1stOne F1 — Essentials Cart Store
 *
 * Separate cart for the Essentials module (groceries, daily needs) + essentials subscription plans.
 * Feature-flag gated — only active when 'essentials' flag is true.
 * Same pattern as main cart but for essentials_catalog items.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartPlan } from '../types';

interface EssentialsCartItem {
  essential_item_id: number;
  cycle_id: number;
  name: string;
  display_price: number;
  unit: string;
  quantity: number;
}

interface EssentialsCartState {
  items: EssentialsCartItem[];
  plans: CartPlan[];
  addItem: (item: Omit<EssentialsCartItem, 'quantity'>) => void;
  removeItem: (essentialItemId: number) => void;
  updateQuantity: (essentialItemId: number, quantity: number) => void;
  addPlan: (plan: CartPlan) => void;
  removePlan: (planId: number) => void;
  setSinglePlan: (plan: CartPlan) => void;
  clearPlans: () => void;
  clearCart: () => void;
  getItemCount: () => number;
  getPlanCount: () => number;
  getDisplayTotal: () => number;
}

export const useEssentialsCartStore = create<EssentialsCartState>()(
  persist(
    (set, get) => ({
      items: [],
      plans: [],

      addItem: (item) =>
        set((state) => {
          const existing = state.items.find(
            (i) => i.essential_item_id === item.essential_item_id
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.essential_item_id === item.essential_item_id
                  ? { ...i, quantity: i.quantity + 1 }
                  : i
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity: 1 }] };
        }),

      removeItem: (essentialItemId) =>
        set((state) => ({
          items: state.items.filter(
            (i) => i.essential_item_id !== essentialItemId
          ),
        })),

      updateQuantity: (essentialItemId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter(
                (i) => i.essential_item_id !== essentialItemId
              ),
            };
          }
          return {
            items: state.items.map((i) =>
              i.essential_item_id === essentialItemId ? { ...i, quantity } : i
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

      setSinglePlan: (plan) => set({ plans: [plan] }),

      clearPlans: () => set({ plans: [] }),

      clearCart: () => set({ items: [], plans: [] }),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),

      getPlanCount: () => get().plans.length,

      getDisplayTotal: () => {
        const { items, plans } = get();
        const itemsTotal = items.reduce((sum, i) => sum + i.display_price * i.quantity, 0);
        const plansTotal = plans.reduce((sum, p) => sum + p.price, 0);
        return itemsTotal + plansTotal;
      },
    }),
    {
      name: '1stone-essentials-cart',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persistedState, version) => {
        if (version < 2) {
          return { ...(persistedState as object), plans: [] };
        }
        return persistedState;
      },
    }
  )
);
