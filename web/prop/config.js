/**
 * PROP -- every number a breakaway wall is built from: thickness, gap, foot,
 * tip, station spacing, tine comb, reach limits. Each field carries the reason
 * it has the value it has; docs/FIN-SPEC.md is the spec they implement.
 *
 * Split out of prop.js; prop.js re-exports it, so importers are unchanged.
 */

export const PROP = {
  th: 1.0,          // wall thickness. 1.0 (two 0.5mm passes) not breakaway.py's
                    // 1.2: a prop is a free-standing wall with nothing bracing
                    // its sides, so it cannot go as thin as a Slant3D fin (whose
                    // tines grip the part), but 1.2 read as chunky. Contact tip
                    // stays 0.6 (Slant3D's tine width) and the base flange 1mm.
  gap: 0.2,         // breakaway clearance below the part
  tip: 0.6,         // width of the contact tip
  baseH: 0.6,       // height of the flat base flange. The foot used to be a CONE
                    // that ramped up over `chamfer` mm, which reads in a slicer as
                    // a golf tee, not the upside-down T a breakaway support should
                    // be. Now the base is a thin flat slab, emitted as its own
                    // solid and unioned by the slicer, with the wall standing
                    // straight up off it.
                    //
                    // WAS 1.0 (Slant3D's ~1mm disc). Lowered to 0.6 because the
                    // flange height sets how high off the plate the TINE grip can
                    // start: `emitTines` skips any station whose wall top sits
                    // below the flange (minTop = baseH + 0.2), so a 1mm flange left
                    // the bottom ~2mm of a tilted part ungripped -- exactly where
                    // the part is least stable and peels. The flange is only an
                    // anti-wobble brace (a long wall gets its bed grip from its
                    // LENGTH, and a tilted part from the bed pad), so 0.6mm -- still
                    // three layers -- braces fine while letting the tine comb reach
                    // ~0.4mm lower down the face. Grip, not adhesion, is what the
                    // bottom band needs.
  tipH: 1.5,        // height the tip taper runs
  // Foot half-width. Kept well under maxUnsupportedSpan/2 on purpose: props are
  // laid in ROWS spaced maxUnsupportedSpan apart, so a foot wider than half that
  // spacing overlaps its neighbour and the row's feet fuse into one slab -- the
  // "thick overlapping feet, not thin fins" the flagship showed. breakaway.py's
  // own 7.0 never hit this because a human places ONE wall per feature, never a
  // packed row. A long wall also gets ample bed grip from its LENGTH, so the foot
  // is only an anti-wobble brace, not the adhesion; 3.0 braces a tall thin wall
  // fine and leaves a clean ~6mm gap between neighbours at the 12mm span.
  footMax: 3.0,     // widest the foot ever gets (< maxUnsupportedSpan/2)
  footMin: 1.6,
  footRatio: 0.12,  // foot half-width as a fraction of wall height
  minSpan: 7.0,     // a wall shorter than this is not worth the plate space
  minHeight: 1.5,   // nor is one this short
  // SQUAT BED SUPPORT. A flanged T-wall needs ~minHeight of headroom just to
  // exist (gap 0.2 + baseH 0.6 + a sliver of tip taper), so a bed overhang lower
  // than that gets NOTHING from the wall path -- its stations are trimmed as
  // stub/blocked and the low ledge prints into air (the near-bed overhangs that
  // came out rough on real organic parts). Below minHeight but above this floor a
  // brimmed squat breakaway is built instead (see sweepSquat): a thin wall on a
  // thin wide brim -- the full T-foot can't fit, but the wall still needs plate
  // grip. Below minHeightSquat the overhang sits ~on the bed and the first few
  // layers self-support, so nothing is built.
  minHeightSquat: 0.6,
  minSpanSquat: 4.0,   // squat walls are cheap; a shorter low ledge still earns one
  // A squat wall's failure mode is PEELING off the plate, not tipping: its own
  // footprint is a hair-wide contact strip, so it needs adhesion AREA the way the
  // bed pad gives the tall parts. It gets a flat brim -- WIDE for grip, but only a
  // couple layers tall so it still snaps off clean, and because it sits on the
  // plate (~gap below the overhang) it never marks the part. Half-width stays
  // under maxUnsupportedSpan/2 so a row of squat walls never fuses brim-to-brim.
  squatBrimH: 0.4,     // ~2 layers
  squatBrimW: 2.5,     // half-width; a 5mm-wide brim strip along the wall
  // mm between cross-sections; a LENGTH, not a count -- see `straightness`.
  // 1.0 rather than 2.0 deliberately, and the trade is measured: at 2.0 the
  // matrix is 8 clean / 2 walls that would weld / 18% coverage, at 1.0 it is
  // 9 clean / ZERO bad walls / 13%. Denser stations both contour the top more
  // finely and probe the flanks more often, and the coverage it costs is lost
  // to the straightness gate rejecting curved regions -- which is M6b's problem
  // to solve by splitting them, not this one's to solve by shipping a support
  // that fuses. "No prop is a fixable disappointment, a fused prop is a ruined
  // print" is already this module's rule; this is that rule priced.
  stationStep: 1.0,
  minStations: 3,   // a run shorter than this is not a wall
  clearProbes: 12,  // points checked down the wall for a clear path to the plate
  // mm the part must stay off the wall's FLANKS. Larger than `gap` on purpose:
  // the top is meant to come within 0.2mm and be bridged over, the flanks are
  // meant never to touch, and a slicer's own XY support distance is ~0.35 on a
  // 0.4 nozzle for the same reason. Set to 0.15 first, which put the closest
  // approach on the flank instead of the top on 4 of 6 walls.
  sideClear: 0.35,
  maxWander: 0.10,  // RMS deviation / chord: above this there is no line to sweep
  // Run direction: at or above this underside slope (rise/run) the walls run down
  // the slope -- a robust, part-aligned axis. Flatter than this there is no slope
  // to read, so a near-flat ledge aligns to its longer world axis instead. Chosen
  // over the footprint's covariance principal axis, which drifts to a spurious
  // diagonal on a messy real overhang. See patchTracks.
  contourSlopeMin: 0.15,
  // how far a face's normal may swing from its sub-patch SEED's before the
  // region is split there -- see splitRegion
  splitAgreeDeg: 15,
  // A region is CURVED (one wall under its lowest line, the tube case) when
  // at least tubeCurvedFrac of its AREA has a normal more than tubeSpreadDeg
  // from the area-weighted mean; otherwise it is a plane (rows of walls).
  // The fraction matters, not the worst face -- a worst-face test routed the
  // drive frame's 3,276 mm2 tilted plane to a single wall because its pocket
  // rims fan to 66-75deg, and the flagship regressed from 9 walls / 86%
  // coverage to 1 / 34%. Measured populations, area beyond 25deg: planes with
  // pockets 4-29%, true curved bands 51-83%. 0.4 sits in the gap.
  tubeSpreadDeg: 25,
  tubeCurvedFrac: 0.4,
  // A region must be at least this big for the tube route. Small curved
  // POCKETS pass the fraction test too (filter_housing carries 15-230 mm2
  // pockets at 25-75% deviant area), but a straight chord track under a
  // pocket that curves in PLAN drifts off the surface -- one such wall
  // measured 0.297 against the 0.2 spec, a wall the part never lands on.
  // The patch path serves them correctly and always did. Real tube bands
  // measure 1,000+ mm2; 300 sits in the gap.
  tubeMinArea: 300,
  // mm an overhang may bridge unsupported: the wall-to-wall spacing across a
  // wide patch, and the ONE dial M7b puts in front of the user. check_stl.py
  // reads this value out of this file (MAX_UNSUPPORTED_SPAN) so the checker and
  // the generator cannot disagree about it.
  maxUnsupportedSpan: 12.0,

  // --- TINES (the grip comb) ---------------------------------------------
  // A plain prop stops `gap` under the overhang and the part bridges over it:
  // a pure breakaway, no grip. The COMBINED support adds a comb of tiny
  // horizontal nubs along the wall's top that bite a hair into the part, so a
  // tilted part cannot peel or twist off the wall -- and, because each nub is
  // one layer line lying in the layer plane, it BENDS to snap clean instead of
  // tearing out (fins.js documents the same reasoning for the beside-the-face
  // fin these replace). Tines only bite where the overhang is steep enough that
  // a horizontal poke reaches solid: past a slope of gap/bite the nub lands in
  // the part, below it in air, and the emitter simply skips the ones that miss
  // (verified by insidePart, never assumed) -- the same honest behaviour the
  // beside-the-face fin had.
  // A tine must be exactly ONE layer tall: printed that way it lays down as a
  // single continuous bead (the nozzle runs along the wall, into the part, back
  // out -- no retraction), which is the whole reason it fuses AND snaps off clean
  // (FIN-SPEC.md "Why the tines must be horizontal"). One layer means one SLICER
  // layer, so this has to equal the print's layer height -- 0.3 (Slant3D's number,
  // his layer height) baked in a 1.5-layer tine at Matthew's 0.2mm.
  tineH: 0.2,        // = slicer layer height; the DEFAULT only -- the UI's "Layer
                     // height" field drives it per build (opts.layerHeight) so the
                     // tine is always exactly one of the user's real layers
  // Tine WIDTH across the run = the bead the nozzle lays: Slant3D's spec is
  // 0.4-0.8mm (0.4 = one nozzle pass, 0.8 = out-and-back), "as small as possible".
  // 0.5 is his stated number ("0.5 by 0.5"). NOTE: this used to be dead -- emitTines
  // built the tine `th` (1.0mm) wide, ~2x spec, a fat divot Matthew caught by eye.
  tineW: 0.5,
  tineBite: 0.5,     // how far a nub reaches horizontally into the part. TRIMMING this
                     // toward Slant3D's smaller sliver (0.3) to shrink the pockmark was
                     // tried and reverted: because the tine seeds on the surface and
                     // drops `gap` below it, the reach-into-solid margin is thin, and
                     // the slope gate is gap/bite -- so a shorter reach stops gripping
                     // at/near 45deg (the common orientation). tines_realparts +
                     // draw + tine_density pin real grip there and fail below ~0.45;
                     // 0.5 is already near the grip floor. Mark reduction is a
                     // PLACEMENT problem (keep tines off flat mid-faces), not a bite one.
  tineStep: 2.0,     // mm between nubs -- the DENSE grip comb, the default
  tineStepSparse: 5.0, // mm between nubs at the sparse end of the Tine-grip slider
  tineOverlap: 0.3,  // how far the nub sinks back into the wall, so they union
  // NOTE: a TIP-OVER-RISK density scale (tineStepSquat/tipRiskLo/tipRiskHi) was
  // removed -- it let stable parts fall to a sparse 9mm comb that read as "laying
  // on the face", and the cube bed-release it was meant to cure was the pad's
  // fault, not the tines'. Surface marking from the dense comb is now tamed the
  // deliberate way: the user's "Tine grip" slider (tineStepFor / opts.tineDensity),
  // which DEFAULTS to dense and the minGripTines floor still protects -- never by
  // silently starving grip. Pinned by tests/tine_density.test.js.
  minGripTines: 3,     // grip floor: never fewer than this per grippable wall,
                       // however squat -- a wall that grips nothing is a loose prop
  // EDGE BIAS. Slant3D's rule is tines go on an edge/corner, never across a visible
  // flat middle -- that mid-face march is what left Matthew's bracket "marked
  // everywhere". So the comb runs DENSE within a band at each end of a wall's run
  // (the run's ends sit on the overhang's edges/corners, where the marks hide and
  // where anti-peel/twist grip has the longest moment arm anyway) and THINS across
  // the middle by tineMidFactor. Short walls (run <= 2*band) are all-edge, so they
  // stay dense end-to-end and the minGripTines floor is untouched.
  tineEdgeBand: 8.0,   // mm of dense comb held at each end of the run
  tineMidFactor: 2.0,  // interior spacing = requested step * this (2mm dense -> 4mm)
  tineSlopeMin: 1.0,   // mm of rise end-to-end before a tail-less line counts as
                       // running down to a bottom edge (anchored comb) vs level
  tineTopClear: 0.5,   // mm kept bare at a wall's TOP end, where the overhang face
                       // ends -- a nub jammed against it hangs past the part's edge
};
