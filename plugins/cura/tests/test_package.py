"""The .curapackage files (build.py --package / --all) and the wrong-download guard.

    python3 plugins/cura/build.py --all && python3 -m pytest -q plugins/cura/tests/
"""
import json
import zipfile

import pytest

from test_plugin import HERE, load

platform_check = load("sf_platform_check", HERE.parent / "SupportFins" / "platform_check.py")
build = load("sf_build", HERE.parent / "build.py")
PACKAGES = sorted((HERE.parent / "build").glob("SupportFins-*.curapackage"))
LIB = {"darwin": "libmini_racer.dylib", "linux": "libmini_racer.so", "win32": "mini_racer.dll"}


@pytest.mark.parametrize("wheel", list(build.PLATFORMS))
def test_each_platform_knows_itself_and_refuses_the_others(tmp_path, wheel):
    suffix, label, os_name, machine = build.PLATFORMS[wheel]
    (tmp_path / "platform.json").write_text(json.dumps(
        {"wheel": wheel, "name": label, "os": os_name, "machine": machine}))
    assert platform_check.mismatch(tmp_path, os_name, machine) is None
    for other, (_, _, o, m) in build.PLATFORMS.items():
        if other != wheel:
            msg = platform_check.mismatch(tmp_path, o, m)
            assert msg and label in msg and "Download the package for your computer" in msg


def test_machine_names_as_each_os_spells_them():
    assert platform_check.here("darwin", "arm64") == ("darwin", "arm64")
    assert platform_check.here("darwin", "x86_64") == ("darwin", "x86_64")   # Rosetta: the process
    assert platform_check.here("darwin", "x86_64") == ("darwin", "x86_64")
    assert platform_check.here("win32", "AMD64") == ("win32", "amd64")
    assert platform_check.here("linux", "aarch64") == ("linux", "aarch64")
    assert platform_check.here("linux", "arm64") == ("linux", "aarch64")


def test_x64_cura_on_an_arm_windows_pc_takes_the_x64_package(tmp_path, monkeypatch):
    # Python 3.12's platform.machine() reports the CPU (ARM64); the process is x64
    monkeypatch.setattr(platform_check.platform, "machine", lambda: "ARM64")
    monkeypatch.setattr(platform_check.sysconfig, "get_platform", lambda: "win-amd64")
    assert platform_check.here("win32") == ("win32", "amd64")
    (tmp_path / "platform.json").write_text(json.dumps(
        {"wheel": "win_amd64", "name": "Windows (64-bit)", "os": "win32", "machine": "amd64"}))
    assert platform_check.mismatch(tmp_path, "win32") is None


def test_the_message_names_a_real_download_page(tmp_path):
    (tmp_path / "platform.json").write_text(json.dumps(
        {"wheel": "win_amd64", "name": "Windows (64-bit)", "os": "win32", "machine": "amd64"}))
    assert platform_check.RELEASE in platform_check.mismatch(tmp_path, "darwin", "arm64")


def test_the_vendored_v8_loads_on_its_own(tmp_path):
    """The V8 library the package ships, not pip's: a fresh interpreter without
    site-packages (V8 starts once per process), vendor/ on the path as __init__.py
    puts it, host_engine pointed at it as SupportFins.engine() does."""
    import subprocess
    import sys
    built = HERE.parent / "build" / "SupportFins"
    if not (built / "vendor" / "py_mini_racer").exists():
        pytest.skip("run plugins/cura/build.py first")
    mine = platform_check.mismatch(built)
    if mine:
        pytest.skip(f"build/SupportFins is another platform's: {mine}")
    code = (
        "import sys; sys.path[:0] = [{v!r}, {b!r}]\n"
        "import supportfins_host as h\n"
        "ctx = h.host_engine(open({js!r}).read(), vendor_dir={v!r})\n"
        "import py_mini_racer; assert py_mini_racer.__file__.startswith({v!r}), py_mini_racer.__file__\n"
        "print(len(h.host_schema(ctx)['options']))\n"
    ).format(v=str(built / "vendor"), b=str(built), js=str(built / "fins_engine.js"))
    out = subprocess.run([sys.executable, "-S", "-c", code], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    assert int(out.stdout.strip()) >= 10


def test_a_dev_build_without_platform_json_is_not_checked(tmp_path):
    assert platform_check.mismatch(tmp_path) is None


def test_every_platform_has_a_package():
    if not PACKAGES:
        pytest.skip("run plugins/cura/build.py --package (or --all) first")
    if len(PACKAGES) < len(build.PLATFORMS):
        pytest.skip("only some platforms built; --all builds every one")
    for suffix, *_ in build.PLATFORMS.values():
        assert any(p.name.endswith(f"-{suffix}.curapackage") for p in PACKAGES), f"no {suffix} package"


@pytest.mark.parametrize("pkg", PACKAGES, ids=lambda p: p.name)
def test_a_package_is_what_curas_installer_reads(pkg):
    with zipfile.ZipFile(pkg) as z:
        names = z.namelist()
        info = json.loads(z.read("package.json"))
        plugin = json.loads(z.read("files/plugins/SupportFins/plugin.json"))
        plat = json.loads(z.read("files/plugins/SupportFins/platform.json"))
        assert "LICENSE" in names
    # what Uranium's PackageManager reads (installPackage, isPackageCompatible)
    assert info["package_id"] == "SupportFins" and info["package_type"] == "plugin"
    assert info["package_version"] == plugin["version"]
    assert info["sdk_version"].split(".")[0] == plugin["supported_sdk_versions"][0].split(".")[0]
    assert info["display_name"] and info["author"]["author_id"]
    # the platform in the name, in platform.json and in the library all agree
    suffix, label, os_name, machine = build.PLATFORMS[plat["wheel"]]
    assert pkg.name == f"SupportFins-{suffix}.curapackage" and label in info["description"]
    assert (plat["os"], plat["machine"]) == (os_name, machine)
    lib = f"files/plugins/SupportFins/vendor/py_mini_racer/{LIB[os_name]}"
    assert lib in names, f"{pkg.name} has no {LIB[os_name]}"
    others = set(LIB.values()) - {LIB[os_name]}
    assert not any(n.rsplit("/", 1)[-1] in others for n in names), "another platform's V8 inside"
    # the plugin itself: engine, schema, host, dialog; no dev files, no caches
    for f in ("__init__.py", "SupportFins.py", "settings.py", "platform_check.py", "frames.py",
              "SettingsDialog.qml", "supportfins_host.py", "fins_engine.js", "options.json"):
        assert f"files/plugins/SupportFins/{f}" in names, f"{f} missing"
    assert not any("__pycache__" in n or "/dev_" in n for n in names)
