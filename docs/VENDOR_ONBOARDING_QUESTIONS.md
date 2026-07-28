# Vendor & Producer Network — Decisions Record

> Concluded 2026-07-28 across two conversations. This is the agreed shape, not
> a build plan — the build plan comes next, one thin slice at a time.
>
> **Two phases, one supply system.**
> **Phase 1 — inbound:** local vendors (milk, vegetables, grocery, baker,
> later a co-operative supermarket) sell into the Essentials tab, delivered on
> Siddapur's existing cycles. Solves customer needs 1stOne doesn't want to
> procure, store or pack — and resolves the conflict of interest with hub
> operators before informal routes establish themselves.
> **Phase 2 — outbound:** source from individual and home-based producers,
> line-haul to Bangalore, pack for retail there, deliver through 1stOne's own
> Bangalore zones and hubs. Targeted at housing and apartment complexes.

---

## 1. The two selling models

Both exist from phase 1 and coexist permanently. The model is a field on the
vendor record and drives everything downstream.

| | **Own brand** | **House brand** |
|---|---|---|
| Seller of record | The vendor | 1stOne |
| Invoice GSTIN | Vendor's | 1stOne's |
| Money relationship | Commission | **You buy at an agreed rate** |
| Wallet credit | Sale value less commission | The agreed rate; your margin is the difference |
| FSSAI / brand on pack | Vendor's own | 1stOne's (you already hold the registration) |
| TCS | Applies | Does not |

This is what lets a compliant shop sell as itself while a home producer who
can't register still sells — under your brand and registration.

---

## 2. Agreed — phase 1

**Commercial**
- Customer pays 1stOne at order time; the vendor's wallet is credited **on
  successful delivery**, net of commission (or at the agreed rate).
- Ledger records gross, commission and net. Reuse the existing customer wallet
  for the balance; add a vendor-earnings detail table for the breakdown.
- Commission per vendor, fixed at onboarding.
- Payout: vendor claims → admin approves → marks paid. No bank details stored.
- Mixed cart splits into two invoices, one per GSTIN.
- Refund after credit: admin decides, per that vendor's return terms.

**Catalogue and access**
- **Essentials only. No food vendors, no kitchen involvement.**
- Vendors log in, create their own items, set their own prices and **daily
  quantity caps**.
- Approve the vendor once; their items then go live without per-item review.
- A vendor may sell into **many zones/hubs**, chosen by them.
- Phase 1 vendor items are **cycle-tagged exactly like your own essentials** —
  no change to the catalogue model.

**Operations**
- **The vendor is another kitchen.** At `kitchen_push_time` the existing
  per-minute tick pushes each vendor their supply list for that cycle. Same
  cutoff as everyone; no new scheduler.
- Vendors see **Confirmed (paid) orders only**. Payment handling is exactly as
  today.
- **Three supply modes**, chosen per vendor — this is a *procurement*
  attribute, not a delivery one:
  1. hub vendor — goods already at the point of delivery
  2. nearby shop — 1stOne collects
  3. everyone else — they drop to 1stOne
  **The last mile is always 1stOne's.** No vendor delivery persona, no new
  order statuses.
- What a vendor sees of a customer depends on their mode: supply-only sees
  item and quantity; a hub operator delivering already sees the address.

---

## 3. Agreed — phase 2

- **Bangalore is a full branch**, not a set of zones — it gets its own kitchen,
  packing facility, staff, hubs, zones, drivers, cycles and reports.
- Requires switching on `branch_management_active`: a `branch_id` backfill plus
  a token refresh, done once. Everything else is already branch-scoped.
- **Cycles gain a lead-days setting.** Cutoff stays; delivery lands N days
  later. Bangalore = 2–3, everything existing = 0, so today's behaviour is
  untouched. This is the only change to the shared dispatch rule.
- **Producer items are cycle-free.** They sit in their own section rather than
  under a meal cycle; selecting one offers the delivery cycles valid for that
  customer's address, and the customer chooses. The client sends a cycle
  *intent*; the server validates and derives the date — same pattern as
  `dispatch_target` in back-office ordering.
- **Retail packing happens in Bangalore**, not at source. Goods travel in bulk.
  Separate packing team at that facility.
- **Collect with delivery**: the Siddapur driver collects from producers on the
  same run as local deliveries. Zero extra trips.
- Producers keep their own brand on the pack; 1stOne provides standard packing
  as a service. Producers who cannot comply use the house-brand model instead.

---

## 4. What phase 1 must not foreclose

Cheap to honour now, painful to retrofit:

1. **Vendor→zone/hub link independent of the vendor's own branch.** A Siddapur
   producer will sell into Bangalore zones.
2. **Item model must tolerate a nullable cycle later** — `orderBuild` currently
   hard-fails an item with no cycle.
3. **No assumption that dispatch is ≤ +2 days.** The A/B/C rule needs to grow a
   lead-days offset.
4. **Selling model on the vendor record from day one** — both models exist in
   phase 1, not just phase 2.
5. **Supply mode stays a procurement attribute.** Nothing downstream of the
   delivery point may depend on it.

---

## 5. Open — for advisers, not for design

1. **TCS** on own-brand vendor sales: obligation, rate, GSTR-8 filing.
2. **Invoice numbering** — two GSTINs almost certainly means two series.
3. Whether 1stOne needs a **packer/repacker registration** for packing goods
   that carry a producer's brand.
4. House-brand purchases are a **purchase, not a commission** — confirm the
   book-keeping treatment differs even though the wallet mechanics look alike.

## 6. Open — for you, whenever

5. Terms: accepted in-app with a timestamp, or ticked off after signing offline?
6. Vendor approval: any admin, or super-admin only?
7. On suspension: items inactive immediately, existing orders honoured, balance
   still claimable?

---

## 7. Sizing, honestly

- **Phase 1: roughly 5–7 days.** Vendor entity and onboarding, two selling
  models, vendor login and item management with caps, zone/hub scoping, supply
  list at kitchen-push time, wallet credit and payout.
- **Phase 2 is a programme, not a task** — branch migration, lead-days,
  cycle-free items, packing workflow, line-haul, Bangalore operations. It needs
  its own breakdown when you're closer, and it will change again by then.

**The encouraging part:** phase 2 needs very little new *architecture*. Multi-
branch has been built and switched off since May. The genuinely new pieces are
lead-days on cycles, cycle-free items, the packing workflow and the line-haul
state — four contained additions, not a rebuild.

## 8. How we'll build it

One thin vertical slice first: **one vendor, one item, end to end** — onboard →
item live → customer buys → delivered → wallet credited → claim → paid. Nothing
else. Then extend one dimension at a time, testing between each.

Not a full design up front, because three times now the story behind a
requirement has changed the answer — the supply modes, the hub-only limit, and
the Bangalore kitchen. Better to keep finding that out in conversation than in
code.
