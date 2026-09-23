#!/usr/bin/env python3
"""
Build the single-file OrcaSlicer plugin: bundle the printfins.com engine from
web/ with esbuild, wrap it in engine_glue.js, and splice it into
support_fins.template.py -> dist/support_fins.py.

    python3 plugin/orca/build.py [--version 0.2.0]

Needs node (esbuild is fetched via npx). Re-run after any change to the engine
modules in web/ so the plugin fins parts exactly like the site does.
"""
import argparse
import pathlib
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent.parent / "web"
ENTRY = """\
export { buildTopology, analyze, IDENTITY3, DEFAULT_THRESHOLD } from '{web}/overhangs.js';
export { buildFins } from '{web}/fins.js';
export { writeThreeMF } from '{web}/threemf.js';
"""


def bundle():
    with tempfile.TemporaryDirectory() as tmp:
        entry = pathlib.Path(tmp, "entry.js")
        out = pathlib.Path(tmp, "engine.js")
        entry.write_text(ENTRY.replace("{web}", WEB.as_posix()))
        subprocess.run(["npx", "-y", "esbuild@0.25", str(entry), "--bundle",
                        "--format=iife", "--global-name=SF", "--target=es2020",
                        "--log-level=warning", f"--outfile={out}"], check=True)
        return out.read_text()


def engine_rev():
    def git(*a):
        return subprocess.run(["git", "-C", str(WEB), *a], capture_output=True,
                              text=True).stdout.strip()
    rev = git("rev-parse", "--short", "HEAD") or "unknown"
    return rev + ("+dirty" if git("status", "--porcelain", "--", ".") else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="0.2.0")
    args = ap.parse_args()

    glue = (HERE / "engine_glue.js").read_text()
    js = glue.replace("//@@ENGINE@@", bundle())
    src = (HERE / "support_fins.template.py").read_text()
    src = (src.replace("@@VERSION@@", args.version)
              .replace("@@ENGINE_REV@@", engine_rev())
              .replace("@@ENGINE_JS@@", repr(js)))

    out = HERE / "dist" / "support_fins.py"
    out.parent.mkdir(exist_ok=True)
    out.write_text(src)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, engine {engine_rev()})")


if __name__ == "__main__":
    main()
