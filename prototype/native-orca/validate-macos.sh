#!/bin/bash
# Deno is capability-confined; every native child has a mandatory OS sandbox.
# Do not wrap this launcher in another sandbox-exec profile.
set -euo pipefail
if [[ $# != 2 ]]; then echo 'usage: validate-macos.sh <workspace> <new-output-directory>' >&2; exit 2; fi
recipe_dir="$(cd "$(dirname "$0")" && pwd -P)"
workspace="$(cd "$1" && pwd -P)"
out="$2"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
cd "$workspace"
python3 -B - "$workspace" <<'PYTHON'
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve(strict=True)
for child in ('cache/deno','tmp'):
    if not (root/child).resolve().is_relative_to(root):
        raise SystemExit('cache path escapes workspace through symlink')
PYTHON
mkdir -p cache/deno tmp
export DENO_DIR="$workspace/cache/deno" TMPDIR="$workspace/tmp" TMP="$workspace/tmp" TEMP="$workspace/tmp"
exec deno run --no-prompt --allow-read --allow-write="$workspace" --allow-run=git,python3 \
  "$recipe_dir/run.js" --workspace "$workspace" --source "$workspace/orca-source" \
  --orca "$workspace/orca-source/build/x86_64/OrcaSlicer/OrcaSlicer.app/Contents/MacOS/OrcaSlicer" --out "$out"
