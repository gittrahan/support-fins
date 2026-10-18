#!/usr/bin/env python3
"""Build the Rhino 8 plugin.

  python3 plugins/rhino/build.py          # -> plugins/rhino/build/SupportFins/ (the project)
                                          #    + build/support-fins-rhino-<version>.yak, if
                                          #    Rhino 8's rhinocode is on this machine

1. Stages a Rhino script project (SupportFins.rhproj): the commands, with
   SupportFins/bootstrap.py inlined at their `# @bootstrap` line (a built command is one
   script, so it can't import its neighbour), and lib/: the plugin's modules, the shared
   Python host (plugins/shared/py/supportfins_host.py), options.json and the
   printfins.com engine (web/*.js, untouched) bundled into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx).
2. `rhinocode project build` compiles it into a .rhp plugin and a .yak package (Rhino
   needn't be running). Without Rhino the staged project still runs a command as a
   script: `rhinocode script build/SupportFins/commands/SupportFins.py`, or open it in
   Rhino's ScriptEditor.

Nothing is vendored: the commands' `# r:` lines have Rhino pip-install numpy and
mini-racer (one py3-none wheel per platform) into the plugin's own `support-fins`
environment on first run, so one .yak serves Mac and Windows.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "SupportFins"
SHARED = HERE.parent / "shared"
ROOT = HERE.parent.parent
OUT = HERE / "build"
PROJECT = OUT / "SupportFins"

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402

PLUGIN_ID = "6a881861-fe75-4314-ba84-6f833da35639"
VERSION = "0.1"
# fixed ids, so a rebuild is the same plugin and the same commands to Rhino
COMMANDS = {
    "SupportFins": "0f6b2c1e-8f43-4f0e-9a51-5d1b7c3e2a10",
    "SupportFinsDraw": "6d3e9a24-1b7f-4c58-8e2d-93a0f4b6c711",
    "SupportFinsSettings": "b2c48f17-5e6a-4d93-a1b0-7c2e8d5f9a32",
}
RHINOCODE = {
    "darwin": ["/Applications/Rhino 8.app/Contents/Resources/bin/rhinocode"],
    "win32": [os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Rhino 8", "System", "rhinocode.exe")],
}


def bootstrap():
    """bootstrap.py from PLUGIN_ID on (not its docstring or imports): what each command gets."""
    text = (SRC / "bootstrap.py").read_text(encoding="utf-8")
    body = text[text.index("PLUGIN_ID = "):]
    if f'PLUGIN_ID = "{PLUGIN_ID}"' not in body:
        sys.exit("bootstrap.py's PLUGIN_ID isn't build.py's")
    return body.rstrip() + "\n"


def stage_command(src, dest):
    text = src.read_text(encoding="utf-8")
    if text.count("# @bootstrap\n") != 1:
        sys.exit(f"{src.name}: needs exactly one '# @bootstrap' line")
    dest.write_text(text.replace("# @bootstrap\n", bootstrap()), encoding="utf-8")


def rhproj(lib_files):
    py3 = {"id": "*.*.python", "version": "3.*.*"}
    return {
        # rhinocode refuses a project without a full host ("saved on Rhino 8.9 or
        # earlier"): a three-part version and os spelled "macOS" or "windows". The .yak
        # comes out "-any" either way, so one value serves both builds.
        "host": {"name": "Rhino3D", "version": "8.11.0", "os": "macOS", "arch": "arm64"},
        "id": PLUGIN_ID,
        "identity": {
            "name": "Support Fins",
            "version": VERSION,
            "publisher": {"name": "printfins.com", "email": "mathyout@pm.me"},   # no email: no author in the .yak
            "description": "Breakaway support fins for 3D printing, from printfins.com: "
                           "tined walls that hold up a part's overhangs and snap off clean.",
            "license": "GPL-3.0-or-later",
            "url": "https://printfins.com/",
        },
        "settings": {
            "buildPath": "build/",
            "buildTarget": {"host": {"name": "Rhino3D", "version": "8"}, "title": "Rhino3D (8.*)", "slug": "rh8"},
            "publishTarget": {"title": "McNeel Yak Server"},
        },
        "codes": [{"id": cid, "language": py3, "title": name, "uri": f"commands/{name}.py"}
                  for name, cid in COMMANDS.items()],
        "resources": [{"id": rid, "uri": f"lib/{f}"} for f, rid in lib_files],
    }


def resource_id(name):
    """A stable id per shared file (uuid5 of its name under the plugin's id)."""
    import uuid
    return str(uuid.uuid5(uuid.UUID(PLUGIN_ID), name))


def stage():
    if PROJECT.exists():
        shutil.rmtree(PROJECT)
    (PROJECT / "commands").mkdir(parents=True)
    lib = PROJECT / "lib"
    lib.mkdir()
    for name in COMMANDS:
        stage_command(SRC / "commands" / f"{name}.py", PROJECT / "commands" / f"{name}.py")
    for f in sorted((SRC / "lib").glob("*.py")):
        shutil.copy2(f, lib / f.name)
    shutil.copy2(SHARED / "py" / "supportfins_host.py", lib / "supportfins_host.py")
    shutil.copy2(SHARED / "engine" / "options.json", lib / "options.json")
    js = bundle_engine(lib / "fins_engine.js")
    files = sorted(p.name for p in lib.iterdir())
    (PROJECT / "SupportFins.rhproj").write_text(
        json.dumps(rhproj([(f, resource_id(f)) for f in files]), indent=2) + "\n", encoding="utf-8")
    return len(js)


def rhinocode():
    for p in RHINOCODE.get(sys.platform, []):
        if os.path.isfile(p):
            return p
    return shutil.which("rhinocode")


def main():
    if sys.argv[1:]:
        sys.exit(f"unknown arguments {' '.join(sys.argv[1:])}; see the docstring")
    js = stage()
    print(f"staged {PROJECT.relative_to(ROOT)} (engine {js / 1024:.0f} KB)")
    rc = rhinocode()
    if rc is None:
        print("no Rhino 8 here (rhinocode): built the project only, no .yak")
        return
    subprocess.run([rc, "project", "build", str(PROJECT / "SupportFins.rhproj")], check=True)
    yaks = sorted((PROJECT / "build").rglob("*.yak"), key=lambda p: p.stat().st_mtime)
    if not yaks:
        sys.exit("rhinocode built no .yak")
    for old in OUT.glob("support-fins-rhino-*.yak"):
        old.unlink()
    dest = OUT / f"support-fins-rhino-{VERSION}.yak"
    shutil.copy2(yaks[-1], dest)
    print(f"built {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
