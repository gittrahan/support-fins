# Support Fins — UltiMaker Cura plugin

**Extensions › Support Fins › Add Support Fins** puts printfins.com breakaway fins under the
selected part's overhangs: upside-down-T walls, one-layer tines where they meet the part, and
a bed pad. They appear as a **Support Fins** object on the plate, attached to the part, before
you slice.

The geometry is **the website's engine itself** (`web/*.js`, unmodified, bundled through
[`plugins/shared/`](../shared/README.md) as the Orca plugin and the Fusion add-in do it), run in
an embedded V8 (mini-racer) that ships inside the plugin. Cura gets the fins the site would give
the same part in the same pose, and a fix on the site reaches Cura at the next build.

Status: **0.1, experimental.** Tested in Cura 5.13 on an Apple-silicon Mac. Website defaults
only (no settings dialog yet).

## Install

```sh
python3 plugins/cura/build.py     # -> plugins/cura/build/SupportFins/  (needs esbuild via npx, and pip)
```

Copy (or link) `build/SupportFins` into Cura's plugins folder, then restart Cura. To find the
folder: **Help › Show Configuration Folder**, then open `plugins/`. On macOS:

```sh
ln -s "$PWD/plugins/cura/build/SupportFins" ~/Library/Application\ Support/cura/5.13/plugins/SupportFins
```

The build vendors mini-racer for the machine it runs on (Cura's Python can't install packages):
about 64 MB unpacked. `python3 plugins/cura/build.py win_amd64` (or `macosx_10_9_x86_64`,
`manylinux_2_27_x86_64`) builds for another platform.

## Use

1. Pose the part the way it will print (rotate it in Cura). The fins are fitted to that pose,
   the same as the website fits them to the rotation you choose there.
2. Select it → **Extensions › Support Fins › Add Support Fins**. *Computing fins…* shows for a
   second or three (the engine runs in the background), then the result: walls and tines
   placed, plus any overhang too shallow for a fin this way up and any piece of the part that
   starts in mid-air. Those aren't hidden: tilt the part and run it again.
3. Turn Cura's own supports off for the part, and slice.

- The fins move with the part. **Rotate or scale** the part and run *Add Support Fins* again:
  it replaces the old fins.
- **Ctrl+Z** takes the fins off again. *Remove Support Fins* removes them from the selected
  parts, or from every part when nothing is selected.
- Several parts selected: each gets its own fins. Groups: ungroup first.
- Layer height comes from the active profile, so the tines land on real layers.

**Tines touch the part rather than bite into it.** Cura's *Remove Mesh Intersection* (a global
setting, on by default) trims the overlap between the part and the fins object, so each tine
ends at the part's outer wall. That's deliberate: the tines snap off clean.

## Developing

```sh
python3 plugins/cura/build.py && python3 -m pytest -q plugins/cura/tests/
```

The tests cover the frame mapping (Cura is Y-up, the engine Z-up) and the part → engine → fins
round trip, without Cura. For the Cura side (menu, background job, scene, undo), drop a
`dev_autorun.json` next to the built plugin and open a model:

```sh
echo '{"rotate_x": 35, "slice": true}' > plugins/cura/build/SupportFins/dev_autorun.json
open -a "UltiMaker Cura" web/dev-models/lbracket.stl
```

The plugin then tilts the part, adds fins, re-runs, undoes, removes, undoes and slices, logging
each step to `dev_log.jsonl` and saving the G-code to `dev_plate0.gcode` (both next to the
plugin). Delete the JSON to go back to normal.
