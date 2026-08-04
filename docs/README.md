# 1stOne — documentation

**Start with `CLAUDE.md` at the repo root.** It is the current map of the
system — architecture, navigation, roles, integrations, business flows, the
audit state — and it is re-derived from the code rather than maintained by
hand, so it does not drift the way prose does.

## Where to look for what

| Question | Answer lives in |
|---|---|
| How does the system work? | `CLAUDE.md` §1–§5 |
| What is broken / decided / accepted right now? | `CLAUDE.md` §9 — **the live list** |
| How do I run and verify things? | `CLAUDE.md` §6, and `06-ops-and-maintenance-runbook.md` |
| Something is on fire | `07-incident-playbooks.md` |
| What SQL has been applied, in what order? | `supabase/sql/DEPLOY_SQL_ORDER.md` |

**Nothing in this folder is the live status of anything.** `CLAUDE.md` is, and
it is re-derived from code rather than maintained by hand. On 2026-08-04 three
items it listed as open were already fixed — so verify before acting even on
that, and fix it when you find drift.

## What lives here now

| File | What it is | Still current? |
|---|---|---|
| `06-ops-and-maintenance-runbook.md` | Owner's operational runbook — scheduled jobs, monitoring, deploys, secret rotation | Yes |
| `07-incident-playbooks.md` | What to do when something breaks | Yes |
| `PHASE_2_PLAN.md` | Second branch + the reverse supply chain. Planned, not started. **House brand belongs here** — it is the same "we buy at an agreed rate" shape | Forward-looking |
| `VENDOR_ONBOARDING_QUESTIONS.md` | Phase-1 vendor decisions record | Yes |
| `HEALTH_REPORT.md` | **Historical snapshot, 2026-07-21.** Retained for its reasoning, not as a backlog — much of it is fixed and it cites 331 tests against 493 today | No — see `CLAUDE.md` §9 |

## What was removed on 2026-07-30, and why

Seven documents were deleted because every one of them predated the vendor
network and described four personas rather than six. A stale document that
looks authoritative is worse than no document — it was actively misleading
during the July audit.

| Removed | What it contained | Why it went |
|---|---|---|
| `01-app-flows.md` | Plain-English narrative of every customer and staff flow — written for a person, not a developer | The only one not derived from code, so the only one genuinely lost rather than regenerable. Recorded here deliberately. |
| `02-maintenance-runbook.md` | Owner's checklist, monitoring, credentials, deploys, secret rotation | Superseded almost line-for-line by `06` |
| `03-architecture-and-data-model.md` | Table-by-table data model, every RPC, every edge function | Regenerable from code. Said "45 tables"; knew nothing of the vendor tables |
| `04-business-logic-and-flows.md` | The money rules in depth — pricing, dispatch dates, cancellation, cron | Regenerable. `CLAUDE.md` §5 covers the same ground more briefly |
| `05-screen-by-screen.md` | Per-screen specification for all personas | Regenerable. `CLAUDE.md` §2 has the navigation map |
| `CODEBASE_MAP.md` | Onboarding synthesis | Superseded by `CLAUDE.md` |
| `DEEP_DIVE_2026-07-27.md` | One-off snapshot taken three days before the vendor network landed | Point-in-time; already overtaken when written |

Also removed: the matching `.docx` copies of 01–05 and the three
`build_*_docx.py` generators that produced them.

**Nothing is lost.** Recover any of them from git:

```
git show bc8049d:docs/01-app-flows.md > docs/01-app-flows.md
```

`bc8049d` is the last commit before the deletion; the tag `july-2026-stable`
sits one commit after it.

## The plan for a real doc set

**Decision (2026-07-30, owner):** do not restore or patch the old set. When the
app is ready for public release, write a fresh set **from the code as it stands
at that point** — the same way `CLAUDE.md` was produced. A generated-from-source
document is accurate on the day it is written and honest about what it does not
cover; a hand-maintained one starts drifting immediately.

What that set should cover, based on what was worth having in the old one:

1. **Business flows in plain English** — the `01-app-flows` role. The only piece
   that cannot be recovered from source, because it describes intent, not
   behaviour. Write this one first and from conversation, not from code.
2. **Architecture and data model** — tables, RPCs, edge functions, RLS.
3. **Business rules** — money, dispatch dates, subscriptions, cancellation.
4. **Screen by screen** — every persona, including vendor, driver and hub
   operator.
5. **Operations** — keep `06` and `07`, refreshed.

Before writing any of it, re-run `supabase/tests/platform_health_check.sql` so
the document describes a system that is actually passing.
