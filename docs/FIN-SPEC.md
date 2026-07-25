# Fin geometry spec

Every number here is stated on camera by Slant3D in *How to Design Better Support Fins
for 3D Printing* (youtube.com/watch?v=vnn4XeKQobs). These are not our guesses. Where we
deviate, this file says so and why.

## The shape

A support fin is **a gap and a grab**, and both halves matter:

- The **fin body** is a thin wall standing off the part face by a clearance — it props
  the part up, exactly like a slicer support.
- The **tines** are tiny horizontal bridges that *fuse into the part*. They're what make
  it a **combined** support.

A fin with no tines only holds the part in one direction. The part falls *away* from it
sideways — Slant3D demos a real cube that did exactly that, mid-print. **Tines are the
entire point, not a refinement.**

## Dimensions

| feature | value | rationale |
|---|---|---|
| fin body standoff | **0.2 mm** from the part face | "spaced exactly 0.2mm away the same way support would be" |
| tine height (vertical) | **0.3 mm** — one layer line | a single bead is enough; smaller ⇒ smaller divot |
| tine width | **0.4–0.8 mm** | 0.4 = one nozzle pass, 0.8 = out-and-back. Prefer the smallest that prints. |
| tine count | **7–8 near the base**, spreading out with height | the part is least stable early. ~5 is usually enough. |
| tine spacing (upper) | every few layers | "just to make sure everything is fully reinforced" |
| base | wide **ellipse**, **1 mm** thick disc | bed adhesion without leaving a veneer to scrape off |
| part bottom edge | **~2 mm chamfer** | a tilted part otherwise starts on a single line and peels off the bed |
| fin top | **rounded**, never pointed | a sharp tip is a retraction point that causes defects |
| placement | on an **edge or corner** | hides the tine pockmarks; never the middle of a visible face |
| long parts | **two fins**, opposite sides | a single fin lets the part twist and fall |

## Why the tines must be horizontal

A horizontal tine prints as **one continuous layer line**: the nozzle travels along the
fin, crosses into the tine, into the part, and back out — **no retraction**. It is a
single strong bead.

A perpendicular (vertical) tine is its own little tower, grown one dot per layer. The
nozzle deposits a tiny amount each pass, so the tines are frail, may not print at all,
may never contact the part, and add a retraction each. Slant3D: *"This is the worst way
of doing it."*

There's a removal benefit too: because horizontal tines lie in the plane of the layer
lines, you **bend** them to fatigue and snap clean, instead of tearing them and leaving
welts.

## Claims we can make (his, on camera)

- Uses less material than tree supports.
- Removes "in a fraction of a second"; at 0.5 mm the marks "have basically no presence at all."
- **Slicer-, machine-, and material-independent** — it's in the STL, so it prints right
  wherever it's sent. This is the property no slicer can provide, because a slicer's
  output is gcode for one machine.
- Diagonal layer lines ⇒ stronger part.
- All edges look good — no distinct top/bottom surface finish.

## Where we deviate

- **`breakaway_wall()` in the prototype is gap-only, no tines — and tines cannot be added
  to it.** The prototype sweeps its wall *under* the contact line, topping out 0.2 mm
  below the part, so the only gap it leaves is vertical, and a tine across a vertical gap
  is the failure mode above. A wall can pass under the contact line *or* rise above it,
  never both: at the contact height the part touches the wall's plane, so it would have to
  pinch to zero thickness there.

  So the fin has to stand **beside** the part, off a near-vertical face, and let the
  **tines carry the load** — which is what "combined" means, and why placement is "on an
  edge or corner." Measured across the 11-model test set (`prototype/probe_tines*.py`):
  66% of contact-line stations take a tine ≤ 1.5 mm, and 13/20 overhang regions have a
  vertical face tall enough to stand a fin against. **That ~65% ceiling is why manual fin
  placement is a core feature, not a fallback.**
- **Scale-aware profile.** The prototype's foot/chamfer/tip are fixed, which degenerates
  into a 14 mm splayed sheet when the overhang sits low. Foot width must scale with wall
  height.
- **The 2 mm bottom chamfer modifies the user's part**, not just adds a fin. That's a
  bigger permission ask — surface it explicitly in the UI, don't do it silently.

## Naming

Slant3D says "grip fins" once. Unrelated to the *grip fin* used elsewhere in Matthew's
CAD work (a tolerance-absorbing feature for mating holes). Don't collide the terms.
