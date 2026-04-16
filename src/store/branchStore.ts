/**
 * 1stOne F1 — Branch Filter Store
 *
 * Super-admin only: persists the branch the admin has chosen to view.
 * null = "All Branches" (unfiltered).
 *
 * Branch-specific admins (branchId in JWT) ignore this store — their
 * branch is locked in the JWT and read directly in useBranchFilter.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BranchState {
  selectedBranchId: number | null;
  selectedBranchName: string | null;
  setSelectedBranch: (id: number | null, name: string | null) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      selectedBranchId: null,
      selectedBranchName: null,
      setSelectedBranch: (id, name) =>
        set({ selectedBranchId: id, selectedBranchName: name }),
    }),
    {
      name: '1stone-branch-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
