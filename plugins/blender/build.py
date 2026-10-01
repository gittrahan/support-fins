#!/usr/bin/env python3
"""Build Blender extensions from THIS checkout's web engine, never a vendored snapshot.

python plugins/blender/build.py --platform windows-x64
python plugins/blender/build.py --all
python plugins/blender/build.py --all --runtime-dir /path/to/verified/runtime
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "build"
CACHE = HERE / ".cache"
PLATFORMS = ("windows-x64", "windows-arm64", "macos-x64", "macos-arm64", "linux-x64", "linux-arm64")
LOCK = json.loads((HERE / "runtime-lock.json").read_text(encoding="utf-8-sig"))
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]""")
# A known lazy-loaded CAD kernel; it is not reachable through ES module imports.
STEP_VENDOR = "vendor/occt-import-js-0.0.23"

def digest(path):
    with pathlib.Path(path).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

def web_files():
    web = (ROOT / "web").resolve()
    found = set()
    def visit(path):
        path = path.resolve()
        if not path.is_relative_to(web):
            raise ValueError(f"Engine dependency escapes web/: {path}")
        if path in found:
            return
        if not path.is_file():
            raise FileNotFoundError(path)
        found.add(path)
        if path.suffix in {".js", ".mjs"}:
            for ref in IMPORT.findall(path.read_text(encoding="utf-8")):
                visit(path.parent / ref)
    for name in ("overhangs.js", "fins.js", "draw.js", "sway.js", "orient.js", "step.js"):
        visit(web / name)
    found.update(p for p in (web / STEP_VENDOR).rglob("*") if p.is_file())
    if not (web / STEP_VENDOR / "occt-import-js.wasm") in found:
        raise FileNotFoundError("STEP kernel was moved; update the Blender build")
    return sorted(found)

def runtime(platform, runtime_dir=None):
    system, arch = platform.split("-")
    upstream = {"windows": "win", "macos": "darwin", "linux": "linux"}[system] + "-" + arch
    record = next(r for r in LOCK["archives"] if r["platform"] == upstream)
    executable = "node.exe" if system == "windows" else "node"
    if runtime_dir:
        path = pathlib.Path(runtime_dir) / platform / executable
        if digest(path) != record["binary_sha256"]:
            raise ValueError(f"Runtime binary checksum mismatch: {platform}")
        return path
    CACHE.mkdir(exist_ok=True)
    name = record["url"].rsplit("/", 1)[1]
    archive = CACHE / name
    if not archive.exists():
        request = urllib.request.Request(record["url"], headers={"User-Agent": "SupportFins-Blender-build"})
        partial = archive.with_suffix(".partial")
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        partial.replace(archive)
    if digest(archive) != record["sha256"]:
        raise ValueError(f"Runtime archive checksum mismatch: {archive.name}")
    stem = name.removesuffix(".zip").removesuffix(".tar.xz")
    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            data = z.read(stem + "/node.exe")
    else:
        with tarfile.open(archive) as z:
            data = z.extractfile(stem + "/bin/node").read()
    if hashlib.sha256(data).hexdigest() != record["binary_sha256"]:
        raise ValueError(f"Extracted runtime checksum mismatch: {platform}")
    path = CACHE / platform / executable
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(data)
    return path

def revision():
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return "source-archive"

def stage(destination):
    """Copy current shared modules verbatim; write a provenance manifest for tests."""
    destination = pathlib.Path(destination)
    shutil.copytree(HERE / "src" / "printfins", destination, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    engine = destination / "engine"
    engine.mkdir()
    for p in (HERE / "engine").glob("*.mjs"):
        shutil.copy2(p, engine / p.name)
    records = {}
    for source in web_files():
        relative = source.relative_to(ROOT / "web")
        target = engine / "web" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        records[relative.as_posix()] = digest(source)
    (engine / "package.json").write_text('{"type":"module"}\n', encoding="utf-8")
    shutil.copy2(ROOT / "LICENSE", engine / "web" / "LICENSE")
    shutil.copy2(HERE / "LICENSE", destination / "LICENSE")
    shutil.copy2(HERE / "README.md", destination / "README.md")
    shutil.copy2(HERE / "THIRD_PARTY.md", destination / "THIRD_PARTY.md")
    (destination / "engine-provenance.json").write_text(
        json.dumps({"upstream_commit": revision(), "web_sha256": records}, indent=2) + "\n", encoding="utf-8")

def write_zip(tree, path):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(tree.rglob("*")):
            if not p.is_file():
                continue
            entry = zipfile.ZipInfo(p.relative_to(tree).as_posix(), (2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if p.name in {"node", "node.exe"} else 0o100644) << 16
            z.writestr(entry, p.read_bytes())

def build(platform, runtime_dir=None):
    if platform not in PLATFORMS:
        raise ValueError(platform)
    binary = runtime(platform, runtime_dir)
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="stage-", dir=OUT) as temporary:
        temporary = pathlib.Path(temporary).resolve()
        assert temporary.is_relative_to(OUT.resolve())
        tree = temporary / "printfins"
        stage(tree)
        target = tree / "runtime" / platform / binary.name
        target.parent.mkdir(parents=True)
        shutil.copy2(binary, target)
        shutil.copy2(HERE / "NODE-LICENSE.txt", tree / "runtime" / "NODE-LICENSE.txt")
        manifest_path = tree / "blender_manifest.toml"
        manifest = manifest_path.read_text(encoding="utf-8")
        manifest = manifest.replace("[permissions]", f'platforms = ["{platform}"]\n\n[permissions]')
        manifest_path.write_text(manifest, encoding="utf-8")
        artifact = OUT / f"support-fins-blender-{platform}.zip"
        write_zip(tree, artifact)
    print(f"Built {artifact.name} ({artifact.stat().st_size // 1024} KiB)", flush=True)
    return artifact

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--platform", choices=PLATFORMS)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--runtime-dir", type=pathlib.Path, help="Use locally verified binaries; no downloads")
    args = parser.parse_args()
    targets = PLATFORMS if args.all else [args.platform]
    artifacts = [build(p, args.runtime_dir) for p in targets]
    (OUT / "SHA256SUMS.txt").write_text("".join(
        digest(p) + "  " + p.name + "\n" for p in artifacts), encoding="utf-8")

if __name__ == "__main__":
    main()
