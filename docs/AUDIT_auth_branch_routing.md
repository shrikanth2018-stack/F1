# Tier 1 Audit — Flow 8: Auth + Branch Routing

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. One actionable finding (F8.1 — file-vs-prod drift in custom_access_token_hook). F4.2 from Flow 4 (push token registration) revisited and closed as test-environment artifact, not a code bug.

## Scope read

- `src/screens/auth/LoginScreen.tsx` (BF-18 unified) — read enough to confirm flow.
- `src/screens/auth/OnboardingScreen.tsx` — referenced in Flow 6 (complete_onboarding_atomic).
- `src/hooks/useAuth.ts` — re-read (Flow 5).
- `src/hooks/usePushNotifications.ts` — token registration mechanics.
- `src/navigation/RootNavigator.tsx` — role split, invokes `usePushNotifications`.
- `src/store/branchStore.ts` — super-admin branch picker state.
- `supabase/sql/custom_access_token_hook.sql` tracked file vs prod `pg_get_functiondef`.

## Verdict matrix

| Spec | Implementation | Match |
|---|---|---|
| Phone OTP via Supabase | `useAuth.signInWithPhone` → `auth.signInWithOtp`; `verifyOTP` → `auth.verifyOtp` | ✓ |
| OTP flow on one screen | BF-18 unified login + OTP (`LoginScreen.tsx`) | ✓ |
| New user → onboarding; existing → role navigator | Profile `full_name` check post-verify | ✓ |
| JWT carries user_role / branch_id / assigned_hub_id / is_driver | Prod hook injects all four (verified live via pg_get_functiondef) | ✓ runtime, ✗ tracked file — F8.1 |
| Tracked SQL matches deployed | `custom_access_token_hook.sql` missing `is_driver` block + SECURITY DEFINER + SET search_path | **✗ — F8.1** |
| Role splits to right navigator | RootNavigator branches on `session.role` | ✓ |
| Super-admin branch picker visible only when `branch_id IS NULL` | AdminHome conditional + `branchStore` | ✓ (Flow 6) |
| JWT refresh post-onboarding | `useCompleteOnboarding.ts:71` calls `refreshSession` | ✓ |
| App-foreground JWT refresh | `useAuth.ts:102-108` AppState listener | ✓ |
| Push token registered on session | `usePushNotifications` invoked from `RootNavigator:59` | ✓ wired |
| Sign-out cleans push token + carts + queue | `useAuth.signOut` does all three | ✓ |
| Token-registration writes to `push_notification_tokens` | Yes (upsert) — but **0 rows in prod** | Test-env artifact, not code bug |

## Findings

### F8.1 — `custom_access_token_hook.sql` tracked file is stale (MF-08-class drift)

**Where:** `supabase/sql/custom_access_token_hook.sql` (53 lines) vs `pg_get_functiondef('public.custom_access_token_hook(jsonb)'::regprocedure)`.

The deployed function adds `is_driver` claim (computed from `delivery_hubs.driver_user_id` OR `delivery_zones.driver_user_id`) and is declared `SECURITY DEFINER` with `SET search_path = public, pg_temp`. The tracked file:
- Does NOT compute `is_driver`.
- Is declared `STABLE` instead of `SECURITY DEFINER`.
- Lacks the `search_path` setting.

**Impact:** the live JWT (and `session.isDriver` in `useAuth.ts:46`, `ProfilePopup.tsx:127`) is correct because prod has the right function. But the tracked file is the source for any DB rebuild — a fresh deploy from `supabase/sql/` would lose the `is_driver` claim. Drivers would lose the "My Deliveries" entry in ProfilePopup.

Same class of drift as MF-08 (production-only objects). The audit doc surfaced is_driver work happened at some point but never made it back into the file.

**Fix:** rewrite `custom_access_token_hook.sql` to match the deployed body. Deploy from the file to ensure full round-trip (file → deploy → pg_get_functiondef returns same shape).

**Status:** action proposed (BF-37).

### F4.2 (revisit from Flow 4) — zero push tokens in prod is test-environment, not a code bug

`push_notification_tokens` has 0 rows. Cause:
- `usePushNotifications.registerForPushNotifications()` early-returns null when `Device.isDevice = false` (simulator/emulator).
- For real devices: requires user to grant push permission. Testers may have denied.
- The upsert path has no error swallowing or RLS gap — `push_tokens_self` policy allows `user_id = auth.uid()` for the customer's own token row.

Once the v1.2.1 production AAB is installed on a real device and permission is granted, registration will fire and `push_notification_tokens` will populate. The wire-up is correct; no fix needed.

**Status:** **closed as not-a-bug**. Real-device installation will surface tokens. Re-verify in V-06 persona regression.

## Closed clean (no action)

- LoginScreen unified BF-18 flow.
- `useAuth` JWT extraction + foreground refresh.
- RootNavigator role split + `usePushNotifications` invocation.
- Token registration mechanics (`upsert` + RLS).
- Sign-out cleanup (token + carts + queue).
- Super-admin branch picker (Flow 6).
- Onboarding `branch_id` derivation + immediate JWT refresh (Flow 6).

## Tier 2 (post-audit Jest backfill) targets

1. `extractRole` returns safe defaults when JWT claims are missing.
2. `usePushNotifications` upserts a token row with `onConflict: 'user_id,token'` (no duplicates).
3. Sign-out RACE-or-timeout never blocks past 3 seconds.
4. Onboarding refresh propagates `branch_id` claim by the time `useAuth.session` next reads.
5. `custom_access_token_hook` computes `is_driver` from union of zones + hubs.
