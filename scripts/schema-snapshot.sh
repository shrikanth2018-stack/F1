#!/usr/bin/env bash
#
# 1stOne F1 — write down what the database actually is.
#
# WHY THIS EXISTS. On 17 August 2026 the repository held 43 tables and 51
# functions in `supabase/sql/schema.sql`. The live database had 54 tables, 105
# functions, 101 policies and 37 triggers. The repo held roughly HALF the
# database, and had done for months.
#
# That has two consequences, and the second one is the dangerous one:
#
#   1. The database could not be rebuilt from git. Lose the Supabase project
#      and there is no path back — the 138 files in supabase/sql/ are the
#      HISTORY of how it was built, applied by hand in an order recorded in a
#      markdown file. That is not a description of what exists.
#
#   2. Reading the repo could not tell you what was deployed. Twenty-five
#      functions are defined in two, three or FOUR different files, and
#      whichever ran last silently won. `assign_hub_operator` is in four —
#      re-running the oldest would quietly re-open a privilege-escalation hole
#      that was closed the same week.
#
# So this writes the live schema down, in full, from the database itself. The
# snapshot is the answer to "what is deployed?" — not any file in
# supabase/sql/, which remains what it always was: the changelog.
#
# WHAT MAKES IT TRUSTWORTHY. It is `pg_dump` (via `supabase db dump`), not a
# hand-rolled catalog query. Verified on the day it was written: the counts
# match the live catalog exactly, there are no `setval` lines (so no volatile
# data leaks in), no timestamp or version header, and two consecutive runs are
# BYTE-IDENTICAL. That last property is the whole basis of the drift check —
# without it, every run would look like a change.
#
# THE ONE GAP, AND WHY THERE IS A SECOND FILE. `supabase db dump` excludes the
# `cron` schema, because on a normal project it is platform-managed. On this
# one it is load-bearing: ten scheduled jobs release the kitchen batch, create
# subscription orders, ping the dead-man's switch and prune logs. So the cron
# jobs and the extension versions are captured separately, by catalog query.
#
# USAGE
#   npm run schema:snapshot            # write to supabase/schema/
#   bash scripts/schema-snapshot.sh /tmp/out   # write somewhere else
#
# Requires: Docker running (pg_dump runs in a container) and `supabase link`
# already done. Read-only against the database.
#
# AFTER APPLYING ANY SQL TO PRODUCTION, RE-RUN THIS AND COMMIT THE RESULT in
# the same sitting — the same pairing rule the OTA release follows. A snapshot
# that lags is worse than none, because it looks authoritative.
#
set -euo pipefail

OUT_DIR="${1:-supabase/schema}"
SCHEMA_FILE="$OUT_DIR/live_schema.sql"
JOBS_FILE="$OUT_DIR/live_jobs.txt"

# Quiet mode: the drift check calls this and does its own reporting.
QUIET="${SCHEMA_SNAPSHOT_QUIET:-0}"
say() { [ "$QUIET" = "1" ] || echo "$@"; }

mkdir -p "$OUT_DIR"

# ── Preflight, with the actual remedy in the message ──────────────────
if ! docker info >/dev/null 2>&1; then
  echo "✖ Docker is not running. \`supabase db dump\` runs pg_dump in a container." >&2
  echo "  Start Docker Desktop and try again." >&2
  exit 1
fi

# ── 1. The public schema, in full ─────────────────────────────────────
say "→ dumping the public schema (pg_dump, via supabase db dump)…"
supabase db dump --linked -f "$SCHEMA_FILE" >/dev/null 2>&1 || {
  echo "✖ supabase db dump failed. Re-run without redirection to see why:" >&2
  echo "    supabase db dump --linked -f $SCHEMA_FILE" >&2
  exit 1
}
[ -s "$SCHEMA_FILE" ] || { echo "✖ the dump produced an empty file" >&2; exit 1; }

# ── 2. The bits pg_dump leaves out ────────────────────────────────────
#
# Ordered by name and with volatile columns left out ON PURPOSE:
#   * cron.job.jobid   — changes if a job is dropped and recreated, which
#                        would read as drift when nothing meaningful moved.
#   * sequence values  — `employee_id_seq` advances every time a staff member
#                        is onboarded. Tracking it would make the snapshot
#                        drift on ordinary use, which trains people to ignore
#                        the check. The sequence's EXISTENCE is in the dump;
#                        its position is data.
say "→ capturing cron jobs and extension versions (catalog query)…"
QUERY_FILE="$(mktemp -t schema_jobs)"
trap 'rm -f "$QUERY_FILE"' EXIT
cat > "$QUERY_FILE" <<'SQL'
SELECT 'EXTENSION  ' || rpad(e.extname, 24) || ' version ' || e.extversion AS line
FROM pg_extension e
UNION ALL
SELECT 'CRON JOB   ' || rpad(j.jobname, 34) || ' schedule ' || rpad(j.schedule, 14)
       || ' active=' || j.active || E'\n             ' || regexp_replace(j.command, '\s+', ' ', 'g')
FROM cron.job j
ORDER BY 1;
SQL

# Parsed with python rather than jq: python ships with macOS and every CI
# runner, jq does not.
#
# The parser SEEKS THE FIRST '{' instead of skipping a fixed number of lines.
# The CLI prints an "Initialising login role..." banner on STDERR, so with
# stderr discarded the JSON starts on line 1 — but with `2>&1` it starts on
# line 2. The first draft did `tail -n +2` and silently ate the opening brace,
# which surfaced as a JSON error 12 characters in. Seeking the brace is correct
# under both, and under a future CLI that adds another banner line.
supabase db query --linked --file "$QUERY_FILE" 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
start = raw.find("{")
if start < 0:
    sys.stderr.write("catalog query returned no JSON:\n" + raw[:500] + "\n")
    sys.exit(1)
payload = json.loads(raw[start:])
rows = payload.get("rows")
if rows is None:
    sys.stderr.write("catalog query returned no rows key:\n" + json.dumps(payload)[:500] + "\n")
    sys.exit(1)
print("# 1stOne F1 — scheduled jobs and extensions.")
print("# Generated by scripts/schema-snapshot.sh. Do not edit by hand.")
print("# These are NOT in live_schema.sql: supabase db dump excludes the cron schema.")
print()
for r in rows:
    print(r["line"])
' > "$JOBS_FILE" || { echo "✖ could not capture cron jobs / extensions" >&2; exit 1; }

# ── 3. Say what was captured, so a silent half-dump cannot pass ───────
if [ "$QUIET" != "1" ]; then
  count() { grep -c "$1" "$SCHEMA_FILE" || true; }
  echo
  echo "  $SCHEMA_FILE"
  printf '    %-26s %s\n' "tables"      "$(count '^CREATE TABLE')"
  printf '    %-26s %s\n' "functions"   "$(count '^CREATE OR REPLACE FUNCTION')"
  printf '    %-26s %s\n' "policies"    "$(count '^CREATE POLICY')"
  # pg_dump emits CREATE TRIGGER; the Supabase wrapper rewrites it to
  # CREATE OR REPLACE TRIGGER. Grepping for the former finds nothing and looks
  # like 37 missing triggers — which is exactly what happened while writing
  # this, so the pattern here is the rewritten one.
  printf '    %-26s %s\n' "triggers"    "$(count '^CREATE OR REPLACE TRIGGER')"
  printf '    %-26s %s\n' "indexes"     "$(count '^CREATE INDEX\|^CREATE UNIQUE INDEX')"
  printf '    %-26s %s\n' "RLS enabled" "$(count 'ENABLE ROW LEVEL SECURITY')"
  printf '    %-26s %s\n' "grants"      "$(count '^GRANT ')"
  echo
  echo "  $JOBS_FILE"
  printf '    %-26s %s\n' "extensions"  "$(grep -c '^EXTENSION' "$JOBS_FILE" || true)"
  printf '    %-26s %s\n' "cron jobs"   "$(grep -c '^CRON JOB' "$JOBS_FILE" || true)"
  echo
  echo "✓ snapshot written. Commit it alongside whatever SQL you just applied."
fi
