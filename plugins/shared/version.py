#!/usr/bin/env python3
"""Every plugin's version, stamped by its build: BASE.<n>.

  python3 plugins/shared/version.py            # each plugin's version, as its build stamps it

n is the position on main (git rev-list --count) of the last commit that changed what
the plugin ships: its own folder (tests and notes aside), and for a plugin built on the
engine, every file esbuild bundles into it plus the shared Python host. So a plugin
gets a new version exactly when its contents change, never otherwise (the PrusaSlicer
port doesn't move when the engine does), and a later version is always the newer code:
Prusa 0.7.740 and Orca 0.7.754 are the code as of main's 740th and 754th commits.

Not counted, so they can change a download without a new number: the repo's LICENSE
(Cura and Blender copy it in), esbuild's own patch release (npx esbuild@0.28), and a
local build's uncommitted edits (it takes HEAD's number). A release comes from main.

BASE moves by hand, for a change worth a new series. The source files hold BASE.0, so
a plugin run from a checkout says it is unstamped. Outside a git checkout every plugin
is BASE.0; a shallow clone (a CI checkout without fetch-depth: 0) is refused rather
than stamped with a wrong, small number.
"""
import functools
import json
import pathlib
import subprocess
import sys
import tempfile

BASE = "0.7"
UNSTAMPED = f"{BASE}.0"

HERE = pathlib.Path(__file__).resolve().parent
PLUGINS = HERE.parent
ROOT = PLUGINS.parent
BRIDGE = HERE / "engine" / "bridge.js"

# what a plugin folder holds that it doesn't ship
_NOT_SHIPPED = [":(exclude,glob)**/tests/**", ":(exclude,glob)**/*.md", ":(exclude,glob)**/build/**"]
# what an engine plugin ships besides the bundle: the V8 host + mesh slicer, the bundler
ENGINE_EXTRAS = [HERE / "py", HERE / "bundle.py"]


def _git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True,
                          check=True).stdout.strip()


def version(paths):
    """BASE.<n> for a plugin made of `paths` (files or folders, in this checkout)."""
    try:
        if _git("rev-parse", "--is-shallow-repository") == "true":
            sys.exit("version.py: a shallow clone can't number a build (check out with fetch-depth: 0)")
    except (OSError, subprocess.CalledProcessError):
        return UNSTAMPED   # not a git checkout
    rel = sorted({pathlib.Path(p).resolve().relative_to(ROOT).as_posix() for p in paths})
    # --first-parent: a merged PR is numbered by its merge commit's place on main
    last = _git("log", "-1", "--first-parent", "--format=%H", "HEAD", "--", *rel, *_NOT_SHIPPED)
    return f"{BASE}.{_git('rev-list', '--count', last)}" if last else UNSTAMPED


def stamp(text, old, new, where):
    """`text` with its one `old` replaced by `new`: a build's version stamp, which
    refuses to guess when the line it stamps has moved."""
    if text.count(old) != 1:
        sys.exit(f"version stamp: {old!r} not found exactly once in {where}")
    return text.replace(old, new)


@functools.lru_cache(maxsize=None)   # a build stamps several platforms from one tree
def bundle_inputs(entry=BRIDGE, *esbuild_args):
    """Every file esbuild bundles from `entry` (its metafile's inputs), as paths."""
    from bundle import esbuild_cmd   # plugins/shared/bundle.py
    with tempfile.TemporaryDirectory() as tmp:
        meta = pathlib.Path(tmp) / "meta.json"
        subprocess.run(esbuild_cmd() + [str(entry), "--bundle", *esbuild_args, f"--metafile={meta}",
                                        f"--outfile={pathlib.Path(tmp) / 'out.js'}", "--log-level=error"],
                       check=True, cwd=ROOT)
        paths = [(ROOT / p).resolve() for p in json.loads(meta.read_text())["inputs"]]
    return tuple(p for p in paths if p.is_relative_to(ROOT))   # a generated entry is no source


def engine_plugin_version(folder, *extra):
    """The version of a plugin built on the shared engine bundle (plugins/<name>/)."""
    return version([folder, *bundle_inputs(), *ENGINE_EXTRAS, *extra])


def _cli_build():
    import importlib.util   # plugins/cli/build.py, by path: every plugin's build is "build"
    spec = importlib.util.spec_from_file_location("cli_build", PLUGINS / "cli" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def all_versions():
    """{plugin folder name: version}, the numbers each build stamps."""
    engine = [*bundle_inputs(), *ENGINE_EXTRAS]
    out = {name: version([PLUGINS / name, *engine])
           for name in ("orca", "fusion", "cura", "freecad", "blender", "rhino", "solidworks")}
    out["prusa"] = version([PLUGINS / "prusa"])   # its own Lua port: no engine
    cli = _cli_build()
    out["cli"] = version([PLUGINS / "cli", *cli.inputs()])
    out["mcp"] = version([PLUGINS / "mcp", PLUGINS / "cli", *cli.inputs(PLUGINS / "mcp" / "support-fins-mcp.js")])
    return out


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    for name, v in all_versions().items():
        print(f"{name:11} {v}")
