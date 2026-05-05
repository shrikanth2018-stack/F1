# 1stOne F1 — Session start

> Read this first when starting a fresh session. Stable; updated only when bring-up changes.

## What this app is

1stOne F1 is Shrikanth's meal + essentials delivery business serving Karnataka. It's an Expo React Native app with three personas (customer, staff, admin) backed by Supabase (auth + DB + Edge Functions + RLS) with Razorpay for payments. Single-branch in production today; multi-branch readiness is a launch gate (see `docs/RULES.md` D-08).

## Read order — first time on the project

1. **`docs/RULES.md`** — how we work. Working rules, communication style, change-request format.
2. **`1stOne_F1_Master_Document.docx`** — canonical product / business / operational reference. Read once for the full app brief — what the app does by design. May lag the live system by a day or two during active dev; live system wins on contested points (see source-of-truth hierarchy in RULES.md), but the Master Doc remains the foundation. Markdown extract available at `Dcos/master_doc_extracted.md` if needed.
3. **`CLAUDE.md`** (root) — codebase shape. Commands, env vars, file layout, pinned architectural facts (operational architecture notes appendix).
4. **`docs/STATUS.md`** — where we are right now. Yesterday's checkpoint, today's queue, persona roster, live SQL state.

## Read order — every subsequent session

1. **`docs/STATUS.md`** — current state.
2. **`docs/DECISIONS.md`** — open task ledger; scan for items in today's queue.
3. **`docs/HISTORY.md`** — skim the most recent 2–3 entries when researching "why does X work this way."

`docs/RULES.md` and the Master Doc are stable references — re-read only when something changes.

## Fresh-session prompts

### For Cowork Claude (investigation + proposal seat)

> I'm resuming work on the 1stOne F1 app — Shrikanth's meal+essentials delivery business in Karnataka. You're the investigation+proposal seat (file/line precision; CC executes).
>
> Read in order: `docs/SESSION_START.md` → `docs/RULES.md` → `1stOne_F1_Master_Document.docx` (first-time only; markdown extract at `Dcos/master_doc_extracted.md`) → `CLAUDE.md` → `docs/STATUS.md` → scan `docs/DECISIONS.md` for items in today's queue → skim recent entries in `docs/HISTORY.md` only if relevant.
>
> Then stand by for direction. Do NOT start work until I confirm a task. Working pattern: investigate with file/line precision, propose, wait for my approval, hand spec to CC, smoke-test between stages.

### For Claude Code (execution seat)

> You're the execution seat for 1stOne F1. Cowork Claude does investigation + proposes; you take approved specs and ship them as single-round-trip commits with descriptive messages, then push.
>
> Read in order: `docs/SESSION_START.md` → `docs/RULES.md` → `CLAUDE.md` → `docs/STATUS.md` (today's queue).
>
> Do NOT start work until a specific approved task arrives. When a task arrives: lint+test before commit, descriptive commit message, single round-trip, push, report back. No speculative refactors, no while-we're-here cleanups, no rewriting working code to match a preferred pattern.

## Acknowledgement

After reading this file (and the others above per the read order), confirm to Shrikanth in plain language that you've read them and will follow the rules in `docs/RULES.md`. Then wait for the first specific request — no unsolicited proposals, no refactors.
