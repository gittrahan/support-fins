# Support Fins for Blender (experimental)

A Blender 4.2+ extension with scene preparation, STL/3MF/STEP import,
conservative mesh checks/repair with backups, overhang highlighting/statistics,
load direction buttons, three reusable orientation suggestions, optional fins,
and separate-part STL/3MF export. English/Italian follow Blender preferences.

This integration calls the **current checkout's web engine**. The build copies
its dependency closure verbatim from web/ and records hashes in
engine-provenance.json. It never imports the standalone prototype's old snapshot.
The Blender-specific orientation adapter composes public web/orient.js APIs;
there is no second implementation of the geometry engine.

## Install and use

Install support-fins-blender-<platform>.zip from Blender Preferences > Add-ons >
Install from Disk. Restart Blender after an upgrade. In the 3D View, open
N > PrintFins, then Prepare Scene > Import model > Check model > Analyze overhangs.
Repair is offered when the check finds issues; repairs keep a hidden backup.
Choose a load direction and Suggest orientation, or Lay a face flat.
Fins are optional: exporting just the model is supported.

Choose macos-arm64 for native Apple Silicon Blender, macos-x64 for Intel Blender
(including Rosetta), and the matching x64/ARM64 variant for Windows/Linux.
Node 24.19.0 is bundled: macOS 13.5+, Windows 10+, or glibc Linux
(kernel 4.18+, glibc 2.28+, libstdc++ GLIBCXX_3.4.25+) is required in addition
to Blender's own platform/hardware requirements. End users install no dependencies.
The add-on does not download software or update itself at runtime.

## Build

Python 3.11+:

    python plugins/blender/build.py --all
    python plugins/blender/build.py --platform macos-arm64

Builds go to plugins/blender/build/. The first build explicitly downloads official
Node archives into .cache/, checking pinned archive AND executable hashes from
runtime-lock.json. Only the selected executable and license are packaged.
For offline builds, --runtime-dir accepts verified per-platform node/node.exe
files; their hashes must match the same lock.

Shared web files and the vendored STEP kernel are read from this repository.
The bridge needs per-fin identity and manual-placement APIs, so it packages
ES modules directly rather than the shared bridge's combined triangle soup.
Node executes those modules locally in a separate cancellable process.

## Checks

    python -m unittest discover -s plugins/blender/tests -p "test_*.py" -v
    blender --background --factory-startup --python-exit-code 1 --python plugins/blender/tests/blender_smoke.py -- --package plugins/blender/build/support-fins-blender-linux-x64.zip

The plugin workflow rebuilds all six ZIPs when web/ or plugins/ changes, runs
bridge/package tests and a Blender 4.2/5.2 smoke matrix, and includes the artifacts
in the existing plugins-latest publication after successful main-branch tests.
Pull requests only build/test; they do not publish releases.

## Limits and review requests

Experimental. Strength scores describe qualitative tensile layer alignment,
not bending, torsion, allowable loads or a structural simulation. Mesh checks
do not detect self-intersections. Review repaired functional openings.
The upstream suggester may offer fewer than three distinct seated poses.

The standalone predecessor was exercised on Windows x64 Blender 4.2.23,
4.5.14 and 5.2.2; the PR's updated-engine validation is recorded in its description.
Mac signing/executable launch and manual viewport testing need native review.
Physical print testing is still required. Prepare/Reset preserves other scenes,
but resetting the dedicated PrintFins scene removes its contents after confirmation.

The Python integration and Blender adapters are GPL-3.0-or-later (LICENSE);
upstream engine files remain MIT. See THIRD_PARTY.md for additional notices.
