/**
 * 1stOne F1 — Essentials Cart Store
 *
 * Separate cart for the Essentials module (groceries, daily needs).
 * Feature-flag gated — only active when 'essentials' flag is true.
 * Same pattern as main cart but for essentials_catalog items.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface EssentialsCartItem {
  essential_item_id: number;
  name: string;
  display_price: number;
  unit: string;
  quantity: number;
}

interface EssentialsCartState {
  items: EssentialsCartItem[];
  addItem: (item: Omit<EssentialsCartItem, 'quantity'>) => void;
  removeItem: (essentialItemId: number) => void;
  updateQuantity: (essentialItemId: number, quantity: number) => void;
  clearCart: () => void;
  getItemCount: () => number;
  getDisplayTotal: () => number;
}

export const useEssentialsCartStore = create<EssentialsCartState>()(
  persist(
    (set, get) => ({
      items: [],

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

      clearCart: () => set({ items: [] }),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),

      getDisplayTotal: () =>
        get().items.reduce((sum, i) => sum + i.display_price * i.quantity, 0),
    }),
    {
      name: '1stone-essentials-cart',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
