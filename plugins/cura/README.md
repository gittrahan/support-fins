# Support Fins — UltiMaker Cura plugin

**Extensions › Support Fins › Add Support Fins** puts printfins.com breakaway fins under the
selected part's overhangs: upside-down-T walls, one-layer tines where they meet the part, and
a bed pad. They appear as a **Support Fins** object on the plate, attached to the part, before
you slice.

The geometry is **the website's engine itself** (`web/*.js`, unmodified, bundled through
[`plugins/shared/`](../shared/README.md) as the Orca plugin and the Fusion add-in do it), run in
an embedded V8 (mini-racer) that ships inside the plugin. Cura gets the fins the site would give
the same part in the same pose, and a fix on the site reaches Cura at the next build.

Status: **0.1, experimental.** Tested in Cura 5.13 on an Apple-silicon Mac.

## Install

Download the package for your computer from the
[`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest) release:

| Computer | File |
|---|---|
| Mac with Apple silicon (M1 and later) | `SupportFins-<version>-mac-arm64.curapackage` |
| Mac with Intel | `SupportFins-<version>-mac-x64.curapackage` |
| Windows | `SupportFins-<version>-windows-x64.curapackage` |
| Linux (x86-64 / ARM64) | `SupportFins-<version>-linux-x64.curapackage` / `-linux-arm64` |

**Drag it onto Cura's window**, accept the licence, and restart Cura. Each package carries the
embedded JavaScript engine (V8) for one platform, 15–22 MB; installed on the wrong computer the
plugin says which one to download instead.

From source:

```sh
python3 plugins/cura/build.py             # -> plugins/cura/build/SupportFins/  (this machine; needs esbuild via npx, and pip)
python3 plugins/cura/build.py --package   # + build/SupportFins-<version>-<platform>.curapackage
python3 plugins/cura/build.py --all       # a package for every platform (CI does this)
```

Or link the built folder into Cura's plugins folder (**Help › Show Configuration Folder**, then
`plugins/`) and restart Cura. On macOS:

```sh
ln -s "$PWD/plugins/cura/build/SupportFins" ~/Library/Application\ Support/cura/5.13/plugins/SupportFins
```

## Use

1. Pose the part the way it will print (rotate it in Cura). The fins are fitted to that pose,
   the same as the website fits them to the rotation you choose there.
2. Select it → **Extensions › Support Fins › Add Support Fins**. *Computing fins…* shows for a
   second or three (the engine runs in the background), then the result: walls and tines
   placed, plus any overhang too shallow for a fin this way up and any piece of the part that
   starts in mid-air. Those aren't hidden: tilt the part and run it again.
3. Turn Cura's own supports off for the part, and slice.

- The fins move with the part. **Rotate or scale** the part and a *Fins are out of date*
  message offers **Update** (it doesn't re-run by itself: that takes a second or three).
- **Ctrl+Z** takes the fins off again. *Remove Support Fins* removes them from the selected
  parts, or from every part when nothing is selected.
- Several parts selected: each gets its own fins. Groups: ungroup first.
- Layer height comes from the active profile, so the tines land on real layers.

**Settings: Extensions › Support Fins › Support Fins Settings…** The website's settings
(material, overhang angle, tines and grip, bed pad, sway braces, cutouts, coverage), with its
defaults and tooltips; *Add Support Fins* stays one click and uses what you saved. The dialog is
built from the shared `plugins/shared/engine/options.json`, so a new setting on the site shows
up here at the next build. Material starts as **Match Cura**: PLA or PETG follow the filament
loaded for the part's extruder, anything else prints with PLA's numbers and the readout says so.

**Tines touch the part rather than bite into it.** Cura's *Remove Mesh Intersection* (a global
setting, on by default) trims the overlap between the part and the fins object, so each tine
ends at the part's outer wall. That's deliberate: the tines snap off clean.

## Developing

```sh
python3 plugins/cura/build.py && python3 -m pytest -q plugins/cura/tests/
```

The tests cover the frame mapping (Cura is Y-up, the engine Z-up), the part → engine → fins
round trip, and the settings layer (`SupportFins/settings.py`: saved values, Match Cura, the
dialog's rows, stale fins), without Cura. For the Cura side (menu, background job, scene, undo), drop a
`dev_autorun.json` next to the built plugin and open a model:

```sh
echo '{"rotate_x": 35, "slice": true}' > plugins/cura/build/SupportFins/dev_autorun.json
open -a "UltiMaker Cura" web/dev-models/lbracket.stl
```

The plugin then tilts the part, adds fins, re-runs, undoes, removes, undoes and slices, logging
each step to `dev_log.jsonl` and saving the G-code to `dev_plate0.gcode` (both next to the
plugin). Add `"settings": {...}` (saved before the first run), `"dialog": true` (opens the
settings dialog, logs what it shows and saves a screenshot to `dev_dialog.png`) and
`"stale": true` (rotates the part afterwards and presses **Update**). Delete the JSON to go back
to normal.
