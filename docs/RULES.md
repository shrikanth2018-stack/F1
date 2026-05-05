# 1stOne F1 — Working Rules

> How we work. Stable; updated only when a rule changes. For session bring-up read `docs/SESSION_START.md` first.

## File map

| File | Answers |
|---|---|
| `docs/SESSION_START.md` | *How does a new agent come up to speed?* Entry point. |
| `docs/RULES.md` (this file) | *How do we work?* |
| `docs/STATUS.md` | *Where are we right now?* Current snapshot, today's queue. |
| `docs/DECISIONS.md` | *What's open?* Pending task ledger. |
| `docs/HISTORY.md` | *How did we get here?* Timeline of shipped milestones. |
| `CLAUDE.md` | *Codebase shape* — architecture, env vars, pinned facts. |
| `1stOne_F1_Master_Document.docx` | *What is the app, by design?* Canonical product/business reference. |

## Roles

- **Shrikanth** — product owner. All directional calls and approvals; smoke-tests between stages.
- **Cowork Claude** — investigation + proposal seat. File/line precision.
- **Claude Code (CC)** — execution seat. Approved specs → single-round-trip commit → push.

**Flow:** Shrikanth raises need → Cowork proposes → Shrikanth approves → CC executes → Shrikanth smoke-tests.

## Communication style

- Short, focused, bullets. Plain English. First-time technical terms get a one-line meaning.
- **Ask before guessing.** When a question needs evidence (SQL, log, file content), ask for it and wait for the paste. No speculation about causes or solutions before evidence is in hand.
- **One option at a time.** Lead with the single best fix + how to judge if it worked. Second option only if the first fails. No buffets.
- **Don't suggest skipping steps** to save time.
- One task at a time, complete cleanly before the next.
- If a request is unsafe or misguided, say so before proceeding.

## Working rules (active)

### D-06 — Best fix for long-term stability wins
Foundation-correct, right-sized — not minimum-diff. Sometimes one line, sometimes a small helper extraction.

**Guardrails:** no speculative refactors, no while-we're-here cleanups, no rewriting working code to match a preferred pattern. If a fix must grow beyond the symptom, the proposal flags why and waits for approval.

### D-07 — Scope freeze through launch
Feature surface is closed. No new screens, flows, hooks, Edge Functions, or capabilities. Three permitted modes:

- **BF (bug fix)** — reactive. Root-cause not symptom-masking.
- **MF (foundation work)** — architectural improvements to the existing surface.
- **FT (fine-tune)** — proactive per-flow perfection. One finding at a time.

If a proposal needs new functionality, flag why and wait for approval to extend scope.

### D-08 — Multi-branch readiness is a launch gate
Production bundle does not ship to Play Store with known multi-branch gaps. Internal Testing track is exempt. See `docs/MF-03_multi_branch_audit.md`.

### Verify before fix
- Re-read the actual file (not a summary).
- Find empirical evidence the bug fires today — DB query, log, live test.
- Only then design the fix.

### Approval gate
No code is written until Shrikanth approves. Cowork proposes; Shrikanth approves; CC executes.

### Preserve existing behavior
Don't change behavior, rename, or refactor unless explicitly approved.

## Source-of-truth hierarchy

When sources conflict:

1. **Live system** — Supabase query, function logs, real-device test. Empirical evidence wins.
2. **`docs/RULES.md`** — joint working rules + architectural decisions. Supersedes code reads and master doc on contested points.
3. **Master Document** — canonical product/business reference.
4. **Live code in the repo** — authoritative on current behavior.
5. **Older audits, `SYSTEM_FLOWS.md`** — historical context only.

## Change-request format

**Light** (one file, no DB / payments / auth / shared component):

1. **Issue** — one line.
2. **Fix** — file + line + change.
3. **Rollback** — one line.
4. End with: *Waiting for approval.*

**Full** (anything touching DB, payments, auth, shared components, or multiple files):

1. **Understanding** — restate issue + outcome.
2. **Root cause** (bugs) or **Approach rationale** (features / MF / FT) — with confidence level.
3. **Impact check** — flows, shared components, DB schema, backend, auth, payments, offline sync, reports/admin. Mark N/A where it doesn't.
4. **Proposed approach** — exact steps.
5. **Rollback plan**.
6. End with: *Waiting for approval before making code changes.*

For non-change messages (questions, status checks), answer normally — no template.

## Architecture & security standards

**Backend / security (non-negotiable):**
- Critical business rules, final calculations, payment validation, and sensitive state transitions are server-side.
- Payment success is never trusted from the client. Verify via secure backend or webhook.
- Client values may display for UX; server is the source of truth.

**Preferred patterns** (apply when codebase already aligns or Shrikanth approves):
- Server-state via TanStack Query. Supabase access via `useSupabaseQuery` / `useSupabaseMutation`. Local state via Zustand.
- Offline staff actions: queued local mutations with persistence + reconnection sync — only when actually needed. Define what's cached, queued, on-reconnect, and on-conflict.

**UI / theme:**
- Centralized theme (`src/theme/index.ts`) — no hardcoded hex codes, font sizes, or spacing values.
- Maintain visual consistency unless redesign is explicitly requested.

**When writing code:**
- Show only files that change; explain each.
- Keep diffs minimal; no unrelated rewrites.
- Don't rename unless necessary.
- Highlight migration / regression risk.
- Verification checklist + rollback per step.
