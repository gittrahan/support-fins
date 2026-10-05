#!/usr/bin/env python3
"""Build the SolidWorks add-in.

  python3 plugins/solidworks/build.py          # -> SupportFins/page/fins_engine.js
  python3 plugins/solidworks/build.py --dll    # + the add-in in build/SupportFins/
  python3 plugins/solidworks/build.py --zip    # + build/support-fins-solidworks.zip

1. Bundles the printfins.com engine (web/*.js, untouched, with the shared bridge;
   plugins/shared/bundle.py, needs esbuild via npx) into the dialog page, which runs it
   in WebView2.
2. --dll: `dotnet build` (the .NET SDK, any OS: the add-in targets .NET Framework 4.8
   through reference assemblies, and SolidWorks' interop is compile-time only).
   DOTNET=/path/to/dotnet if it isn't on the PATH.
3. --zip: the add-in folder plus install.bat / uninstall.bat, as users download it.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE / "SupportFins"
OUT = HERE / "build"
ADDIN = OUT / "SupportFins"
ZIP = OUT / "support-fins-solidworks.zip"
ROOT = HERE.parent.parent

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import bundle_engine  # noqa: E402

# What dotnet build leaves that the add-in doesn't need (it hosts WebView2 in WinForms).
SKIP = {"Microsoft.Web.WebView2.Wpf.dll"}
SKIP_SUFFIX = (".pdb", ".xml")


def build_dll():
    dotnet = os.environ.get("DOTNET") or shutil.which("dotnet")
    if not dotnet:
        sys.exit("--dll needs the .NET SDK (dotnet on the PATH, or DOTNET=/path/to/dotnet)")
    if ADDIN.exists():
        shutil.rmtree(ADDIN)
    subprocess.run([dotnet, "build", str(PROJECT / "SupportFins.SolidWorks.csproj"),
                    "-c", "Release", "-o", str(ADDIN), "-nologo", "-v", "q"], check=True)
    for f in list(ADDIN.rglob("*")):
        if f.is_file() and (f.name in SKIP or f.suffix in SKIP_SUFFIX):
            f.unlink()
    for bat in ("install.bat", "uninstall.bat"):
        shutil.copy2(HERE / bat, ADDIN / bat)


def package():
    ZIP.unlink(missing_ok=True)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ADDIN.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(OUT).as_posix())


def main():
    args = sys.argv[1:]
    if args not in ([], ["--dll"], ["--zip"]):
        sys.exit(__doc__)
    js = bundle_engine(PROJECT / "page" / "fins_engine.js")
    print(f"bundled {(PROJECT / 'page' / 'fins_engine.js').relative_to(ROOT)} ({len(js) / 1024:.0f} KB)")
    if args:
        build_dll()
        print(f"built {ADDIN.relative_to(ROOT)}")
    if args == ["--zip"]:
        package()
        print(f"built {ZIP.relative_to(ROOT)} ({ZIP.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
