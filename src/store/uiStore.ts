/**
 * 1stOne F1 — UI Store
 *
 * Ephemeral UI state that doesn't need persistence.
 * Loading overlays, modal visibility, active tab tracking, etc.
 */

import { create } from 'zustand';

interface UIState {
  /** Global loading overlay (payment processing, etc.) */
  isGlobalLoading: boolean;
  globalLoadingMessage: string;
  setGlobalLoading: (loading: boolean, message?: string) => void;

  /** Currently selected delivery cycle tab */
  activeCycleId: number | null;
  setActiveCycleId: (id: number | null) => void;

  /** Cart sheet visibility */
  isCartVisible: boolean;
  setCartVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isGlobalLoading: false,
  globalLoadingMessage: '',
  setGlobalLoading: (loading, message = '') =>
    set({ isGlobalLoading: loading, globalLoadingMessage: message }),

  activeCycleId: null,
  setActiveCycleId: (id) => set({ activeCycleId: id }),

  isCartVisible: false,
  setCartVisible: (visible) => set({ isCartVisible: visible }),
}));
