// Mock AsyncStorage — Zustand persist middleware would otherwise try to load it
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { useCartStore } from '@/store/cartStore';

const samplePlanA = {
  plan_id: 1,
  plan_name: 'Food 30',
  cycle_id: 1,
  duration_days: 30,
  price: 2000,
  plan_type: 'food' as const,
  start_date: '2026-05-01',
  plan_item_ids: [],
};

const samplePlanB = {
  plan_id: 2,
  plan_name: 'Essentials 30',
  cycle_id: 1,
  duration_days: 30,
  price: 1500,
  plan_type: 'essentials' as const,
  start_date: '2026-05-01',
  plan_item_ids: [],
};

const sampleItem = {
  menu_item_id: 10,
  cycle_id: 1,
  name: 'Tiffin',
  display_price: 120,
};

describe('cartStore — items', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('starts with empty items and plans', () => {
    const s = useCartStore.getState();
    expect(s.items).toEqual([]);
    expect(s.plans).toEqual([]);
  });

  it('addItem inserts a new item with quantity=1', () => {
    useCartStore.getState().addItem(sampleItem);
    expect(useCartStore.getState().items).toEqual([{ ...sampleItem, quantity: 1 }]);
  });

  it('addItem increments quantity for an existing menu_item_id', () => {
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().addItem(sampleItem);
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
  });

  it('updateQuantity removes the item when quantity drops to 0', () => {
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().updateQuantity(sampleItem.menu_item_id, 0);
    expect(useCartStore.getState().items).toEqual([]);
  });

  it('updateQuantity removes the item for a negative quantity', () => {
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().updateQuantity(sampleItem.menu_item_id, -5);
    expect(useCartStore.getState().items).toEqual([]);
  });
});

describe('cartStore — plans (one-plan invariant)', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('addPlan adds a plan that is not already in cart', () => {
    useCartStore.getState().addPlan(samplePlanA);
    expect(useCartStore.getState().plans).toEqual([samplePlanA]);
  });

  it('addPlan is idempotent — does NOT add if same plan_id is already in cart', () => {
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addPlan(samplePlanA);
    expect(useCartStore.getState().plans).toHaveLength(1);
  });

  it('addPlan can hold multiple distinct plans (legacy multi-plan path)', () => {
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addPlan(samplePlanB);
    expect(useCartStore.getState().plans).toHaveLength(2);
  });

  it('setSinglePlan REPLACES whatever is in plans (BUY-flow invariant)', () => {
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addPlan(samplePlanB);
    useCartStore.getState().setSinglePlan({ ...samplePlanA, plan_id: 99 });
    const plans = useCartStore.getState().plans;
    expect(plans).toHaveLength(1);
    expect(plans[0]?.plan_id).toBe(99);
  });

  it('clearPlans removes all plans but keeps items', () => {
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().clearPlans();
    expect(useCartStore.getState().plans).toEqual([]);
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('clearCart wipes both plans and items', () => {
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().clearCart();
    const s = useCartStore.getState();
    expect(s.plans).toEqual([]);
    expect(s.items).toEqual([]);
  });
});

describe('cartStore — cycle scoping', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('clearCycle removes only items in the given cycle', () => {
    useCartStore.getState().addItem({ ...sampleItem, cycle_id: 1 });
    useCartStore.getState().addItem({ ...sampleItem, menu_item_id: 11, cycle_id: 2 });
    useCartStore.getState().clearCycle(1);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]?.cycle_id).toBe(2);
  });

  it('getCycleItems returns only items in the given cycle', () => {
    useCartStore.getState().addItem({ ...sampleItem, cycle_id: 1 });
    useCartStore.getState().addItem({ ...sampleItem, menu_item_id: 11, cycle_id: 2 });
    expect(useCartStore.getState().getCycleItems(1)).toHaveLength(1);
    expect(useCartStore.getState().getCycleItems(2)).toHaveLength(1);
    expect(useCartStore.getState().getCycleItems(3)).toEqual([]);
  });

  it('clearCycle does NOT touch plans (different concern)', () => {
    useCartStore.getState().addItem({ ...sampleItem, cycle_id: 1 });
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().clearCycle(1);
    expect(useCartStore.getState().plans).toHaveLength(1);
  });

  it('same menu_item_id in different cycles is treated as ONE record (current behavior)', () => {
    // Note: addItem matches solely on menu_item_id, ignoring cycle_id.
    // If admin reuses the same menu_item across cycles, the second add
    // increments the first record's quantity. Documented for awareness.
    useCartStore.getState().addItem({ ...sampleItem, cycle_id: 1 });
    useCartStore.getState().addItem({ ...sampleItem, cycle_id: 2 });
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });
});

describe('cartStore — getDisplayTotal math', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('returns 0 for an empty cart', () => {
    expect(useCartStore.getState().getDisplayTotal()).toBe(0);
  });

  it('sums items by display_price × quantity', () => {
    useCartStore.getState().addItem({ ...sampleItem, display_price: 120 });
    useCartStore.getState().addItem({ ...sampleItem, display_price: 120 });
    useCartStore.getState().addItem({ ...sampleItem, display_price: 120 });
    expect(useCartStore.getState().getDisplayTotal()).toBe(360);
  });

  it('sums plan prices (one entry per plan, regardless of duration)', () => {
    useCartStore.getState().addPlan(samplePlanA); // 2000
    useCartStore.getState().addPlan(samplePlanB); // 1500
    expect(useCartStore.getState().getDisplayTotal()).toBe(3500);
  });

  it('combines items + plans correctly', () => {
    useCartStore.getState().addItem({ ...sampleItem, display_price: 120 });
    useCartStore.getState().addItem({ ...sampleItem, display_price: 120 });
    useCartStore.getState().addPlan(samplePlanA); // 2000
    expect(useCartStore.getState().getDisplayTotal()).toBe(120 * 2 + 2000);
  });

  it('handles fractional prices without floating-point drift for normal cases', () => {
    useCartStore.getState().addItem({ ...sampleItem, display_price: 99.5 });
    useCartStore.getState().addItem({ ...sampleItem, display_price: 99.5 });
    expect(useCartStore.getState().getDisplayTotal()).toBe(199);
  });
});

describe('cartStore — getItemCount and getPlanCount', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
  });

  it('getItemCount sums quantities across all items', () => {
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().addItem(sampleItem);
    useCartStore.getState().addItem({ ...sampleItem, menu_item_id: 11 });
    expect(useCartStore.getState().getItemCount()).toBe(3);
  });

  it('getPlanCount returns the number of plan entries', () => {
    expect(useCartStore.getState().getPlanCount()).toBe(0);
    useCartStore.getState().addPlan(samplePlanA);
    useCartStore.getState().addPlan(samplePlanB);
    expect(useCartStore.getState().getPlanCount()).toBe(2);
  });
});
