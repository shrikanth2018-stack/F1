# Tier 1 Audit — Flow 6: Admin / Super-admin Actions (MF-03 Closure)

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. No code changes needed — MF-03 Classes A / B / C confirmed shipped across Commits 1-5 (2026-05-05). Two deferred post-launch findings (F6.1 templates per-branch, F6.2 referrals branch-scope intentional gap). STATUS.md and DECISIONS.md updated to reflect MF-03 readiness.

## What changed since STATUS.md was last refreshed

STATUS.md (last touched 2026-05-05 morning, refreshed today as part of bookkeeping) and the MF-03 audit doc described Class A/B/C as open. **Verified live**: MF-03 Commits 1-5 (2026-05-05 13:47-16:33 IST) actually closed all three classes. The audit doc's punch list (~18 policies, schema migrations, RPC updates) all landed. Confirming below.

## Verification matrix (MF-03 punch list)

### Class A — RLS branch boundaries

Goal: every staff/admin policy gates on `(is_super_admin() OR (admin AND branch_id = jwt_branch_id()) OR self-clause)`.

| Table policy | State | Branch-scoped? |
|---|---|---|
| profiles_self_update / profiles_admin_all | `is_admin() AND has_branch_access(branch_id)` | ✓ |
| orders_self / orders_self_insert / orders_staff_update | `has_branch_access(branch_id)` | ✓ |
| order_items_self | JOIN `o.branch_id` via parent orders | ✓ |
| cancelled_days_self | `has_branch_access(branch_id)` | ✓ |
| wallet_tx_self / wallet_tx_no_writes | JOIN to profiles + `has_branch_access(p.branch_id)` | ✓ |
| attendance_self / leave_self / salary_self | `has_branch_access(branch_id)` | ✓ |
| business_expenses_admin | `has_branch_access(branch_id)` | ✓ |
| push_tokens_self / feedback_self / pending_topups_admin | JOIN to profiles + branch-scoped | ✓ |
| feature_flags_admin | `is_super_admin()` only — correct (global toggles) | ✓ |
| kitchen_push_log_admin / manifest_log_admin / referral_settings_admin | `is_super_admin()` only | ✓ |
| orders_hub_operator_update (BF-12) | `hub_id == jwt.assigned_hub_id` | ✓ |
| **referrals_self** | `is_admin()` only — no branch scope | F6.2 (intentional) |
| notification_templates (admin read/write) | `auth.jwt() ->> 'user_role' = 'admin'` — admin-only, no branch | F6.1 (deferred) |

### Class B — `branch_id` column presence

Probed live: 13/13 expected tables HAVE the column. 5 tables intentionally lack it (derived via JOIN in RLS):

| Table | branch_id? | Why |
|---|---|---|
| orders, customer_addresses, user_subscriptions, subscription_plans, menu_items, essentials_catalog, delivery_cycles, delivery_hubs, delivery_zones, cancelled_subscription_days, staff_attendance, staff_leaves, staff_salary | ✓ has column | self-scoped |
| order_items | derived via parent orders | JOIN-scoped in RLS |
| wallet_transactions, pending_wallet_topups, push_notification_tokens | derived via profiles | JOIN-scoped in RLS |
| referrals | no column | pair-bound; intentional |

### Class C — Customer onboarding `branch_id` derivation

`complete_onboarding_atomic` RPC server-derives `branch_id` from `delivery_zones.branch_id` → fallback `delivery_hubs.branch_id` → `1` default. Writes onto both `profiles` and `customer_addresses`. JWT refresh fires immediately after RPC return (`useCompleteOnboarding.ts:71`).

Verified live:
- Only ONE profile has NULL `branch_id`: phone `917777777777` (super-admin sentinel — intentional per FT-05).
- 333 (driver+staff) confirmed `branch_id = 1` — earlier backfill TODO marked complete.

### Punch list items 12-14 (staff INSERT branch_id + report filters + backfill)

- **`staff_attendance` INSERT (item 12):** `useAttendance.ts:124` includes `branch_id: bf.branchIdForWrite`. ✓
- **`staff_leaves` INSERT (item 12):** `useAttendance.ts:262` includes `branch_id: bf.branchIdForWrite`. ✓
- **Two report hooks unfiltered (item 13):** `useReports.ts` has 9 useQuery blocks, all 9 call `useBranchFilter` and apply `.eq('branch_id', bf.branchId)` when active. `useHubReport.ts` same. ✓
- **NULL→1 backfill (item 14):** Confirmed via probe — no production profiles with NULL `branch_id` except 777 super-admin sentinel. ✓

### Atomic admin RPCs

| Action | Atomic? | Where |
|---|---|---|
| Hub operator assignment | ✓ | `assign_hub_operator` RPC |
| Subscription cancel + refund | ✓ | `admin_cancel_subscription_atomic` (BF-20) |
| **Order cancel + refund** | ✓ | `admin_cancel_order_atomic` (BF-34a, today) |
| Driver assignment | ✗ | F5.1 (deferred) |

## Findings

### F6.1 — `notification_templates` not branch-scoped (defer to multi-branch launch)

`rls_notification_templates.sql` gates on `auth.jwt() ->> 'user_role' = 'admin'` — any admin can read/edit. No branch scoping. In a multi-branch world, branch-1 admin's template edits affect branch-2 customers (templates are global).

**Status:** for single-branch launch, no impact. For multi-branch (post-flag-flip), either:
- (a) Add `branch_id` to `notification_templates`, scope policy: branch-1 admin only edits branch-1 templates, super-admin edits all. Schema change.
- (b) Lock template writes to super-admin only. Simpler. Branch admins lose template control but can still see customer pushes.

**Defer** until you're ready to add branch 2. Then revisit. CLAUDE.md says "Templates are admin-editable per event_key" — wording doesn't specify scope.

### F6.2 — `referrals_self` admin clause is `is_admin()` only (intentional gap)

Already documented in `rls_policies.sql:405-410` with rationale: pair-bound entries, no branch_id column, joining via either profile would be a double-EXISTS query on every read. Branch-1 admin can see branch-2's referral pairs.

**Status:** comment justifies the gap. Practical impact: low (referrals viewed in aggregate, no PII leak beyond profile names which admins already see). **Defer.**

## Closed clean (no action)

- All admin RPCs gated correctly via `is_admin()` or `is_super_admin()` inside SECURITY DEFINER.
- Atomicity for the three high-blast-radius operations (sub cancel, order cancel, hub op assignment).
- Feature flags super-admin gated.
- Branch picker on AdminHome conditional on super-admin (`branch_id IS NULL`).
- All catalog reads + admin writes branch-aware via `useBranchFilter`.
- Onboarding writes branch_id atomically server-side from address.
- JWT refresh wired up after onboarding completes.

## MF-03 launch status

Remaining items to flip `branch_management_active = TRUE`:

1. **V-06 persona regression** — customer / staff / driver / hub-op / branch-admin walked end-to-end. Operational test, not code work.
2. **Flag flip SQL** — `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';` once V-06 passes.

Both code-level blockers (Classes A / B / C) are closed.

## Tier 2 (post-audit Jest backfill) targets

1. `complete_onboarding_atomic` derives branch_id from zone, falls back to hub, falls back to 1.
2. RLS isolation: branch-1 admin cannot SELECT orders.branch_id=2.
3. RLS isolation: branch-1 admin cannot UPDATE feature_flags.
4. `assign_hub_operator` clears old + sets new in one transaction.
5. Foreground JWT refresh picks up `branch_id` change post-onboarding.
