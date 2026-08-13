# Support Fins

**Tip a part on edge, and Support Fins adds the breakaway support fins that make that
orientation printable — baked into the STL.**

Runs entirely in your browser. Nothing uploads, nothing installs, no account.

## Why

Printing a part flat is usually the weakest way to print it. Lying/diagonal layer
orientation tests up to ~3× stronger than standing. Most people print flat anyway,
because the strong orientation needs supports — and slicer supports scar the surface,
waste plastic, and take longer to pick off than the part took to design.

Designed-in fins fix that, and they're better than slicer supports in a way a slicer
structurally can't match: **the support lives in the STL.** Upload it anywhere, any
printer, any filament, any slicer settings, and it still comes out right. A slicer's
output is gcode for one machine.

No slicer generates them. OrcaSlicer's complete style list is Grid / Snug / Organic /
Tree Slim / Tree Strong / Tree Hybrid — nothing modifies the mesh, nothing bonds to the
part on purpose. The technique exists (Slant3D evangelizes it), but you have to CAD it
by hand every time.

## How it works

1. Load an STL.
2. Rotate it. You're in control — Support Fins suggests, it never decides for you.
3. It shows you live: overhang count, how many can take a real fin, height, bed contact.
   Point at the load direction and answer one question — *does it pull apart, or does it
   lever?* — and it scores orientations for strength too.
4. Export. Fins and a bed pad are baked into the STL.

### Why you pick the rotation, not the software

"Stronger" is undefined without a load direction, and geometry doesn't contain one. Left
fully automatic, an orientation solver will happily hand you a part 155 mm tall balanced
on a needle with two sail-sized fins — technically optimal, unprintable. That's a real
result from our prototype, not a hypothetical. So the human makes the one call the
software can't, and the software does the rest.

## Status

Early. The geometry engine is prototyped and validated against third-party STLs; the
browser app is not built yet.

- [x] Overhang detection + region segmentation
- [x] Bed-reachability test
- [x] Fin wall swept along a curved contact line (watertight output)
- [x] Orientation scoring + load-direction model
- [x] **Tines** — the fused connection. See `docs/FIN-SPEC.md`; this is the whole point.
      Shipped as the **Combined fin** mode (`fins.js` mode `stabilize`): wall + ellipse
      base + horizontal tines that fuse laterally into the part. Tines are built in world
      axes so each occupies a single layer (0.300mm in Z) and stays horizontal to the
      plate however the face leans — the perpendicular-to-a-leaning-face tine is exactly
      the failure Slant3D warns about. Verified watertight, standoff 0.200mm, tines fuse +
      touch the wall across the dev matrix; exports to STL and 3MF.
- [ ] Scale-aware fin profile
- [ ] Bed pad on tilted exports
- [ ] The actual browser app

## Honest limitations

- Overhangs that sit over the *part* rather than the plate aren't handled — fins attach
  to the bed only.
- Features below roughly a 4 mm wall height are too short for a real fin.
- It won't pick your orientation for you, on purpose.

## Layout

```
docs/       FIN-SPEC.md — the verified fin geometry, with sources
prototype/  Python/trimesh proof of concept (numpy + trimesh, no CAD kernel)
web/        the browser app
```

The prototype is deliberately written in plain mesh math — no boolean kernel, no CAD
library — because everything it does has to port to the browser. Fins are separate closed
solids appended to the mesh; the slicer unions them.

### Running the prototype

```bash
pip install trimesh numpy manifold3d
python3 prototype/spike_overhangs.py yourpart.stl      # what needs support
python3 prototype/spike_fins.py yourpart.stl out.stl   # add fins
python3 prototype/spike_orient.py yourpart.stl         # rank orientations
python3 prototype/spike_arrow.py yourpart.stl 0,0,-1   # load-direction scoring
```

## Credit

The fin technique is Slant3D's — they've evangelized designed-in supports for years.
Support Fins automates it. `docs/FIN-SPEC.md` cites their numbers directly.

## License

MIT.

**The license covers this tool, not what you make with it.** STLs you run through Support
Fins are entirely yours — the output carries no license obligation, and nothing about
using this tool affects how you license, sell, or distribute your models.
