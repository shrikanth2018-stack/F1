/**
 * 1stOne F1 — Cart Store (Zustand + AsyncStorage)
 *
 * Client-side cart for menu items (meals).
 * Cart is cycle-aware: items are grouped by delivery_cycle_id.
 * Pricing is display-only on client; server recalculates at checkout.
 *
 * Persisted to AsyncStorage so cart survives app restart.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem } from '../types';

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (menuItemId: number) => void;
  updateQuantity: (menuItemId: number, quantity: number) => void;
  clearCart: () => void;
  clearCycle: (cycleId: number) => void;
  getItemCount: () => number;
  getCycleItems: (cycleId: number) => CartItem[];
  getDisplayTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

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

      clearCart: () => set({ items: [] }),

      clearCycle: (cycleId) =>
        set((state) => ({
          items: state.items.filter((i) => i.cycle_id !== cycleId),
        })),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),

      getCycleItems: (cycleId) =>
        get().items.filter((i) => i.cycle_id === cycleId),

      /** Display-only total. Server recalculates at checkout. */
      getDisplayTotal: () =>
        get().items.reduce((sum, i) => sum + i.display_price * i.quantity, 0),
    }),
    {
      name: '1stone-cart',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
