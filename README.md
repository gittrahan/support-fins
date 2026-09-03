# Support Fins

**Tip a part on edge, and Support Fins adds the breakaway support fins that make that
orientation printable — baked right into the STL.**

Live at **[printfins.com](https://printfins.com)**. Runs entirely in your browser: nothing
uploads, nothing installs, no account.

## Why

Printing a part flat is usually the weakest way to print it. Lying or diagonal layer
orientation tests up to ~3× stronger than standing up. Most people print flat anyway,
because the strong orientation needs supports, and slicer supports scar the surface, waste
plastic, and take longer to pick off than the part took to design.

Designed-in fins fix that, and they beat slicer supports in one way a slicer can't touch:
the support lives in the STL. Upload it anywhere — any printer, any filament, any slicer —
and it still comes out right. A slicer only ever outputs gcode for one machine.

No slicer generates these. OrcaSlicer's whole style list is Grid / Snug / Organic / Tree
Slim / Strong / Hybrid, and none of them modify the mesh or bond to the part on purpose.
The technique isn't new (Slant3D has evangelized designed-in supports for years), but until
now you had to CAD it by hand every time.

## How it works

1. Load an STL.
2. Rotate it. You're in control — Support Fins suggests, it never decides for you.
3. It shows you live: overhang count, how many can take a real fin, height, bed contact.
   Point at the load direction, answer one question — *does it pull apart, or does it
   lever?* — and it scores orientations for strength too.
4. Export. Fins and a bed pad come baked into the STL (or 3MF).

**Why you pick the rotation, not the software:** "stronger" means nothing without a load
direction, and the geometry doesn't contain one. Turn a solver fully loose and it'll hand
you a part 155 mm tall balanced on a needle with two sail-sized fins — technically optimal,
completely unprintable. (Ours did exactly that.) So the human makes the one call the
software can't, and the software does the rest.

## Status

The web app is live and does the full loop: load, rotate, score, fin, export. The geometry
engine is validated against third-party STLs and pinned by an offline test suite.

Working: overhang detection, bed-reachability, contoured breakaway fin walls, orientation +
load-direction scoring, the combined fin (wall + tines that fuse into the part — the whole
point; see `docs/FIN-SPEC.md`), STL and 3MF export.

Still open: scale-aware fin profiles, and the bed pad on tilted exports.

## Run it locally

The web app is vanilla ES modules — no build step. Serve it with the included dev server
(it disables caching so edits actually show up on reload):

```bash
python3 dev-server.py            # http://localhost:8731/
```

The Python prototype is the proof of concept the engine was ported from — plain mesh math,
no CAD kernel:

```bash
pip install trimesh numpy manifold3d
python3 prototype/spike_overhangs.py yourpart.stl      # what needs support
python3 prototype/spike_fins.py yourpart.stl out.stl   # add fins
python3 prototype/spike_orient.py yourpart.stl         # rank orientations
python3 prototype/spike_arrow.py yourpart.stl 0,0,-1   # load-direction scoring
```

Tests (Deno for the JS engine):

```bash
deno test --allow-read tests/
```

## The PrusaSlicer plugin

`plugin/` is a native PrusaSlicer 3.0 companion. It can't do the automatic tool — the 3.0
plugin sandbox can't read a loaded mesh's triangles — but it *generates* the fin natively
(an overhang test object, a standalone breakaway fin you position by hand, and a combined
tine demo) so PrusaSlicer users get a printable proof of the mechanism without leaving the
slicer. See `plugin/README.md`.

## Honest limitations

- Overhangs sitting over the *part* rather than the plate aren't handled — fins attach to
  the bed only.
- Features shorter than roughly a 4 mm wall height are too short for a real fin.
- It won't pick your orientation for you. On purpose.

## Layout

```
web/         the browser app (live at printfins.com)
plugin/      native PrusaSlicer 3.0 plugin
prototype/   Python/trimesh proof of concept the engine was ported from
docs/        FIN-SPEC.md — the verified fin geometry, with sources
tests/       offline geometry regression suite
```

Fins are separate closed solids appended to the mesh; the slicer unions them. The whole
engine is plain mesh math with no boolean kernel, because it has to run in the browser.

## Credit

The fin technique is Slant3D's — they've evangelized designed-in supports for years.
Support Fins just automates it. `docs/FIN-SPEC.md` cites their numbers directly.

## License

MIT. The license covers this tool, not what you make with it — STLs you run through Support
Fins are entirely yours, and the output carries no license obligation.

---

Free and open source. If it ever saves you a print, you can [buy me a coffee on
Ko-fi](https://ko-fi.com/matthewtrahan) ☕.
