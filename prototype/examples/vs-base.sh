#!/usr/bin/env bash
# Coverage scoreboard: probe.js at <base> (default origin/main) and at the working
# tree, on the reported parts (reports/) and the real minis/organic models (real/),
# then probe_diff.js on the policy number, must%. Both runs are scored by THIS
# checkout's held.js (one ruler). Sequential, one process at a time.
#
#   prototype/examples/vs-base.sh [base-ref]
#   POSES=up,X30 prototype/examples/vs-base.sh       # real/ poses (default up,X30)
#   KEEP=<dir> ...                                  # keep the JSON
#   HEAD_MODE=full ...                              # build the working tree in Full coverage
#                                                     (base stays Auto: what the mode adds)
#   BASE_MODE=full HEAD_MODE=full ...               # Full vs Full: what a fill change does
set -uo pipefail
BASE="${1:-origin/main}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d -t sf-probe.XXXXXX)"
cleanup() { git -C "$ROOT" worktree remove --force "$WORK/base" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

git -C "$ROOT" fetch -q origin 2>/dev/null || true
git -C "$ROOT" worktree add -q --detach "$WORK/base" "$BASE" || exit 2
echo "base $(git -C "$WORK/base" log --oneline -1)"
echo "head $(git -C "$ROOT" log --oneline -1)$([ -n "$(git -C "$ROOT" status --porcelain -- web)" ] && echo ' + uncommitted web/ changes')"

run() {   # $1 web dir, $2 out prefix, $3 mode
  deno run -A "$HERE/probe.js" --web "$1" --mode "$3" --dir "$HERE/reports" --poses up,suggested,X-90 --json "$2-reports.json" >/dev/null || return 1
  deno run -A "$HERE/probe.js" --web "$1" --mode "$3" --poses "${POSES:-up,X30}" --json "$2-real.json" >/dev/null || return 1
  deno eval "const a=JSON.parse(Deno.readTextFileSync('$2-reports.json')),b=JSON.parse(Deno.readTextFileSync('$2-real.json'));Deno.writeTextFileSync('$2.json',JSON.stringify([...a,...b]))"
}
run "$WORK/base/web" "$WORK/base" "${BASE_MODE:-auto}" || exit 2
run "$ROOT/web" "$WORK/head" "${HEAD_MODE:-auto}" || exit 2

echo
deno run -A "$HERE/probe_diff.js" "$WORK/base.json" "$WORK/head.json"
status=$?
[ -n "${KEEP:-}" ] && { mkdir -p "$KEEP"; cp "$WORK"/base.json "$WORK"/head.json "$KEEP"/; echo "kept json in $KEEP"; }
exit $status
