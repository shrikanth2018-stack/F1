#!/usr/bin/env bash
#
# 1stOne F1 — rehearse a SQL change on a clean copy before production sees it.
#
# WHY THIS EXISTS. There is one database, and it is development, preview and
# production at once. Every schema change has always gone straight to it. The
# discipline that made that survivable was dry-running inside
# `BEGIN … ROLLBACK` — good, and it caught real problems, but it has two holes:
#
#   * IT RUNS AGAINST PRODUCTION. A dry run that half-fails leaves nothing
#     behind, but it is still executing on the live database, and a rollback
#     does not undo everything. `nextval()` is not transactional: two dry runs
#     of one file quietly moved `employee_id_seq` from 6 to 22 on 17 Aug 2026.
#   * IT CANNOT TELL YOU THE FILE IS IDEMPOTENT. Every file in supabase/sql/ is
#     required to be safe to run twice. Nothing ever checked.
#
# This builds a throwaway database from `supabase/schema/live_schema.sql`,
# applies your file to it TWICE, and shows you exactly what changed. Then it
# throws the database away. Production is never touched — the only thing read
# from it is nothing at all; the snapshot on disk is the input.
#
# ── WHAT THIS PROVES, AND WHAT IT DOES NOT ────────────────────────────
#
# PROVES:  the SQL is valid against the real schema; it applies cleanly; it is
#          idempotent; and precisely which objects it adds, alters or drops.
#
# DOES NOT PROVE:  that it does the right thing to your DATA. The rehearsal
#          database is EMPTY — the snapshot is schema-only, deliberately, so no
#          customer data is ever copied to a laptop. So an `UPDATE … WHERE`
#          touches zero rows here and an assertion like "every staff member has
#          an employee number" passes trivially.
#
#          THE BEGIN … ROLLBACK DRY RUN AGAINST PRODUCTION IS STILL REQUIRED.
#          This is the step before it, not instead of it. Rehearse to prove the
#          SQL is sound, then dry-run to prove it does the right thing to the
#          rows that actually exist.
#
# USAGE
#   npm run schema:rehearse supabase/sql/my_change.sql
#   npm run schema:rehearse -- file_one.sql file_two.sql     # applied in order
#   KEEP=1 npm run schema:rehearse ...   # leave the container up to poke at
#
# Requires Docker running. Exit 0 = the change is sound, 1 = it is not.
#
set -euo pipefail

SNAPSHOT="supabase/schema/live_schema.sql"
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.104"
CONTAINER="f1_rehearse_$$"
WORK="$(mktemp -d -t f1_rehearse)"

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo
    echo "  KEEP=1 — container left running as '$CONTAINER'."
    echo "    psql:   docker exec -it $CONTAINER psql -U postgres"
    echo "    remove: docker rm -f $CONTAINER"
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── Arguments ─────────────────────────────────────────────────────────
if [ "$#" -eq 0 ]; then
  echo "usage: npm run schema:rehearse <file.sql> [more.sql …]" >&2
  exit 1
fi
for f in "$@"; do
  [ -f "$f" ] || { echo "✖ no such file: $f" >&2; exit 1; }
done

# ── Preflight ─────────────────────────────────────────────────────────
docker info >/dev/null 2>&1 || {
  echo "✖ Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
}
[ -s "$SNAPSHOT" ] || {
  echo "✖ no schema snapshot at $SNAPSHOT — run: npm run schema:snapshot" >&2
  exit 1
}

PGPW="rehearse"
# As `postgres`, because that is the role Supabase itself applies SQL as — so
# a grant or an ownership problem shows up here rather than in production.
psql_in() { docker exec -i "$CONTAINER" psql -U postgres -d postgres "$@"; }
# As `supabase_admin` — needed only for the auth-schema shim below. `postgres`
# is NOT a superuser in this image and does not own the auth schema, so it
# cannot create a function in it. The image's POSTGRES_PASSWORD applies to
# supabase_admin as well, which is how this gets in without a password hunt.
psql_super() { docker exec -i -e PGPASSWORD="$PGPW" "$CONTAINER" psql -U supabase_admin -d postgres "$@"; }
# Deterministic schema fingerprint, taken from inside the container.
#
# THE \restrict FILTER IS NOT COSMETIC. pg_dump 17 emits a `\restrict <random
# token>` / `\unrestrict <same token>` pair, and the token is regenerated on
# every invocation. Without stripping it, two dumps of an UNCHANGED database
# always differ — which made the idempotence check below report every file as
# not idempotent, including one that only creates indexes with IF NOT EXISTS.
# (`supabase db dump` strips these itself, which is why the committed snapshot
# is byte-stable.)
fingerprint() {
  docker exec "$CONTAINER" pg_dump -U postgres -d postgres --schema-only --schema=public 2>/dev/null \
    | grep -vE '^\\(un)?restrict ' || true
}

echo "→ starting a throwaway Postgres 17.6 (no ports published, nothing shared)…"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPW" "$IMAGE" >/dev/null
for i in $(seq 1 90); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  [ "$i" = "90" ] && { echo "✖ Postgres never became ready" >&2; exit 1; }
  sleep 1
done

# ── The one platform gap ──────────────────────────────────────────────
#
# The image ships auth.users, auth.uid(), auth.role() and auth.email() — which
# is why the 13 foreign keys from public into auth.users resolve — but NOT
# auth.jwt(), which Supabase's own migrations add. Without it, exactly six
# policies fail to create: the ones that read the JWT inline rather than
# through the public.jwt_*() wrappers the other 95 use.
#
# This is Supabase's real implementation, so the rehearsal is a faithful copy
# rather than a copy with six holes in its security model.
echo "→ adding the auth.jwt() shim the bare image lacks…"
psql_super -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO postgres, anon, authenticated, service_role;
SQL

# ── Build the baseline ────────────────────────────────────────────────
#
# ON_ERROR_STOP=1 on purpose. The snapshot restores cleanly now, so ANY error
# here means either the snapshot is stale or the image has changed — both worth
# stopping for rather than rehearsing against a half-built schema.
echo "→ building the baseline from ${SNAPSHOT}…"
if ! psql_in -q -v ON_ERROR_STOP=1 -f - < "$SNAPSHOT" > "$WORK/base.out" 2> "$WORK/base.err"; then
  echo "✖ the snapshot did not restore cleanly. Nothing was rehearsed." >&2
  echo "  This is not a problem with your change." >&2
  sed 's/^/    /' "$WORK/base.err" | head -20 >&2
  exit 1
fi

base_counts() {
  psql_in -tAc "
    select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
        || ' tables · '
        || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
        || ' functions · '
        || (select count(*) from pg_policies where schemaname='public')
        || ' policies · '
        || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public')
        || ' triggers';"
}
echo "  baseline: $(base_counts | tr -d '\r')"
fingerprint > "$WORK/fp_before.sql"

# ── Apply the candidate, once ─────────────────────────────────────────
echo
for f in "$@"; do
  echo "→ applying $f …"
  if ! psql_in -v ON_ERROR_STOP=1 -f - < "$f" > "$WORK/run1_$(basename "$f").out" 2> "$WORK/run1_$(basename "$f").err"; then
    echo
    echo "✖ FAILED on first application of $f"
    echo
    sed 's/^/    /' "$WORK/run1_$(basename "$f").err" | head -40
    exit 1
  fi
  # A file's own report / RAISE NOTICE output is the point of reading it.
  if [ -s "$WORK/run1_$(basename "$f").err" ]; then
    echo "    notices:"
    grep -E '^(NOTICE|WARNING)' "$WORK/run1_$(basename "$f").err" | sed 's/^/      /' | head -20 || true
  fi
done
echo "  ✓ applied with no errors"
fingerprint > "$WORK/fp_after1.sql"

# ── Apply it again — the idempotence requirement, finally checked ─────
echo
echo "→ applying everything a SECOND time (every file here must be re-runnable)…"
for f in "$@"; do
  if ! psql_in -v ON_ERROR_STOP=1 -f - < "$f" > /dev/null 2> "$WORK/run2_$(basename "$f").err"; then
    echo
    echo "✖ NOT IDEMPOTENT — $f failed when run a second time."
    echo "  Every file in supabase/sql/ is required to be safe to re-run."
    echo
    sed 's/^/    /' "$WORK/run2_$(basename "$f").err" | head -40
    exit 1
  fi
done
fingerprint > "$WORK/fp_after2.sql"

if ! diff -q "$WORK/fp_after1.sql" "$WORK/fp_after2.sql" >/dev/null 2>&1; then
  echo
  echo "✖ NOT IDEMPOTENT — the second run changed the schema again."
  echo "  (- = after one run, + = after two)"
  diff -u "$WORK/fp_after1.sql" "$WORK/fp_after2.sql" 2>/dev/null | tail -n +3 | head -40 || true
  exit 1
fi
echo "  ✓ re-running changed nothing"

# ── What the change actually did ──────────────────────────────────────
echo
echo "→ what this change does to the schema:"
if diff -q "$WORK/fp_before.sql" "$WORK/fp_after1.sql" >/dev/null 2>&1; then
  echo "    nothing — no schema objects added, altered or dropped."
  echo
  echo "    Two innocent reasons for this, and one that is not:"
  echo "      • the change is DATA only (an UPDATE, a backfill) — and the"
  echo "        rehearsal database is empty, so there was nothing to act on;"
  echo "      • it is already IN the snapshot, so every guard (IF NOT EXISTS,"
  echo "        CREATE OR REPLACE) correctly did nothing;"
  echo "      • or it did not do what you thought. If you expected a new"
  echo "        object here, that is the answer."
else
  DIFF="$(diff -u "$WORK/fp_before.sql" "$WORK/fp_after1.sql" 2>/dev/null | tail -n +3 || true)"
  TOTAL="$(printf '%s\n' "$DIFF" | wc -l | tr -d ' ')"
  printf '%s\n' "$DIFF" | grep -E '^[+-]' | grep -vE '^[+-]{3}' | sed 's/^/    /' | head -60 || true
  [ "$TOTAL" -gt 60 ] && echo "    … ($TOTAL diff lines in total)"
fi

echo
echo "  final: $(base_counts | tr -d '\r')"
cat <<'MSG'

✓ Sound: applies cleanly, and re-running it changes nothing.

  This did NOT test what it does to your data — the rehearsal database is
  empty. Still dry-run it against production inside BEGIN … ROLLBACK before
  applying, and remember that a rollback does not undo a nextval().
MSG
