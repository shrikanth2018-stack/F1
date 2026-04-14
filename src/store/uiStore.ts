/**
 * 1stOne F1 — UI Store
 *
 * Ephemeral UI state that doesn't need persistence.
 * Loading overlays, modal visibility, active tab tracking, etc.
 */

import { create } from 'zustand';

type HomeTab = 'food' | 'essentials';

interface UIState {
  /** Global loading overlay (payment processing, etc.) */
  isGlobalLoading: boolean;
  globalLoadingMessage: string;
  setGlobalLoading: (loading: boolean, message?: string) => void;

  /** Cart sheet visibility */
  isCartVisible: boolean;
  setCartVisible: (visible: boolean) => void;

  /** Home screen toggle: food (default) | essentials */
  activeHomeTab: HomeTab;
  setActiveHomeTab: (tab: HomeTab) => void;

  /** Profile popup visibility */
  isProfileVisible: boolean;
  setProfileVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isGlobalLoading: false,
  globalLoadingMessage: '',
  setGlobalLoading: (loading, message = '') =>
    set({ isGlobalLoading: loading, globalLoadingMessage: message }),

  isCartVisible: false,
  setCartVisible: (visible) => set({ isCartVisible: visible }),

  activeHomeTab: 'food',
  setActiveHomeTab: (tab) => set({ activeHomeTab: tab }),

  isProfileVisible: false,
  setProfileVisible: (visible) => set({ isProfileVisible: visible }),
}));
