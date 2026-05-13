# 1stOne F1 — Session start

> Read this first when starting a fresh session. Stable; updated only when bring-up changes.

## What this app is

1stOne F1 is Shrikanth's meal + essentials delivery business serving Karnataka. It's an Expo React Native app with three personas (customer, staff, admin) backed by Supabase (auth + DB + Edge Functions + RLS) with Razorpay for payments. Single-branch in production today; multi-branch readiness is a launch gate (see `docs/RULES.md` D-08).

## Read order — every session

1. **`docs/RULES.md`** — how we work. Working rules, communication style, change-request format.
2. **`CLAUDE.md`** (root) — codebase shape. Commands, env vars, file layout, pinned architectural facts (operational architecture notes appendix).
3. **`docs/STATUS.md`** — current state. Yesterday's checkpoint, today's queue, persona roster, live SQL state.
4. **`docs/DECISIONS.md`** — open task ledger; scan for items in today's queue.
5. **`docs/HISTORY.md`** — skim the most recent 2–3 entries only when researching "why does X work this way."

That's it for default bring-up.

## Working pattern

Default: a single Claude (CC) instance handles the full cycle — investigate, propose tightly, wait for approval, execute, report. This is what Shrikanth prefers (validated 2026-05-05 — direct CC throughput ~3x the older Cowork-mediated split).

The two-seat split (Cowork investigates + proposes, CC executes) is **optional**, used only when Shrikanth specifically requests it for genuinely heavyweight investigations (multi-day audits across many flows). Default is single-seat; don't presume the split.

Per-commit re-approval is **exempted on already-approved plans**. Within an audit doc or multi-step plan that Shrikanth has approved, execute next step → push → report. Re-ask only on scope drift, DB / payments / auth / RLS surprises, or destructive actions.

## Fresh-session prompt

> I'm resuming work on the 1stOne F1 app — Shrikanth's meal+essentials delivery business in Karnataka. You handle the full cycle: investigate, propose, wait for my approval, execute, report.
>
> Read in order: `docs/SESSION_START.md` → `docs/RULES.md` → `CLAUDE.md` → `docs/STATUS.md` → scan `docs/DECISIONS.md` for items in today's queue. Skim recent `docs/HISTORY.md` entries only if researching prior decisions.
>
> Then stand by for my first request. Don't start work until I confirm a task. Working pattern per task: investigate with file/line precision, propose tightly using the Light or Full change-request format, wait for approval, execute, report. Per-commit re-approval is exempted on already-approved plans — execute and report; re-ask only on scope drift.

## Acknowledgement

After reading the docs above, confirm in plain language that you've read them and will follow the rules in `docs/RULES.md`. Then wait for the first specific request — no unsolicited proposals, no refactors.
