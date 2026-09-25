# Support Fins for Autodesk Fusion

A Fusion add-in that puts print supports **in the model** instead of the slicer.
Phase 1 is **sway braces**. These are tapered buttress ribs that stand beside the tall sides of a
part, tied to it with one-layer tines, so a tall, slender part doesn't drift or wobble as it prints.

The brace maths is a port of `web/sway.js` from the Support Fins website
([MitchMilam/support-fins](https://github.com/MitchMilam/support-fins), branch `sway-braces`).
See [FUSION-ADDIN-HANDOFF.md](FUSION-ADDIN-HANDOFF.md) for the spec and background.

## Install

1. Link (or copy) the `SupportFins` folder into Fusion's add-ins folder:

   ```powershell
   New-Item -ItemType Junction -Path "$env:APPDATA\Autodesk\Autodesk Fusion 360\API\AddIns\SupportFins" -Target "$PWD\SupportFins"
   ```

   You can also add the folder from inside Fusion: **Utilities › Add-Ins › Scripts and Add-Ins**,
   then **+** next to *My Add-Ins*.
2. In **Scripts and Add-Ins**, select **SupportFins** and click **Run**. Tick *Run on Startup* to
   load it every time Fusion starts.
3. The command appears under **Solid › Create › Insert Sway Brace**.

## Use

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
SupportFins/                the add-in (this folder goes in Fusion's AddIns)
  SupportFins.py            entry point: run/stop
  sway_command.py           the dialog, readout and preview
  fusion_bridge.py          print frame (cm ↔ mm, bed → up), meshing, BRep bodies
  settings_store.py         settings.json next to the add-in
  sway_core/                pure Python, no adsk imports, millimetres
    sway.py                 the brace algorithm (port of web/sway.js); constants in SWAY
    patches.py              wall patches (port of web/planes.js)
    geometry.py             clipping, mesh containment, prisms
tests/test_sway.py          unit tests (port of tests/sway.test.js, plus more)
tools/check_stl.py          run Auto on an STL and compare with the website
tools/make_icons.py         regenerates the toolbar icons
```

Run the tests (plain Python, no Fusion needed):

```powershell
C:\Python312\python.exe -m unittest discover -s tests -v
```

Check against the website on a real part:

```powershell
C:\Python312\python.exe tools\check_stl.py "..\support-fins\Samples\Fence Cap-45 Degree Vertical-Rev 3.stl" --grow out.stl
```

For the fence cap this gives **4 braces, 102 tines, 1 skipped**, the same as the website. The
"g solid" figure is the braces' solid volume × density, so it's an upper bound; the slicer's
estimate will be lower.

The defaults (depth, thickness, spacing) are the named constants in `SWAY` in
`sway_core/sway.py`. Change them there if the test print suggests new values.

## Status and open items

- The pure-Python core is tested, and it matches the website on the fence cap.
- **The Fusion layer hasn't been run inside Fusion yet.** Check the dialog, the preview, parametric
  vs direct designs, and parts inside sub-components.
- Confirm the slicer merges the tines (separate bodies overlapping the part by the bite) with the
  part.
- Phase 2 (overhang fins via the website's JS engine in an HTML palette) hasn't been started.
