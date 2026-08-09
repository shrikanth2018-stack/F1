# 1stOne — What I Would Change

Written as if I owned this business. Opinions are marked as opinions; every
factual claim was verified against the running code, the live database or the
service dashboards on 8 August 2026.

---

## 1. Start with what is genuinely good, because it constrains everything else

The money path is better than most systems I have read, and it is the part
where being wrong costs real money. The server derives every price and date;
the phone sends only intent. A paise-exact drift check refuses an order whose
price moved while the customer was deciding. Idempotency keys are consumed only
on success. The wallet moves atomically with automatic compensation, and when
compensation itself fails the customer gets a support reference and an admin
gets a push. Vendor credit is a database trigger because four different code
paths reach "Delivered" and only a trigger catches all four.

The system is also unusually honest about its own failures. There are alert
paths for a failed refund, a subscription that did not get created, a kitchen
batch that never sent, a vendor line that could not be credited. Most systems
fail silently and find out from a customer.

**I would not rebuild any of this.** Everything below assumes it stays.

---

## 2. The central tension

The engineering is roughly eighteen months ahead of the business.

Built and working: six personas, a vendor network with commissions and payout
claims, hub operators with monthly commission accounting, loyalty, referrals,
multi-branch scaffolding, an offline queue for staff, a bulk B2B ordering path,
nine report types.

Actually happened: **zero real customers, zero delivered orders, zero rupees.**
One vendor, who has never earned. Three hubs, none of which can pay a
commission because none has a percentage set. No customer has ever earned a
loyalty point. No referral has ever been made.

This is not a criticism of the build. It is the single most important fact
about where the business stands, and it changes what "best version" means.
Every feature is a permanent tax: it must be tested, documented, kept working
through every SDK upgrade, and explained to whoever comes next. A feature that
does not yet earn is a liability carried at full cost.

**So the question is not "what should we add". It is "what should we switch off
until it earns its keep, and what must be unbreakable before the first real
customer".**

---

## 3. Three things that are quietly broken as *product*

These are the findings I would act on first, because each is a business
decision hiding inside working code.

### 3.1 The loyalty programme does not award points. At all.

`store_config.loyalty_points_per_rupee` is set to 0.10 and is editable on the
Store Config screen. Nothing reads it. I traced every caller of
`increment_loyalty_points`: the only live ones are the referral signup and the
referral first-order trigger. **No code anywhere awards a point for spending
money.**

So today: a customer sees a "My Loyalty Points" screen, can redeem points at
1 point = ₹1, and has no way to ever earn one except by being referred.

Two honest options. Fund it — wire earning to order completion and pick a rate
deliberately. Note that 0.10 points per rupee is **10% cashback**, which is
almost certainly not what was intended for a food business on thin margins;
1–2% is the normal range. Or remove the screen until you want it. What I would
not do is leave it visible and inert: a rewards scheme that never rewards
teaches customers that your promises are decorative.

*My recommendation: wire it at 1%, or hide the screen. Decide in an hour, not a
quarter.*

### 3.2 The referral programme pays nothing, and until today its link was dead

`referral_settings` is active, but `referee_signup_credit` = ₹0,
`referrer_first_order_credit` = ₹0, `referrer_month_credit` = ₹0. The only
reward is 50 loyalty points on each side — which, per 3.1, is the one place
points can come from. And the share link used a URL scheme the app never
registered, so on any production Android install the link simply did nothing.

A growth loop that costs nothing usually produces nothing. Either put real
money behind it — ₹50 to each side on first order is a normal starting
number — or turn it off. Half-on is the worst state: it occupies a screen, a
settings page, an edge function and a database trigger, and returns zero.

### 3.3 There is no cash-on-delivery, and the code has quietly made that decision for you

Payment methods are wallet, Razorpay, and `account` (admin-only, for B2B).
There is no cash path anywhere.

I do not know your customers — you do. UPI penetration in Karnataka is high and
this may be exactly right. But right now the *code* is making that call, not
you. If even one customer in five in Siddapur wants to hand over cash at the
door, you cannot serve them, and you will read it as "the app isn't converting"
rather than "we don't accept how they want to pay".

*Decide it deliberately. If the answer is "no cash", write that down as a
business decision. If it is "yes", it is a genuine piece of work — an order
state, a driver collection flow, and daily reconciliation — and it should be
scoped before launch, not after.*

---

## 4. What I would change technically, in the order I would do it

**First: a second environment, and real migrations.** This is the biggest
structural risk in the system and everything else is smaller. One Supabase
project is development, preview and production simultaneously. 127 SQL files
are applied by hand in an order recorded in a markdown file. It has worked
because of your discipline — dry-run in a transaction, roll back, then apply —
but that is a practice, not a property. The day you are tired, or the day
someone else touches it, the safety net is a habit.

A second Supabase project as staging, plus converting those 127 files into a
real migration sequence, costs roughly a day and about $25/month. It converts
"a mistyped UPDATE ends the business" into "a mistyped UPDATE is caught in
staging".

**Second: backups.** Free tier includes none. You already know this and plan to
upgrade at launch. The thing to know is that upgrading does not backfill — a
backup exists only from the moment the plan starts, and everything between now
and then is unprotected. The manual dump I took today covers you in the
meantime; run it before every schema change.

**Third: alerting on the money path.** Cron failures push to admins. Client
crashes go to Sentry. But if `place-order` started returning 500 to every
customer, nothing would tell you — it lives only in Supabase logs, which nobody
watches. This is the gap between "orders stopped" and "you found out". A
Supabase log drain or a simple synthetic check that places and cancels a test
order every fifteen minutes would close it.

**Fourth: two screen tests, not a hundred.** Coverage is pointed at the right
things — dispatch dates, order building, subscription maths, offline replay.
What is untested is screens, and the two that matter are Cart and Checkout,
because that is where a shared-component change silently breaks revenue. I
would add those two and stop. Chasing 114 screens is how test suites become
something nobody runs.

**Fifth, and only when it starts hurting: `subscription_plans.plan_items`.**
Plan contents live in a TEXT column holding JSON, while a properly typed,
indexed, foreign-keyed `subscription_plan_items` table sits empty beside it.
Everything reads the TEXT column. It works. It is the one place where the
schema actively misleads a reader, and it will bite when someone needs to ask
"which plans contain this item" in SQL.

**Flagged, not scheduled:** the `orders` table does two jobs. A subscription
*purchase* (a revenue event, zero fulfilment) and a subscription *dispatch* (a
fulfilment event, zero money) are both rows in `orders`, told apart by item
type and zeroed amounts. That is clever and it works — but it is why
`isOperationalOrder` exists, why reports must exclude statuses, and why the
staff board needs filtering. It is the thing most likely to hurt when a second
branch or a new order type arrives. I would not touch it now; I would refuse to
add a third meaning to that table.

---

## 5. Unit economics — one number I would check before launch

Delivery fee is ₹0. Hub commission is a percentage of delivered orders. Vendor
commission is 5% to you on their goods.

So a hub-delivered order of your own food earns you the food margin **minus**
the hub commission, with no delivery revenue at all. That can be perfectly
sound — the hub replaces a driver you would otherwise pay — but it means the
entire margin has to come out of the food price, and the commission percentage
is effectively your delivery cost per order.

No hub currently has a percentage set, so nothing is being paid and nothing is
being tested. **Before you set that number, model one month at realistic volume
with it.** It is the single number that decides whether the hub model makes or
loses money, and it is currently blank.

---

## 6. How work is handled

The release discipline is already good — the gate runs in two places on
purpose, web ships with every release, dummy flows before anything customer-
facing, verify by grepping the served bundle rather than trusting a status
code. Most solo operations have nothing like it.

Two things I would change.

**Make the release ritual a literal checklist**, not remembered practice. Six
lines, ticked every time: check passes, edge functions diffed and deployed,
native diff checked, OTA pushed, git pushed, web bundle verified. It now exists
in the maintenance workbook; use it as a checklist rather than a description.

**The bus factor is one, and it is worse than it looks.** Services split across
two Google accounts, and losing `1st0nedotin@gmail.com` costs you Play,
Cloudflare and Supabase simultaneously — the store, the website and the entire
backend. Print both sets of two-factor recovery codes. This is a fifteen-minute
task that protects everything else on this list.

---

## 7. What I would explicitly not do

- **Not rebuild the money path.** It is the strongest part of the system.
- **Not chase test coverage** across 114 screens.
- **Not clean up the dead code** — the `'Paid'` status, the `'split'` payment
  method, the unused RPC. It is genuinely tidy for its size and none of it
  causes a bug. Clear it when you are next in that file, never as a project.
- **Not add features before the first hundred real orders.** Everything already
  built is enough to run this business. What is missing is customers, and no
  feature fixes that.

---

## 8. If I owned it, this is the order

**Before the first real customer** — roughly a week of work.
Backups on Pro. Decide loyalty (fund at 1% or hide). Decide referrals (fund or
turn off). Decide cash-on-delivery deliberately. Set hub commission after
modelling a month. Print both recovery-code sets. Razorpay live key, rebuild,
verify one real ₹1 payment end to end.

**First month after launch** — as capacity allows.
Staging project and real migrations. Money-path alerting. Cart and Checkout
tests.

**When the business asks for it, not before.**
The `orders` table split. Typed plan items. The vendor payout separation from
customer wallet float. iOS.

---

## The one-line version

The system is built well enough to run a business that is ten times its current
size. Nothing needs rebuilding. What it needs is a second environment so
mistakes are survivable, three product decisions that are currently being made
by silence rather than intent, and the discipline to add nothing else until
real customers tell you what they actually want.
