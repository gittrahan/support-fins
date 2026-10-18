"""build.py's staged Rhino project, without Rhino (rhinocode compiles it; the real run
is rhino_smoke.py).

    python3 -m pytest -q plugins/rhino/tests/test_build.py

Pinned:
  - SupportFins.rhproj lists every command and every shared file, with fixed ids (a
    rebuild is the same plugin to Rhino), the plugin id the commands look themselves
    up by, and a Rhino 8 / Python 3 target;
  - each built command is one script: the bootstrap inlined, it parses, and it starts
    with the same `# r:` requirements in the same `support-fins` environment (two
    commands asking for different packages would fight over one environment).
"""
import ast
import importlib.util
import json
import pathlib

import pytest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rhino_build", HERE.parent / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


@pytest.fixture(scope="module")
def project(tmp_path_factory):
    out = tmp_path_factory.mktemp("rhino")
    mp = pytest.MonkeyPatch()
    mp.setattr(build, "PROJECT", out / "SupportFins")
    # the bundle's contents are the shared suite's business: a stand-in keeps this fast
    mp.setattr(build, "bundle_engine", lambda dest: (dest.write_text("var SupportFinsEngine={};"),
                                                     "var SupportFinsEngine={};")[1])
    build.stage()
    mp.undo()
    return out / "SupportFins"


def test_rhproj_lists_commands_and_files(project):
    proj = json.loads((project / "SupportFins.rhproj").read_text(encoding="utf-8"))
    assert proj["id"] == build.PLUGIN_ID
    assert proj["settings"]["buildTarget"]["host"] == {"name": "Rhino3D", "version": "8"}
    assert [c["title"] for c in proj["codes"]] == list(build.COMMANDS)
    assert all(c["language"] == {"id": "*.*.python", "version": "3.*.*"} for c in proj["codes"])
    for item in proj["codes"] + proj["resources"]:
        assert (project / item["uri"]).is_file(), item["uri"]
    files = {r["uri"] for r in proj["resources"]}
    assert {"lib/supportfins_rhino.py", "lib/supportfins_rhino_core.py", "lib/supportfins_host.py",
            "lib/options.json", "lib/fins_engine.js"} <= files
    ids = [proj["id"]] + [c["id"] for c in proj["codes"]] + [r["id"] for r in proj["resources"]]
    assert len(set(ids)) == len(ids)


def test_ids_are_stable(project, tmp_path):
    first = (project / "SupportFins.rhproj").read_text(encoding="utf-8")
    assert build.resource_id("lib/x.py") == build.resource_id("lib/x.py")
    assert json.loads(first)["resources"][0]["id"] == build.resource_id(
        json.loads(first)["resources"][0]["uri"].split("/", 1)[1])


def test_commands_are_one_script_each(project):
    headers = set()
    for name in build.COMMANDS:
        text = (project / "commands" / f"{name}.py").read_text(encoding="utf-8")
        assert "# @bootstrap" not in text
        assert f'PLUGIN_ID = "{build.PLUGIN_ID}"' in text
        tree = ast.parse(text)
        funcs = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
        assert {"_lib", "RunCommand"} <= funcs, name
        head = text.split('"""', 1)[0]
        assert head.startswith("#! python3\n# venv: support-fins\n"), name
        headers.add(head)
    assert len(headers) == 1
    # 0.12.4: the last mini-racer for Python 3.9, Rhino 8's (0.13+ needs 3.10); its fins
    # are byte-identical to 0.14.1's on every tests/fixtures STL
    assert "# r: mini-racer==0.12.4" in headers.pop()
