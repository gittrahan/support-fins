#!/usr/bin/env bash
# Local checks for the Support Fins plugin bundle. Requires `lua`/`luac`.
# In-slicer behaviour still has to be verified by hand (see README) -- this only
# covers syntax, the slicer's scan pass, and the placement arithmetic.
set -euo pipefail
cd "$(dirname "$0")"
BUNDLE="com.printfins.support-fins"

echo "== luac -p (syntax) =="
for f in "$BUNDLE"/*.lua; do luac -p "$f" && echo "  ok  $f"; done

echo "== manifest JSON =="
python3 -c "import json;json.load(open('$BUNDLE/manifest.json'));print('  ok  $BUNDLE/manifest.json')"

echo "== scan pass (bare engine: no api, no require -- reads info only) =="
for f in "$BUNDLE"/*.lua; do
  lua -e 'local f=[['"$f"']]; local c=assert(loadfile(f)); assert(pcall(c));
          assert(type(info)=="table" and info.menu and info.title and info.params and type(execute)=="function", "info incomplete in "..f);
          print("  ok  "..f.."  ->  "..info.menu)'
done

echo "== geometry (mock api) =="
( cd tests && lua add_fin_test.lua )

echo "ALL PLUGIN CHECKS PASS"
