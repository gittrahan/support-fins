#!/usr/bin/env bash
# UI "no behaviour change" gate: run the ui-smoke script against <base> (default
# origin/main) and the working tree, per model, and diff. Exit 1 on any change.
#
#   prototype/ui-smoke/vs-base.sh [base-ref]         # e.g. origin/main, a sha
#   MODELS="cone lbracket tshape" prototype/ui-smoke/vs-base.sh
#   KEEP=/some/dir prototype/ui-smoke/vs-base.sh     # keep the JSON dumps
#
# Runs one headless Chrome at a time (two in parallel stalled the GPU process).
set -uo pipefail
BASE="${1:-origin/main}"
MODELS="${MODELS:-cone lbracket}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d -t sf-ui.XXXXXX)"
cleanup() { git -C "$ROOT" worktree remove --force "$WORK/base" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

git -C "$ROOT" fetch -q origin 2>/dev/null || true
git -C "$ROOT" worktree add -q --detach "$WORK/base" "$BASE" || exit 2
echo "base $(git -C "$WORK/base" log --oneline -1)"
echo "head $(git -C "$ROOT" log --oneline -1)$(git -C "$ROOT" diff --quiet -- web || echo ' + uncommitted web/ changes')"

status=0
for m in $MODELS; do
  deno run -A "$HERE/ui-smoke.js" --web "$WORK/base/web" --model "$m" --out "$WORK/base-$m.json" 2>/dev/null \
    || { echo "$m: base run failed:"; deno eval "console.log(JSON.parse(Deno.readTextFileSync('$WORK/base-$m.json')).errors.join('\n'))" 2>/dev/null; status=2; continue; }
  deno run -A "$HERE/ui-smoke.js" --web "$ROOT/web" --model "$m" --out "$WORK/head-$m.json" 2>/dev/null
  deno run -A "$HERE/compare.js" "$WORK/base-$m.json" "$WORK/head-$m.json" || status=1
done
[ -n "${KEEP:-}" ] && { cp "$WORK"/*.json "$KEEP"/ 2>/dev/null; echo "kept json in $KEEP"; }
exit $status
