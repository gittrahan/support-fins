# Nozzle-sized support walls

Set **Walls → Nozzle** to the printer's nozzle diameter, then choose the desired
wall count with **Fin thickness**. The readout shows the calculated thickness.
The supported nozzle range is 0.2–3 mm; wall counts are 2, 4, 6 or 8 lines.

Line width is nozzle × 1.1. Wall-body thickness is that width × line count.
For example, a 1.6 mm nozzle gives a 1.76 mm bead and 3.52 / 7.04 / 10.56 /
14.08 mm walls. Match the slicer's line width to this assumption; a nozzle alone
cannot determine how a slicer chooses toolpaths.

The chosen dimensions reach Auto, Full coverage, hand-drawn walls and Sway.
Contact tips and grip tines remain one bead wide for breakaway. Sway retains its
print-tested thickness floor: max(selected gauge, min(2.4, 1.2 + 0.004 × height)).
Feet encompass the wider bodies. Existing foot shapes, Sway depth limits,
placement decisions, collisions and the three-tine minimum remain unchanged.
Thicker walls may be refused where the clearance cannot accommodate them.

Upstream's optional **Interface material → Flat contacts** keeps the full chosen
wall gauge at flat contact crests, instead of the one-bead breakaway tip. With
Everywhere, Sway tine material tags are preserved as well. The 3MF exporter keeps
the interface as a component of the supports object. These combinations are
geometry-tested; material bonding and tool changes still need printer checks.

Set **Layer height** to the actual slice height, in the range 0.08–2.4 mm.
Tines occupy one layer. The same range reaches the shared plugin option schema;
plugin and other engine callers keep legacy wall dimensions unless they explicitly
pass `tunables: { nozzle, wallLines }`. Omitted/null profiles restore legacy
dimensions in a reused engine without resetting material clearances.

The browser starts in Auto and selects a 0.4 mm nozzle with two wall lines.
That means 0.88 mm ordinary walls, with the existing Sway floor. Original legacy
reference scenes remain unchanged; separate profile references record this
intentional browser dimension change.

STL and separate-object 3MF exports are tested on a synthetic metre-high post.
Check first layers, contact tines, clearances and continuity in the slicer.
These new profiles are geometry-tested; they have not been physically print-tested.

This change contains only nozzle sizing and matching layer-height controls.
Draw/background execution belongs to PR #224. Cross, tapered base extensions,
rounded feet and explicit fitted-feature placement will be proposed separately.
