# 1stOne — Product Shape and Sprint Plan

The argument for why the customer-facing app is still a prototype, what shape it
should take instead, and a sprint plan to get there.

Written 8 August 2026. Every factual claim about current behaviour was read from
the source; the design argument is judgement and is marked as such.

---

# Part One — The shape argument

## 1. What this business actually is

A home kitchen in Siddapur delivering **daily** meals and **daily** essentials
across four fixed delivery windows, with neighbourhood hubs handling the last
mile. Thirty-seven dishes. Eight essentials. Two subscription plans —
Breakfast 30 at ₹1,250 (₹41.67 a day) and Milk 15 at ₹775.

The whole backend is built for recurrence: a manifest generator that creates
tomorrow's orders while the customer sleeps, `days_consumed` accounting, pause,
skip-a-day, four cutoffs, batch release to the kitchen. This is a **subscription
business**.

## 2. What the app is built like

The customer opens the app to a grid of dishes with Add buttons, a food/
essentials toggle, and a floating cart. Browse → add → cart → checkout.

That is the **marketplace** interaction model — Swiggy, Zomato, Blinkit. It is
designed for a customer who wants something *different* today, chosen from
thousands of options, with discovery as the main job.

Your customer wants the *same* thing tomorrow that they had today, chosen once,
with the ability to skip Thursday.

**That mismatch is the prototype-shaped part.** Not the visual design, not the
code quality — the interaction model was inherited from the wrong category of
product.

## 3. Why this is not a small thing

### The dominant customer state is unserved

A subscriber in steady state has four needs:

1. **Reassurance** — is tomorrow's breakfast actually coming?
2. **Exception** — I'm travelling Thursday, skip it
3. **Money** — do I have balance for the rest of the month?
4. **Renewal** — my plan ends in three days

Today, all four live behind a profile icon that opens a modal. Skipping a day is
four interactions deep. Renewal is only surfaced as a push notification — if
that push fails or is dismissed, the subscription lapses silently and the
customer's daily habit breaks. **The most valuable customer you have is the one
the interface serves worst.**

### The marketplace model buys you nothing at this catalogue size

Grid-plus-cart-plus-checkout is heavy machinery for discovery. It exists because
Swiggy has tens of thousands of items and the hard problem is *finding*
something.

You have **eleven breakfast dishes**, and they are cycle-bound — a customer
ordering breakfast can only choose from those eleven. Three taps of navigation
and a cart abstraction to choose between eleven things is not helping anyone.
The machinery costs you a cart screen, a checkout screen, two Zustand stores and
a floating action button, and returns discovery value you do not need.

### The most-repeated action does not exist

I searched the entire codebase: there is **no reorder, no "order again", no
"same as yesterday"** anywhere. A past order is read-only.

For a daily-meals business this is the central omission. The single most common
thing a customer will ever want to do — repeat yesterday — currently costs 6–9
taps plus scrolling and visual hunting, every day, forever.

### The two carts are a database artefact leaking into the interface

`buildAuthoritativeOrder` accepts **one** `items[]` array, filters food and
essentials internally, and groups by delivery cycle. **The server has always
supported a mixed cart.** The split exists only on the client: two Zustand
stores and a `cartType` parameter on Checkout.

So a customer who wants idli and milk — both arriving in the same 7:30am
window — must place two orders and pay twice. They experience a distinction
that exists in your schema and nowhere in their head.

## 4. The shape I would argue for

**Home becomes state-aware.** Not a redesign of everything — a reordering of
what the customer meets first.

**For a subscriber:**

```
┌─────────────────────────────────────┐
│  Tomorrow · Breakfast · 7:30 am     │
│  Idli ×2, Vada ×1                   │
│  [ Skip this day ]    [ Change ]    │
└─────────────────────────────────────┘

Wallet ₹1,935  ·  12 meals left        ← renewal warning lands here

── Add something extra ──────────────
[ today's menu, horizontal scroll ]

[ Browse full menu → ]
```

**For a non-subscriber:** today's menu exactly as now, plus a visible
subscription offer — "Breakfast 30 · ₹1,250 · works out at ₹41 a day."

**Bottom tabs:** Home · Orders · Plans · Profile.

What this changes, concretely:

- Skip a day: **4 interactions → 1**
- Check what's coming: **3 taps and a modal → 0, it is the first thing you see**
- Renewal: **a push you might miss → permanently visible once it matters**
- The subscription pitch: **hidden behind a modal → in front of every
  non-subscriber**
- Reorder: **impossible → one tap**

## 5. Steelmanning the current design

**"Only one subscription exists in the database — you would be designing for a
customer who does not exist."**

Fair, and it is why the home screen is *state-aware* rather than
subscription-only. A non-subscriber sees today's menu, which is what they see
now, plus an offer they currently cannot find. Nothing is lost. And if the
subscription business never works, note that the entire backend was built for
it — that would be a much larger problem than a home screen.

**"Browsing drives basket size."**

True in marketplaces with deep catalogues. With eleven cycle-bound breakfast
options, there is nothing to discover. The pattern does not transfer.

**"The current design is not broken — customers can do everything."**

They can. The question is not capability, it is cost per action on the actions
they perform most. That is what separates a prototype from a product.

## 6. Two smaller shape questions worth settling

**The cycle is named twice.** Cycle 1 is "Breakfast" in food and "Morning" in
essentials — same delivery window, two names, because `delivery_cycles` carries
both `cycle_name` and `essentials_label`. The moment the carts merge, the
section needs one name. My suggestion: name it by **the time it arrives** —
"Morning · by 7:30" — which is true for both a dosa and a litre of milk, and is
the thing the customer actually cares about.

**The wallet is right, but introduced at the wrong moment.** A prepaid float is
correct for a daily habit — it removes payment friction from every subsequent
order, which matters enormously for something bought 30 times a month. But
today a first-time customer meets it as an obstacle. The natural moment to fund
a wallet is **the subscription purchase itself**.

## 7. What I would not change

The money path, dispatch logic, RLS model, offline queue, batch release and
vendor flow are all sound and none of this touches them. Six personas in one
binary is right for a business this size — one install, one build. The
onboarding flow (phone → OTP → name + address + map pin) is genuinely good and
correct for hub routing.

The complexity in the *rules* is honest complexity inherited from running a
kitchen. I would keep almost all of it. One exception, in Sprint 3.

---

# Part Two — The sprint plan

Each sprint is a coherent chunk we can finish and verify. None of them touch the
money path, dispatch derivation, RLS or the vendor flow.

## Sprint 0 — See it before changing it

**Goal:** replace my inference with observation.

I have an iOS simulator booted and can capture and drive it. I walk every
journey — customer, staff, hub operator, driver, vendor, admin — and record real
tap counts, dead ends, confusing states, empty states and error copy.

**Output:** a findings list ranked by how often a real customer hits each one.
**Code changed:** none.
**Why first:** three of my strongest claims came from reading code. Some of what
I believe is wrong, and I would rather find out before we build on it.

## Sprint 1 — The three wins that need no new thinking

**Goal:** the highest value-per-hour work in the product.

1. **Reorder** — from Orders and Order Detail. Repopulates the cart from a past
   order, re-prices through `quote-order` (never trusts old prices), lands on
   Checkout.
2. **One cart** — merge the two stores, drop `cartType`, send one mixed array.
   **Server needs no changes.**
3. **Bottom tab bar** — Home · Orders · Plans · Profile. Ends
   modal-as-navigation.

**Verify:** place a mixed food + essentials order in one checkout; reorder it;
confirm the server produces one order group with correctly split dispatch rows.
**Risk:** low. Nothing server-side moves.

## Sprint 2 — The shape change

**Goal:** the state-aware home from Part One §4.

Subscriber sees next delivery, skip, wallet and meals-left. Non-subscriber sees
today's menu plus the offer. Browse moves one level down.

**Verify:** walk it as a subscriber, a non-subscriber, and a lapsed subscriber.
**Risk:** medium — this is the real redesign. It is also the one that changes
how the product feels.

## Sprint 3 — Simplify the rules the customer meets

1. **Delete the 2-hour cancellation window.** Cancellation currently applies two
   guards: within 2 hours of ordering **and** before the earliest cutoff. Order
   tomorrow's breakfast at 10am, try to cancel at 1pm — refused, though the
   cutoff is 22:30 and the kitchen knows nothing about it. The cutoff alone is
   the real operational constraint. The window costs a customer a meal they do
   not want and buys you nothing.
2. **Surface skip/pause where the subscription lives**, not three levels deep.
3. **Make renewal visible** in the app, not only as a push.

**Risk:** low. One guard removed in `cancel-order`; the cutoff guard stays.

## Sprint 4 — Admin organised by task

Today AdminHome is organised by database table — Menu Manage, Plans Manage,
Essentials Manage, Delivery Manage. You navigate your business by schema.

Regroup around what you actually do: **Today** (orders, kitchen, dispatch),
**This month** (expenses, claims, reports), **Setup** (menu, plans, zones,
staff, vendors).

**Risk:** low — navigation grouping, no logic changes.

## Sprint 5 — Launch hardening

The items from the earlier review that survived scrutiny: backups on Pro, domain
auto-renew, second admin on each service, the three funding decisions (loyalty,
referrals, cash-on-delivery), hub commission modelled then set, the two stale
`staff_user_id` values cleared, Razorpay live plus rebuild plus one real ₹1
payment tested end to end, Play listing completed.

---

## Sequencing, and the honest caveat

Sprint 0 first, always. Then 1 — it is cheap and changes the daily experience
more than anything else here. Then decide 2 on the evidence rather than on my
argument. Sprints 3 and 4 are small. Sprint 5 gates the launch and can run in
parallel with any of it.

**The caveat, now discharged:** Part One was reasoned from source code. Part
Three is what the walkthrough found, including the two places the reasoning was
wrong. Sprint 0 is therefore complete for the customer persona; staff, hub,
driver, vendor and admin remain unwalked.

---

# Part Three — What the walkthrough actually showed

Observed on an iPhone 17 simulator running the current build, 8 August 2026,
signed in as a real test customer. **Two of my earlier claims were wrong and are
corrected here.** Where observation contradicted the argument, observation won.

## Corrections to Part One

**The cart is NOT lost — it is worse than lost.** I claimed switching tabs
silently loses the cart. Wrong. The cart *bar* vanishes from Home, but the Cart
screen shows both carts together, correctly grouped by cycle with their own
subtotals. And then it presents **two buttons: "Checkout Essentials · ₹35" and
"Checkout Food · ₹50."** The customer sees ₹85 of shopping in one place and is
required to pay twice. That is a stronger argument for merging than the one I
made, because the split is explicit rather than accidental.

**The subscription surface is well designed.** I assumed it was poor. It is not.
"Breakfast 30 · Starts Sat 8 Aug · Day 1/30", a pause toggle, and a **delivery
calendar** of day chips where tapping a day opens "Tue, 11 Aug · Delivery
scheduled · Breakfast 30 · Skip". That is exactly the right pattern for a
subscription business. My criticism reduces to **depth, not quality** — it is
four taps behind a profile modal when it should be one tap from home.

**The wallet screen is genuinely good.** Balance, a top-up field with ₹500 /
₹1,000 / ₹2,000 quick amounts, and a transaction list that reads properly:
"Refund — order #11554 cancelled by admin +₹1,900", "Wallet topup via Razorpay
pay_TMUJcvif4rbfPT +₹1,000", "Order payment for #11553 −₹1,250". Every entry
names its reason and its reference. Nothing to change.

## Confirmed by observation

**No reorder anywhere.** Ten orders listed; every row read-only.

**Subscription dispatches appear as ₹0 orders.** Seen: `Order #11556 · Sat,
8 Aug · ₹0 · Confirmed`. A Breakfast-30 subscriber accumulates **thirty ₹0
entries a month**, burying real purchases.

**Orders and Subscriptions are BOTH split Food | Essentials.** The artificial
divide appears in three places, not one.

**The hero image consumes the top quarter of Home.** Four items visible before
scrolling.

**Two floating bars stack over the list** once the cart is non-empty, occluding
roughly 15% of the screen.

**Sections are ordered by `sort_order`, not urgency.** At 09:45 the list led
with Breakfast — orderable only for tomorrow — while Lunch closed in 75 minutes
and sat below the fold.

## New findings only visible by looking

**The cycle has THREE names, not two.** Home/Food says "**Breakfast**".
Home/Essentials says "**Morning**". The Cart says "**Lunch**" for the essentials
item — using `cycle_name` where Home used `essentials_label`. So the same
customer meets three different words for two delivery windows inside one
purchase.

**Every saved address is labelled "Home".** Checkout showed three addresses, all
titled "Home", distinguishable only by reading the street line —
"6/14, Nammane, Kamakshi Farm…", "1Bilgi s testing…", "Avaraguppa, Vidyagiri…".
`customer_addresses.label` defaults to `'Home'` and nothing prompts a rename.
The picker should lead with the address line, or require a distinct label.

**The cart warns about cutoffs, and does it well.** "Some items missed today's
cutoff — check each cycle's delivery day below", with each group then showing
"Tomorrow · dispatch by 7:30 AM". That is proactive, honest and clear. Keep it.

**Checkout is clean.** Address, order summary, subtotal, delivery, total,
"Incl. GST ₹2", then Razorpay or Wallet with the balance shown inline. No
complaints.

## What this does to the sprint plan

Sprint 1 is unchanged and now better evidenced — reorder, one cart, tab bar.
The one-cart work is smaller than feared: the Cart screen already groups by
cycle correctly and shows both. It needs the two checkout buttons collapsed into
one, and the Home cart bar to count both carts.

**Two items promoted into Sprint 1** on the strength of what I saw:

- **Render subscription dispatches as "Breakfast 30 · Day 3 of 30", not "₹0".**
  This is order-list presentation only — no schema change — and it prevents a
  subscriber's history filling with what look like errors.
- **Settle the cycle naming.** One name per delivery window, everywhere. My
  suggestion stands: name it by arrival time.

**Demoted:** the subscription control surface. It is good. It just needs to be
one tap from Home rather than four, which the tab bar in Sprint 1 already
solves.
