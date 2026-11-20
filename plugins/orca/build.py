#!/usr/bin/env python3
"""Build the single-file OrcaSlicer plugin.

  python3 plugins/orca/build.py            # -> plugins/orca/build/support_fins_orca.py

1. Bundles the printfins.com engine (web/*.js, untouched) plus the shared plugin
   bridge (plugins/shared/engine/bridge.js) into one IIFE (plugins/shared/bundle.py).
2. Inlines that bundle into src/support_fins_orca.py as ENGINE_JS, and each shared
   Python module in INLINE (plugins/shared/py/) at its marker line.

The result is ONE .py file: drop it into OrcaSlicer (Plugins > Install local
plugin, or <data_dir>/orca_plugins/). Orca installs numpy and mini-racer itself
from the PEP 723 header on first load (it bundles uv for that).

Needs esbuild: see plugins/shared/bundle.py.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "build"
PLACEHOLDER = '"__FINS_ENGINE_JS__"'
PAGE_PLACEHOLDER = '"__SF_CONFIG_PAGE__"'
PAGE_JS_MARKER = "/*__SF_CONFIG_JS__*/"
SHARED_PY = HERE.parent / "shared" / "py"
# shared module -> the marker line in src/support_fins_orca.py it replaces
INLINE = {
    "supportfins_host.py": "# __SUPPORTFINS_HOST__",
    "supportfins_slice.py": "# __SUPPORTFINS_SLICE__",
}

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import bundle_engine  # noqa: E402
from version import engine_plugin_version, stamp  # noqa: E402


def config_page():
    """The settings page Orca shows (src/config_page.html with config_page.js inlined)."""
    html = (HERE / "src" / "config_page.html").read_text(encoding="utf-8")
    page_js = (HERE / "src" / "config_page.js").read_text(encoding="utf-8")
    if html.count(PAGE_JS_MARKER) != 1:
        sys.exit(f"{PAGE_JS_MARKER} not found exactly once in src/config_page.html")
    if "</script" in page_js.lower():
        sys.exit("src/config_page.js must not contain </script: it is inlined into a <script> tag")
    return html.replace(PAGE_JS_MARKER, page_js)


PREVIEW_PLACEHOLDER = '"__SF_PREVIEW_PAGE__"'
PREVIEW_JS_MARKER = "/*__SF_PREVIEW_JS__*/"
# Orca-only modules in src/ -> their marker line in src/support_fins_orca.py
INLINE_SRC = {"preview.py": "# __SF_PREVIEW__"}


def page(name, marker):
    """src/<name>.html with src/<name>.js inlined at its script marker."""
    html = (HERE / "src" / f"{name}.html").read_text(encoding="utf-8")
    page_js = (HERE / "src" / f"{name}.js").read_text(encoding="utf-8")
    if html.count(marker) != 1:
        sys.exit(f"{marker} not found exactly once in src/{name}.html")
    if "</script" in page_js.lower():
        sys.exit(f"src/{name}.js must not contain </script: it is inlined into a <script> tag")
    return html.replace(marker, page_js)


def main():
    js = bundle_engine(OUT / "fins_engine.js")
    src = (HERE / "src" / "support_fins_orca.py").read_text(encoding="utf-8")
    if src.count(PLACEHOLDER) != 1:
        sys.exit("placeholder for the engine bundle not found exactly once in src/support_fins_orca.py")
    lines = src.splitlines(keepends=True)
    sources = {**{name: (SHARED_PY / name, marker) for name, marker in INLINE.items()},
               **{name: (HERE / "src" / name, marker) for name, marker in INLINE_SRC.items()}}
    for name, (path, marker) in sources.items():
        at = [i for i, line in enumerate(lines) if line.startswith(marker)]
        if len(at) != 1:
            sys.exit(f"{marker} not found exactly once in src/support_fins_orca.py")
        code = path.read_text(encoding="utf-8")
        where = path.relative_to(HERE.parent.parent).as_posix()
        lines[at[0]] = (f"# --- inlined from {where} ---\n"
                        f"{code}# --- end {name[:-3]} ---\n")
    # json.dumps yields a valid Python string literal (ASCII, escaped).
    out = "".join(lines).replace(PLACEHOLDER, json.dumps(js))
    out = stamp(out, PAGE_PLACEHOLDER, json.dumps(config_page()), "src/support_fins_orca.py")
    out = stamp(out, PREVIEW_PLACEHOLDER, json.dumps(page("preview_page", PREVIEW_JS_MARKER)),
                "src/support_fins_orca.py")
    v = engine_plugin_version(HERE)
    out = stamp(out, '# version = "0.7.0"', f'# version = "{v}"', "src/support_fins_orca.py")
    out = stamp(out, 'VERSION = "0.7.0"', f'VERSION = "{v}"', "src/support_fins_orca.py")
    target = OUT / "support_fins_orca.py"
    target.write_text(out, encoding="utf-8")
    print(f"built {target.relative_to(HERE.parent.parent)} {v} "
          f"({target.stat().st_size / 1024:.0f} KB, engine {len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
