/**
 * FIN -- the numbers the combined support shares with the UI: the one-layer
 * tine height, tine bite, bed-pad size, and the wide-face coverage pitches.
 * docs/FIN-SPEC.md is the spec they implement.
 *
 * Split out of fins.js; fins.js re-exports it, so importers are unchanged.
 */

export const FIN = {
  // --- from docs/FIN-SPEC.md, stated on camera. Do not "tune" these. ---
  tineH: 0.2,         // = slicer layer height: a tine must be ONE layer so it prints
                      // as a single continuous bead (see prop/config.js tineH / FIN-SPEC)

  // --- ours, derived or measured ---
  tineBite: 0.3,      // how far a tine sinks into the part
  padH: 0.5,          // bed pad thickness
  padMargin: 4.0,     // how far the pad's open-bed grip spreads past the part's
                      // contact. A part tilted onto an EDGE grips only the OUTBOARD
                      // side (inboard the part rises over the pad, which conforms
                      // or drops), so the whole hold is one narrow strip. This was
                      // 8mm to anchor a near-zero-contact tilted cube on the pad
                      // alone, but that made the pad a fat blob on every part;
                      // Matthew chose a slimmer, cleaner oval and a slicer brim for
                      // the worst tilts instead (the readout says so). Outboard
                      // cells sit on open bed at full height, so the margin only
                      // adds bed grip -- it can never weld to the part.
  padSegs: 48,        // segments on the smooth-oval pad (open-bed footprint)
  padMinArea: 60.0,   // mm^2 of bed contact above which no pad is needed
  // WIDE-FACE ROW COVERAGE. Density is the maker's call via opts.coverage
  // (0 sparse .. 1 dense), which maps to the wedge row pitch (coverPitch).
  coverExtraSparse: 88, // mm row pitch at coverage 0 (below the neutral default)
  coverSparse: 55,    // mm row pitch at coverage 0.5 -- the neutral default
  coverDense: 22,     // mm row pitch at coverage 1
  coverDefault: 0.5,  // density used when the UI has not set one yet (neutral)
};
