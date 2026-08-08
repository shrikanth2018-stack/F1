# 1stOne — Business Processes

What the business does, and who is allowed to do what.
Current as of 8 August 2026. Every statement was read from the running code and
the live database.

---

## What the business is

A home-kitchen food and daily-essentials delivery service. One mobile app (and
one website) serves six kinds of people. Everything runs in one region, on
Indian Standard Time.

Today it is set up as **one branch** ("Main Branch"), **one delivery zone**, and
**three hubs** (Kolsirsi, Shiralagi, Bilagi).

## What is sold

**Food.** 37 dishes across four delivery times, each with a photo and a recipe.
Behind them sit 34 "building blocks" — the components a dish is made from
(rice, sambar and so on). Blocks are not on the customer menu; they exist so the
kitchen gets a combined prep list, and so the office can sell them in bulk.

**Essentials.** 8 items — milk, curd, bread, ghee, coriander, a newspaper. Six
are ours, two come from a vendor.

**Subscription plans.** 2 plans: "Breakfast 30" (30 days, ₹1,250) and
"Milk 15" (15 days, ₹775). A plan is paid for once, up front, and then delivers
automatically each day.

## The four delivery times

| | Order by | Kitchen told at | Delivered from |
|---|---|---|---|
| **Breakfast** (essentials: "Morning") | 10:30 pm the night before | 11:40 pm | 7:30 am |
| **Lunch** ("Noon") | 11:00 am | 11:10 am | 12:30 pm |
| **Snacks** (food only) | 3:00 pm | 3:10 pm | 4:30 pm |
| **Dinner** ("Evening") | 6:00 pm | 6:10 pm | 7:30 pm |

Breakfast is the only one that closes the night before. Snacks does not carry
essentials.

---

## The six kinds of people

### Customer

Anyone who signs in. There are no passwords — sign-in is a phone number and an
OTP.

A customer can: browse the menu and essentials (two separate carts), place an
order, buy a subscription, top up a wallet, redeem loyalty points, refer a
friend, cancel their own order, rate an order, and manage their addresses.

They cannot change their own role, wallet balance, loyalty points, or which
branch or hub they belong to. Those columns are not writable from the app at all.

### Staff (kitchen and packing)

Marked `staff` in the system. They see a two-tab board — **Kitchen** and
**Packing** — showing the batch the kitchen was just told about.

They can: advance orders through preparation, see the combined prep list, clock
in and out (works offline), request an attendance correction, apply for leave,
claim expenses, and raise supply requests.

### Driver

A staff member who has been named as the driver on a zone or a hub. They get a
"My Deliveries" screen.

On a hub order they can only move it from **Dispatched** to **Received at Hub**,
then stop — the rest belongs to the hub operator. On a direct order they take it
all the way to **Delivered**.

### Hub operator

A customer whose profile has been attached to a hub. They get a hub dashboard.

They handle the last leg: **Received at Hub → On the Way → Delivered**. They can
also see their hub's monthly commission and raise a claim for it.

*Note: no hub currently has a commission percentage set, so no claim can
actually be raised today. This is a setting, not a code change.*

### Vendor

A customer who also has a vendor record. Today there is one: **Nandini Milk**,
approved, on 5% commission.

A vendor can: complete their registration, list items for sale (each needs a
photo before it can be submitted), propose changes to a live listing, switch
their own items on and off, see paid orders containing their goods, mark an
order ready, see their earnings, and request a payout.

They cannot change their own commission, status or selling model, and they
cannot edit a live listing directly — a change goes to the office for approval.

### Admin and super-admin

An admin runs everything: orders, menu, plans, essentials, delivery areas,
staff, vendors, customers, expenses, stock, notifications, banners and reports.

A **super-admin** adds four things on top: managing branches, exporting the
customer list, changing store settings, and changing feature switches.

There are currently 2 admins (one of them the super-admin), 2 staff, and 5
customers — of whom one is the hub operator and one is the vendor.

---

## How someone becomes each thing

**Customer** — signs in with a phone number. A profile is created automatically.

**Staff** — an admin enters their details on the Onboard Employee screen. If the
person has never used the app, a login is created for them. They get an employee
number in the form `1ST-2026-001`. Choosing the designation **"ADMIN HEAD"**
makes them an admin instead of staff, and only a super-admin may do that.

**Driver** — an admin names an existing staff member as the driver on a zone or
a hub. Nothing else changes; the "My Deliveries" screen appears on their next
sign-in.

**Hub operator** — an admin attaches an existing person to a hub.

**Vendor** — five steps, in order:

1. Admin finds an **already-registered** person by phone and elevates them.
   The system never creates a login for a vendor.
2. That person sees "Complete vendor registration" in their profile menu and
   fills in business name, GST, FSSAI and a return policy.
3. Admin reviews it, sets the commission and selling model.
4. Admin sets which zones and hubs the vendor may sell into. **Without this
   step nobody can see their goods.**
5. Admin approves. Only now can their items go live.

A vendor can be **suspended** later — their catalogue goes off immediately,
orders already placed are still honoured, and any balance stays claimable.
Re-approving does *not* put their items back on sale; the vendor turns them back
on themselves.

**Removing a staff member** — an admin offboards them, which turns them back
into a customer and stamps an exit date. It is refused while they are still
named as a driver anywhere.

---

## Money, in outline

- **Prices already include GST.** The tax shown on an invoice is carved out of
  the price, never added to it. The rate is 5%.
- **The delivery fee is currently ₹0** and is charged once per order, not once
  per delivery time.
- **The wallet** is a stored balance. It can be topped up (minimum ₹100,
  maximum ₹50,000) and spent. Refunds go back to the wallet.
- **Loyalty points** convert at **1 point = ₹1** of wallet credit.
- **Cancellation window: 2 hours** from placing the order, and only while the
  earliest delivery time has not yet closed.
- **Admin discount** on a back-office order is capped at **15%**.
- A vendor is paid their share of a sale **when the order is delivered**, not
  when it is placed.

---

## Referrals

Currently switched on. When a new customer uses a referral code they get
**50 loyalty points** and no cash. When that customer places their first order,
the person who referred them gets **50 loyalty points** and no cash. Those
amounts are settings, not code.

---

## What the business has actually done so far

The database holds test data only: 9 people, 17 orders, 1 subscription, 1
vendor. No order has ever reached "Delivered", so no vendor has ever been paid
and no commission has ever been calculated. No real money has moved — the
payment gateway is still on its test key.
