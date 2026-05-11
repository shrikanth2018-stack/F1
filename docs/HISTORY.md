# 1stOne F1 — History

> Timeline of major milestones, shipped items, and architectural pivots. Append-only. Skim recent entries when researching "why does X work this way." Not exhaustive — read the relevant files for full detail. For open items see `docs/DECISIONS.md`. For working rules see `docs/RULES.md`.

## 2026-05-11 — Tier 1 + Tier 2 audit day (17 commits, 191 → 300 tests, 8 BFs)

Single working day that closed the launch-blocking audit work. Tier 1 (Flow-by-flow read-only audit + immediate fixes for findings, per-flow doc in `docs/AUDIT_*.md`) ran the full ladder. Tier 2 (Jest backfill, regression locks + hook coverage) ran end-to-end after Tier 1. Long-term-stability bias adopted and saved to `~/.claude/projects/-Users-shrikanthhegde/memory/` so future sessions don't re-litigate.

**Shipped fixes (8 BFs, all DB + edge function deploys verified live via `pg_get_functiondef` / `cron.job` queries / typecheck):**

- `10aa5fd` — **BF-31** — Flow 0 order generation + listing. (a) `useStaffOrders` filters out subscription-purchase orders (every `order_items` row carrying `item_type='subscription'`) so they don't surface in Kitchen / Packing / Hub Dash. They still appear on customer My Orders per XL spec rule (3). (b) `generate_daily_manifest` normalizes plural `subscription_plans.plan_type` ('essentials') to singular `orders.order_type` ('essential') at insert, mirroring the singular convention `place-order` already uses. Verified live via 4 fresh dispatch rows. Files: `src/hooks/useStaffOrders.ts`, `supabase/sql/generate_daily_manifest.sql`.
- `2fca7d5` — **BF-32** — Flow 1 payments + wallet. (a) `mark_order_paid` (Razorpay webhook path) now writes status='Confirmed' to match `confirm-order` — eliminates the dual-status race. (b) `wallet-topup` Edge fn reads correct column `min_wallet_topup` (was `wallet_min_topup`, never existed); admin's configured min is now enforced server-side again. Files: `supabase/sql/rpc_atomic_increments.sql`, `supabase/functions/wallet-topup/index.ts`.
- `3711398` — **BF-33 / F2.1** — Flow 2 subscription lifecycle. Per Shrikanth's option (a) call: `generate_daily_manifest` calendar-window guard removed; end-of-life now driven only by `days_consumed >= duration_days`. Pause / skip / cron-outage extend the effective end date so all paid meals get delivered (D-01). `subscription-expiry-push` switched to delivery-count `daysLeft`. SubscriptionDetailScreen relabeled "N meals left" + pause copy explains the shift. Files: `supabase/sql/generate_daily_manifest.sql`, `supabase/functions/subscription-expiry-push/index.ts`, `src/screens/customer/SubscriptionDetailScreen.tsx`. Decision saved to long-term memory.
- `032e816` — **BF-34** — Flow 3 one-off order lifecycle. (a) `admin_cancel_order_atomic` RPC mirroring BF-20's pattern — atomic deactivate + wallet refund + APPENDS reason to notes (was REPLACING, clobbering delivery instructions). Status guard rejects post-dispatch cancels. (b) Packing UI advances essentials Confirmed → Packed (essentials skip Kitchen entirely; pre-fix order 350 sat stuck at Confirmed for 5 days). Files: `supabase/sql/admin_cancel_order_atomic_rpc.sql` (new), `src/hooks/useAdminOrders.ts`, `src/screens/staff/StaffDashboard.tsx`. Backfill: order 350 → Cancelled (test data, no physical delivery).
- `f752c2c` — **BF-35** — Flow 4 staff ops. (a) `send-push` Edge fn typo fix (`body: resolvedBody` → `body: msgBody`) — was a latent time-bomb on disk that would have broken all pushes on next deploy. (b) DB trigger `trg_order_status_push` + `_notify_order_status_push` dropped; was firing duplicate hardcoded pushes alongside app-code `resolveAndSendPush` calls AND bypassing admin's `notification_templates` overrides. Replacement push fan-outs: `confirm-order` adds `order.razorpay_confirmed` + `subscription.activated` pushes; `generate_daily_manifest` fires `order.confirmed` push per cron-generated dispatch via `pg_net` so daily sub reassurance push survives. Files: `supabase/functions/send-push/index.ts`, `supabase/sql/push_notifications.sql`, `supabase/functions/confirm-order/index.ts`, `supabase/sql/generate_daily_manifest.sql`.
- `dcec18c` — **BF-36** — Flow 7 notifications + cron. (a) `low-wallet-check` switched to delivery-count `daysLeft` (was calendar; same fix shape as BF-33b for expiry push). (b) Scheduled the `expire-idempotency-keys` cron that `idempotency_keys.sql` declared but nobody had run. Files: `supabase/functions/low-wallet-check/index.ts` + one-off `cron.schedule()` SQL.
- `6cc5c6b` — **BF-37** — Flow 8 auth + branch routing. `custom_access_token_hook.sql` tracked file was stale vs prod (missing `is_driver` claim, missing SECURITY DEFINER attribute, missing search_path). MF-08-class drift — would have lost drivers' "My Deliveries" entry on any DB rebuild from `supabase/sql/`. File rewritten to match deployed body. Files: `supabase/sql/custom_access_token_hook.sql`.
- `49b7edd` — **BF-38** — Tier 2 deferred-finding closures. (a) `useWalletTopup` now sends Idempotency-Key header on each Edge fn invoke; double-tap or network-retry no longer creates a second pending Razorpay order. (b) `useRealtimeOrders` re-subscribes at IST midnight with a 5s safety margin; overnight dashboards roll over to the new day's filter. Files: `src/hooks/useWallet.ts`, `src/hooks/useRealtimeOrders.ts`.

**Tier 1 audit ladder (8 / 8 flows closed):** per-flow audit docs at `docs/AUDIT_payments_wallet.md`, `docs/AUDIT_subscription_lifecycle.md`, `docs/AUDIT_one_off_order_lifecycle.md`, `docs/AUDIT_staff_operations.md`, `docs/AUDIT_driver_hub_delivery.md`, `docs/AUDIT_admin_actions.md`, `docs/AUDIT_notifications_cron.md`, `docs/AUDIT_auth_branch_routing.md`. Each ends with a "Tier 2 targets" + "Deferred" section. 10 findings remain deferred — all post-launch FT, none block D-08. MF-03 Classes A / B / C verified closed live during Flow 6 (no code change needed; Commit 4 from 2026-05-05 + Class C from Commit 1 + punch list items 12-14 all already shipped).

**Tier 2 Jest backfill (191 → 300 tests across 18 suites):**

Decision: launch-final lock-in per Shrikanth (Option D from the four-option presentation — add `@testing-library/react-native` for hook tests, skip pgTAP / Deno test, rely on V-06 for SQL + Edge fn integration).

- `84280cf` — **batch 1, 84 tests** — pure-logic regression locks. Three small testability extractions (each justified by test coverage, D-06 right-sized): `src/utils/orderFilters.ts` (`isOperationalOrder` for BF-31), `src/utils/packingFlow.ts` (`nextPackingStatus` for BF-34b), `src/utils/subscriptionMath.ts` (`subscriptionDaysRemaining` + `proratedSubscriptionRefund` for BF-33 + BF-21). Plus full coverage of the previously-untested `nextDeliveryStatus` state machine (52 tests).
- `49b7edd` — **batch 2, 14 tests** — hook tests via `@testing-library/react-native` (added with `--legacy-peer-deps` to bypass a strict react-test-renderer peer pin). Shared `_helpers/queryClient.tsx` test wrapper. Coverage: useWallet (BF-38a Idempotency-Key header), useAdminOrders (BF-34a atomic cancel RPC + push fan-out), useSubscriptions (BF-20 + pause/skip RLS guards).
- `d5c0b90` — **batch 3, 11 tests** — useStaffOrders hook-level integration (BF-31 sub-purchase exclusion + branch filter + hub filter), useOrders (useCancelOrder server-error surfacing + useConfirmOrder Razorpay payload contract).

**Long-term memory saved** (loads automatically in future sessions) at `~/.claude/projects/-Users-shrikanthhegde/memory/`:
- `feedback_long_term_stability_bias.md` — for 1stOne F1, lean foundational over minimum-diff; Shrikanth's attention shifts post-launch and silent integrity bugs compound when nobody's watching.
- `project_f21_subscription_semantics.md` — F2.1 → option (a). Generation gated on days_consumed; pause/skip/cron-outage extend the effective end date.

**Doc commits + non-fix entries (chronological):**

- `519281a` — docs: day-end checkpoint 2026-05-11 + Tier 1 audit kickoff (closed 2026-05-05 + 2026-05-06 docs gap).
- `d94b6d3` — docs(audit): Tier 1 Flow 2 — Subscription lifecycle (F2.1 design call surfaced).
- `d10ede8` — docs(audit): Tier 1 Flow 5 — Driver + Hub delivery (no code; deferred F5.1 driver assignment atomic RPC + F5.2 JWT refresh window).
- `1bce506` — docs(audit): Tier 1 Flow 6 — Admin actions + MF-03 closure confirmation.
- `326a017` — docs: Tier 1 audit ladder closed — 8/8 flows shipped (BF-31 → BF-37).
- `35e3300` — docs: Tier 2 closure — STATUS + DECISIONS updated for launch-ready state.

**Side observations:**
- Cron `kitchen-cutoff-push-tick` resumed firing after a ~5-day Supabase free-tier pause when the DB woke up for this session. Auto-fired orders 9440/9441 for today; manual run created 9442/9443 for tomorrow as Flow 0 verification.
- Sub 39 (essentials, Newspaper 30 Days, start 2026-05-07) currently sits at days_consumed=2 with 4 deliveries lost during the cron pause. Per BF-33's days_consumed semantics, the customer's tail simply shifts forward — they still get 30 total deliveries.
- send-push was deployed BEFORE the typo-introducing commit (`4e00d70`, 2026-04-25) on 2026-04-24; the typo was latent until BF-35a fixed it on disk + redeployed.
- 0 rows in `push_notification_tokens` — token registration is wired but not exercised in this test environment (simulators + denied permissions). Real device install during V-06 will populate.

**Net pre-launch state:** code-level work complete. V-06 persona regression + flag flip SQL are the only remaining D-08 items. After that, FT-08 UX punch list → Play Store → App Store.

## 2026-05-06 — v1.2.1 hotfixes, production AAB submitted

**Commit:**
- `9ffae33` — **BF-29 + BF-30** — login keypad regression on iOS, three RLS write-gap holes (admin / staff / hub), address default invariant. v1.2.1 cut. EAS build `11454af5` (versionCode 11) finished and submitted to Play Console Internal Testing.

## 2026-05-05 — Multi-branch foundation + admin staffing pass (24 commits)

Two arcs closed simultaneously: **MF-03 multi-branch foundation** (Commits 1-5, Class B fully closed, Class C pending Shrikanth's architectural call) and **admin staffing/employee surface** (FT-02a/b, FT-03, FT-07, BF-22 through BF-28). RULES + SESSION_START tightened to single-seat default + plan-level approval gate. Pre-push gate shipped (MF-07a). Version 1.2.0 bumped.

**Highlights (HEAD-ward; full list in `git log`):**

- `1ab5283` — docs: SESSION_START + RULES tightened (single-seat default; plan-level approval).
- `07297c1` — chore: version 1.1.0 → 1.2.0 for multi-branch foundation release.
- `9c70a4c` — **BF-28** — EmployeeDetail Done button save fix.
- `c62397c` — **BF-27** — admin profile/salary writes via SECURITY DEFINER RPC + RLS gap close.
- `efe5bc4` — **FT-07** — EmployeeDetail Profile compact refresh + edit toggle.
- `601a31b` — **MF-07a** — pre-push gate via husky.
- `c5a047e` — **FT-01** — `serviceAccountKeyPath` cleanup + Play Console setup doc.
- `f46bb1e` — **CL-09** — `DEPLOY_SQL_ORDER` refresh.
- `2d2c530` — **FT-03, D-07** — ADMIN HEAD designation = branch admin role.
- `949e9c9` + `b062525` + `ded3721` + `96718b5` + `f609e0b` — **MF-03 Commits 1-5, D-08** — branch_id schema + onboarding foundation, client write payloads + JWT refresh, branch-filtered reports, RLS branch boundaries + `has_branch_access` helper, cleanup + branch-1 admin persona (`888`).
- `1781b80` — **MF-08 partial-close** — Supabase types regenerated + onboarding RPC nullable defaults.
- `4e8b3da` + `d03674e` — **BF-26** — iOS picker text invisible (drop `themeVariant`, use `textColor` + explicit modal dimensions).
- `4189c22` — **BF-24, BF-25** — iOS date/time pickers + Joining Date label.
- `d05cc2d` — **FT-02b** — staff lookups in DB + employee offboarding.
- `741fe59` — **FT-02a** — compact one-row `OnboardEmployeeScreen` layout.
- `70cc9a6` — **BF-22, BF-23** — login change-phone rate-limit + Android safe-area.
- `e4b1fe3` — docs: split monolithic doc into SESSION_START / RULES / STATUS / DECISIONS / HISTORY + CLAUDE.md appendix.

## 2026-05-04 — Sixteen-commit day

Three architectural arcs closed: subscription cancellation accuracy, Stock Manager simplification, login + OTP unification + multi-branch readiness foundations. Three new working rules adopted (D-06 best fix wins; D-07 scope freeze + perfection-review; D-08 multi-branch as launch gate). Three new follow-up gates (MF-06 staging, MF-07 test coverage, MF-08 source-of-truth — all queued post-V-06).

**Commits:**

- `953e9c9` — **MF-05** — customer cancel cross-screen invalidation. `useCancelOrder` switched to `invalidateOrderQueries` helper (mirroring BF-09 family). Latent `OrderDetailScreen.tsx:89-90` access-path bug closed (`(result as any)?.data?.X` → `(result as any)?.X`). Files: `src/hooks/useOrders.ts`, `src/screens/customer/OrderDetailScreen.tsx`.
- `77fe7ec` — **CL-10** — `handle_new_user` trigger comment cleanup (later corrected by CL-11 — trigger does exist on auth.users).
- `5df6c2c` — **BF-13** — wallet-paid regular order confirmation alert. Missing `else` branch in `src/screens/customer/CheckoutScreen.tsx:361-374`.
- `0fda489` — **BF-17** — Stock Manager simplification (Solution D). 2-tab unified Current Order / History; per-category Print + Print All; staff-style add UX; atomic merge RPC `add_or_merge_supply_order_item`; AFTER INSERT mirror trigger from `staff_order_requests`. Files: `src/hooks/useStockManager.ts`, `src/screens/admin/StockManagerScreen.tsx`, `supabase/sql/staff_order_requests_mirror_trigger.sql`.
- `716e0e0` — **BF-18** — Login + OTP unified into one screen with progressive disclosure. Phase machine `'phone' | 'otp'`. `OTPScreen.tsx` deleted; `LoginScreen.tsx` owns phone+OTP state. Files: `src/screens/auth/LoginScreen.tsx`, `src/navigation/RootNavigator.tsx`.
- `bb2c2f4` — Dead code cleanup (−105 lines, unused state/imports/styles + .gitignore additions).
- `c53dc81` — Supabase reorg + final cleanup. Closed half-done `supabase/` → `supabase/sql/` migration; SYSTEM_FLOWS.md + dead SQL files removed.
- `6753235` — **CL-11** — corrected `handle_new_user` comments. Trigger DOES exist on `auth.users` but not in tracked SQL (CL-10 had been based on incomplete public-schema-only audit).
- `38f2daa` — `.gitignore` `.claude/` + `scripts/`.
- `826103a` — 2026-05-04 audit trail in DECISIONS.md.
- `fc7fb5c` — **BF-19, D-05** — zero financial fields on subscription dispatch orders + history backfill migration. Rewrote `generate_daily_manifest.sql` to match live BF-01/BF-02 state (closed long-standing file-vs-prod gap).
- `642203a` — **BF-21, D-03a** — proration includes tax + delivery slice + closed pre-existing `useAdminSubscriptions` query gap (price field missing from select; old proration always returned 0).
- `56318a8` — **BF-20, D-03b** — atomic `admin_cancel_subscription` RPC. Replaces two-step cancel-then-refund with single Postgres transaction. File: `supabase/sql/admin_cancel_subscription_atomic_rpc.sql`.
- `f0065f9` — **MF-02, D-08** — branch picker on `OnboardEmployeeScreen`. Conditional on `feature_flags.branch_management_active`.
- `c1ce0ab` — **MF-03 audit + Class B, D-08** — multi-branch readiness audit doc (`docs/MF-03_multi_branch_audit.md`) + write-defaults fix. New `branchIdForWrite` helper in `useBranchFilter.ts` consolidates 11 sites across 9 hooks. BF-06 anti-pattern eliminated.
- `549e98d` — **MF-03 Note #7** — `useAdminNotes` Class B nuance + stranded-NULL backfill caveat.
- `c8837d6` — Day-end checkpoint.
- `9106227` — chore: bump version to 1.1.0 for internal testing release.

**SQL deployed live this day:**
- `cron.unschedule('generate-daily-manifest')` — CL-02 — 23:00 IST nightly safety-net removed.
- `add_supply_catalog_staff_read_policy.sql` — BF-14.
- `add_staff_order_requests_policies.sql` — BF-15.
- `staff_order_requests_mirror_trigger.sql` (incl. `add_or_merge_supply_order_item` shared merge RPC) — BF-17.
- `generate_daily_manifest()` rewrite + historical UPDATE migration zeroing dispatch financial fields — BF-19.
- `admin_cancel_subscription_atomic_rpc.sql` — BF-20.

## 2026-05-03 — Twelve-bug streak (BF-04 → BF-12)

Hub-routed order lifecycle now flows end-to-end: customer order → kitchen → packing → driver → hub → hub operator → delivered, gated correctly per persona at every step.

**Commits:**

- `65ea46b` + `4589bd3` — **BF-04** — Staff dashboard Kitchen + Packing tabs unbroken. Missing `orders.delivery_address_id` FK added (`supabase/sql/add_orders_delivery_address_fkey.sql`); visibility drift fixed in `src/screens/staff/StaffDashboard.tsx`. Hub-operator persona model corrected (hub op = customer + `assigned_hub_id`, not staff).
- `dae7772` — **BF-05a** — Admin staff elevation lookup matches DB 12-digit phone format (`OnboardEmployeeScreen.tsx`).
- `482ae13` — **BF-05b** — `elevate-employee` Edge Function uses `auth_user_id_by_phone` SECURITY DEFINER RPC for `auth.users` lookup (PostgREST `.schema('auth')` returns PGRST106). File: `supabase/sql/add_auth_user_id_by_phone_rpc.sql`.
- `8f39191` — **BF-05c** — `PhonePicker.tsx` phone-format drift fix (last remaining surface).
- `e99a3b3` — **BF-06** — Default `branch_id = 1` on staff elevation when feature flag off (`useResourceManager.ts:131`).
- *BF-07 superseded by BF-08 mid-session.*
- `9deb7a1` + `680847d` + `402fdce` (+ follow-ups `74de60f`, `13fb758`, `a50891f`) — **BF-08** — Removed Live tab from `DeliveryManagerScreen`; collapsed Manage Running Orders rows to one line + tappable detail; new `AdminOrderDetailScreen.tsx` as full admin action surface.
- `b2702ef` — **DC-01** — One-off backfill of `delivery_method='hub'` + `hub_id=19` on test orders 335/336/337 (snapshot-stale, orphaned from later address routing).
- `7bb864c` — **BF-09** — Centralized order query invalidation across mutating hooks (`src/api/invalidateOrderQueries.ts` helper).
- `b9b2a97` — **BF-11** — Persona-aware `nextDeliveryStatus(persona)` extracted to `src/utils/deliveryStatus.ts`. Driver / hub_operator / admin each get the right transitions.
- `18333c9` + `ab84151` — **BF-12** — RLS policy `orders_hub_operator_update` allows hub operators to advance their hub's orders. File: `supabase/sql/add_orders_hub_operator_update_policy.sql`.

**Live data set up this day:** persona roster (777 admin, 666 staff, 555 customer, 444 hub op, 333 staff+driver). Zone 1 (id=2) created with `driver_user_id = 333`. Hub 1 Kolsirsi (id=19) created with `driver_user_id = 333` and `staff_user_id = 444`. RLS policy `orders_staff_update` updated to include `'Received at Hub'`.

## 2026-05-02 — BF-03 ships, BF-01+BF-02 deployed, cleanup pass

- `1c2e04e` — **BF-03** — Combined onboarding screen with atomic profile+address save. `complete_onboarding_atomic` RPC (`supabase/sql/complete_onboarding.sql`) + `add_address_zone_hub_serviceability.sql` schema-gap migration. New `src/screens/auth/OnboardingScreen.tsx` + `src/hooks/useCompleteOnboarding.ts`. `RegistrationScreen.tsx` deleted. Replaces two-screen Registration → AddAddress flow with one screen + single Postgres transaction.
- **BF-01 + BF-02** — `generate_daily_manifest` daily wallet debit removed + plan items source switched to `subscription_plans.plan_items` JSON column. Verified live: 0 wallet debits, items appear correctly on dispatch orders. (Subsequently rewritten in BF-19.)
- **CL-01** — `subscription-cron` and `subscribe` folders removed (never tracked in git).
- **CL-03 + CL-04** — `confirm-order-payment` and `razorpay-webhook` Edge Functions deleted from Supabase (count went from 14 → 12).
- **CL-06** — `staff_leaves` typo fixed in `rls_policies.sql` (3 occurrences).
- **CL-07** — `CLAUDE.md` count corrections (41 hooks, 18+5 screens, jest configured).
- **CL-08** — `supabase/deploy.sh` deleted (was untracked, contained stale revoked Razorpay test keys).
- `fa6e56c` — Cleanup batch commit.

**Decisions reached this day:**
- **D-01** — Subscription billing model: customer pays full plan price upfront from wallet (or Razorpay); no daily debits afterward. Plan price is all-inclusive (food + tax + delivery). Wallet refund on admin cancel.
- **D-02** — Webhook safety-net: `verify-payment` is configured + active per live test (resolved). `razorpay-webhook` deleted as legacy.
- **D-03** verified — admin proration + wallet refund flow works end-to-end (already implemented in `AdminSubscriptionsScreen.tsx`).
- **D-04** verified — one-off cancellation matches Master Doc (`cancel-order` Edge Function with cancellation_window_hours + cycle cutoff).
- **D-05** logged — manifest order `total_amount` double-counts subscription revenue. Resolved 2026-05-04 by BF-19.

## Earlier — pre-Phase 2

Phase 1 audit (`PHASE1_OUTPUT.md`, 2026-05-02). Master Document v1.0 (2026-04-26). System flows trace (`SYSTEM_FLOWS.md`, 2026-04-23 — subscription content materially out of date as of Phase 2). Earlier audits and blueprints retained as historical context only.
