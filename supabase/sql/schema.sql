-- ============================================================
-- 1stOne F1 — Complete Production Database Schema
-- ============================================================
-- Run this ENTIRE file in Supabase SQL Editor as ONE batch.
-- RLS is enabled separately via rls_policies.sql (idempotent).
-- See DEPLOY_SQL_ORDER.md §4 for the deploy sequence.
-- Total: 29 tables + 2 functions + indexes + triggers
-- ============================================================

-- ============================================================
-- 0. UTILITY: Auto-update updated_at on row modification
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. PROFILES & AUTH
-- ============================================================
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'staff', 'admin')),
    assigned_hub_id INTEGER DEFAULT NULL,
    branch_id INTEGER DEFAULT NULL,
    wallet_balance DECIMAL(10,2) DEFAULT 0.00,
    loyalty_points INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE,
    referred_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_profiles_phone ON profiles(phone_number);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_branch ON profiles(branch_id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. BRANCHES [feature-flagged]
-- ============================================================
CREATE TABLE branches (
    id SERIAL PRIMARY KEY,
    branch_name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. STORE CONFIG (Singleton — id=1)
-- ============================================================
CREATE TABLE store_config (
    id SERIAL PRIMARY KEY,
    tax_rate_percentage DECIMAL(5,2) DEFAULT 5.00,
    delivery_fee DECIMAL(10,2) DEFAULT 0.00,
    cancellation_window_hours INTEGER DEFAULT 2,
    storm_mode_active BOOLEAN DEFAULT FALSE,
    essentials_module_active BOOLEAN DEFAULT FALSE,
    hub_delivery_active BOOLEAN DEFAULT FALSE,
    loyalty_points_per_rupee DECIMAL(5,2) DEFAULT 0.10,
    min_wallet_topup DECIMAL(10,2) DEFAULT 100.00,
    whatsapp_support_number TEXT DEFAULT '9448364017',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    low_wallet_threshold NUMERIC DEFAULT 200,
    winback_inactive_days INTEGER DEFAULT 14
);
CREATE TRIGGER trg_store_config_updated BEFORE UPDATE ON store_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. FEATURE FLAGS
-- ============================================================
CREATE TABLE feature_flags (
    id SERIAL PRIMARY KEY,
    flag_key TEXT UNIQUE NOT NULL,
    flag_value BOOLEAN DEFAULT FALSE,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_feature_flags_updated BEFORE UPDATE ON feature_flags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. DELIVERY CYCLES
-- ============================================================
CREATE TABLE delivery_cycles (
    id SERIAL PRIMARY KEY,
    cycle_name TEXT NOT NULL,
    cutoff_time TIME NOT NULL,
    kitchen_push_time TIME NOT NULL,
    delivery_start TIME NOT NULL,
    delivery_end TIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_essentials BOOLEAN DEFAULT FALSE,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_delivery_cycles_active ON delivery_cycles(is_active);
CREATE INDEX idx_delivery_cycles_branch ON delivery_cycles(branch_id);
CREATE TRIGGER trg_delivery_cycles_updated BEFORE UPDATE ON delivery_cycles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. DELIVERY HUBS [feature-flagged]
-- ============================================================
CREATE TABLE delivery_hubs (
    id SERIAL PRIMARY KEY,
    hub_name TEXT NOT NULL,
    address_details TEXT NOT NULL,
    contact_phone TEXT,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_delivery_hubs_active ON delivery_hubs(is_active);
CREATE TRIGGER trg_delivery_hubs_updated BEFORE UPDATE ON delivery_hubs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. DELIVERY ZONES [feature-flagged]
-- ============================================================
CREATE TABLE delivery_zones (
    id SERIAL PRIMARY KEY,
    zone_name TEXT NOT NULL,
    description TEXT,
    delivery_fee_override DECIMAL(10,2) DEFAULT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_delivery_zones_updated BEFORE UPDATE ON delivery_zones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. MENU ITEMS (Food Catalog)
-- ============================================================
CREATE TABLE menu_items (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER REFERENCES delivery_cycles(id),
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    ingredients TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_menu_items_cycle ON menu_items(cycle_id);
CREATE INDEX idx_menu_items_active ON menu_items(is_active);
CREATE INDEX idx_menu_items_branch ON menu_items(branch_id);
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. ESSENTIALS CATALOG [feature-flagged]
-- ============================================================
CREATE TABLE essentials_catalog (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER REFERENCES delivery_cycles(id),
    name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    unit TEXT DEFAULT 'piece',
    is_active BOOLEAN DEFAULT TRUE,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_essentials_cycle ON essentials_catalog(cycle_id);
CREATE INDEX idx_essentials_active ON essentials_catalog(is_active);
CREATE TRIGGER trg_essentials_updated BEFORE UPDATE ON essentials_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 10. SUBSCRIPTION PLANS
-- ============================================================
CREATE TABLE subscription_plans (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER REFERENCES delivery_cycles(id),
    plan_name TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    savings_amount DECIMAL(10,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    plan_type TEXT CHECK (plan_type IN ('food', 'essential')),
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_sub_plans_cycle ON subscription_plans(cycle_id);
CREATE INDEX idx_sub_plans_active ON subscription_plans(is_active);
CREATE INDEX idx_sub_plans_type ON subscription_plans(plan_type);
CREATE TRIGGER trg_sub_plans_updated BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 11. SUBSCRIPTION PLAN ITEMS
-- ============================================================
CREATE TABLE subscription_plan_items (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL,
    item_type TEXT DEFAULT 'food' CHECK (item_type IN ('food', 'essential')),
    quantity INTEGER DEFAULT 1
);
CREATE INDEX idx_sub_plan_items_plan ON subscription_plan_items(plan_id);

-- ============================================================
-- 12. USER SUBSCRIPTIONS
-- ============================================================
CREATE TABLE user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    plan_id INTEGER REFERENCES subscription_plans(id),
    start_date DATE NOT NULL,
    days_consumed INTEGER DEFAULT 0,
    is_paused BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    payment_method TEXT CHECK (payment_method IN ('wallet', 'razorpay', 'split')),
    razorpay_order_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_user_subs_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_subs_plan ON user_subscriptions(plan_id);
CREATE INDEX idx_user_subs_active ON user_subscriptions(is_active, is_paused);
CREATE TRIGGER trg_user_subs_updated BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 13. CANCELLED SUBSCRIPTION DAYS
-- ============================================================
CREATE TABLE cancelled_subscription_days (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES user_subscriptions(id) ON DELETE CASCADE,
    cancelled_date DATE NOT NULL,
    cycle_id INTEGER REFERENCES delivery_cycles(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(subscription_id, cancelled_date, cycle_id)
);
CREATE INDEX idx_cancelled_days_sub ON cancelled_subscription_days(subscription_id);
CREATE INDEX idx_cancelled_days_date ON cancelled_subscription_days(cancelled_date);

-- ============================================================
-- 14. ORDERS
-- ============================================================
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    subscription_id INTEGER REFERENCES user_subscriptions(id) DEFAULT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0.00,
    delivery_fee DECIMAL(10,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Confirmed' CHECK (status IN (
        'Confirmed', 'Preparing', 'Ready', 'Packed',
        'Dispatched', 'On the Way', 'Delivered',
        'Received at Hub', 'Cancelled'
    )),
    order_type TEXT CHECK (order_type IN ('food', 'essential')),
    dispatch_date DATE NOT NULL,
    cycle_id INTEGER REFERENCES delivery_cycles(id),
    delivery_method TEXT DEFAULT 'direct' CHECK (delivery_method IN ('direct', 'hub')),
    hub_id INTEGER REFERENCES delivery_hubs(id) DEFAULT NULL,
    payment_method TEXT CHECK (payment_method IN ('wallet', 'razorpay', 'split')),
    razorpay_order_id TEXT,
    wallet_amount_used DECIMAL(10,2) DEFAULT 0.00,
    delivery_address_id INTEGER,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_dispatch ON orders(dispatch_date);
CREATE INDEX idx_orders_cycle ON orders(cycle_id);
CREATE INDEX idx_orders_type ON orders(order_type);
CREATE INDEX idx_orders_hub ON orders(hub_id);
CREATE INDEX idx_orders_sub ON orders(subscription_id);
CREATE INDEX idx_orders_branch ON orders(branch_id);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 15. ORDER ITEMS
-- ============================================================
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER,
    item_type TEXT DEFAULT 'food' CHECK (item_type IN ('food', 'essential')),
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_time DECIMAL(10,2) NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- 16. CUSTOMER ADDRESSES
-- ============================================================
CREATE TABLE customer_addresses (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'Home',
    full_name TEXT NOT NULL,
    address_line TEXT NOT NULL,
    landmark TEXT,
    city TEXT,
    pincode TEXT,
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_addresses_user ON customer_addresses(user_id);
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON customer_addresses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 17. WALLET TRANSACTIONS
-- ============================================================
CREATE TABLE wallet_transactions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    amount DECIMAL(10,2) NOT NULL,
    transaction_type TEXT CHECK (transaction_type IN ('credit', 'debit')),
    description TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at DESC);

-- ============================================================
-- 18. LOYALTY REDEMPTIONS
-- ============================================================
CREATE TABLE loyalty_redemptions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    points INTEGER NOT NULL,
    type TEXT CHECK (type IN ('earned', 'redeemed')),
    description TEXT,
    reference_order_id INTEGER REFERENCES orders(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_loyalty_user ON loyalty_redemptions(user_id);

-- ============================================================
-- 19. EXPENSE CLAIMS
-- ============================================================
CREATE TABLE expense_claims (
    id SERIAL PRIMARY KEY,
    staff_id UUID REFERENCES profiles(id),
    category TEXT CHECK (category IN ('Grocery', 'Vegetable', 'Stationery', 'Fuel', 'Expense')),
    description TEXT NOT NULL,
    amount DECIMAL(10,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    approved_by UUID REFERENCES profiles(id) DEFAULT NULL,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_expense_staff ON expense_claims(staff_id);
CREATE INDEX idx_expense_status ON expense_claims(status);
CREATE TRIGGER trg_expense_updated BEFORE UPDATE ON expense_claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 20. STAFF ATTENDANCE
-- ============================================================
CREATE TABLE staff_attendance (
    id SERIAL PRIMARY KEY,
    staff_id UUID REFERENCES profiles(id),
    clock_in_time TIMESTAMP WITH TIME ZONE,
    clock_out_time TIMESTAMP WITH TIME ZONE,
    clock_in_lat DECIMAL(10,7),
    clock_in_lng DECIMAL(10,7),
    clock_out_lat DECIMAL(10,7),
    clock_out_lng DECIMAL(10,7),
    date DATE NOT NULL,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL
);
CREATE INDEX idx_attendance_staff ON staff_attendance(staff_id);
CREATE INDEX idx_attendance_date ON staff_attendance(date);

-- ============================================================
-- 21. STAFF LEAVES
-- ============================================================
CREATE TABLE staff_leaves (
    id SERIAL PRIMARY KEY,
    staff_id UUID REFERENCES profiles(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    approved_by UUID REFERENCES profiles(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_leaves_staff ON staff_leaves(staff_id);
CREATE INDEX idx_leaves_status ON staff_leaves(status);
CREATE TRIGGER trg_leaves_updated BEFORE UPDATE ON staff_leaves
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 22. STAFF SALARY
-- ============================================================
CREATE TABLE staff_salary (
    id SERIAL PRIMARY KEY,
    staff_id UUID REFERENCES profiles(id),
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL,
    base_salary DECIMAL(10,2) NOT NULL,
    deductions DECIMAL(10,2) DEFAULT 0.00,
    bonus DECIMAL(10,2) DEFAULT 0.00,
    net_salary DECIMAL(10,2) NOT NULL,
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(staff_id, month, year)
);
CREATE INDEX idx_salary_staff ON staff_salary(staff_id);
CREATE TRIGGER trg_salary_updated BEFORE UPDATE ON staff_salary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 23. STAFF SHIFTS
-- ============================================================
CREATE TABLE staff_shifts (
    id SERIAL PRIMARY KEY,
    staff_id UUID REFERENCES profiles(id),
    shift_name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    days_of_week TEXT[] DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_shifts_staff ON staff_shifts(staff_id);
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON staff_shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 24. PUSH NOTIFICATION TOKENS
-- ============================================================
CREATE TABLE push_notification_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, token)
);
CREATE INDEX idx_push_tokens_user ON push_notification_tokens(user_id);
CREATE TRIGGER trg_push_tokens_updated BEFORE UPDATE ON push_notification_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 25. ADMIN NOTES TO STAFF
-- ============================================================
CREATE TABLE admin_notes (
    id SERIAL PRIMARY KEY,
    target_tab TEXT CHECK (target_tab IN ('kitchen', 'packing', 'delivery', 'all')),
    note_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES profiles(id),
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_admin_notes_updated BEFORE UPDATE ON admin_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 26. BANNERS
-- ============================================================
CREATE TABLE banners (
    id SERIAL PRIMARY KEY,
    banner_type TEXT CHECK (banner_type IN ('image', 'text')),
    image_url TEXT,
    text_content TEXT,
    is_live BOOLEAN DEFAULT FALSE,
    branch_id INTEGER REFERENCES branches(id) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_banners_updated BEFORE UPDATE ON banners
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 27. REFERRAL SETTINGS
-- ============================================================
CREATE TABLE referral_settings (
    id SERIAL PRIMARY KEY,
    referrer_reward_points INTEGER DEFAULT 50,
    referee_reward_points INTEGER DEFAULT 50,
    referrer_wallet_credit DECIMAL(10,2) DEFAULT 0.00,
    referee_wallet_credit DECIMAL(10,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER trg_referral_settings_updated BEFORE UPDATE ON referral_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 28. REFERRALS
-- ============================================================
CREATE TABLE referrals (
    id SERIAL PRIMARY KEY,
    referrer_id UUID REFERENCES profiles(id),
    referee_id UUID REFERENCES profiles(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
    reward_given BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referee ON referrals(referee_id);

-- ============================================================
-- 29. APP FEEDBACK
-- ============================================================
CREATE TABLE app_feedback (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    order_id INTEGER REFERENCES orders(id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_feedback_user ON app_feedback(user_id);
CREATE INDEX idx_feedback_order ON app_feedback(order_id);

-- ============================================================
-- JWT CUSTOM CLAIM FUNCTION (Role in token — zero extra queries)
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_role TEXT;
  user_hub INTEGER;
BEGIN
  SELECT role, assigned_hub_id INTO user_role, user_hub
  FROM public.profiles WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(claims, '{user_role}', to_jsonb(COALESCE(user_role, 'customer')));
  IF user_hub IS NOT NULL THEN
    claims := jsonb_set(claims, '{assigned_hub_id}', to_jsonb(user_hub));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SERVER TIME FUNCTION (Smart Cart Engine uses this)
-- ============================================================
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DEFERRED FOREIGN KEYS
-- ============================================================
-- The orders table is defined before customer_addresses in this
-- script (creation order driven by other dependencies), so the
-- orders.delivery_address_id → customer_addresses(id) FK cannot be
-- declared inline. Adding it here as an idempotent DO block — same
-- as supabase/sql/add_orders_delivery_address_fkey.sql, baked into
-- the bootstrap script so a fresh schema.sql run produces a
-- complete DB. Migration file kept for incremental application to
-- DBs created before this fix landed (BF-04, 2026-05-03).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_address_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_address_id_fkey
      FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id);
  END IF;
END;
$$;

-- Force PostgREST schema-cache reload so nested SELECTs through
-- orders → customer_addresses resolve correctly.
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE! All 29 tables + 2 functions created.
-- Now run seed.sql for initial data.
-- ============================================================
