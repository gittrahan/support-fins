"""plugins/orca/cloud_release.py: the Orca Cloud upload a stable release makes (#474)."""
import importlib.util
import json
import pathlib
import subprocess
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
spec = importlib.util.spec_from_file_location("cloud_release", HERE.parent / "cloud_release.py")
CR = importlib.util.module_from_spec(spec)
spec.loader.exec_module(CR)

PLUGIN = '# /// script\n# version = "0.7.1040"\n# ///\nimport orca\nVERSION = "0.7.1040"   # stamped\n'
CHANGELOG = {"releases": [
    {"version": "1.0.7", "date": "2026-11-21", "entries": [
        {"text": "Taller ribs on tall walls"},
        {"text": "Blender plugin: faster install"},
        {"text": "Orca plugin: a notification lists what each part got"},
        {"text": "Big one", "highlights": [{"text": "Plugins for Cura and Blender", "prs": [1]},
                                            {"text": "Full coverage mode", "prs": [2]}]},
    ]},
    {"version": "1.0.6", "date": "2026-11-10", "entries": [{"text": "Older"}]},
]}


def run(tmp_path, tag, changelog=CHANGELOG):
    (tmp_path / "p.py").write_text(PLUGIN)
    (tmp_path / "c.json").write_text(json.dumps(changelog))
    return subprocess.run([sys.executable, str(HERE.parent / "cloud_release.py"), tag, str(tmp_path / "p.py"),
                           str(tmp_path / "c.json"), str(tmp_path / "out")], capture_output=True, text=True)


def test_a_stable_release_writes_the_any_os_file_stamped_with_the_site_version(tmp_path):
    r = run(tmp_path, "v1.0.7")
    assert r.returncode == 0, r.stderr
    built = (tmp_path / "out" / "support_fins_orca_any.py").read_text()
    assert '# version = "1.0.7"' in built and 'VERSION = "1.0.7"   # stamped' in built
    assert "0.7.1040" not in built
    meta = json.loads((tmp_path / "out" / "metadata.json").read_text())
    assert meta["version"] == "1.0.7"


def test_the_changelog_puts_plugin_lines_first_and_links_the_full_release(tmp_path):
    run(tmp_path, "v1.0.7")
    log = json.loads((tmp_path / "out" / "metadata.json").read_text())["changelog"]
    assert log.splitlines()[:3] == ["OrcaSlicer plugin:", "- Orca plugin: a notification lists what each part got",
                                    "- Plugins for Cura and Blender"]
    assert "- Taller ribs on tall walls" in log and "- Full coverage mode" in log and "Older" not in log
    shared = log.split("Engine and site")[1]
    assert "- Blender plugin: faster install" in shared, "another plugin's news isn't Orca's"
    assert log.endswith("https://github.com/gittrahan/support-fins/releases/tag/v1.0.7")


def test_a_long_changelog_is_cut_to_orca_clouds_limit_on_a_line(tmp_path):
    many = {"releases": [{"version": "1.0.7", "entries": [{"text": f"Change number {i} " + "x" * 80} for i in range(80)]}]}
    run(tmp_path, "v1.0.7", many)
    log = json.loads((tmp_path / "out" / "metadata.json").read_text())["changelog"]
    assert len(log) <= CR.LIMIT and "\n...\n\nFull notes:" in log


def test_a_prerelease_is_skipped_and_writes_nothing(tmp_path):
    r = run(tmp_path, "v1.1.0-rc.1")
    assert r.returncode == 0 and r.stdout.startswith("skipped")
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("tag", ["1.0.7", "plugins-latest", "v1.0"])
def test_anything_but_a_release_tag_fails(tmp_path, tag):
    assert run(tmp_path, tag).returncode != 0


def test_a_release_missing_from_the_changelog_fails(tmp_path):
    assert "no release 1.0.9" in run(tmp_path, "v1.0.9").stderr


def test_a_plugin_whose_version_lines_moved_fails_instead_of_shipping_a_wrong_version():
    with pytest.raises(SystemExit):
        CR.stamp_version("import orca\n", "1.0.7")


def test_the_real_plugin_source_stamps_cleanly():
    src = (ROOT / "plugins" / "orca" / "src" / "support_fins_orca.py").read_text()
    out = CR.stamp_version(src, "1.2.3")
    assert '# version = "1.2.3"' in out and 'VERSION = "1.2.3"' in out


def test_every_shipped_release_has_notes():
    data = json.loads((ROOT / "web" / "changelog.json").read_text())
    for r in data["releases"]:
        assert CR.changelog_for(data, r["version"]).strip()
