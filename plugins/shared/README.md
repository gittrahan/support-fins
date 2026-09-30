# Support Fins — shared plugin code

Code every plugin that can run JavaScript shares, so they all run **the website's
engine (`web/*.js`), unmodified**, instead of keeping their own copy of the geometry.
A fix on the site reaches a plugin the next time it is built.

```
engine/fins_entry.js    posed triangle soup in (mm, z up) -> fin + bed-pad triangles out
engine/bridge.js        base64 in/out for Python hosts running the bundle in V8 (mini-racer)
engine/options.json     the settings every plugin dialog is built from: key, type, default,
                        range or choices, label, tooltip, section, when it shows. Defaults,
                        ranges and choices are pinned to the website's controls (web/index.html)
                        by tests/options.test.js; fins_entry.js takes its defaults from it.
                        A host builds its dialog from it and passes the values through
                        optionsFromDialog() (and optionVisible() for show/hide; from Python,
                        host_options / host_visible), never by hand
engine/report.js        the one-line result (walls, tines, overhangs not reached, floating
                        pieces) for JS hosts (the CLI); Python hosts' host_report says
                        the same words
bundle.py               esbuild: bridge.js + web/*.js -> one IIFE, global SupportFinsEngine
py/supportfins_host.py  Python side for plugins that run the bundle in mini-racer: start V8
                        (host_engine), run the engine on a soup and map the fins back to
                        the caller's frame (host_compute); a settings dialog's values to
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
deno test --allow-read plugins/shared/tests/
python3 -m pytest -q plugins/shared/py/tests/   # needs numpy, trimesh, mini-racer==0.14.1
```

**What goes where.** Anything two plugins could use lives here: engine host, mesh
slicing, and next the options every dialog is built from. `plugins/<host>/` only calls
into that host's API (read the part, show a dialog, add the result). A plugin that
needs a new piece of geometry adds it here, with its own tests, instead of in its
adapter. Fusion is the exception: its `fins_core/` is pure Python because Fusion has no
numpy, and moves here only when another plugin wants per-fin objects.

Used by: [Orca](../orca/README.md) (inlines the bundle into its single-file plugin) and
[Cura](../cura/README.md) (ships the bundle and the Python host next to the plugin).
Onshape (FeatureScript) and Prusa (Lua) can't run JavaScript, so they don't use this.

CI: [`.github/workflows/plugins.yml`](../../.github/workflows/plugins.yml) rebuilds and tests
the plugins on every PR and push that touches `web/` or `plugins/`, and on main publishes
the builds to the [`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
pre-release.
