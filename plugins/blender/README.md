# Support Fins — Blender extension (experimental)

printfins.com's breakaway support fins under a part in Blender 4.2+: select the part,
**Generate fins**, and each wall, sway brace and the bed pad appears as its own object
under it, ready to export with the part.

Same engine as the site and every plugin: the part's triangles (modifiers applied) go
to `computeFins` in V8 (mini-racer, installed by Blender from the extension's wheel)
through the shared host, `plugins/shared/py/supportfins_host.py`. No fin geometry lives
in the add-on.

## Install

Download `support_fins-<platform>.zip` for your computer (`macos-arm64`, `macos-x64`,
`windows-x64`, `linux-x64`) from the
[plugins-latest](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
release, then in Blender: **Edit ▸ Preferences ▸ Get Extensions ▸ ⌄ ▸ Install from Disk**.
The panel is in the 3D View sidebar (**N**), tab **Support Fins**.

## Use

- **Bed** = the world XY plane at the part's lowest point: the part prints the way it
  sits, z up. Turn it to change the pose, or **Lay face flat** and click the face that
  should go down.
- **Units**: one Blender unit is read as `Unit Scale × 1000` mm. An STL imported 1:1
  into a default scene reads as metres; the panel shows the part's size in mm and
  offers **Use millimetres** (Unit Scale 0.001) when the size looks wrong.
- **Settings** are the site's, with the site's defaults and ranges (generated from
  `plugins/shared/engine/options.json`); ones the engine would ignore are hidden.
- **Generate fins** replaces the part's fins for its current pose and settings. The
  result line says what was placed and what wasn't reached (overhangs too shallow for
  a fin, pieces starting in mid-air).
- **Draw wall**: click two points under an overhang for one hand-placed wall (the site's
  Draw mode). Generate re-stands drawn walls for the part's current pose; one that no
  longer fits says why.
- Fins are children of the part. Delete one you don't want (it comes back on the next
  Generate). Moving the part, editing its mesh or changing a setting marks the fins
  **out of date** until Generate runs again.
- **Export**: select the part and its fins and use Blender's own STL export.

## Build and test

```
python3 plugins/blender/build.py               # this machine's platform -> build/support_fins-<platform>.zip
python3 plugins/blender/build.py --all         # every platform
python3 -m pytest -q plugins/blender/tests/    # settings mapping, no Blender (needs mini-racer==0.14.1)
python3 plugins/blender/tests/run_blender.py --version 4.2.23 --package plugins/blender/build/support_fins-linux-x64.zip
```

`run_blender.py` downloads a checksum-verified Linux Blender and runs `blender_smoke.py`
in it (CI does this for 4.2 LTS and 5.2). On a Mac, run the smoke test against your own
Blender with `BLENDER_USER_CONFIG/SCRIPTS/DATAFILES/EXTENSIONS` pointed at a scratch
folder, so the test install never touches your setup.

## Licence and credit

The add-on (this folder) is GPL-3.0-or-later, as Blender requires of add-ons; the
engine bundled into it (`web/*.js`) stays MIT (`LICENSE-engine` in the zip).

The Blender side started as [RemusTL](https://github.com/RemusTL)'s extension in
[#145](https://github.com/gittrahan/support-fins/pull/145): the two-click Draw wall and
Lay face flat tool and the headless-Blender CI smoke test are his, ported onto the
shared engine path.
