# Phase 2 — Second Branch & the Reverse Supply Chain

**Status:** planned, not started. Nothing in this document is built.
**Written:** 2026-07-28, from the vendor-network design sessions.
**Prerequisite:** phase 1 (vendor network) live and stable on Branch 1.

This is a working reference, not a spec to implement literally. Where a
decision was actually made it is marked **Decided**; where it was discussed
but left open it is marked **Open**. Do not invent answers for the open ones.

---

## 1. What phase 2 actually is

Two things that happen to share machinery, and are easy to confuse:

1. **A second branch** — Bangalore. A full replica of the operating model:
   its own kitchen, its own delivery cycles under different names, its own
   staff, hubs and zones.
2. **A reverse supply chain** — sourcing from individual and small home-based
   producers near Branch 1, packing centrally, and delivering that stock
   *into* the Bangalore market.

Phase 1's vendor network is the same shape pointed the other way: there, a
vendor supplies into our existing delivery. Here, *we* aggregate many small
producers and become the supplier into a new market.

### Why the sequencing landed this way

The original instinct was to open Branch 2 first, because the multi-branch
audit came back clean. That was wrong, and the owner corrected it:
**vendors onboard to Branch 1 first, then phase 2.** The dependency is real —
the producers who will supply Bangalore are the same population as Branch 1's
vendors, and their onboarding, terms, payout and quality machinery has to be
proven on home ground before it carries a second market.

---

## 2. The multi-branch position today

**This is the important finding, and it is verified, not assumed.**

- `branch_management_active` exists in `feature_flags`. Built May 2026.
  **Never switched on.**
- A branch audit across 22 tables found **zero** rows with a NULL
  `branch_id` — the sole exception being the super-admin's own profile,
  which is correct by design (they are not bound to a branch).

**Therefore switching on Branch 2 is a flag flip and a data-entry exercise,
not a migration.** There is no backfill to write. Re-verify before relying on
this — it was true as of 2026-07-27 and new tables may have landed since.

### What still has to be built or decided

| Area | State |
|---|---|
| `branch_id` columns and scoping | Done, verified populated |
| Branch-scoped RLS | **Open** — needs a read before trusting it |
| Cycle names per branch | **Decided**: replicate the cycle model with different names per branch |
| Kitchen per branch | **Decided**: Bangalore gets its own kitchen setup |
| Staff/driver/hub assignment | Presumed branch-scoped; **verify** |
| Reports split by branch | **Open** |
| Which branch a customer sees | **Open** — by address routing is the obvious answer, not confirmed |

---

## 3. The reverse supply chain

**The idea, in the owner's framing:** source from individual/small home-based
producers, pack it properly, and deliver it to a market like Bangalore.

This is materially harder than the vendor network, because we take on roles
phase 1 deliberately avoids:

- **We hold the stock.** Phase 1 vendors either ship at-hub or supply to
  order; there is no inventory in the system today. Aggregating from many
  small producers means real inventory, with all that follows — stock on
  hand, shrinkage, expiry, reconciliation.
- **We pack and brand it.** That is a packaging operation, a label, an FSSAI
  position, and shelf-life management per producer. None of it exists.
- **We move it between cities.** Inter-branch transfer is a concept the data
  model has no notion of.
- **We are the quality guarantor.** A home producer's failure becomes our
  recall.

### Sequencing this properly

Nothing here should start before Branch 2 runs normally on its own kitchen.
The reverse chain is a *second* business layered on a market that must
already work.

Suggested order, not yet agreed:

1. Branch 2 live, own kitchen, own cycles, normal operation
2. Producer onboarding reusing the phase-1 `vendors` machinery
3. Inventory — the first genuinely new data model
4. Packing operation and labelling
5. Inter-branch transfer
6. Sell the packed goods into Branch 2's Essentials

---

## 4. Carried over from phase 1

Open items that phase 1 left standing and phase 2 cannot ignore:

- **TCS.** Marketplace tax-collected-at-source obligations were raised and
  never resolved. Aggregating from unregistered producers makes this sharper,
  not softer.
- **Unregistered-vendor invoicing.** How we invoice on behalf of a producer
  with no GST number.
- **Invoice numbering** across branches — phase 1 decided vendor orders share
  the regular order sequence; a second branch reopens the question.
- **Payouts without storing bank details.** Decided in principle: UPI VPA,
  Razorpay fund-account tokens, or Payout Links (which store nothing) —
  symmetric with the payment links already used for money in. RazorpayX not
  yet enabled. Currently a vendor payout is an expense claim that collapses
  approve→paid in one step.
- **Razorpay is still on test keys.** Live keys and the `payment_link.paid`
  webhook event are outstanding, and are Branch-1 blockers, not phase-2 ones.

---

## 5. Things to re-verify before building

Every claim here has a shelf life. Before acting on this document:

1. Re-run the NULL `branch_id` audit — new tables may have landed.
2. Read the RLS policies for branch scoping specifically; the audit checked
   data, not policy.
3. Confirm `branch_management_active` is still the only flag gating this.
4. Check whether `essentials_catalog` and the vendor tables carry
   `branch_id` — they were added after the original branch work.

---

## 6. Related documents

- `docs/DEEP_DIVE_2026-07-27.md` — full architecture read, including the
  branch audit this summarises
- `docs/VENDOR_ONBOARDING_QUESTIONS.md` — phase 1 decisions record (21
  decisions, open items, sizing)
- `supabase/sql/DEPLOY_SQL_ORDER.md` §16 — vendor network deploy order
- `HEALTH_REPORT.md` — the polish backlog, separate from this
