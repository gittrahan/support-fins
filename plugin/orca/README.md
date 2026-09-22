# Support Fins — OrcaSlicer plugin lane

Companion to [printfins.com](https://printfins.com), targeting **OrcaSlicer's Python
plugin system** (embedded CPython; single-`.py` PEP 723 plugins or `.whl`).

## The read/write split that shapes everything here

OrcaSlicer and PrusaSlicer expose **opposite halves** of what this tool needs, and
neither exposes both:

| | read the loaded mesh? | add geometry to the plate? |
|---|---|---|
| **PrusaSlicer 3.0** (Lua) | ❌ no triangle access | ✅ generative (`make_cube`…) — our Prusa plugin drops a fin you hand-place |
| **OrcaSlicer** (Python) | ✅ `orca.host` returns `vertices()`/`triangles()` | ❌ host is **read-only** — "nothing here mutates the model" |

So on Orca we can do the *smart* half Prusa can't — read the user's actual model and
**auto-fit** fins to its overhangs — but we **cannot** place the result on the live
plate. There is no add-object / import-mesh / make-primitive call anywhere in Orca's
plugin surface (verified across `orca.host`, `orca.script`, `orca.slicing`). The
honest ceiling: compute the fins in-Orca, write a finned `.3mf`, user does
`File ▸ Import`. That still beats the Prusa plugin (real auto-fit, not hand-placed),
it just isn't the "fins land on your plate automatically" the feature request imagined.

The one theoretical write-path is the slicing pipeline (`posSupportMaterial`, "mutate
the live slicing graph") — but that emits support as *toolpaths*, not our contoured
breakaway mesh fin. Different, deeper, lower-fidelity. Not the plan.

## Roadmap

1. **`support_fins_probe.py` — the spike (this commit).** Reads the loaded model via
   `orca.host`, runs the 45° overhang classification in **pure numpy** (no trimesh),
   reports faces/bbox/overhang-area per volume, and separately reports whether
   `trimesh` imports. Answers the two unknowns before we port anything: *does the read
   work on a real dragged-in model, and what deps can the port rely on?*
2. **Port the analysis + fit.** `spike_overhangs.py` → region/contact-line, then
   `spike_orient.py` (re-orient to minimise overhang) and `spike_fins.py` (contour the
   breakaway fins). Reimplement trimesh's few calls (submesh, surface sample) in numpy
   if step 1 says trimesh is absent.
3. **Export.** Reuse `web/threemf.js`'s structure (part + fins as separate placed
   objects, mm units, production UUIDs) to write a finned `.3mf` to disk. Filesystem
   writes are permitted (permission-gated audit hook).
4. **Funnel option.** A lightweight "flag my overhangs → open in printfins.com" panel
   using only the read-only mesh API — legit in-slicer discovery within the rules.

## Install (side-load)

**Needs an OrcaSlicer nightly (or a release newer than 2.4.2)** — the Python plugin
system is not in 2.4.2 stable. First install pulls `numpy` via Orca's bundled `uv`
(declared in the PEP 723 block).

OrcaSlicer → **Plugins** → **Browse plugins ▸ Install local plugin** → pick
`support_fins_probe.py`. Manual alternative: each plugin needs **its own subfolder** —
`<data_dir>/orca_plugins/support_fins_probe/support_fins_probe.py`. Load a model, then
**Plugins ▸ Run** the probe; the report comes back in the result dialog (and stdout).

**Status:** untested against a live OrcaSlicer build — written to the documented API.
Run the probe first; if it loads and reports sane overhang numbers, phase 2 is greenlit.
