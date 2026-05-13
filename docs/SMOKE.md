# 1stOne F1 — Smoke test critical paths

> The fixed set of user paths that must work for a build to be considered shippable. Run before any AAB cut to Play Store + after any change touching DB / payments / auth / RLS / shared components. Tick boxes locally before sign-off; do not commit ticked state.
>
> For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`.

## How to use

- All OTPs are `123456`. Persona roster lives in `docs/STATUS.md` ("Persona / test phone roster").
- Each path is one line; expand inline if a failure deserves a note.
- Order matters loosely (login first, then customer flows, then staff flows, then admin).
- Tick boxes (`[x]`) in a scratch copy; the committed file stays unchecked.
- A failed path = release blocker until fixed or explicitly waived (and waivers logged in `docs/DECISIONS.md`).

## Authentication & routing

- [ ] **P-01** Customer login — phone `555`, OTP `123456` → lands on customer home, role routing correct.
- [ ] **P-02** Staff login — phone `666` → kitchen / packing / delivery tabs visible on StaffDashboard.
- [ ] **P-03** Branch admin login — phone `888` → admin home, sees only branch 1 data.
- [ ] **P-04** Super admin login — phone `777` → admin home, sees all branches; cross-branch reports load.
- [ ] **P-05** Driver login — phone `333` → driver view appears; zone 1 + hub 1 assignments visible.
- [ ] **P-06** Hub operator login — phone `444` → hub 19 consolidated picks visible.

## Customer one-off order

- [ ] **C-01** Food cart → checkout → wallet pay → order Confirmed; receipt shows correct total.
- [ ] **C-02** Food cart → checkout → Razorpay pay (test mode) → order Confirmed after callback; `confirm-order` activates idempotently.
- [ ] **C-03** Essentials cart → checkout → wallet pay → order Confirmed; essentials packing flow picks it up.
- [ ] **C-04** Cross-midnight cycle: scenario `'B'` shows "missed today's cutoff" banner; scenario `'C'` triggers confirm dialog + "Day after tomorrow" badge.
- [ ] **C-05** Cross-branch address switch: warning + cart clear fires when customer switches to address in different branch.
- [ ] **C-06** Cancel one-off order within window → wallet portion refunded automatically; status flips to Cancelled.

## Customer subscription

- [ ] **S-01** Buy subscription (one plan in cart) → wallet pay → `user_subscriptions.is_active = true` immediately; appears in My Subscriptions.
- [ ] **S-02** Buy subscription → Razorpay pay → `is_active` flips to true after `confirm-order` (regression for AC-02).
- [ ] **S-03** Pause/skip subscription mid-life → `days_consumed` semantics hold; effective end shifts forward (BF-33 / F2.1).
- [ ] **S-04** Subscription end-of-life: `generate_daily_manifest` stops generating when `days_consumed >= duration_days`. UI labels remaining as "N meals left".

## Wallet

- [ ] **W-01** Wallet topup via Razorpay (test mode) → balance increments atomically; Idempotency-Key on request (BF-38).
- [ ] **W-02** Wallet debit on order is atomic (no double-debit on retry).
- [ ] **W-03** Low-wallet push fires on schedule for active subscriptions (`low-wallet-check` cron; days_consumed-based).

## Staff operations

- [ ] **K-01** Kitchen: new order appears in real time; mark prepared → status flips.
- [ ] **K-02** Packing: ready order appears; mark packed → status flips; essentials packing first-hop intact (BF-34).
- [ ] **K-03** Delivery: assigned driver sees order; mark delivered → status flips + customer push fires.
- [ ] **K-04** Offline kitchen mutation: airplane mode → mark prepared → reconnect → mutation flushes via `useOfflineSync`; no double-fire.
- [ ] **K-05** IST-midnight rollover: realtime order list refreshes at 00:00 IST (BF-38 / F4.3).

## Admin

- [ ] **A-01** Admin cancel one-off order → wallet portion refunds, Razorpay portion shows manual-action message (atomic via `admin_cancel_order_atomic`).
- [ ] **A-02** Admin cancel subscription → prorated refund preview; editable amount; confirm → wallet credited (atomic via `admin_cancel_subscription_atomic`).
- [ ] **A-03** Branch admin (888) cannot see other-branch orders / users / subscriptions (RLS).
- [ ] **A-04** Super admin (777) can flip global feature flags.
- [ ] **A-05** Branches management screen (FT-04): create / edit / deactivate branch.

## Notifications

- [ ] **N-01** Order-status push fires via `resolveAndSendPush` helper using admin's editable template (BF-35).
- [ ] **N-02** Subscription daily dispatch push fires from `generate_daily_manifest` via `pg_net`.
- [ ] **N-03** Admin can edit a notification template, customer sees updated copy on next event.
- [ ] **N-04** Wallet refund failure → branch admin receives `admin.wallet_refund_failed` push (BF-39).

## Infrastructure

- [ ] **I-01** Storm mode dual-switch: flip either `store_config` column or `feature_flags` row → new orders rejected.
- [ ] **I-02** Idempotency keys: same `razorpay_order_id` retried → no double-confirm; same wallet topup retried → no double-credit.
- [ ] **I-03** Cron jobs all active: `kitchen-cutoff-push-tick`, `low-wallet-check`, `subscription-expiry-push`, `dormant-user-check`, `expire-idempotency-keys` (per `cron.job` query).
- [ ] **I-04** Sentry: forced test exception in release build appears in dashboard. (Run before launch only.)

## Pre-launch additional (run before AAB cut)

- [ ] **L-01** Fresh AAB installs cleanly on physical device; OTA channel correct.
- [ ] **L-02** Razorpay live key activation gated correctly (web build still blocks payment with "Mobile App Required").
- [ ] **L-03** Multi-branch flag (`branch_management_active`) flip on staging confirms branch isolation end-to-end (D-08 launch gate).
- [ ] **L-04** Backup of production Supabase taken before any schema change scheduled with the release.
