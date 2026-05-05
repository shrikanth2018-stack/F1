# MF-03 Multi-Branch Readiness Audit (2026-05-05, fresh)

> Read-only audit performed against current `main` (HEAD `741fe59`). Old audit (2026-05-04) replaced by this version — several findings in the old doc had already shipped same-day in `c1ce0ab`.

## Snapshot

The app today runs single-branch with `feature_flags.branch_management_active = false`. The **plumbing** for multi-branch (JWT `branch_id` claim, `useBranchFilter`, `branchIdForWrite` write helper, super-admin branch picker on AdminHome, branch-aware reads on most hooks) is in place and working. The **data isolation layer** is not — RLS has zero branch boundaries and several tables that should carry `branch_id` don't have the column at all. That second gap is what blocks safely adding a second branch.

## Already in place — no action needed

- All admin write hooks use `bf.branchIdForWrite` (never NULL): `useBanner:70`, `useDeliveryZones:52`, `useDeliveryHubs:76`, `useSubscriptionPlans:89`, `useAdminNotes:70`, `useStockManager:116/176`, `useExpenseManager:127`, `useEssentialsCatalog:67`, `useMenuManagement:62/181`. The "Class B / 9-hooks-still-write-NULL" finding from the prior audit is stale — fixed in `c1ce0ab`.
- `useBranchFilter` exposes `isSuperAdmin` and `branchIdForWrite` (`useBranchFilter.ts:45-72`).
- Super-admin branch picker is wired in `AdminHome.tsx:52-82` (renders only when `bf.isSuperAdmin`, persists to `branchStore`).
- OnboardEmployee branch picker conditional in place (`OnboardEmployeeScreen.tsx:188+`); validation rejects null branch when super-admin and flag active.
- JWT `custom_access_token_hook` injects `branch_id` from `profiles.branch_id` (`custom_access_token_hook.sql:32-43`).
- `place-order` Edge Function reads `branch_id` from the customer's address and threads it into `orders` + `user_subscriptions` (`place-order/index.ts:141, 171, 384, 443`). The mechanism is right; the input data is the gap (see below).
- Catalog reads are branch-aware on every consumer hook (`useMenuItems`, `useDeliveryCycles`, `useSubscriptionPlans`, `useDeliveryHubs`, `useDeliveryZones`, `useBanner`, etc.) — query keys include `bf.branchId`, queries apply `.eq('branch_id', bf.branchId)` when active.

## Open — schema-level gaps (the big new finding)

The previous audit assumed every branch-aware table had the column. Several don't.

- **`customer_addresses` has no `branch_id` column.** `place-order:141` selects it but the field is always undefined → `orders.branch_id` always lands NULL. This is the head of the chain that makes order isolation impossible. Fix: add the column + backfill from `delivery_zones.branch_id` / `delivery_hubs.branch_id`.
- **`user_subscriptions` has no `branch_id` column.** `place-order:443` writes `plan.branch_id ?? null` but reads can't filter by branch — explains why `useSubscriptionReport` and `useSubscriptionPlanReport` don't try.
- **`cancelled_subscription_days`** — no column. Less critical (joinable to `user_subscriptions` once that's fixed).
- **`staff_leaves` / `staff_salary` / `staff_shifts`** — no column. Inconsistent with `staff_attendance` / `expense_claims` which DO have it. Add the column.
- **`push_notification_tokens`** — no column. Branch can be derived via JOIN to `profiles.branch_id`; column not strictly required.

## Open — RLS has zero branch boundaries

- `rls_policies.sql:28-31` defines `jwt_branch_id()` but **no policy uses it**. Every admin and staff path is `is_admin()` or `is_staff_or_admin()` only.
- File header at lines 4-6 is stale (`STATUS: DISABLED during development` — RLS is actually enabled in dev + prod).
- ~18 policies need a branch clause: `profiles`, `orders`, `order_items`, `user_subscriptions`, `cancelled_subscription_days`, `customer_addresses`, `wallet_transactions`, `expense_claims`, `staff_attendance`, `staff_leaves`, `staff_salary`, `business_expenses`, `admin_notes`, plus the catalog DO-loop tables (`menu_items`, `essentials_catalog`, `delivery_cycles`, `delivery_hubs`, `delivery_zones`, `subscription_plans`, `subscription_plan_items`, `banners`).
- Fix shape per policy (uniform): `USING (public.is_super_admin() OR (public.is_admin() AND branch_id = jwt_branch_id()) OR (other-self-clause))`. Plus a new helper `is_super_admin()` defined as `role = 'admin' AND jwt_branch_id() IS NULL`.
- Single dedicated PR is the right shape — broad surface, uniform pattern, narrow review focus.

## Open — customer onboarding leaves branch unset

- `complete_onboarding.sql:52-66` — INSERTs `profiles` + `customer_addresses` without `branch_id`.
- `handle_new_user` trigger (production-only per CL-11, MF-08) — creates stub profile with no `branch_id`.
- Effect: every new customer's profile and address are created with NULL branch, so their orders / subscriptions / addresses chain to NULL.
- Fix: the address has `zone_id` and `hub_id` at insert time; both reference tables that carry `branch_id`. The RPC can derive branch server-side (`SELECT branch_id FROM delivery_zones WHERE id = p_zone_id`, fallback to `delivery_hubs`, default 1). Single source of truth, no client trust expansion.

## Open — staff INSERTs miss branch_id

- `useAttendance.ts:116-122` — `staff_attendance` upsert payload has no `branch_id`. Table has the column. Fix: add `branch_id: bf.branchIdForWrite`.
- `useAttendance.ts:253-258` — `staff_leaves` insert has no `branch_id`. Table needs the column added.
- `useResourceManager.ts:303-308` — `staff_salary` insert has no `branch_id`. Table needs the column added.

## Open — two reports leak across branches

- `useReports.ts:140-182` (`useSubscriptionReport`) — no `useBranchFilter`, no `.eq('branch_id', ...)`. Counts subs across all branches.
- `useReports.ts:329-354` (`useSubscriptionPlanReport`) — same. Plan-wise breakdown leaks.
- Both blocked by `user_subscriptions.branch_id` not existing — fix the column first, then add the filter.

## Open — JWT staleness after onboarding (small but real)

- `custom_access_token_hook` injects `branch_id` from `profiles.branch_id` at token issuance. A customer who signs in via OTP, *then* onboards (writing `profile.branch_id`), holds a stale JWT with NULL branch until the next refresh (~hourly).
- During that window, branch-filtered customer reads (menu, plans, banners) see all branches.
- Fix: call `supabase.auth.refreshSession()` from the client immediately after `complete_onboarding_atomic` returns (in `useCompleteOnboarding`). ~3 lines.

## Stale duplicate column

- `store_config.branch_management_active` (`schema.sql:69`) — never read by client code (only `feature_flags.branch_management_active` is read). Drop the column or remove from selects.

## Super-admin login — what exists, what's missing

**Today.** Super-admin = profile row with `role = 'admin'` AND `branch_id IS NULL`. The JWT's `branch_id` claim becomes NULL, `useBranchFilter.isSuperAdmin = true`, the AdminHome branch picker appears (`AdminHome.tsx:52-82`), and the user can switch branches via the store. This works.

**Missing.** No test persona is set up as super-admin. Phone `777` has `branch_id = 1` in production, making them a branch-1 admin. To exercise super-admin behavior end-to-end, add a new test phone (e.g. `888`) with `role='admin'` and `branch_id=NULL`. One-line SQL.

## Decisions needed

1. **Onboarding `branch_id` derivation.** Three options:
   - (a) RPC derives `branch_id` server-side from `delivery_zones.branch_id` (fall back to `delivery_hubs.branch_id`, then 1). **Recommend.**
   - (b) Client passes `branch_id` parameter; RPC trusts it.
   - (c) Trigger writes NULL; RPC overwrites once address resolves.

2. **`staff_leaves` / `staff_salary` / `staff_shifts`: add column or JOIN-filter?** **Recommend column** (matches `staff_attendance` / `expense_claims`; consistent shape; cheap migration).

3. **Drop `store_config.branch_management_active` column?** **Recommend yes** — dead duplicate.

4. **Super-admin test persona.** Add `888` with `role='admin'`, `branch_id=NULL`?

5. **Catalog model — per-branch or shared?** Schema today treats menu / plans / cycles / essentials / banners as per-branch (every row carries `branch_id`). Confirms autonomy per branch. If you wanted a shared catalog (one menu serves all branches), schema would need to allow nullable branch_id meaning "global" — a different design. **Confirm "per-branch" is the intent before fixes land.**

## Recommended fix order

1. Architectural calls (the five decisions above).
2. **Schema migration** — add `branch_id` column to `customer_addresses`, `user_subscriptions`, `cancelled_subscription_days`, `staff_leaves`, `staff_salary`, `staff_shifts`. Single migration file.
3. **`complete_onboarding_atomic` RPC update** — server-derive `branch_id` from zone/hub.
4. **Capture `handle_new_user` into tracked SQL** (closes part of MF-08) — leave it writing NULL, derivation happens in `complete_onboarding_atomic`.
5. **`useCompleteOnboarding`** — add `supabase.auth.refreshSession()` after RPC returns, so the JWT picks up the freshly-written branch.
6. **`place-order` Edge Function** — already correct once `customer_addresses.branch_id` is populated. No code change.
7. **`useAttendance` (clock-in + leave) and `useResourceManager` (salary)** — add `branch_id: bf.branchIdForWrite` to the three INSERT payloads.
8. **`useReports`** — add `useBranchFilter` to `useSubscriptionReport` + `useSubscriptionPlanReport`.
9. **Backfill SQL** (one-off, run before flag flip): `UPDATE ... SET branch_id = 1 WHERE branch_id IS NULL` across every branch-aware table (~14 tables).
10. **RLS PR** (largest single piece): ~18 policies grow a `(is_super_admin() OR (admin AND branch_id = jwt_branch_id()) OR self-clause)` pattern. Define `is_super_admin()` helper. Update file header.
11. **Add `888` super-admin test phone**; **drop `store_config.branch_management_active`**.
12. **Flip `feature_flags.branch_management_active = true`** after #9 + #10 land.

## Verified findings (caveats resolved 2026-05-05)

- **Edge functions verified clean.** `send-push` already accepts a `branch_id` parameter (line 12, 89, 138) and filters profiles by it when set — branch-aware notification targeting is in place. The payment/operational functions (`verify-payment`, `confirm-order`, `confirm-topup`, `wallet-topup`, `cancel-order`, `apply-referral`, `elevate-employee`) operate on row-by-row identifiers; `branch_id` flows through the row's existing column. Scheduled push functions (`subscription-expiry-push`, `low-wallet-check`, `dormant-user-check`) iterate users to send each one their own notification — branch-agnostic by design and correct (each customer's push reaches them regardless of branch). SQL-side `kitchen_cutoff_push.sql` reads `cycle.branch_id` (line 81, 90, 136) and `generate_daily_manifest.sql` reads `plan.branch_id` (line 70, 140, 151). **No edge function changes needed.**
- **Catalog model is per-branch (confirmed).** Every catalog table — `menu_items`, `essentials_catalog`, `delivery_cycles`, `delivery_hubs`, `delivery_zones`, `subscription_plans`, `banners` — carries `branch_id` and is filtered by it in customer/admin reads via `useBranchFilter`. Each branch owns its own catalog rows (admin must duplicate for parity if desired). Matches the "branches are autonomous" architecture per Master Doc.
- **JWT-staleness fix is one line, pattern already exists.** `useAuth.ts:96-108` already calls `supabase.auth.refreshSession()` on app foreground for exactly this kind of claim refresh. Same call needs to fire from `useCompleteOnboarding` after the RPC succeeds. Single addition to that hook's `onSuccess`.

## New finding — no admin UI to add a branch

`useBranches.ts:14-31` is read-only (SELECT only). No hook or screen exists for INSERT/UPDATE on the `branches` table. Master Doc references a "Branches" Manage screen, but it doesn't exist in code. Adding branch 2 today = direct SQL via Supabase dashboard. Fine for first launch (one-time op done by Shrikanth), but a "Branches" Manage screen is post-launch follow-up for self-service.

## Phone uniqueness note

Supabase Auth makes `auth.users.phone` globally unique. A customer/staff phone exists in exactly one branch via `profiles.branch_id`. Moving someone between branches = update profile.branch_id, not new account. Fine for the data model; worth noting in operational guide.

## Counts

- 4 architectural decisions / one-off setup items.
- 6 schema columns to add.
- 5 hook payloads to amend (3 staff INSERTs + 2 report filters).
- 1 RPC to update + 1 trigger to track.
- 1 client `refreshSession` call.
- 1 backfill migration (~18 tables).
- ~18 RLS policies to grow a branch clause + 1 new helper function.
- 1 column to drop, 1 super-admin test phone to add.

---

# Final execution plan (2026-05-05)

## Decisions Shrikanth needs to make before commit 1

1. **Onboarding `branch_id` derivation:** RPC server-derives from `delivery_zones.branch_id` (fall back to `delivery_hubs.branch_id`, then 1). **Recommended.**
2. **`staff_leaves` / `staff_salary` / `staff_shifts`:** add `branch_id` column (matches `staff_attendance` / `expense_claims`). **Recommended.**
3. **Drop `store_config.branch_management_active`** dead duplicate column. **Recommended.**
4. **Add `888` super-admin test persona** (`role='admin'`, `branch_id=NULL`). **Recommended.**

## Execution — 5 commit groups + 1 approval gate + flag flip

### Commit 1 — Schema + onboarding foundation (DB-only)
- Add `branch_id` to: `customer_addresses`, `user_subscriptions`, `cancelled_subscription_days`, `staff_leaves`, `staff_salary`, `staff_shifts`. Single migration file.
- Rewrite `complete_onboarding_atomic.sql` — derive `branch_id` server-side from `delivery_zones` / `delivery_hubs`; write to both `profiles` and `customer_addresses`.
- Capture `handle_new_user` trigger into tracked SQL (writes NULL; RPC fills it). Closes part of MF-08.
- Add `is_super_admin()` SQL helper: `role = 'admin' AND jwt_branch_id() IS NULL`.

### Commit 2 — Client write payloads (close staff INSERTs + JWT refresh)
- `src/hooks/useCompleteOnboarding.ts` — call `supabase.auth.refreshSession()` in `onSuccess` so JWT picks up freshly-written `branch_id`.
- `src/hooks/useAttendance.ts:116-122` — add `branch_id: bf.branchIdForWrite` to clock-in payload.
- `src/hooks/useAttendance.ts:253-258` — same for `staff_leaves` insert.
- `src/hooks/useResourceManager.ts:303-308` — same for `staff_salary` insert.

### Commit 3 — Reports filter fix
- `src/hooks/useReports.ts:140-182` (`useSubscriptionReport`) — add `useBranchFilter`, apply `.eq('branch_id', bf.branchId)` when active.
- `src/hooks/useReports.ts:329-354` (`useSubscriptionPlanReport`) — same.

### Commit 4 — RLS branch boundaries (single dedicated PR)
- ~18 policies grow `(public.is_super_admin() OR (admin AND branch_id = jwt_branch_id()) OR self-clause)` pattern.
- Replace stale `STATUS: DISABLED during development` header (file lines 4-6).
- Tables to update: `profiles`, `orders`, `order_items`, `user_subscriptions`, `cancelled_subscription_days`, `customer_addresses`, `wallet_transactions`, `expense_claims`, `staff_attendance`, `staff_leaves`, `staff_salary`, `business_expenses`, `admin_notes`, plus the catalog DO-loop tables (`menu_items`, `essentials_catalog`, `delivery_cycles`, `delivery_hubs`, `delivery_zones`, `subscription_plans`, `subscription_plan_items`, `banners`).

### APPROVAL GATE — one-time backfill SQL (Shrikanth approves before run)

Run **once** before flipping the flag. Every new row after Commit 2 lands gets `branchIdForWrite` (never NULL) — no further backfill needed ever.

```sql
UPDATE profiles                      SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE customer_addresses            SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE user_subscriptions            SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE orders                        SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE staff_attendance              SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE staff_leaves                  SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE staff_salary                  SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE staff_shifts                  SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE cancelled_subscription_days   SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE expense_claims                SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE menu_items                    SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE essentials_catalog            SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE delivery_cycles               SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE delivery_hubs                 SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE delivery_zones                SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE subscription_plans            SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE banners                       SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE admin_notes                   SET branch_id = 1 WHERE branch_id IS NULL;
```

### Commit 5 — Cleanup + super-admin persona
- Drop `store_config.branch_management_active` column (dead duplicate).
- Add `888` super-admin test phone (auth.users + profiles row with `role='admin'`, `branch_id=NULL`).

### Flag flip
```sql
UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';
```

After flip: super-admin can switch branches via picker; branch admins/staff scoped to their branch; customers see only their branch's catalog.

## Post-launch follow-ups (not blockers for branch 2)

- **"Branches" Manage admin screen** — currently no UI to add a new branch row; do it via SQL once for branch 2. Future FT-XX for self-service branch CRUD.
- **Spot-check scheduled push functions in multi-branch context** — confirm sub-expiry / low-wallet / dormant pushes fire correctly per-customer (~30 min check).

## Fresh session bring-up

A fresh Cowork session resuming this work should read, in order:
1. `docs/SESSION_START.md`
2. `docs/RULES.md`
3. `docs/STATUS.md`
4. **This audit document** (`docs/MF-03_multi_branch_audit.md`) — full plan above.
5. `docs/DECISIONS.md` for any newer items not in this audit.

The work resumes at: Shrikanth confirms decisions 1-4 → execute Commit 1.
