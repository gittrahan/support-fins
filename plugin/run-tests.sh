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
# The slicer runs each file in a bare engine to read `info`. Plugin entry files
# declare `info`+`execute`; module files (shapes.lua etc) declare neither and
# just return a table -- those must load clean but carry no `info`.
for f in "$BUNDLE"/*.lua; do
  lua -e 'local f=[['"$f"']]; local c=assert(loadfile(f)); assert(pcall(c));
          if info ~= nil or type(execute)=="function" then
            assert(type(info)=="table" and info.menu and info.title and info.params and type(execute)=="function", "info incomplete in "..f);
            print("  ok  "..f.."  ->  "..info.menu)
          else
            print("  ok  "..f.."  ->  (module)")
          end'
done

echo "== geometry (mock api) =="
( cd tests && lua add_fin_test.lua )

echo "ALL PLUGIN CHECKS PASS"
