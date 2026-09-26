# Support Fins — Autodesk Fusion add-in

A Fusion add-in that puts print supports **in the model** instead of the slicer. It's a
companion to [printfins.com](https://printfins.com). Sway braces by Mitch Milam; support fins by
MorbidJ-hub. Two commands under **Solid › Create**:

- **Insert Support Fins**: the website's breakaway fins under the part's overhangs
  (upside-down-T walls gripped by a comb of one-layer tines) and a bed pad where the part
  barely touches the plate. The geometry comes from **the website's engine itself**
  (`web/*.js`, unmodified), run in an embedded V8 through
  [`plugins/shared/`](../shared/README.md), the same way the Orca plugin runs it. Fusion places
  the fins the site would place, and a fix on the site reaches Fusion with the next build.
- **Insert Sway Brace**: tapered buttress ribs that stand beside the tall sides of a part, tied to
  it with one-layer tines, so a tall, slender part doesn't drift or wobble as it prints. The brace
  maths is a port of the website's [`web/sway.js`](../../web/sway.js); the numbers and reasoning
  are in [`docs/FIN-SPEC.md`](../../docs/FIN-SPEC.md), "Sway braces (tall parts)".

## Install

**From a build (easiest, Windows).** Download `SupportFins.zip` (about 100 KB) or
`SupportFins-win_amd64.zip` (about 16 MB) from the
[`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
release, or build it (`python3 plugins/fusion/build.py`). Unzip it so the `SupportFins`
folder sits in Fusion's add-ins folder:

- Windows: `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\`
- macOS: `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/`

Then go to step 2 below. Insert Support Fins needs mini-racer (a V8 JavaScript runtime), and
Fusion's Python has no pip:
- **`SupportFins-win_amd64.zip` carries it**, so it works offline.
- **`SupportFins.zip` fetches it once on first run** (about 15 MB from PyPI, in the background
  while Fusion starts). The download is pinned by SHA-256 to the exact wheel (`RUNTIME` in
  `engine_host.py`), and nothing else is unpacked. Build it with `build.py --slim`.

**macOS** isn't released yet: nobody has run the add-in in Fusion on a Mac. The builds exist
(`python3 plugins/fusion/build.py --platform macosx_arm64` for Apple silicon,
`--platform macosx_x86_64` for Intel); if you try one, please report back.

**From the repo (to develop).** Build the engine bundle and vendor the runtime into the source
folder first, then link it:

```sh
python3 plugins/fusion/build.py --no-vendor --here win_amd64   # or macosx_arm64 / macosx_x86_64
```

1. Link (or copy) the `SupportFins` folder into Fusion's add-ins folder:

   ```powershell
   # Windows
   New-Item -ItemType Junction -Path "$env:APPDATA\Autodesk\Autodesk Fusion 360\API\AddIns\SupportFins" -Target "$PWD\SupportFins"
   ```
   ```sh
   # macOS
   ln -s "$PWD/SupportFins" ~/Library/Application\ Support/Autodesk/Autodesk\ Fusion\ 360/API/AddIns/SupportFins
   ```

   You can also add the folder from inside Fusion: **Utilities › Add-Ins › Scripts and Add-Ins**,
   then **+** next to *My Add-Ins*.
2. In **Scripts and Add-Ins**, select **SupportFins** and click **Run**. Tick *Run on Startup* to
   load it every time Fusion starts.
3. The commands appear under **Solid › Create**: **Insert Support Fins** and **Insert Sway Brace**.

## Insert Support Fins

1. **Print bed**: the same choices as Insert Sway Brace below (the ground origin plane to start
   with, a face the part stands on, a plane on the bed, or the part itself). Pose the part the
   way it will print first: the fins are fitted to the pose you give it, just as the website
   fits them to the rotation you pick there.
2. **Part**: defaults to the bed face's body, or to the design's only visible body. Solid bodies
   are meshed at 0.05 mm; mesh bodies (imported STLs) are used as they are.
3. **Settings** (remembered between sessions, website defaults to start):
   - Fin style: *Auto* (props for the overhangs, plus bracing fins if the part would topple),
     *Props only*, or *Stabilize*
   - Layer height (**must match your slicer**; shared with Insert Sway Brace)
   - Tines on/off, Tine density %
   - Wide-face coverage % (how densely a broad overhang is lined)
   - Bed pad on/off
4. The readout gives the count of fins and tines, whether there's a bed pad, and a rough weight.
   The preview shows the fins live. Click **Insert** to keep them.

The fins go into the **Supports** component (in a Part Design document, beside the part in
its one component) as **mesh bodies**. In a parametric design each one is its own
*Base Mesh Feature*, grouped as **Support fins** in the timeline. They are one per fin (its wall and the tines that ride on it) and
one per bed pad, named *Support fin N* and *Bed pad N*. Delete any fin you don't want. Your own
bodies are never changed. Export the part and the Supports bodies together (STL/3MF); the tines
overlap the part by the bite on purpose, and the slicer merges them.

Run Insert Support Fins before Insert Sway Brace on the same part: the Python brace port doesn't
yet steer clear of fin walls (see *Status*).

## Insert Sway Brace

1. **Print bed**: this starts on the ground origin plane (XY, or XZ in a Y-up design), which is
   right for a part modelled standing on the origin. To stand it another way, pick instead:
   - the face the part stands on;
   - a construction plane on the bed. The origin planes are hidden, so pick one from **Origin** in
     the Browser;
   - **the part itself**. The part then stands as modelled, on its lowest point, with Fusion's up
     axis (Z or Y, from Preferences) as up.

   With a face or plane, "up" is whichever side the part is on.
2. **Placement**
   - **Pick faces**: click upright faces of the part. Each click places one brace at that spot.
     Mesh bodies (imported STLs) work too: click the spot on the mesh. Click again for every extra
     brace, even on the same face. **Undo last pick** and **Clear picks** remove them. A brace that
     would run into one already placed shifts up to 4 mm to clear it, or is refused with a reason.
   - **Auto**: braces the tallest sides automatically (up to 4 faces, facing different ways).
     **Part** defaults to the bed face's body, or to the design's only visible body. Auto also
     won't stand a brace more than 40 mm (or 40% of its height) up before its first tine —
     below its lowest grip a brace holds nothing and nothing holds it. A part tilted onto a
     corner puts every side high off the bed and hits this; rotate so a side reaches the bed.
     A brace you **pick** builds there anyway, and the readout says how far it stands first.
3. **Settings** (remembered between sessions):
   - Material (PLA/PETG sets the gap and bite)
   - Layer height (**must match your slicer**)
   - Support gap
   - Tine bite
   - Tine spacing
   - Grip from (no tines below this height)
   - Brace depth (% of rib height)
   - Tines on/off
4. The readout lists each brace, or the reason it was refused. The preview shows the braces live.
   Click **Insert** to keep them.

Braces go into a **Supports** component, one body per brace (inside a base feature in parametric
designs), so your own bodies are never changed. A **Part Design** document allows only one
component, so there the braces are added to the part's component as their own *Sway brace N*
bodies instead. You can hide or delete them freely. A new run
steers clear of braces left by earlier runs.

Export the part and the Supports bodies together (STL/3MF) for slicing.

## Develop

```
build.py                    engine bundle + mini-racer vendoring + one zip per platform
SupportFins/                the add-in (this folder goes in Fusion's AddIns)
  SupportFins.py            entry point: run/stop, starts both commands
  fins_command.py           Insert Support Fins: dialog, readout and preview
  engine_host.py            runs the website's engine in V8 (mini-racer); no adsk imports
  fins_core/shells.py       engine soup -> closed shells -> one welded mesh per fin / pad
  engine/fins_engine.js     the engine bundle (built, not committed)
  lib/<platform>/           vendored mini-racer (built, not committed)
  sway_command.py           Insert Sway Brace: the dialog, readout and preview
  fusion_bridge.py          print frame (cm ↔ mm, bed → up), meshing, BRep bodies
  settings_store.py         settings.json next to the add-in
  sway_core/                pure Python, no adsk imports, millimetres
    sway.py                 the brace algorithm (port of web/sway.js); constants in SWAY
    patches.py              wall patches (port of web/planes.js)
    geometry.py             clipping, mesh containment, prisms
tests/test_sway.py          unit tests (port of tests/sway.test.js, plus more)
tests/test_fins.py          engine host, mesh reshaping, and the command run on fake_adsk
tests/fake_adsk.py          just enough of Fusion's API to run the fins command offline
```

Run the tests from the repo root (plain Python, no Fusion needed). The fins tests need the
engine bundle and mini-racer, and skip (saying why) without them:

```sh
pip install mini-racer==0.14.1
python3 plugins/fusion/build.py --no-vendor
python3 -m unittest discover -s plugins/fusion/tests -v
```

The `SWAY` constants in `sway_core/sway.py` mirror `SWAY` in `web/sway.js`; change both
together. Bump the manifest version with each Fusion-side change: the dialog shows it, so
you can tell which build Fusion loaded (Stop/Run reloads the add-in's modules).

## Status

### Insert Support Fins

- Offline: the engine host returns the website's fins in the part's own frame, identical
  wherever the part sits on the plate; every fin and pad body is a closed mesh; through the fake
  Fusion API a tilted mesh part gets named, tagged fins in Supports (base feature in parametric,
  none in direct), Y-up "stand as modelled" works, and a part through the bed is refused.
- The vendored runtime loads from `lib/<platform>/` in a Python with no mini-racer installed.
- **Run in Fusion on Windows (Sept 2026, Python 3.14):** the vendored mini-racer loads, and a
  tilted L-bracket mesh in a Part Design gets the same 4 fins / 20 tines / bed pad as the
  website, with a live preview. Every body is closed and oriented, named, tagged, and listed in
  the browser. Two Fusion findings are built in: `addByTriangleMeshData` inside a base feature
  makes bodies no feature owns (the browser never lists them), so parametric designs import
  STLs instead; and the engine's bed pad has ~4% of its triangles flipped, so every shell is
  re-wound before it goes in.
- **Harder runs in Fusion on Windows:**
  - 3DBenchy (225k triangles, public domain) laid on its side, in a Hybrid design: 5 fins,
    10 tines and a bed pad land in a real *Supports* sub-component. Reading the mesh, running
    the engine and reshaping take 3.2 s together (0.5 + 2.5 + 0.2).
  - A tilted solid (BRep) T-bracket with a horizontal hole and a boss under the arm, meshed
    by the add-in: 4 fins and a bed pad, including walls that stand on the part's own foot.
  - Insert Sway Brace still runs beside it and ignores the fin bodies.
- The engine decides what gets fins, as on the website: on Benchy it leaves 12 of 16 small
  overhang regions unsupported, and the T-bracket's walls get no tines at the defaults.
- Still to confirm: macOS (`--jitless`, so no macOS build is released yet) and a print of an
  exported part + fins.

### Insert Sway Brace

- The pure-Python core matches `web/sway.js` brace-for-brace on plain test parts.
- Run in Fusion on Windows (Auto and picked faces, mesh bodies, Part Design documents).
  Not yet tried: macOS, parts in sub-components, multi-component documents, a bed other
  than the XY plane, curved faces.
- Still to confirm: that the slicer merges the tines (separate bodies overlapping the part
  by the bite) with the part.
- Not ported: keeping clear of prop walls (`swayClashesWall`), since the add-in places none.
