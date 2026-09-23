#!/usr/bin/env bash
# Regression gate: sweep the engine at <base> (default origin/main) and at the
# working tree, report where the branch supports LESS, then run check_stl.py on
# every changed case of both builds. Exit 1 on any blocking regression.
#
#   prototype/sweep/vs-base.sh [base-ref]        # e.g. origin/main, a sha
#   NOCHECK=1 prototype/sweep/vs-base.sh         # skip the (slower) check_stl pass
set -uo pipefail
BASE="${1:-origin/main}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d -t sf-sweep.XXXXXX)"
cleanup() { git -C "$ROOT" worktree remove --force "$WORK/base" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

git -C "$ROOT" fetch -q origin 2>/dev/null || true
git -C "$ROOT" worktree add -q --detach "$WORK/base" "$BASE" || exit 2
echo "base $(git -C "$WORK/base" log --oneline -1)"
echo "head $(git -C "$ROOT" log --oneline -1)$(git -C "$ROOT" diff --quiet -- web || echo ' + uncommitted web/ changes')"

deno run -A "$HERE/sweep.js" --web "$WORK/base/web" --out "$WORK/base.json" &
deno run -A "$HERE/sweep.js" --web "$ROOT/web" --out "$WORK/head.json" &
wait

echo
deno run -A "$HERE/compare.js" "$WORK/base.json" "$WORK/head.json" --changed "$WORK/changed.json"
status=$?

if [ -z "${NOCHECK:-}" ]; then
  echo
  deno run -A "$HERE/sweep.js" --web "$WORK/base/web" --out "$WORK/b2.json" --export "$WORK/exp-base" --only "$WORK/changed.json" >/dev/null &
  deno run -A "$HERE/sweep.js" --web "$ROOT/web" --out "$WORK/h2.json" --export "$WORK/exp-head" --only "$WORK/changed.json" >/dev/null &
  wait
  python3 "$HERE/check_diff.py" "$WORK/exp-base" "$WORK/exp-head" || status=1
fi
[ -n "${KEEP:-}" ] && { cp "$WORK"/*.json "$KEEP"/ 2>/dev/null; echo "kept json in $KEEP"; }
exit $status
