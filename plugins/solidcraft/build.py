#!/usr/bin/env python3
"""Build the SolidCraft plugin: a WebAssembly component SolidCraft runs as an export slot.

  python3 plugins/solidcraft/build.py           # -> build/support-fins/ (the package) + build/support-fins-solidcraft.zip
  python3 plugins/solidcraft/build.py --test    # + solidcraft-cli plugin check and plugin test on the package

1. Bundles src/quickjs.js, which imports the engine from web/ and plugins/shared/
   (untouched), into one script (esbuild, as plugins/shared/bundle.py does).
2. Builds component/ for wasm32-unknown-unknown: QuickJS (rquickjs, with its own small
   libc, so no WASI) running that bundle, behind SolidCraft's `exporter-plugin` world
   (wit/plugin.wit). wasm-tools makes the core module a component. It imports nothing
   but the craft:plugin interfaces: no network, no files.
3. Writes plugin.json from options.json (src/manifest.js), stamped with the plugin's
   version (plugins/shared/version.py), copies the icon and tests/cases in (the package's
   own tests), and zips plugin.json, the component and the icon as SolidCraft's
   Preferences > Plugins > Install plugin... takes it.

Needs Node 20.10+ (npx fetches the pinned esbuild), Rust with the wasm32-unknown-unknown
target, clang and llvm-ar (QuickJS is C; CC_wasm32_unknown_unknown and
AR_wasm32_unknown_unknown name others), and wasm-tools (WASM_TOOLS=/path/to/it). --test
needs solidcraft-cli (SOLIDCRAFT_CLI=/path/to/it).
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / "build"
ID = "support-fins"
PACKAGE = OUT / ID
ZIP = OUT / "support-fins-solidcraft.zip"
ENTRY = HERE / "src" / "quickjs.js"
BUNDLE = OUT / "quickjs.js"          # component/src/lib.rs include_str!s this path
CRATE = HERE / "component"
TARGET = "wasm32-unknown-unknown"
CORE = OUT / "target" / TARGET / "release" / "support_fins_solidcraft.wasm"

ESBUILD_ARGS = ["--format=iife", "--platform=neutral", "--target=es2020", "--main-fields=module,main"]

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import esbuild_cmd  # noqa: E402


def tool(env, *names, why):
    path = os.environ.get(env) or next((p for n in names if (p := shutil.which(n))), None)
    if not path:
        sys.exit(f"build.py needs {names[0]} ({why}): put it on the PATH, or {env}=/path/to/it")
    return path


def plugin_version():
    from version import ENGINE_EXTRAS, bundle_inputs, version   # plugins/shared/version.py
    return version([HERE, *bundle_inputs(ENTRY, *ESBUILD_ARGS), *ENGINE_EXTRAS])


def bundle():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(esbuild_cmd() + [str(ENTRY), "--bundle", *ESBUILD_ARGS, f"--outfile={BUNDLE}",
                                    "--log-level=warning"], check=True, cwd=ROOT)


def versioned(name):
    """clang, then clang-22 down to clang-14: a distribution's LLVM often has only the latter."""
    return [name, *(f"{name}-{v}" for v in range(22, 13, -1))]


def component(out):
    env = dict(os.environ)
    # QuickJS is C: cc builds it with clang for wasm32 and archives it with llvm-ar (GNU
    # ar writes no symbol index for wasm objects, and the link then misses QuickJS).
    # CC_/AR_wasm32_unknown_unknown, cc's own variables, pick other ones.
    triple = TARGET.replace("-", "_")
    for var, name, why in ((f"CC_{triple}", "clang", "QuickJS is C"),
                           (f"AR_{triple}", "llvm-ar", "an archive index wasm-ld reads")):
        if not env.get(var):
            env[var] = tool(var, *versioned(name), why=why)
    cargo = tool("CARGO", "cargo", why="the component is a Rust crate")
    subprocess.run([cargo, "build", "--release", "--locked", "--lib", "--target", TARGET,
                    "--manifest-path", str(CRATE / "Cargo.toml"), "--target-dir", str(OUT / "target")],
                   check=True, env=env, cwd=CRATE)
    wasm_tools = tool("WASM_TOOLS", "wasm-tools", why="it makes the module a component")
    subprocess.run([wasm_tools, "component", "new", str(CORE), "-o", str(out)], check=True)


def manifest(version):
    node = tool("NODE", "node", why="src/manifest.js writes plugin.json")
    out = subprocess.run([node, str(HERE / "src" / "manifest.js"), version], check=True,
                         capture_output=True, text=True, cwd=ROOT).stdout
    return json.loads(out)


def stage(version):
    if PACKAGE.exists():
        shutil.rmtree(PACKAGE)
    PACKAGE.mkdir(parents=True)
    component(PACKAGE / f"{ID}.wasm")
    (PACKAGE / "plugin.json").write_text(json.dumps(manifest(version), indent=1, ensure_ascii=False) + "\n",
                                         encoding="utf-8")
    shutil.copytree(HERE / "icons", PACKAGE / "icons")
    # the package's own tests (solidcraft-cli plugin test runs them; the .zip leaves them out)
    shutil.copytree(HERE / "tests" / "cases", PACKAGE / "tests")


def package():
    ZIP.unlink(missing_ok=True)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("plugin.json", f"{ID}.wasm"):
            z.write(PACKAGE / name, name)
        for icon in sorted((PACKAGE / "icons").glob("*.svg")):
            z.write(icon, f"icons/{icon.name}")


def solidcraft(*args):
    cli = tool("SOLIDCRAFT_CLI", "solidcraft-cli", why="--test runs SolidCraft's plugin check and plugin test")
    subprocess.run([cli, *args], check=True)


def main():
    args = sys.argv[1:]
    if args not in ([], ["--test"]):
        sys.exit(__doc__)
    v = plugin_version()
    bundle()
    stage(v)
    package()
    wasm = PACKAGE / f"{ID}.wasm"
    print(f"built {PACKAGE.relative_to(ROOT)} {v} ({wasm.stat().st_size / 1e6:.1f} MB component)")
    print(f"built {ZIP.relative_to(ROOT)} ({ZIP.stat().st_size / 1e6:.1f} MB)")
    if args == ["--test"]:
        solidcraft("plugin", "check", str(PACKAGE))
        solidcraft("plugin", "test", str(PACKAGE), "--require-cases")


if __name__ == "__main__":
    main()
