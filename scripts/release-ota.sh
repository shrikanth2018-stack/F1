#!/usr/bin/env bash
#
# 1stOne F1 — release an OTA, and prove it landed.
#
# WHY THIS EXISTS. On 9 August an invalid `scheme` in app.config.js made
# `eas update` refuse the manifest server-side. It exits 1 and prints a red
# ✖, but that is the last of ~60 lines of bundler output, and a refused
# publish otherwise looks exactly like a successful one: the bundles still
# build, the assets still upload. Nobody noticed for four days, and two
# finished features — the home rebuild and one-cart checkout — sat unshipped
# behind it while the repo looked entirely healthy.
#
# So this does not just run the command. It records the live update group id
# BEFORE publishing and checks it CHANGED afterwards. A publish that fails,
# half-fails, or silently no-ops cannot pass that test.
#
# It also does the pairing the release practice asks for: an OTA is followed
# by `git push` in the same sitting, so app.1stone.in never drifts from what
# the phones are running.
#
# Usage:  npm run release:ota -- "what changed, in a few words"
#
set -euo pipefail

# `npx --yes`, NOT `--no-install`. The first version of this used --no-install
# so a release could never silently pull a different CLI — but that makes the
# release depend on npx cache state, and it broke the moment Expo published
# eas-cli 21.7.1: the cache held 21.7.0, --no-install refused to fetch, and
# the release aborted for a reason that had nothing to do with the app.
# --yes fetches when needed and never prompts. The channel-moved check below
# is what actually guarantees a release landed, so the CLI version does not
# need to be frozen to make this safe.
EAS="npx --yes eas-cli"

CHANNEL="${CHANNEL:-production}"
MESSAGE="${1:-}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

if [ -z "$MESSAGE" ]; then
  red "✖ Give the release a message: npm run release:ota -- \"what changed\""
  exit 1
fi

# Anything uncommitted would ship in the bundle but not be in git — the two
# would disagree about what is live, which is the thing this file exists to
# prevent.
if [ -n "$(git status --porcelain)" ]; then
  red "✖ Working tree is dirty. Commit first — the OTA ships your tree, git records it."
  git status --short
  exit 1
fi

# eas update NEVER ships supabase/functions. If they changed since the last
# release, the app and the server are about to disagree.
LAST_TAG="$(git rev-parse HEAD@{1} 2>/dev/null || echo '')"
if [ -n "$LAST_TAG" ] && ! git diff --quiet "$LAST_TAG" HEAD -- supabase/functions/ 2>/dev/null; then
  bold "⚠  supabase/functions changed since the previous HEAD."
  git diff --name-only "$LAST_TAG" HEAD -- supabase/functions/ | sed 's/^/     /'
  bold "   eas update does NOT ship these. Deploy them, or the app meets an older server."
  printf '   Continue? [y/N] '
  read -r reply < /dev/tty
  [ "$reply" = "y" ] || { red "✖ Aborted."; exit 1; }
fi

bold "→ gate"
npm run check

# The update group live on the channel right now. Everything after this is
# measured against it.
read_group() {
  $EAS channel:view "$CHANNEL" --non-interactive 2>/dev/null \
    | awk '/Group ID/ { print $3; exit }'
}
BEFORE="$(read_group || true)"
bold "→ live update group before: ${BEFORE:-<none>}"

bold "→ eas update --channel $CHANNEL"
# set -e already aborts on a non-zero exit; this makes the reason unmissable
# rather than leaving it as the last line of the bundler's output.
if ! $EAS update --channel "$CHANNEL" --message "$MESSAGE" --non-interactive; then
  red ""
  red "════════════════════════════════════════════════════"
  red "  ✖ OTA FAILED TO PUBLISH — nothing shipped."
  red "    Scroll up for the reason. Common cause: a value"
  red "    in app.config.js the manifest schema rejects."
  red "════════════════════════════════════════════════════"
  exit 1
fi

AFTER="$(read_group || true)"
if [ -z "$AFTER" ] || [ "$AFTER" = "$BEFORE" ]; then
  red ""
  red "════════════════════════════════════════════════════"
  red "  ✖ THE CHANNEL DID NOT MOVE."
  red "    eas update reported success but the live group"
  red "    is still ${BEFORE:-<none>}. Nothing reached any device."
  red "════════════════════════════════════════════════════"
  exit 1
fi

bold "→ live update group after:  $AFTER"

# Web ships with every release.
bold "→ git push"
git push origin "$(git rev-parse --abbrev-ref HEAD)"

green ""
green "════════════════════════════════════════════════════"
green "  ✓ RELEASED"
green "    channel : $CHANNEL"
green "    group   : $AFTER"
green "    commit  : $(git rev-parse --short HEAD)"
green "    web     : deploying from the push above"
green "════════════════════════════════════════════════════"
