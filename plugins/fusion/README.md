# Support Fins — Autodesk Fusion add-in

A Fusion add-in that puts printfins.com supports **in the model** instead of the slicer. It's
a companion to [printfins.com](https://printfins.com). Add-in structure and Fusion plumbing by
Mitch Milam; support fins by MorbidJ-hub.

**Solid › Create › Insert Support Fins** adds the website's breakaway fins under the part's
overhangs (upside-down-T walls gripped by a comb of one-layer tines) and a bed pad where the
part barely touches the plate. The geometry comes from **the website's engine itself**
(`web/*.js`, unmodified, bundled through [`plugins/shared/`](../shared/README.md) as the Orca
plugin does it), run by **Fusion's own browser in a hidden palette**. Fusion places the fins the
site would place, a fix on the site reaches Fusion with the next build, and nothing native
ships with the add-in: the same folder works on Windows and macOS.

> Earlier previews (0.4.x) ran the engine in mini-racer, an embedded V8. That was Windows-only:
> on macOS, Fusion ships its own `libv8.dylib`, macOS merges V8's weak symbols across the two
> copies, and Fusion crashes when the dialog opens. The palette loads nothing native.

## Install

**From a build.** Download `SupportFins.zip` from the
[`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
release (or build it: `python3 plugins/fusion/build.py --zip`) and unzip it so the
`SupportFins` folder sits in Fusion's add-ins folder:

- Windows: `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\`
- macOS: `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/`

**From the repo.** Build the engine bundle, then link (or copy) the add-in folder into Fusion's
add-ins folder:

```sh
python3 plugins/fusion/build.py        # writes SupportFins/palette/fins_engine.js (needs esbuild via npx)
```
```powershell
# Windows
New-Item -ItemType Junction -Path "$env:APPDATA\Autodesk\Autodesk Fusion 360\API\AddIns\SupportFins" -Target "$PWD\plugins\fusion\SupportFins"
```
```sh
# macOS
ln -s "$PWD/plugins/fusion/SupportFins" ~/Library/Application\ Support/Autodesk/Autodesk\ Fusion\ 360/API/AddIns/SupportFins
```

You can also add the folder from inside Fusion: **Utilities › Add-Ins › Scripts and Add-Ins**,
then **+** next to *My Add-Ins*.

1. In **Scripts and Add-Ins** (Shift+S), select **SupportFins** and click **Run**. Tick *Run on
   Startup* to load it every time Fusion starts.
2. **Solid › Create › Insert Support Fins**.

## Insert Support Fins

1. **Print bed**: starts on the ground origin plane (XY, or XZ in a Y-up design), which is right
   for a part modelled standing on the origin. To stand it another way, pick the face it stands
   on, a construction plane on the bed, or **the part itself** (it then stands as modelled, on
   its lowest point, with Fusion's up axis as up). With a face or plane, "up" is whichever side
   the part is on. Pose the part the way it will print: the fins are fitted to that pose, just
   as the website fits them to the rotation you pick there.
2. **Part**: defaults to the bed face's body, or to the design's only visible body. Solid bodies
   are meshed at 0.05 mm; mesh bodies (imported STLs) are used as they are.
3. **Settings** (remembered between sessions, website defaults to start):
   - Fin style: *Auto* (props for the overhangs, plus bracing fins if the part would topple),
     *Props only*, or *Stabilize*
   - Layer height (**must match your slicer**)
   - Tines on/off, Tine density %
   - Wide-face coverage % (how densely a broad overhang is lined)
   - Bed pad on/off
   - **Sway braces (tall parts)**, off by default, with Grip from / Brace tine spacing /
     Brace depth. A different job from the fins above: a tapered rib stands edge-on against a
     tall side and is tied to it by one-layer tines all the way up, so the part can't drift or
     wobble as it grows. Nothing needs to overhang — a plain tall post gets braces and no fins.
     See `docs/FIN-SPEC.md`, "Sway braces (tall parts)".
4. The readout says *Computing fins…* for a moment after each change, then gives the count of
   fins and tines (and braces, when asked for), whether there's a bed pad, a rough weight, and
   anything to check (a piece of the part that isn't joined to the rest, overhangs left
   unsupported, or why no brace could stand). The preview shows the fins live. Click **Insert**
   to keep them.

The fins go into the **Supports** component (in a Part Design document, beside the part in its
one component) as **mesh bodies**: one per fin (its wall and the tines that ride on it), one per
sway brace and one per bed pad, named *Support fin N*, *Sway brace N* and *Bed pad N*. In a parametric design each is its own
*Base Mesh Feature*, grouped as **Support fins** in the timeline. Delete any fin you don't want.
Your own bodies are never changed. Export the part and the Supports bodies together (STL/3MF);
the tines overlap the part by the bite on purpose, and the slicer merges them.

## How the engine runs

`engine_host.PaletteEngine` opens a hidden palette (`palette/engine.html`) when the add-in
starts. Its JavaScript runs on Fusion's main thread, so **Python never waits on it**; the
palette drives every exchange with `adsk.fusionSendData`:

| palette → Python | Python's reply |
| --- | --- |
| `ready` `{engine, browser}` | `ok` |
| `next` | the queued job `{id, soup, options}`, or `{idle: ms}` (100 with the dialog open, 1000 without) |
| `result` `{id, raw \| error}` | `ok`, or `stale` for anything but the latest job |
| `log` `{msg}` | `ok` (written to View › Show Text Commands) |

A dialog change queues a job (a newer one replaces one not yet picked up) and nudges the
palette with `sendInfoToHTML('wake')`. When the answer lands, a custom event refreshes the
readout and calls `doExecutePreview()`, since no dialog input changed to make Fusion re-run the
preview.

## Develop

```
build.py                    bundles the engine into SupportFins/palette/fins_engine.js;
                            --zip also writes build/SupportFins.zip
SupportFins/                the add-in (this folder goes in Fusion's AddIns)
  SupportFins.py            entry point: run/stop
  fins_command.py           Insert Support Fins: dialog, readout and preview
  engine_host.py            the palette engine; encode/decode; compute_fins() under Node
  palette/engine.html, .js  the hidden page that runs the engine
  palette/fins_engine.js    the engine bundle (built, not committed)
  fins_core/shells.py       engine soup -> closed shells -> one welded mesh per fin / pad
  fusion_bridge.py          print frame (cm <-> mm, bed -> up), meshing, mesh bodies
  settings_store.py         settings.json next to the add-in
tests/test_fins.py          engine, palette protocol, mesh reshaping, the command on fake_adsk
tests/fake_adsk.py          just enough of Fusion's API to run the command offline
```

Run the tests from the repo root (plain Python, no Fusion needed). The engine tests run the
same bundle under Node (`engine_host.compute_fins`) and skip, saying why, without it:

```sh
python3 plugins/fusion/build.py
python3 -m unittest discover -s plugins/fusion/tests -v
```

Bump the manifest version with each Fusion-side change: the dialog shows it, so you can tell
which build Fusion loaded (Stop/Run reloads the add-in's modules).

## Status

- Offline: the engine returns the website's fins in the part's own frame, identical wherever
  the part sits on the plate; every fin and pad body is a closed mesh; the palette protocol
  (latest job wins, stale answers dropped, slow idle poll, a silent palette named) and the
  asynchronous dialog (pending, then refresh + preview) are pinned in the tests.
- Fusion findings carried over from the 0.4.x Windows runs: `addByTriangleMeshData` inside a
  base feature makes bodies no feature owns, so parametric designs import STLs instead; and the
  engine's bed pad has a few flipped triangles, so every shell is re-wound before it goes in.
- **Run in Fusion on Windows (2705.1.25, Python 3.14, Sept 28 2026):** the hidden palette
  loads and reports (`Neutron/2705.1.25`); an L-bracket mesh tilted 35° gets 4 fins, 20 tines
  and a bed pad (the same stats the engine gives under Node), with a live preview; turning the
  bed pad off re-runs the engine and the preview; Insert puts 4 tagged *Support fin* bodies
  (1668 triangles) in *Supports*; reopening the dialog counts them as an earlier run.
  One Windows finding: the palette URL must be a `file:///C:/...` URI. A bare path reaches the
  browser as `file:///C:%5CUsers...` and the page never loads.
- The palette pattern (hidden palette, `fusionSendData`, no Python waits) was proven on macOS
  (Apple silicon, Fusion 2704.1.36) by the engine-test spike on PR #83: exact website fins on
  the L-bracket at 35° in 52 ms. This build (v0.5.0) has since run there too, in Fusion
  2705.1.25. Intel Macs are untested.
- Shown, the palette has a status line (ready / jobs run / last error), for debugging.
