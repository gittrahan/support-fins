#!/usr/bin/env python3
"""Regenerate the synchronous Clipper ESM wrapper from a verified npm tarball.

Download clipper-lib-6.4.2.tgz into repository tmp, then:
  python3 prototype/vendor-clipper.py tmp/clipper-lib-6.4.2.tgz

No installation, network operation, extraction or external cache is performed.
The two licence files already in web/vendor are included in bundle-preserved
legal comments. Trailing whitespace is normalized; algorithm source is unchanged.
"""
import base64
import hashlib
import io
from pathlib import Path
import sys
import tarfile

PIN = "knglhjQX5ihNj/XCIs6zCHrTemdvHY3LPZP9XB2nq2/3igyYMFueFXtfp84baJvEE+f8pO1ZS4UVeEgmLnAprQ=="
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "web/vendor/clipper-lib-6.4.2"


def generate(archive):
    if base64.b64encode(hashlib.sha512(archive).digest()).decode() != PIN:
        raise ValueError("clipper-lib tarball checksum mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive)) as package:
        source = package.extractfile("package/clipper.js").read().decode("utf-8")
    source = "\n".join(line.rstrip() for line in source.split("\n"))
    notices = "\n".join((DEST / name).read_text() for name in ["LICENSE.boost.txt", "LICENSE.jsbn.txt"])
    # JSBN's notice includes comment delimiters; retain its text inside one legal
    # comment without accidentally ending it early. esbuild preserves this notice.
    notices = notices.replace("/*", "").replace("*/", "")
    notices = "\n".join(line.rstrip() for line in notices.split("\n"))
    prefix = ("/*! @license Clipper and embedded JSBN\n" + notices + "\n*/\n"
              "// ESM isolation: use the upstream CommonJS path without publishing globals.\n"
              "const module = { exports: {} };\nconst self = {};\nconst document = undefined;\n")
    suffix = ("\n// Fail to the caller instead of opening a browser alert.\n"
              "module.exports.Error = (message) => { throw new Error(message); };\n"
              "export default module.exports;\n")
    return prefix + source + suffix


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    archive = Path(sys.argv[1]).resolve()
    if not archive.is_relative_to(ROOT):
        sys.exit("keep the downloaded tarball inside this checkout")
    (DEST / "clipper.js").write_text(generate(archive.read_bytes()))
