"""plugins/shared/version.py: every plugin's version, BASE.<n>, stamped by its build.

    python3 -m pytest -q plugins/shared/py/tests/test_version.py   (needs git history + esbuild)
"""
import pathlib
import re
import subprocess
import sys

import pytest

SHARED = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SHARED))
import version as V  # noqa: E402

PLUGINS = SHARED.parent
# every source file a build stamps, and the unstamped line it looks for
STAMPED = [
    ("orca/src/support_fins_orca.py", '# version = "0.7.0"'),
    ("orca/src/support_fins_orca.py", 'VERSION = "0.7.0"'),
    ("fusion/SupportFins/SupportFins.manifest", '"version": "0.7.0"'),
    ("cura/SupportFins/plugin.json", '"version": "0.7.0"'),
    ("blender/support_fins/blender_manifest.toml", 'version = "0.7.0"'),
    ("freecad/SupportFins/supportfins_freecad.py", 'VERSION = "0.7.0"'),
    ("prusa/com.printfins.support-fins/manifest.json", '"version": "0.7.0"'),
    ("solidworks/SupportFins/SupportFins.SolidWorks.csproj", "<Version>0.7.0</Version>"),
    ("cli/version.js", "'0.7.0'"),
]


def _git(*a):
    return subprocess.run(["git", "-C", str(V.ROOT), *a], capture_output=True, text=True, check=True).stdout.strip()


shallow = _git("rev-parse", "--is-shallow-repository") == "true"
needs_history = pytest.mark.skipif(shallow, reason="a shallow clone can't number builds")


@pytest.mark.parametrize("rel,line", STAMPED)
def test_every_source_holds_the_unstamped_base_once(rel, line):
    # a version bumped by hand in a source file would make its build's stamp fail
    assert V.UNSTAMPED == "0.7.0"
    assert (PLUGINS / rel).read_text(encoding="utf-8").count(line) == 1, rel


def test_a_stamp_refuses_a_moved_line():
    assert V.stamp('a "0.7.0" b', '"0.7.0"', '"0.7.9"', "x") == 'a "0.7.9" b'
    for text in ("no version here", '"0.7.0" "0.7.0"'):
        with pytest.raises(SystemExit):
            V.stamp(text, '"0.7.0"', '"0.7.9"', "x")


@needs_history
def test_the_number_is_the_last_commit_that_changed_the_plugin():
    # Prusa is its own Lua port: its number is the last commit in its folder (tests and
    # notes aside), however many engine commits came after
    v = V.version([PLUGINS / "prusa"])
    # first-parent, as version.py: a PR's CI runs on a merge commit, which is the change
    last = _git("log", "-1", "--first-parent", "--format=%H", "HEAD", "--", "plugins/prusa", *V._NOT_SHIPPED)
    assert v == f"{V.BASE}.{_git('rev-list', '--count', last)}"
    assert re.fullmatch(r"0\.7\.[1-9][0-9]*", v)
    # more files can only make it newer, never older; nothing is newer than HEAD
    n = lambda version: int(version.split(".")[2])   # noqa: E731
    head = int(_git("rev-list", "--count", "HEAD"))
    assert n(v) <= head and n(V.engine_plugin_version(PLUGINS / "orca")) <= head
    assert n(V.version([PLUGINS / "prusa", PLUGINS / "orca"])) >= n(v)
    # a test or a note changes no plugin's version
    assert V.version([PLUGINS / "prusa" / "tests"]) == V.UNSTAMPED


@needs_history
def test_an_engine_plugin_counts_the_files_it_bundles():
    inputs = {p.relative_to(V.ROOT).as_posix() for p in V.bundle_inputs()}
    assert "plugins/shared/engine/bridge.js" in inputs and "web/fins.js" in inputs
    assert "web/app.js" not in inputs   # the site's page isn't in any plugin
    assert all(not p.startswith("..") for p in inputs)
