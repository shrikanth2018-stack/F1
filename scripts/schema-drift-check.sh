#!/usr/bin/env bash
#
# 1stOne F1 — has production moved without the repo noticing?
#
# Regenerates the schema snapshot into a scratch directory and diffs it against
# the committed one. Any difference means the live database and the repository
# disagree, which is the state this project lived in for months without knowing.
#
# WHAT A FAILURE ACTUALLY MEANS. Two possibilities, and they need opposite
# responses:
#
#   1. You applied SQL to production and have not re-snapshotted. Normal, and
#      the fix is `npm run schema:snapshot` and commit — in the same sitting as
#      the SQL, the same way an OTA is followed by a push.
#
#   2. You did NOT apply anything. Then something changed the database that
#      nobody recorded: a hand-edit in the Supabase dashboard, an old SQL file
#      re-run, or a change made from another machine. That is the case worth
#      stopping for. Read the diff before touching anything — it names the
#      object.
#
# The diff is printed with the LIVE side as `+`, so a `+` line is something in
# production that the repo does not know about.
#
# USAGE
#   npm run schema:check
#
# Requires Docker running and `supabase link` done. Read-only against the
# database. Exit 0 = in sync, 1 = drift, 2 = could not check.
#
set -euo pipefail

COMMITTED_DIR="supabase/schema"
SCRATCH="$(mktemp -d -t schema_drift)"
trap 'rm -rf "$SCRATCH"' EXIT

for f in live_schema.sql live_jobs.txt; do
  if [ ! -f "$COMMITTED_DIR/$f" ]; then
    echo "✖ no committed snapshot at $COMMITTED_DIR/$f" >&2
    echo "  Create the baseline first: npm run schema:snapshot" >&2
    exit 2
  fi
done

echo "→ regenerating the live schema to compare…"
SCHEMA_SNAPSHOT_QUIET=1 bash scripts/schema-snapshot.sh "$SCRATCH" || {
  echo "✖ could not read the live schema — nothing was compared." >&2
  echo "  This is NOT a pass. Fix the connection and re-run." >&2
  exit 2
}

# EVERY `diff` HERE ENDS IN `|| true`, AND THAT IS NOT NOISE.
#
# `diff` exits 1 when files differ — which is the case this script exists to
# handle — and `set -euo pipefail` treats that as a fatal error. The first
# version of this loop aborted the moment it found the first difference: it
# printed one diff, never compared live_jobs.txt, and never printed the
# explanation at the bottom. It still exited non-zero, so it LOOKED like it had
# worked. A half-run check that reports a plausible failure is worse than one
# that crashes, because nobody investigates it.
DRIFTED=0
for f in live_schema.sql live_jobs.txt; do
  if ! diff -q "$COMMITTED_DIR/$f" "$SCRATCH/$f" >/dev/null 2>&1; then
    DRIFTED=1
    # Computed once, before printing, so the trimming note below is accurate.
    FULL_DIFF="$(diff -u "$COMMITTED_DIR/$f" "$SCRATCH/$f" || true)"
    BODY="$(printf '%s\n' "$FULL_DIFF" | tail -n +3 || true)"
    TOTAL="$(printf '%s\n' "$BODY" | wc -l | tr -d ' ')"

    echo
    echo "══ DRIFT in $f ══"
    echo "   (- = in the repo, + = in production)"
    echo
    # Trimmed: a full diff of a 10,000-line dump after a big change is
    # unreadable, and the first 120 lines are enough to name the object. The
    # scratch copy is deleted on exit, so the hint below is how to see it all.
    printf '%s\n' "$BODY" | head -120 || true
    if [ "$TOTAL" -gt 120 ]; then
      echo
      echo "   … $((TOTAL - 120)) more diff lines. To see everything:"
      echo "     npm run schema:snapshot && git diff $COMMITTED_DIR/$f"
    fi
  fi
done

echo
if [ "$DRIFTED" = "0" ]; then
  echo "✓ in sync — the repository describes the database that is running."
  exit 0
fi

cat <<'MSG'
✖ The live database and the committed snapshot disagree.

  If you applied SQL and expected this:
      npm run schema:snapshot && git add supabase/schema && git commit

  If you applied nothing, something changed production unrecorded. Find out
  what before re-snapshotting — re-snapshotting is how an unexplained change
  becomes the new baseline and stops being visible.
MSG
exit 1
