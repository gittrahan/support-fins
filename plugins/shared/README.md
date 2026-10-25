# Support Fins — shared plugin code

Code every plugin that can run JavaScript shares, so they all run **the website's
engine (`web/*.js`), unmodified**, instead of keeping their own copy of the geometry.
A fix on the site reaches a plugin the next time it is built.

```
engine/fins_entry.js    posed triangle soup in (mm, z up) -> fin + bed-pad triangles out,
                        plus `pieces` (which triangles are which fin, for a host that
                        shows one object per fin), `overFaces` and `smallFaces` (the
                        input-face indices the site paints red and amber after generation;
                        amber includes area-based slivers and small holes left for bridging)
engine/draw_entry.js    Draw mode: the same soup + two points -> one hand-drawn wall
                        (web/draw.js drawnWall, called the way the site calls it)
engine/seat.js          what both entries do first: centre + snap the part, set the
                        clearances -- so a wall doesn't move with plate position
engine/bridge.js        base64 in/out for Python hosts running the bundle in V8 (mini-racer)
engine/options.json     the settings every plugin dialog is built from: key, type, default,
                        range or choices, label, tooltip, section, when it shows. Defaults,
                        ranges and choices are pinned to the website's controls (web/index.html)
                        by tests/options.test.js; fins_entry.js takes its defaults from it.
                        A host builds its dialog from it and passes the values through
                        optionsFromDialog() (and optionVisible() for show/hide; from Python,
                        host_options / host_visible), never by hand. Its user-facing
                        reference, docs/PLUGIN-CONFIG.md, is written by options_doc.js
                        (tests/options_doc.test.js fails when it is stale)
engine/report.js        the one-line result (walls, tines, overhangs not reached, floating
                        pieces) for JS hosts (the CLI); Python hosts' host_report says
                        the same words
vendor.py               mini-racer vendored into a plugin folder, per platform, for hosts
                        that can't pip-install (Cura, FreeCAD): their build.py uses it
bundle.py               esbuild: bridge.js + web/*.js -> one IIFE, global SupportFinsEngine
version.py              every plugin's version, 0.7.<n>: n = main's commit count at the last commit that
                        changed what the plugin ships (its folder + the files it bundles); each build stamps it
py/supportfins_host.py  Python side for plugins that run the bundle in mini-racer: start V8
                        (host_engine), run the engine on a soup and map the fins back to
                        the caller's frame (host_compute; host_compute_pieces adds the
                        per-fin pieces and overhang faces; host_draw_wall draws one wall);
                        a settings dialog's values to
                        engine options (host_schema, host_options, host_visible). Orca inlines it
                        at build time
py/supportfins_slice.py mesh -> per-layer polygons (split_shells, slice_soup, group_loops),
                        for hosts whose API takes layer polygons, not a mesh. Pure numpy.
                        Orca inlines it at build time
tests/                  Deno tests: same fins as the website, anywhere on the plate;
                        the base64 bridge round-trips exactly
ENGINE-SENSITIVITY.md   engine note: tine placement moves under 1e-13 mm of noise, and
                        how fins_entry.js neutralises it
```

```
python3 plugins/shared/bundle.py out.js     # needs esbuild (npx fetches it on demand)
python3 plugins/shared/version.py          # each plugin's version, as its build would stamp it
deno test --allow-read plugins/shared/tests/
python3 -m pytest -q plugins/shared/py/tests/   # needs numpy, trimesh, mini-racer==0.14.1
```

**What goes where.** Anything two plugins could use lives here: engine host, mesh
slicing, and next the options every dialog is built from. `plugins/<host>/` only calls
into that host's API (read the part, show a dialog, add the result). A plugin that
needs a new piece of geometry adds it here, with its own tests, instead of in its
adapter. Fusion is the exception: its `fins_core/` is pure Python because Fusion has no
numpy, and moves here only when another plugin wants per-fin objects.

Used by: [Orca](../orca/README.md) (inlines the bundle into its single-file plugin),
[Cura](../cura/README.md) and [FreeCAD](../freecad/README.md) (ship the bundle and the
Python host next to the plugin), and [Blender](../blender/README.md) (the same, with
mini-racer as a wheel Blender installs; it uses the per-fin pieces and drawWall), and
[Rhino](../rhino/README.md) (the same, with mini-racer pip-installed by Rhino 8 itself).
Onshape (FeatureScript) and Prusa (Lua) can't run JavaScript, so they don't use this.

**Nozzle.** Schema-built CAD dialogs (FreeCAD, Blender, Rhino, SolidWorks) and MCP
settings offer the website's nozzle diameters, including 0.8 mm, with 0.4 mm as the
default. Slicer plugins don't ask (hostSupplied, like layer height): Cura reads the
part's extruder's `machine_nozzle_size`, Orca the wall extruder's `nozzle_diameter`,
the CLI's preserved-project mode the project's `nozzle_diameter`, and a size off the
site's list (0.3, 0.5) is used as is. Both Auto and Draw apply the diameter with
two-line walls on every call, resetting any previous nozzle/wall-line state.
Layer height and support gap remain separate settings. This exposes the existing
website scaling; it does not add material presets or nozzle-specific calibration.

**Separate walls.** In Full coverage, `separateWalls` keeps fill walls from crossing
other walls or sharing their bases, so a resin print doesn't cure them into one block.
It is `'auto'` (the default), `'on'` or `'off'`. Auto follows the tine direction the
way the site ticks its box: on for Vertical (resin) tines, off for Horizontal (FDM).
A dialog stores whatever it holds, so the schema carries Auto rather than the site's
self-ticking checkbox. Separation may leave more overhang unsupported, and thin ties
between tall walls stay (they snap). Auto mode ignores it.
FreeCAD, Blender, Cura, Rhino and SolidWorks expose the schema control; Orca accepts
`{"mode":"full","separateWalls":"on"}` in its plugin config. The CLI flag is
`--separate-walls <auto|on|off>`, and MCP uses `"separate-walls": "on"` in `settings`.
Fusion's hand-written dialog sends neither tine direction nor this setting, so it
builds FDM tines without separation; Prusa and Onshape don't use the shared engine.

CI: [`.github/workflows/plugins.yml`](../../.github/workflows/plugins.yml) rebuilds and tests
the plugins on every PR and push that touches `web/` or `plugins/`, and on main publishes
the builds to the [`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
pre-release.
