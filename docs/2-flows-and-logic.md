# 1stOne — Flows and Logic

The step-by-step paths, and every rule the system actually enforces.
Current as of 8 August 2026.

---

## The one rule everything else follows

**The phone never decides money or dates.** It sends item IDs, quantities, an
address and a payment choice. The server works out the delivery time, the
delivery date, the price, the tax and the fee. The same piece of server code
does the price preview and the real order, so the two can never disagree.

---

## 1. Placing an order

**Step 1 — Preview.** The cart asks the server for a quote. Back comes: which
delivery time each item falls into, which date it will go out, the tax carved
out, the delivery fee, and the total.

**Step 2 — Which date?** For each delivery time the server compares the clock
(in IST) with that time's cutoff:

- A same-day time (Lunch, Snacks, Dinner): **before cutoff → today**;
  after cutoff → **tomorrow**.
- Breakfast, which closes the night before: **before 10:30 pm → tomorrow**;
  after → **the day after tomorrow**.

If anything lands on the day after tomorrow, the customer is shown the date and
must tap to agree before the order goes through.

**Step 3 — Checks before anything is written.** The order is refused if:
storm mode is on; the address is outside the delivery area; an item is inactive
or has no delivery time assigned; a vendor item is being ordered to an address
that vendor does not cover; a vendor item is over its daily cap for that date;
or a new subscription would deliver the same item as one already running over
the same dates.

**Step 4 — Money.** Item prices already include GST. Tax is calculated as
`price × 5 ÷ 105` and reported separately. The **delivery fee is added once**,
to the earliest delivery date in the order.

**Step 5 — The drift check.** When the customer taps Pay, the phone sends back
the exact quote it showed them. The server re-prices from scratch and compares
to the last paisa. **If anything has changed, the order is refused** — no order
row, no gateway charge, no wallet movement — and the customer is told to review
the new total and tap Pay again.

**Step 6 — Payment.**
- **Wallet**: the balance is checked and debited in one atomic step. If it is
  short, the order is refused. The order is created as **Confirmed**.
- **Razorpay**: the gateway order is created *before* anything is written to our
  database. The order is created as **Pending** and only becomes Confirmed once
  payment is verified.

**Step 7 — Safety net.** If the order fails to save after a wallet debit, the
wallet is automatically refunded. If *that* also fails, the customer gets a
support reference number and the office is alerted.

**Guard rails.** Each checkout carries one idempotency key, so a double-tap or a
retry cannot create two orders. The key is only consumed on success. There is
also a limit of 5 successful orders per person per minute.

**Note.** One customer order can become several rows — one per delivery time —
all sharing a single order-group ID. The customer sees one order; the kitchen
sees one job per delivery time.

---

## 2. Paying by card / UPI

Two independent paths confirm a payment, and either can win:

1. **In the app** — after the payment sheet closes, the app asks the server to
   verify the signature and mark the order paid.
2. **The webhook** — Razorpay calls the server directly.

Both check a signature. The webhook **refuses to run at all if its secret is
missing**. Both mark every row in the order group as paid and activate any
subscription in it. Whichever runs second finds nothing left to do.

The webhook also handles: wallet top-ups, failed payments, and **payment links**
(used for back-office orders). The payment-link event must be ticked in the
Razorpay dashboard, or back-office orders never show as paid.

**On the website there is no card payment at all** — web checkout is
wallet-only.

---

## 3. Topping up the wallet

Customer enters an amount (minimum ₹100, maximum ₹50,000). A gateway order is
created and a pending record written. **The wallet is never credited at this
point.** It is credited only when the payment is confirmed, either in the app or
by the webhook — and the pending record makes a double credit impossible.

---

## 4. Subscriptions

**Buying one.** A plan is paid for in full at purchase. That payment is the
revenue event. A wallet purchase activates immediately; a card purchase
activates when the payment confirms.

**Conflict rule.** You cannot start a plan that delivers the same item as one
already running over overlapping dates. A plan that starts *after* the current
one finishes is allowed, and the app offers that date.

**Daily delivery.** Every minute, the server checks each delivery time. When a
cutoff has passed and the delivery window has not yet opened, it creates that
day's orders for every active, unpaused subscription. Those orders carry
**zero money** — the meal was already paid for. Then it counts one day used.

The system skips a subscription for that day if: the customer skipped it, an
order already exists for that day, or the customer has no active address.

**Length is counted in meals, not days.** Pausing or skipping pushes the end
date out, so every paid meal is eventually delivered. A subscription switches
itself off when the last day is used.

**Reminders.** Customers are told the day before a subscription starts, and
again when 2 days and 1 day of meals remain. If a renewal is close and the
wallet is below ₹200, they are prompted to top up.

**Cancelling.** A customer cannot cancel a subscription themselves. An admin
does it, and the refund is proportional to the meals not yet delivered:
`(price ÷ total days) × days remaining`, rounded to the rupee.

---

## 5. From order to doorstep

**The batch release.** Every minute the server checks whether a delivery time's
cutoff has passed. When it has, it creates the day's subscription orders and
then sends the kitchen a summary push. **That push is what releases the batch.**

The staff board shows exactly that one batch — plus anything from earlier that
is due and still unfinished, so nothing gets lost when the board flips to the
next batch. **Before the first push of the day the board is empty. That is
correct, not a fault.**

**The stages.**

```
Pending → Confirmed → Preparing → Ready → Packed → Dispatched
       → Received at Hub → On the Way → Delivered
```

Cancelled and Failed sit outside this line.

- **Kitchen tab** moves food from Confirmed to Ready. It shows a combined
  ingredient list, not a list of dishes — a dish with a recipe is broken into
  its blocks and added up across every order.
- **Packing tab** moves Ready → Packed → Dispatched. **Essentials skip the
  kitchen entirely** and go straight from Confirmed to Packed.
- **Driver** takes a hub order from Dispatched to Received at Hub, and a direct
  order all the way to Delivered.
- **Hub operator** takes it from Received at Hub → On the Way → Delivered.

**An order can never go backwards.** The database refuses it. Moving *to*
Cancelled or Failed is always allowed; coming back out of them is not. Admins
are exempt.

**Customer notifications** are sent at five points only: **Ready, Dispatched,
Received at Hub, Delivered, Cancelled**. Preparing, Packed and On the Way are
deliberately silent.

**Working offline.** If staff lose signal, status changes queue on the phone and
replay when signal returns. Four guards apply: nothing replays without a signed-in
session; a change queued by a *different* person on a shared device is thrown
away; a stale change that would move an order backwards lands as a no-op; and
the customer notification only fires if the change actually took effect. After
5 failed attempts the change is dropped and reported to Sentry.

---

## 6. Cancelling an order

A customer cancels the **whole order group** in one action. It is refused if:

- any line is a subscription purchase (those need an admin);
- more than **2 hours** have passed since the order was placed;
- the earliest delivery time's cutoff has passed ("the kitchen has already
  received today's orders");
- nothing in the group is still cancellable.

On success, every still-cancellable row is cancelled and the **wallet portion is
refunded automatically**. A card payment is *not* refunded automatically — the
amount is reported so it can be refunded from the Razorpay dashboard by hand.
Cancelling an already-cancelled order returns success without refunding twice.
If the wallet refund fails, the cancellation still stands and the office is
alerted.

An admin can cancel with a chosen refund amount. They cannot cancel a delivered
order, and they cannot cancel one that is out for delivery until its date has
passed.

---

## 7. Where an address can be delivered

The customer drops a pin. **The device does no geography at all** — the server
tests the point against the zone and hub polygons and stamps the answer onto the
address.

An address is serviceable if it falls inside an active zone, or inside a hub
marked as extending coverage. If it falls inside a hub polygon, the order is
routed through that hub; otherwise it is delivered direct.

A customer cannot set their own zone or hub — the server overwrites whatever
they send. Staff and admins can override, which is how a business address
outside every polygon gets handled.

---

## 8. Vendor selling and earning

**Listing an item.** A vendor creates it as a draft — it starts switched off.
They must add a photo; submission is refused without one, and names the item
missing it. It then goes to the office, which approves or rejects with a reason.
Approval switches it on.

**Changing a live item.** The vendor proposes a change; it does not take effect
until the office approves. The office applies the change field by field, so
nothing unexpected can slip through. A vendor *can* switch their own item off,
and change its daily cap, without approval.

**Who sees a vendor's goods.** Only customers whose address falls in a zone or
hub the vendor has been granted. This rule is enforced twice on purpose — once
when browsing, once again when ordering.

**Getting paid.** When an order is marked **Delivered**, the vendor's share is
credited to their wallet automatically:

- **Own brand** (the current model): `sale value × (1 − commission%)`.
  At 5%, a ₹54 litre of milk earns the vendor ₹51.30.
- **House brand**: an agreed per-item buying price × quantity.

The credit is tied to the order line, so re-delivering can never pay twice, and
a failure on one line never blocks the delivery being recorded.

**Payout.** The vendor requests a payout, which raises a claim for the office to
settle. Only one claim can be open at a time. When it is marked Paid, the wallet
is debited automatically — and if the balance has since dropped, the debit is
refused and logged rather than driving the wallet negative.

⚠️ **The payout claims the vendor's entire wallet balance**, including any money
they put in themselves as a customer. This matters only once a vendor also
shops on the app.

---

## 9. Hub commission

Counted on **delivered** orders routed through that hub, over a whole calendar
month, and only the **last complete month** can be claimed. The operator sees
last month and the month to date, and raises one claim per month.

Two figures are computed slightly differently: the claim uses the value of the
goods, the admin Hub Report uses the order total (which would include a delivery
fee). With the fee at ₹0 they agree.

---

## 10. Back-office ordering

An admin can place an order for a customer — for bulk or business accounts.
Differences from a customer order, all deliberate:

- No price-drift check and no rate limit.
- A discount up to **15%**, applied to unit prices so the invoice adds up.
- An optional delivery-fee override.
- **Every line goes out in the one delivery time the admin picks**, regardless
  of what the item is normally catalogued under. This is also the only way to
  order a building block.
- The order is created **before** payment, so an unpaid order is a valid result.
- Payment can be: wallet, a **payment link sent by SMS**, or "account" (bill
  later).
- Storm mode still applies — there is no back-office override.
- A **preview** button runs the whole calculation and writes nothing, so the
  confirmation figures are the real ones.

The customer and address must already exist, and **the address must resolve to a
zone or a hub** — an order nobody can route is refused.

---

## 11. Staff attendance and supplies

**Attendance.** Clock in and out; works offline. Staff can only write their own
attendance for dates between 7 days ago and tomorrow. If they forgot a day, they
request a correction; an admin approves it, which creates the missing record
using their shift start time (or 9:00 am if no shift is set). Approval is
refused if a record for that day already exists. A reminder goes out two days
before month end.

**Supplies.** Staff raise a supply request (Vegetables, Grocery or Stationery).
It is added straight to the office's live order list — identical items are
merged and quantities added. An admin prints a batch, which snapshots what was
printed and marks those lines as done.

---

## 12. Referrals

A code is applied once per person, never your own, and only while the referral
programme is switched on. The new customer is credited immediately. The person
who referred them is credited when the new customer's **first** order is
confirmed — checked by counting their orders, so it can only ever fire once.

---

## 13. What runs automatically

| When (IST) | What |
|---|---|
| Every minute | Release the batch to the kitchen; create the day's subscription orders |
| Every 5 minutes | Ping the external health monitor |
| Every 10 minutes | Alert if a kitchen batch is 45 minutes from delivery and was never sent |
| Every hour | Alert on any background-job failure; delete idempotency keys older than 24 hours |
| 9:00 am daily | Subscription starting / ending reminders |
| 9:30 am daily | Low-wallet warnings |
| 10:00 am Mondays | Win-back message to customers inactive for 14 days |
| 10:30 am daily | Attendance reminder (only two days before month end) |
| 2:30 am daily | Trim old logs (pushes 90 days, dispatch runs 180 days) |
