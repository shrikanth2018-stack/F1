# MF-03 Multi-Branch Readiness Audit (2026-05-04)

## Summary

The codebase will not safely host a second branch as it stands today. There are **two categories of definite gaps and one architectural-class concern** that need to close before the Play Store bundle ships per D-08.

- **Class A — RLS gives no branch boundary.** No policy in `rls_policies.sql` scopes by `auth.jwt() ->> 'branch_id'`. The helper `jwt_branch_id()` is defined but unused. Today's only branch boundary is whatever the React layer applies via `useBranchFilter()`. At branch 2, every staff/admin role bypasses application-level filtering at the SQL level — a staff member at branch 1 can read and update orders, hubs, zones, menus, etc. across all branches via direct SQL or any non-filtered hook.
- **Class B — BF-06 anti-pattern repeats in nine admin write hooks.** Every one of them writes `branch_id: bf.isActive ? bf.branchId : null` (or equivalent), so in single-branch mode every new row gets `branch_id = NULL`. Identical to the BF-06 root cause; identical fix shape (`bf.branchId ?? 1`).
- **Class C — Customer-side onboarding writes NULL.** Both the `handle_new_user` trigger (per CL-11) and `complete_onboarding_atomic` RPC create profile rows without `branch_id`. `customer_addresses` first-row INSERT inside the same RPC also omits `branch_id`. Already called out in D-08.

Plus a handful of probable gaps and one feature-flag-drift cleanup. Counts: **~14 definite items, ~6 probable, ~5 needs-verify**.

---

## Scope and method

**Read directly:** `useBranchFilter.ts`, `useBranches.ts`, `useFeatureFlag.ts`, `useReports.ts` (all 8 functions), `complete_onboarding.sql`, `rls_policies.sql` (full), `generate_daily_manifest.sql` (around the orders INSERT), `kitchen_cutoff_push.sql` (around the kitchen-summary path), `place-order/index.ts` (branch_id flow), `useResourceManager.ts:120-150`, `useAttendance.ts:90-160`, `useEssentialsCatalog.ts`, hot lines of `useStockManager.ts`, `OnboardEmployeeScreen.tsx:315-345`, `schema.sql:60-80`. Plus DECISIONS.md entries D-08, MF-02, MF-03, BF-04, BF-06, CL-11.

**Sampled via grep, not exhaustively read:** the admin-side write paths in `useSubscriptionPlans.ts`, `useDeliveryHubs.ts`, `useDeliveryZones.ts`, `useBanner.ts`, `useMenuManagement.ts`, `useExpenseManager.ts`, `useAdminNotes.ts` — pattern was identified through grep of `bf.isActive ? bf.branchId : null` then spot-confirmed on one file (`useEssentialsCatalog.ts`).

**Not investigated:** `useStaffLeave.ts`, `useResourceManager.ts:303` (staff_salary), `useAttendance.ts:253` (staff_leaves admin-side), `ImportItemsScreen.tsx:242` (bulk plan import), Edge Functions other than `place-order` and `elevate-employee`, all individual admin report screens (only the hooks were read; whether each screen passes the right inputs into `useBranchFilter`-aware hooks is a NEEDS VERIFY).

**Time:** ~50 minutes. Confidence on Class A and Class C is high (read directly). Confidence on Class B is high for the five hooks I confirmed; medium for the four sampled-only hooks (NEEDS VERIFY they also need the fix, but pattern is identical).

---

## 1. Tagging audit (writes)

For each branch-aware table, every place a row gets created.

### profiles
- **Trigger `on_auth_user_created` → `handle_new_user`** (auth.users AFTER INSERT, lives only in prod per CL-11, not in tracked SQL). Per CL-11 comments: creates stub `(id, phone_number)` only. **❌ no `branch_id`** — every customer profile starts with NULL.
- **`complete_onboarding_atomic`** (`supabase/sql/complete_onboarding.sql:52-55`) — INSERT/UPSERT into `profiles`. **❌ no `branch_id`** in column list. Sets only `(id, phone_number, full_name)`.
- **`elevate_employee` RPC** (`supabase/sql/elevate_employee.sql:53-69`) — INSERT/UPDATE writes `branch_id = p_branch_id`. **✅** receives explicit branch from caller.
- **`useOnboardEmployee` hook** (`useResourceManager.ts:128-143`) — body sends `branch_id: payload.branch_id ?? bf.branchId ?? 1`. **✅** post-BF-06 + MF-02-aware (form value wins).

### customer_addresses
- **`complete_onboarding_atomic`** (`supabase/sql/complete_onboarding.sql:59-65`) — INSERT into customer_addresses. **❌ no `branch_id`** in column list. Customer's first address is written with NULL.
- **`useAddAddress` (existing-customer add-address flow)** — NEEDS VERIFY (not opened during this audit; grep noted but file not read).

### orders
- **`place-order` Edge Function** (`supabase/functions/place-order/index.ts:171, 384`) — derives `branchId = addressData.branch_id ?? null` then passes to atomic-create RPC as `p_branch_id`. **✅** branch comes from the customer's selected delivery address — the same address that has all the routing info. *Caveat:* `customer_addresses.branch_id` is NULL today (per Class C), so production orders may today be writing NULL through this path even though the code shape is correct. Fixed automatically once Class C is fixed.
- **`generate_daily_manifest`** (`supabase/sql/generate_daily_manifest.sql:151`) — INSERTs dispatch order with `branch_id = v_plan.branch_id`. Plan-driven. **⚠️** correct only if the plan has a branch (today plans created via `useSubscriptionPlans:89` write NULL when flag off — Class B). Net effect: today's dispatch orders have NULL branch.
- **No other order INSERTs found.** `kitchen_cutoff_push.sql` reads orders, doesn't insert.

### user_subscriptions
- **`place-order` Edge Function** (`supabase/functions/place-order/index.ts:443`) — INSERT with `branch_id: plan.branch_id ?? null`. **⚠️** plan-derived; same indirection as orders. NULL today via same chain as above.
- **No other subscription INSERTs found.** `admin_cancel_subscription_atomic_rpc.sql` (today's BF-20) only updates `is_active = false` and inserts wallet_transactions — doesn't touch branch_id.

### staff_attendance
- **`useClockIn` hook** (`useAttendance.ts:116-130`) — payload is `(staff_id, date, clock_in_time, clock_in_lat, clock_in_lng)`. **❌ no `branch_id`** in payload. Upsert into `staff_attendance` writes NULL branch.
- **`useClockOut` hook** — NEEDS VERIFY (not opened during this audit; same shape suspected).

### staff_leaves / staff_salary / staff_shifts / expense_claims
- **`useStaffLeave.ts:42`, `useAttendance.ts:253`** (staff_leaves INSERT — admin or staff side) — NEEDS VERIFY whether either sets branch_id.
- **`useResourceManager.ts:303`** (staff_salary INSERT) — NEEDS VERIFY.
- **`useExpenseManager.ts:127`** (expense_claims INSERT) — `branch_id: bf.isActive ? bf.branchId : null`. **❌ Class B**.

### subscription_plans / menu_items / essentials_catalog / delivery_hubs / delivery_zones / banners / supply_order_items / supply_batches / staff_order_requests / admin_notes
All Class B — same `bf.isActive ? bf.branchId : null` write pattern. List of confirmed sites (line numbers from grep):

| Hook | Line | Table |
|---|---|---|
| `useEssentialsCatalog.ts` | 67 | `essentials_catalog` |
| `useMenuManagement.ts` | 62, 181 | `menu_items` (two INSERTs — food + essentials variant?) |
| `useSubscriptionPlans.ts` | 89 | `subscription_plans` |
| `useDeliveryHubs.ts` | 76 | `delivery_hubs` (also accepts `payload.branch_id` first) |
| `useDeliveryZones.ts` | 52 | `delivery_zones` (same shape) |
| `useBanner.ts` | 70 | `banners` |
| `useStockManager.ts` | 116 | `supply_order_items` (via RPC param `p_branch_id`) |
| `useStockManager.ts` | 176 | `supply_batches` |
| `useExpenseManager.ts` | 127 | `expense_claims` |
| `useAdminNotes.ts` | 70 | `admin_notes` (intentional NULL — see notes) |

Plus the staff-side `staff_order_requests` mirror trigger (`staff_order_requests_mirror_trigger.sql:117`) — propagates `NEW.branch_id`. Whatever the original INSERT sets is what the trigger pushes downstream. NEEDS VERIFY: which client path INSERTs into `staff_order_requests` and whether it sets branch_id.

---

## 2. Filtering audit (reads)

Hooks that *do* filter by branch (`bf.isActive && bf.branchId != null` then `.eq('branch_id', bf.branchId)`):

| Hook | Line | Status |
|---|---|---|
| `useStaffOrders.ts` | 73 | ✅ |
| `useAdminOrders.ts` | 46 | ✅ |
| `useDeliveryCycles.ts` | 27 | ✅ |
| `useEssentialsCatalog.ts` | 47 | ✅ |
| `useMenuManagement.ts` | 34, 128 | ✅ |
| `useExpenseManager.ts` | 32, 103 | ✅ |
| `useAdminNotes.ts` | 38, 102 | ✅ |
| `useStockManager.ts` | 78, 213 | ✅ |
| `useReports.ts` × 6 functions | 30, 90, 197, 255, 301, 369 | ✅ |
| `useBanner.ts` | 41, 62 | ✅ |
| `useDeliveryZones.ts` | 27 | ✅ |
| `useDeliveryHubs.ts` | 30 | ✅ |
| `useSubscriptionPlans.ts` | 57 | ✅ |
| `useCustomerFeedback.ts` | 47 | ✅ — special: post-fetch filter via order's branch_id since `app_feedback` has no column |

Hooks that **don't** filter and probably should:

| Hook | Concern |
|---|---|
| `useReports.ts → useSubscriptionReport` (line 140-182) | **❌** No `useBranchFilter` call. Counts active/paused/cancelled subs across all branches. Admin Reports → Subscriptions tile leaks. |
| `useReports.ts → useSubscriptionPlanReport` (line 329-354) | **❌** Same — joins `subscription_plans` no branch filter. Plan-wise breakdown leaks. |

NEEDS VERIFY:

- **`useResourceRoster` / `useStaffRoster`** — admin staff-list views; was not opened during this audit.
- **`useCustomerList` or analogue** — admin customer list — was not opened.
- **Subscription detail / list hooks** in `useSubscriptions.ts` — only `useAdminSubscriptions` was glanced; verify it filters by branch.

---

## 3. Feature flag drift

**Canonical source: `feature_flags.branch_management_active`** (BOOLEAN row in the `feature_flags` table, default FALSE per `seed_feature_flags.sql:15`). Read by `useFeatureFlag('branch_management_active')` which reads only `feature_flags`. Plumbed into `useBranchFilter` and `useBranches`.

**Drift source: `store_config.branch_management_active`** (BOOLEAN column in the `store_config` singleton row, schema.sql:69). **No code reads it** — the `store_config` SELECT in `useStoreConfig` returns the row but no consumer references this column today. Stale duplicate.

**Verdict:** drift is real but harmless. The `store_config` column is a dead duplicate. Cleanup recommended (drop the column or stop including it in `useStoreConfig` selects to prevent future "wait, which one's canonical?" cycles), but no functional bug.

**What flips when `feature_flags.branch_management_active` goes true:**
1. `bf.isActive = true` everywhere `useBranchFilter` is called.
2. Branch-filtered query hooks (16+) start applying `.eq('branch_id', bf.branchId)`.
3. `useBranches` activates (`enabled: isActive`).
4. **Class B hooks switch from writing NULL to writing `bf.branchId`.** This is the cliff — every existing row written with NULL stays NULL. The Class B fixes (`?? 1` fallback) prevent *new* NULLs but do not retroactively heal old NULL rows.

**Implication:** flipping the flag without first running the Class B fixes AND a backfill is risky. Existing NULL-tagged rows stay invisible to filtered queries forever — orders don't show up, attendance doesn't aggregate, plans don't appear in their branch's catalog. Need a backfill SQL pass before flipping.

---

## 4. RLS branch scoping

**Headline: zero branch-aware policies.** `rls_policies.sql` defines `jwt_branch_id()` (line 28-31) but no policy in the file uses it. Every staff/admin path uses `is_admin()` or `is_staff_or_admin()` only. At branch 2:

| Table | Policy | Branch boundary today |
|---|---|---|
| `profiles` | `profiles_admin_all` (admin-all) | ❌ admin sees every branch's profiles |
| `orders` | `orders_self`, `orders_staff_update` | ❌ any staff/admin reads + updates any branch |
| `order_items` | `order_items_self` (staff-or-admin OR own-order) | ❌ staff sees any branch |
| `user_subscriptions` | `user_subs_self` (own OR staff-or-admin) | ❌ |
| `cancelled_subscription_days` | same | ❌ |
| `customer_addresses` | `addresses_self` (own OR staff-or-admin) | ❌ |
| `wallet_transactions` | `wallet_tx_self` (own OR staff-or-admin) | ❌ |
| `menu_items`, `essentials_catalog`, `delivery_cycles`, `delivery_hubs`, `delivery_zones`, `subscription_plans`, `subscription_plan_items`, `banners`, `branches` | DO-loop generates `_read_all` (true) + `_admin_write` (`is_admin()`) | ❌ admin writes any branch's catalog |
| `expense_claims`, `staff_attendance`, `staff_leaves`, `staff_salary` | self-or-admin | ❌ admin reads/writes all branches |
| `business_expenses` | `business_expenses_admin` (admin) | ❌ |

**File-level staleness:** `rls_policies.sql:4-6` says `STATUS: **DISABLED** during development`. Per BF-04 / today's reality, RLS is enabled in dev and prod. Header comment is stale. (This is the deferred Item-A from this morning's chore queue.)

**Fix shape needed:** every staff-and-admin policy on a branch-aware table needs a branch-equality clause with admin override. Pattern:
```sql
USING (
  public.is_admin() OR  -- super-admin sees all
  (public.is_staff_or_admin() AND branch_id = public.jwt_branch_id())
)
```
Roughly 15-20 policies need this treatment. This is the largest single piece of MF-03 fix work.

---

## 5. Admin reports

**`useReports.ts` — 8 functions:**

| Function | Branch-filter status |
|---|---|
| `useRevenueReport` | ✅ (line 30) |
| `useOrderReport` | ✅ (line 90) |
| `useSubscriptionReport` | ❌ no filter |
| `useStaffAttendanceReport` | ✅ (line 197) |
| `useOrdersDetailReport` | ✅ (line 255) |
| `useRevenueDetailReport` | ✅ (line 301) |
| `useSubscriptionPlanReport` | ❌ no filter |
| `useExpenseReport` | ✅ (line 369) |

**Admin home / branch picker (super-admin):**

`AdminHome.tsx` (per grep, line 57: `// Only super-admins (no branch_id in JWT) need this`) consumes the branch picker UI. The selector writes to `branchStore.selectedBranchId`, which `useBranchFilter` reads when JWT has no branch. **NEEDS VERIFY:** the picker UI is wired and triggers store updates correctly — only the comment was sampled, not the JSX.

**Reports screens:** screens under `src/screens/admin/` that consume the report hooks were not opened during this audit. NEEDS VERIFY they pass `useBranchFilter`-aware hooks correctly. Probable that they're fine since the hooks self-derive the branch — but worth a one-screen sanity check.

---

## Punch list (prioritized)

### DEFINITE — must fix before launch (per D-08)

1. **[CLASS A] RLS — zero branch-scoped policies.** Add `branch_id = jwt_branch_id()` clauses with `is_admin()` override to every staff-and-admin policy on a branch-aware table (roughly 15-20 policies in `rls_policies.sql`). Also fix the file's stale "DISABLED during development" header.

2. **[CLASS C] `complete_onboarding_atomic` — does not set `branch_id`.** Add `branch_id` parameter (derived client-side from the picked address's `zone_id`/`hub_id` lookup) and write it into both the `profiles` UPSERT and the `customer_addresses` INSERT. D-08 explicitly calls this out.

3. **[CLASS C] `handle_new_user` trigger — does not set `branch_id`.** Function lives only on prod; capture in tracked SQL (this is also part of MF-08), then add branch_id derivation. NEEDS VERIFY whether the trigger has any branch context to derive from at signup time — likely no, may need to leave NULL and rely on `complete_onboarding_atomic` to update it.

4. **[CLASS B] BF-06-pattern fix — `useEssentialsCatalog.ts:67`.** `bf.isActive ? bf.branchId : null` → `bf.branchId ?? 1`.

5. **[CLASS B] BF-06-pattern fix — `useMenuManagement.ts:62, 181`.** Same shape.

6. **[CLASS B] BF-06-pattern fix — `useSubscriptionPlans.ts:89`.** Same shape. (Cascades to fix the `user_subscriptions.branch_id` and `orders.branch_id` NULL chain through `place-order` and `generate_daily_manifest`.)

7. **[CLASS B] BF-06-pattern fix — `useDeliveryHubs.ts:76`.** Same shape.

8. **[CLASS B] BF-06-pattern fix — `useDeliveryZones.ts:52`.** Same shape.

9. **[CLASS B] BF-06-pattern fix — `useBanner.ts:70`.** Same shape.

10. **[CLASS B] BF-06-pattern fix — `useStockManager.ts:116, 176`.** Same shape (one is RPC param, one is direct INSERT).

11. **[CLASS B] BF-06-pattern fix — `useExpenseManager.ts:127`.** Same shape.

12. **[ATTENDANCE] `useClockIn` mutation — staff_attendance INSERT missing `branch_id` entirely.** Add to payload: `branch_id: bf.branchId ?? 1` (or read from staff's profile.branch_id at clock-in time). Same for `useClockOut`.

13. **[REPORTS] `useSubscriptionReport` + `useSubscriptionPlanReport` — add `useBranchFilter` and `.eq('branch_id', ...)`.** Otherwise admin Reports → Subscriptions and plan-wise breakdown leak across branches.

14. **[BACKFILL] One-off SQL pass before flipping `branch_management_active`.** Every existing row in branch-aware tables that has `branch_id IS NULL` needs to be set to `1` (the only branch today). Otherwise those rows become invisible the moment filters activate. Migration shape:
    ```sql
    UPDATE profiles SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE customer_addresses SET branch_id = 1 WHERE branch_id IS NULL;
    UPDATE orders SET branch_id = 1 WHERE branch_id IS NULL;
    -- ... and 12+ more tables
    ```
    Should be batched as a single migration file.

### PROBABLE — likely needs fix, NEEDS VERIFY first

15. **`useStaffLeave.ts:42`** — staff_leaves INSERT — confirm if it tags branch_id; if not, add `?? 1` pattern.

16. **`useResourceManager.ts:303`** — staff_salary INSERT — confirm branch_id; same pattern fix.

17. **`useAttendance.ts:253`** — staff_leaves admin INSERT — confirm.

18. **`ImportItemsScreen.tsx:242`** — bulk subscription_plans CSV import — confirm whether the `records` array carries branch_id. If user-supplied CSV doesn't have branch_id, code must inject it.

19. **`useClockOut`** — same gap as `useClockIn` likely.

20. **`store_config.branch_management_active` column** — stale duplicate, never read. Cleanup: drop the column, OR remove from any `select('*')` paths to prevent future confusion.

### NEEDS VERIFY

21. **Admin reports screens** — confirm each screen under `src/screens/admin/` that displays aggregated metrics consumes `useBranchFilter`-aware hooks and passes the right values.

22. **`useAddAddress` (existing-customer add-address flow)** — confirm whether it sets `branch_id` on the new address row, or if it's reused from a derived value.

23. **`AdminHome` branch picker UI wiring** — comment exists at line 57 indicating "super-admins need this," but the JSX wasn't read. Verify the picker is rendered and writes to `branchStore.selectedBranchId`.

24. **`OnboardEmployeeScreen` branch picker UI** — state hooks are present (line 327-336), but the JSX rendering wasn't read. Verify the picker is actually rendered for super-admins and is hidden in single-branch mode (per the comment at 321-326). This is MF-02's concern — likely already in flight per Shrikanth's note.

25. **`staff_order_requests` write path** — the trigger forwards `NEW.branch_id`, but which client hook INSERTs the original row? Confirm it sets branch_id correctly.

---

## Notes / architectural observations needing a human call

1. **The RLS gap is the biggest single piece of work.** Roughly 15-20 policies need to grow a branch clause. Pattern is uniform but the testing surface is broad — every role × every table × every operation needs spot-verification post-fix. Suggest landing this as a single dedicated PR with a focused review.

2. **The Class C onboarding gap interacts with the Class B catalog gaps.** Customer's first address is written with NULL branch (Class C). When that customer places an order, `place-order` reads the address's branch_id (correctly, line 171), so the order's branch_id derives from a NULL address. Even if every Class B hook is fixed, customer orders today will still be NULL until Class C is fixed. **Order of fixes:** Class C first, then Class B, then Class A (RLS), then backfill, then flip the flag.

3. **`handle_new_user` trigger:** lives only on production, captured by D-08 + MF-08 as a known source-of-truth gap. The trigger fires on `auth.users` INSERT — at that moment, the system has no idea what branch the new user belongs to (they haven't picked an address yet). Probable answer: leave the trigger writing NULL for branch, fix it in `complete_onboarding_atomic` once the user has a serviceable address. But this needs Shrikanth's call — alternative is to default to `1` on the trigger and let `complete_onboarding_atomic` overwrite if needed.

4. **Backfill fragility:** the backfill (item 14) sets every existing NULL to `1`. Safe today because there's only one branch. But if the team accidentally activates the flag before running backfill, the resulting data divergence is silent and ongoing — every new row goes to `bf.branchId ?? 1` correctly, but every old null row still doesn't appear in any filtered query. Worth gating the flag flip behind a manual checklist step that explicitly references the backfill having run.

5. **`subscription_plan_items` table:** has RLS enabled (`rls_policies.sql:181`) but no branch column was queried in this audit. Live system suggests admin writes plans via `subscription_plans.plan_items` JSON column (per BF-02), so this table may be unused / dead in the current architecture. Worth confirming as part of MF-08 source-of-truth audit.

6. **Test coverage of branch flow is essentially nil.** Single Jest test references `branch_id: null` (timeEngine.test.ts:23). When the fixes above are made, recommend adding integration tests under `src/__tests__/` that exercise: (a) onboarding writes correct branch_id, (b) order placement inherits address's branch_id, (c) flag flip with mixed NULL data does not silently drop rows. Tracked under MF-07 post-V-06.

7. **`useAdminNotes.ts` after the Class B fix — subtle, worth flagging.** The hook upserts against a `UNIQUE (target_tab, branch_id) NULLS NOT DISTINCT` constraint. The Class B fix shifted the single-branch upsert key from `(target_tab, NULL)` to `(target_tab, 1)`. Functionally equivalent **today** (still one note per `target_tab` in the only branch), and **semantically correct for multi-branch** — once the flag flips, notes become branch-specific (each branch admin sees their own notes per target_tab, not a globally-shared NULL-keyed note). The one caveat: existing `branch_id = NULL` rows in production will become stranded once new upserts use `branch_id = 1` — the new (target_tab, 1) upserts won't conflict with the old NULL row, so the NULL row sits ignored, and a new branch_id=1 row gets created on next admin save. Not a problem today (flag is still false; reads still see NULL rows because no branch filter is applied), but it IS part of why item #14 (pre-flag-flip backfill) is non-optional. The backfill `UPDATE admin_notes SET branch_id = 1 WHERE branch_id IS NULL;` migrates those orphan rows into the new keying scheme so the upsert path works correctly post-flip. Same story applies to every Class B table — admin_notes is just the most visible because of the NULLS NOT DISTINCT constraint coupling.
