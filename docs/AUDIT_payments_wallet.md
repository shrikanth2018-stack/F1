# Tier 1 Audit — Flow 1: Payments + Wallet

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. Findings tracked below; actionable fixes proposed separately.

## Scope read

**Edge functions (full reads):** `place-order`, `confirm-order`, `verify-payment`, `wallet-topup`, `confirm-topup`, `cancel-order`.

**SQL RPCs (full reads):** `place_order_atomic`, `mark_order_paid`, `mark_order_failed`, `increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`, `complete_wallet_topup` (all in `rpc_atomic_increments.sql`); `idempotency_keys.sql`.

**Hooks + screens:** `useWallet` (3 hooks), `useOrders.useCancelOrder` / `useConfirmOrder` / `usePendingRazorpayOrder`, `CheckoutScreen`, `WalletScreen`, `PendingPaymentBanner`, `StoreConfigScreen` (wallet fields), `StaffDashboard.statusColor`, `OrdersScreen.statusVariant`.

**Live prod probes:**
- `orders` status distribution (27 'Confirmed', 5 'Cancelled', 3 'Delivered', 1 each 'Ready'/'Packed'; 0 'Paid', 0 'Pending', 0 'Failed').
- Stuck Pending (>60min): 0.
- `pending_wallet_topups` status: 3 completed, 0 pending, 0 failed.
- `profiles.wallet_balance` negative: 0.
- Wallet ledger consistency (signed credit-debit sum vs balance): consistent — 4 profiles show a 2000 seed credit applied without journal entry (test seed only, not a bug).
- `idempotency_keys`: 27 rows, oldest 2026-04-22 (19 days), cleanup cron absent.

## Verdict matrix (spec vs implementation)

| Spec | Implementation | Match |
|---|---|---|
| Server-side price/fee derivation | `place-order:178-223` recomputes from `menu_items` / `essentials_catalog` / `delivery_zones` / `delivery_hubs` | ✓ |
| Wallet single-SQL atomicity | `decrement_wallet_balance_if_sufficient` uses `FOR UPDATE` row lock (`rpc_atomic_increments.sql:36-67`) | ✓ |
| Wallet ledger paired with balance change | Both inc + dec RPCs INSERT into `wallet_transactions` (`rpc_atomic_increments.sql:26, 62`) | ✓ |
| Idempotency-Key on all payment endpoints | `place-order` enforces ✓; `wallet-topup` supports but client never sends (**F1.3**) | partial |
| Rate limit on payment endpoints | place-order + wallet-topup both 5/60s | ✓ |
| Razorpay HMAC verify | `confirm-order:111-119`, `confirm-topup:91-98`, `verify-payment:66-70` | ✓ |
| Webhook handles order + topup + subscription per call | `verify-payment:98-208` runs all three branches, no early return | ✓ |
| Subscription activation matches AC-02 | `confirm-order:139-153` + `verify-payment:164-202` both activate `user_subscriptions` keyed by `razorpay_order_id` | ✓ |
| Wallet refund on cancel | `cancel-order:184-195` via `increment_wallet_balance` | ✓ |
| Razorpay refund flagged for admin manual | `cancel-order:200-204` returns `razorpay_refund_due` in payload | ✓ (per design) |
| Single status string across confirm paths | **divergent** — `confirm-order` writes `'Confirmed'`, `mark_order_paid` writes `'Paid'` (**F1.1**) | ✗ |
| Server validates wallet topup against store_config | **reads wrong columns** `wallet_min_topup`/`wallet_max_topup` — neither exists (**F1.2**) | ✗ |
| Admin can configure max wallet topup | No column, no admin UI (**F1.2 extension**) | gap |

## Findings

### F1.1 — Confirm-path status divergence ('Confirmed' vs 'Paid')

- **Where:** `confirm-order/index.ts:126` writes `'Confirmed'`; `rpc_atomic_increments.sql:154` (mark_order_paid called from `verify-payment:102-105`) writes `'Paid'`.
- **Impact:** same Razorpay order can end up in either status depending on race timing (SDK callback path vs webhook path). Downstream surfaces handle both inconsistently:
  - ✓ `push_kitchen_summary` (`kitchen_cutoff_push.sql:100`) — accepts both.
  - ✓ `cancel-order:24` — accepts both.
  - ✗ `StaffDashboard.statusColor` — no 'Paid' case → muted color.
  - ✗ `OrdersScreen.statusVariant` — no 'Paid' case → fallthrough.
  - ✗ Packing tab `nextStatus` flow — no advance from 'Paid'; order stuck in UI.
- **Today in prod:** 0 'Paid' rows. Likely because Razorpay sandbox callback wins almost every time. Real-world (app killed/backgrounded mid-flow) will hit it.
- **Recommended fix:** single source of truth — change `mark_order_paid` to write `'Confirmed'`. One-line SQL. Drop the dual-value handling everywhere.
- **Status:** action proposed (BF-32a).

### F1.2 — `wallet-topup` reads non-existent columns

- **Where:** `wallet-topup/index.ts:91-93` queries `select('wallet_min_topup, wallet_max_topup')`. Actual column is `min_wallet_topup` (singular underscore order); no max column exists.
- **Impact:** server-side validation falls back to hardcoded `100` / `50000` regardless of admin config. Client UI (`WalletScreen.tsx:51`) reads `min_wallet_topup` correctly — so the UI shows the admin value but a direct API caller can bypass it.
- **Today in prod:** admin's `min_wallet_topup` happens to be 100, identical to fallback — no user-visible divergence yet.
- **Recommended fix:** edge function: change select + variable name to `min_wallet_topup`; drop the non-existent `wallet_max_topup` query (keep the hardcoded 50000 ceiling for now). Adding a real `max_wallet_topup` column is post-launch.
- **Status:** action proposed (BF-32b).

### F1.3 — Client wallet topup omits Idempotency-Key

- **Where:** `useWallet.ts:82-84` calls `supabase.functions.invoke('wallet-topup', { body: { amount } })` with no header.
- **Impact:** server idempotency cache (`wallet-topup/index.ts:72-80`) never hits — every client call creates a fresh Razorpay order. Bounded by 5/60s rate limit. Up to 5 unused pending_wallet_topups can accumulate per minute on double-taps before sheet opens.
- **Recommended fix:** mirror `CheckoutScreen.tsx:104, 236` pattern — `generateId()` + send `Idempotency-Key` header. Refresh key after success.
- **Status:** deferred — low probability, no money impact.

### F1.4 — `expire-idempotency-keys` cron not scheduled

- **Where:** `idempotency_keys.sql:17-21` schedules hourly cleanup. `SELECT * FROM cron.job WHERE jobname='expire-idempotency-keys'` returns nothing.
- **Impact:** table will grow linearly. Currently 27 rows; oldest 19 days. Not yet a problem.
- **Recommended fix:** re-run the `cron.schedule(...)` block once via SQL editor.
- **Status:** deferred — pure maintenance debt.

### F1.5 — Cancel-order wallet-refund failure has no admin signal

- **Where:** `cancel-order/index.ts:191-194` logs to `console.error` if `increment_wallet_balance` fails after the order is already cancelled. No support reference, no admin notification.
- **Impact:** customer wallet missing the refund; admin has no signal except inspecting Supabase function logs. Mismatch with `place-order/index.ts:407-420` which generates a support reference for the analogous failure.
- **Recommended fix:** mirror the place-order reference-id pattern OR insert an `admin_notes` row for ops visibility.
- **Status:** deferred — financial hardening, post-launch.

## Closed clean (no action)

- Server-side authority on money: 100%, end-to-end.
- Wallet atomicity + ledger: consistent.
- Razorpay webhook design: idempotent, three-branch, returns 200 even on partial failure (correctly avoids Razorpay retry storms).
- Cancellation guards: window-based + cycle-cutoff-based + idempotent on second call.
- Storm mode kill switch enforced at `place-order:121-134`.

## Test data state captured (for V-06 reference)

- Persona `555` customer wallet: 3425 (seed 2000 + net 1425 from 9 journal entries).
- `444`/`666`/`777` test personas: 2000 each, seed credit only.
- 3 completed wallet topups in `pending_wallet_topups`; 0 stuck.
- 0 stuck Pending Razorpay orders.

## Tier 2 (post-audit Jest backfill) targets surfaced

Each of these would be a high-value regression test once Tier 1 closes:

1. `place_order_atomic` rolling back order_items insert when invariant fails.
2. `decrement_wallet_balance_if_sufficient` race under concurrent callers (FOR UPDATE guarantee).
3. `verify-payment` running all three branches without early return.
4. `cancel-order` idempotency on second call returns same payload, no double refund.
5. `confirm-order` + `mark_order_paid` status-guard idempotency (post F1.1 fix, both write 'Confirmed').
6. Idempotency-Key replay: same key → cached response, no second order/topup.
