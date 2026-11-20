"""Prepare a stable release's Orca plugin for the Orca Cloud listing (#474).

  python3 plugins/orca/cloud_release.py v1.0.6 dist/support_fins_orca.py web/changelog.json out/

writes out/support_fins_orca_any.py and out/metadata.json, which plugins.yml's
orca-cloud job posts to Orca Cloud's publish API. Prints what it wrote, or why it
skipped (a pre-release tag such as v1.1.0-rc.1: only stable releases go to Orca Cloud).

- Version: the release tag without its "v", the same version printfins.com shows. Orca
  Cloud takes the version from the metadata and needs each one higher than the last, so
  the plugin's own 0.7.<n> build number is stamped over with it too: what Orca says is
  installed then matches the listing.
- File name: "_any" tells Orca Cloud the file runs on every OS (it is one Python file;
  Orca installs numpy and mini-racer per platform from its PEP 723 header).
- Changelog: that release's web/changelog.json entries, the ones naming Orca or the
  plugins first, then the engine and site changes the plugin shares, cut to Orca Cloud's
  4000 characters with a link to the full release.
"""
import json
import pathlib
import re
import sys

REPO = "gittrahan/support-fins"
LIMIT = 4000
_PLUGIN = re.compile(r"\b(orca|orcaslicer|plugins?)\b", re.I)


def stamp_version(source, version):
    """`source` with its header version and VERSION constant set to `version`. Each must
    appear exactly once, so a changed plugin layout fails loudly instead of shipping a
    file whose version disagrees with its listing."""
    out = source
    for pattern, repl in ((r'^# version = "[^"]*"$', f'# version = "{version}"'),
                          (r'^VERSION = "[^"]*"', f'VERSION = "{version}"')):
        out, n = re.subn(pattern, repl, out, flags=re.M)
        if n != 1:
            sys.exit(f"cloud_release: {pattern!r} matched {n} times in the plugin, expected 1")
    return out


def _lines(entry):
    """An entry's text, or its highlights when it has them (as the release notes do)."""
    if entry.get("highlights"):
        return [h["text"] for h in entry["highlights"]]
    return [entry["text"]]


def changelog_for(changelog, version):
    """That release's notes for Orca users: plugin entries first, then the rest."""
    release = next((r for r in changelog.get("releases", []) if r.get("version") == version), None)
    if release is None:
        sys.exit(f"cloud_release: web/changelog.json has no release {version}")
    plugin, shared = [], []
    for e in release["entries"]:
        for line in _lines(e):
            (plugin if _PLUGIN.search(line) else shared).append(f"- {line}")
    parts = []
    if plugin:
        parts += ["OrcaSlicer plugin:", *plugin]
    if shared:
        parts += (["", "Engine and site (the plugin runs the same engine):"] if plugin else
                  ["Engine and site (the plugin runs the same engine):"]) + shared
    tail = f"\n\nFull notes: https://github.com/{REPO}/releases/tag/v{version}"
    body = "\n".join(parts)
    if len(body) + len(tail) > LIMIT:
        cut = body[:LIMIT - len(tail) - 4]
        body = cut[:cut.rfind("\n")] + "\n..." if "\n" in cut else cut + "..."
    return body + tail


def main(argv):
    if len(argv) != 5:
        sys.exit(__doc__)
    tag, plugin, changelog, out = argv[1], pathlib.Path(argv[2]), pathlib.Path(argv[3]), pathlib.Path(argv[4])
    m = re.fullmatch(r"v(\d+\.\d+\.\d+)(-.+)?", tag)
    if not m:
        sys.exit(f"cloud_release: {tag!r} is not a vX.Y.Z release tag")
    if m.group(2):
        print(f"skipped: {tag} is a pre-release; only stable releases go to Orca Cloud")
        return
    version = m.group(1)
    out.mkdir(parents=True, exist_ok=True)
    (out / "support_fins_orca_any.py").write_text(stamp_version(plugin.read_text(), version))
    meta = {"version": version, "changelog": changelog_for(json.loads(changelog.read_text()), version)}
    (out / "metadata.json").write_text(json.dumps(meta))
    print(f"wrote {out / 'support_fins_orca_any.py'} and metadata.json for {version}")


if __name__ == "__main__":
    main(sys.argv)
