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
});
