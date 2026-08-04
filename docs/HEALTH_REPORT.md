# 1stOne — Health & Optimization Report

> ## ⚠ HISTORICAL SNAPSHOT — NOT A LIVE BACKLOG
>
> Written **2026-07-21** at HEAD `fc8b79a`. Retained as a record of what the
> system looked like then, and because its reasoning is still worth reading.
>
> **It is NOT current.** Much of it has since been fixed — the `CartScreen`
> conditional hook, network timeouts, the offline-queue wedge, log retention,
> money-path Sentry coverage. Other parts are simply out of date: it cites
> 331 tests against 493 today, and predates the vendor listing approval flow,
> the Menu Manager rebuild, CI, and the 2026-08-04 RLS and attendance fixes.
>
> **For the live list, read `CLAUDE.md` §9.** Do not action anything from this
> file without checking the code first — on 2026-08-04, three items believed
> open turned out to be already fixed.

---



> **Provenance.** Written 2026-07-21 at HEAD `fc8b79a` (code unchanged since `f618c60`). Produced by a five-area parallel review (reliability/performance, data integrity & queries, code health, tests, operational readiness), each grounded in `docs/CODEBASE_MAP.md`, then deduplicated and re-ranked globally. Scope was deliberately **optimization-focused** at the owner's request: build-from-scratch verification, dependency audit, and security were excluded (security was covered by the Round 1/2 hardening audits, complete as of May 2026). Inferences are labeled.

---

## 1. Executive summary

**Overall rating: AMBER — architecturally sound, one crash-risk bug, and a thin "when things go wrong" layer.**

The foundations are genuinely good and it shows in every report: server-authoritative money paths with `FOR UPDATE`-locked atomic RPCs, clean status/constraint discipline (75 FKs, no circular imports, zero TODO debt), paginated customer queries, an idempotent job clockwork, and existing tests that are deep rather than performative (331/331 passing, `tsc` clean). Nothing found threatens money correctness today.

What keeps it Amber is concentrated in three themes:

1. **One real bug:** a conditional React hook in `CartScreen` that can crash the customer cart — the only ESLint error in the repo, sitting on the money path's front door.
2. **Resilience debt that low usage has been masking:** an offline queue that can wedge permanently after a mid-sync kill; no timeouts on any network call; a realtime invalidation storm at kitchen-push time; log tables with no retention; scan-the-world queries that silently truncate at ~1,000 rows.
3. **A thin failure-visibility layer:** Sentry effectively captures crashes only (money-path errors surface as on-device Alerts and vanish); all alerting rides one self-monitoring chain (cron → service key → Expo push); there is no written OTA rollback procedure; the server-side money path has no real regression tests (the two edge-function tests assert against local re-implementations).

None of this is urgent at tester-only volume. All of it gets more expensive to fix — and more likely to fire — as real customers arrive. The fix list below is heavily weighted toward small (S) efforts; roughly half the total findings are one-sitting fixes.

## 2. Area ratings

| Area | Rating | One-line verdict |
|---|---|---|
| Reliability & performance | 🟠 Amber | Sound architecture; offline-queue wedge, no timeouts, invalidation storm, per-user polling |
| Data integrity & queries | 🟠 Amber | Money paths solid; unbounded log growth, silent 1000-row truncation, one missing uniqueness guard |
| Code health | 🟠 Amber | Very clean; one conditional-hook bug, web-unsafe `Alert.alert` spread, 5 oversized screens |
| Tests | 🟠 Amber | 331/331 pass and existing tests are good; server money path & offline sync unprotected |
| Operational readiness | 🟠 Amber | Good happy-path observability; crash-only Sentry, no rollback doc, self-monitoring alert chain |

## 3. Globally prioritized issues

Severity re-ranked across all areas by blast radius for a real customer base. Effort: S ≈ under an hour–half day · M ≈ half–two days · L ≈ multi-day.

### High

| # | Issue | Evidence | Blast radius | Effort |
|---|---|---|---|---|
| 1 | **Conditional hook in CartScreen** — `useEssentialsEnabled()` called after two early returns; hook count changes on empty↔filled cart transition → React "rendered fewer hooks" crash. Only ESLint error in the repo. | `src/screens/customer/CartScreen.tsx:324` | Customer cart screen can crash in production — money-path entry | **S** |
| 2 | **Offline queue can wedge permanently** — `staffQueueStore` persists `isSyncing`; a mid-drain app kill rehydrates `isSyncing: true` and `drainQueue` early-returns forever. | `src/store/staffQueueStore.ts:84-89`, `src/hooks/useOfflineSync.ts:35` | Silent, permanent loss of staff offline sync — the exact rainy-day path it exists for | **S** |
| 3 | **Sentry captures crashes only** — `captureError` is called from exactly one place (ErrorBoundary). Payment/checkout failures surface as Alerts and are never recorded. | `src/components/ErrorBoundary.tsx:38`; `src/screens/customer/CheckoutScreen.tsx:248-270` | Field payment failures invisible; you learn from customer complaints | **M** |
| 4 | **No OTA rollback procedure** — `ON_LOAD` + `fallbackToCacheTimeout: 0` pushes a bad bundle to every device within minutes; no doc mentions `eas update:republish`. | `src/hooks/useOTAUpdates.ts:31-56`; absent from docs 02/06 | A startup-crashing OTA strands the entire fleet while the procedure is invented under pressure | **S** (document + rehearse once) |
| 5 | **Alerting is one self-monitoring chain** — refund-failed / sub-create-failed / cron-failure alerts all ride cron → `app_config` service key → Expo push; the cron-failure alerter reads the same key and degrades to `RAISE WARNING` in unwatched logs. Key rotation has already broken crons once (`fix_failing_crons.sql:15-28`). | `supabase/sql/cron_failure_alert.sql:41-44` | One bad key rotation or Expo outage silences the jobs **and** the alarm | **M** (external heartbeat, e.g. healthchecks.io) |
| 6 | **Server money path has no real regression tests** — the two Deno tests assert against local re-implementations (`simulatePlaceOrder`, in-test storm logic), and `buildAuthoritativeOrder` (453 lines: re-pricing, GST carve-out, fee priority) has zero tests despite the import pattern already existing (`dispatch.test.ts` imports `_shared/dispatch.ts` directly). | `supabase/functions/place-order/index.test.ts:16`; `supabase/functions/_shared/orderBuild.ts` | Any pricing/idempotency regression ships undetected; hits every order | **M** |
| 7 | **Unbounded log-table growth** — `push_logs`, `manifest_run_log`, `kitchen_push_log`, `cron.job_run_details` have no retention; the per-minute tick alone adds ~1,440 `job_run_details` rows/day *(inference re: live cron settings)*. `idempotency_keys` already has the pattern to copy (`idempotency_keys.sql:17-20`). | `supabase/sql/push_notifications.sql:43-62`, `kitchen_cutoff_push.sql:257` | Table bloat slows `get_job_health()`, dormant-check reads, and backups | **S** |

### Medium

| # | Issue | Evidence | Blast radius | Effort |
|---|---|---|---|---|
| 8 | **Silent ~1000-row truncation** in scan-the-world queries *(inference: PostgREST default cap)* — `dormant-user-check` fetches all customers/orders unpaginated; `useCustomerExport` pulls every order unbounded. | `supabase/functions/dormant-user-check/index.ts:62-77`; `src/hooks/useCustomerExport.ts:153-156` | Past ~1,000 rows: missed win-backs, silently wrong exports | **M** |
| 9 | **Realtime invalidation storm** — every `orders` INSERT/UPDATE invalidates 6 query families on every mounted dashboard; manifest generation + bulk advance emit N events in seconds at kitchen-push time. | `src/hooks/useRealtimeOrders.ts:79` → `src/api/invalidateOrderQueries.ts:24-40` | Refetch rounds scale with subscriptions × devices, right at the busiest moment | **S** (debounce ~500 ms) |
| 10 | **No timeout on any network call** — no custom fetch/AbortController on the Supabase client; checkout invoke can spin forever; edge functions' outbound Razorpay/Expo fetches also unbounded. | `src/api/supabaseClient.ts:22-29`; `CheckoutScreen.tsx:233`; `place-order/index.ts:181` | Dead connections hang the Pay button and cron ticks | **M** |
| 11 | **No DB-level dispatch uniqueness** — manifest dedupe is an `IF EXISTS` check only; no unique index on `orders(subscription_id, dispatch_date)`. Cron path is serialized, but a manual/backfill run concurrent with the tick can double-create dispatch orders. | `supabase/sql/generate_daily_manifest.sql:106-116` | Duplicate subscription deliveries on a manual rerun race | **S** (partial unique index) |
| 12 | **`Alert.alert` on web-served screens** — 56 files use it vs 11 using the cross-platform `confirmDialog` (whose own header calls web `Alert.alert` unreliable); includes Checkout ×12, AddAddress ×11, Wallet ×6. | `src/utils/confirmDialog.ts:1-12` | Checkout/address error feedback can silently no-op in the web app | **M** (prioritize customer screens) |
| 13 | **Per-user 60 s edge-function polling** — `useCycleDispatch` polls `cycle-dispatch` every minute per active customer session for data derivable from `delivery_cycles` + clock *(inference on the cheaper alternative)*. | `src/hooks/useCycleDispatch.ts:38` | Function-invocation load grows linearly with users | **S–M** |
| 14 | **Critical client logic untested** — `useOfflineSync` (identity/no-regress/retry guards) and `extractRole` (all persona routing) at 0% coverage; both are cheaply mockable/pure. | `src/hooks/useOfflineSync.ts:25-130`; `src/hooks/useAuth.ts:36-81` | Silent regressions in shared-device sync and role routing | **S–M** |
| 15 | **No incident playbooks** — runbook troubleshooting covers expected-behavior confusion only; nothing for Supabase outage, Razorpay webhook backlog/replay, Expo push outage, or OTP SMS provider failure (provider itself undocumented). | `docs/06-ops-and-maintenance-runbook.md` §9 | Every real outage is improvised | **M** |
| 16 | **Deploy couplings enforced by memory** — place-order/app must ship together; `DEPLOY_SQL_ORDER.md` is manual and references a staging env that doesn't exist. (Legacy-payload guard fails safe.) | `docs/06:54`; `supabase/sql/DEPLOY_SQL_ORDER.md:3-4` | Mis-ordered deploy under pressure | **S** (checklist) |

### Low

| # | Issue | Evidence | Effort |
|---|---|---|---|
| 17 | Offline queue drops mutations after 5 retries with no record/capture; entries never age out | `useOfflineSync.ts:45`; `staffQueueStore.ts` | S |
| 18 | Missing composite indexes for growth: staff batch query (partial index on past-undelivered), `wallet_transactions (user_id, created_at DESC)` | `useStaffOrders.ts:60-79`; `useWallet.ts:65-70` | S |
| 19 | Non-atomic two-step print batch — crash between snapshot insert and item stamping leaves double-order risk | `src/hooks/useStockManager.ts:169-190` | S |
| 20 | `useSupplyBatches` unbounded (drags all `items_snapshot` JSON history); add `.limit()` | `useStockManager.ts:208-212` | S |
| 21 | No refetch-on-foreground — React Query `focusManager` never wired to AppState; staff board can show stale data after phone sleep | repo-wide (no hits) | S |
| 22 | Sequential awaits in `buildAuthoritativeOrder` (~8–10 roundtrips, several independent) add latency to every cart-open/checkout | `_shared/orderBuild.ts:120-292` | M |
| 23 | Oversized screens (StaffDashboard 783, StockManager 733, Checkout 727, ExpenseManager 659, Cart 655); Checkout is the one that matters (money logic interleaved with layout) | `src/screens/` | M each |
| 24 | Food/essentials near-clone stores & smart-cart hooks — dispatch-evaluation fixes must be made twice | `src/store/cartStore.ts` vs `essentialsCartStore.ts` | S |
| 25 | Knip residue: unused `SubscriptionCalendar.tsx`, unused `useHubOperatorIds` export, duplicate `formatPrice|formatCurrency`, `react-native-gesture-handler` listed but never imported (removal = native build change — verify on device) | `knip` output | S |
| 26 | DR gaps: EAS keystore custody unverified *(inference)*; `assets` storage bucket has no backup story | `docs/02:165` | S each |
| 27 | Render hygiene: non-memoized catalog rows / inline closures — fine at current sizes, revisit at hundreds of items | `HomeScreen.tsx:327-351`; `StaffDashboard.tsx:388` | S |

**Reconciliation note:** code-health judged the empty `catch {}` blocks (e.g. `CheckoutScreen.tsx:256`) deliberate best-effort UX — correct; ops-readiness flagged the same sites as observability gaps — also correct. Resolution: keep the UX behavior, add Sentry capture inside those catches (folded into issue #3). No other cross-report contradictions found.

## 4. Top 5 things to fix first

1. **CartScreen conditional hook** (#1) — one-line hoist; removes a real production crash from the money path.
2. **Offline-queue `isSyncing` wedge** (#2) — persist only `queue` (Zustand `partialize`) or reset the flag on rehydrate.
3. **Sentry capture on money paths** (#3) — add `captureException` to checkout/payment/refund catches and the offline-queue give-up path (#17 rides along).
4. **Write and rehearse the OTA rollback runbook** (#4) — one page: `eas update:republish` of the last good update, when to use it, how to verify.
5. **External heartbeat for the job clockwork** (#5) — a free healthchecks.io-style ping from the per-minute cron; alarms escape the self-monitoring chain.

## 5. Top 5 quick wins

1. **Log-retention crons** (#7) — copy the existing `idempotency_keys` cleanup pattern for `push_logs` + friends.
2. **Partial unique index** on `orders(subscription_id, dispatch_date)` (#11) — turns a race into a constraint.
3. **Debounce realtime invalidation** ~500 ms (#9) — one small change in `useRealtimeOrders`/`invalidateOrderQueries`.
4. **Knip cleanup** (#25) — delete the unused file/export, dedupe the formatter (leave the gesture-handler removal for a native-build slice).
5. **`.limit()` on `useSupplyBatches` + the two composite indexes** (#18, #20).

## 6. Suggested slicing (per the owner's workflow)

Banked locally, owner review after edits, one commit + OTA per slice:
- **Slice A (client stability):** #1, #2, #21 + Sentry captures (#3) — pure JS, ships as one OTA.
- **Slice B (SQL, no deploy coupling):** #7, #11, #18 — idempotent SQL files, run in SQL editor.
- **Slice C (docs/process, no code):** #4, #5 heartbeat, #15, #16.
- **Slice D (tests):** #6, #14 — no runtime change at all.
- Everything else as appetite allows.

## 7. Appendix — coverage limits

- **Live DB not touched** (by design): index/retention findings about the live schema are inferred from `supabase/sql/` files, which are known to lag production. Verify against the live catalog before creating indexes.
- **No on-device run:** performance findings are static analysis; nothing was profiled on a phone, and no app was launched.
- **Skipped by owner's scope choice:** build-from-scratch verification, `npm audit`/dependency review, and a fresh security pass (prior hardening rounds stand).
- **SQL RPCs untestable as-is:** no SQL test harness exists in the repo, so `place_order_atomic`, `generate_daily_manifest`, etc. were reviewed by reading only.
- **Edge-function latency:** reasoned from sequential-await structure, not measured.
