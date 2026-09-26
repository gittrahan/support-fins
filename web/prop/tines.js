/**
 * Grip tines: the one-layer nubs a wall reaches into the part with, so a tilted
 * part can't peel off it. `emitTines` lays the comb along a wall, `biteDirsAt`
 * aims each nub at the nearest part face, `tineStepFor` maps the "Tine grip"
 * setting to nub spacing.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { insidePart } from '../inside.js';
import { boxExtrude } from '../solids.js';
import { PROP } from './config.js';

/** Squared distance from point p to triangle (a,b,c). Ericson closest-point. */
function ptTriDist2(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; const w = sub(p, q); return dot(w, w); }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; const u = sub(p, q); return dot(u, u); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; const u = sub(p, q); return dot(u, u); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  const u = sub(p, q); return dot(u, u);
}

/**
 * Horizontal INWARD-normal of the part face nearest a tine seed -- the direction
 * a tine must bite to grip "straight on". The bite heading has to come from the
 * PART (which way the face points), never from the wall's run: a wall along a
 * leaning face's level contour runs TANGENT to the surface, so a run-aligned nub
 * lies flat instead of biting in. The nearest face handles both scenarios the tool
 * places walls in -- under a sloped overhang (nearest face is the underside) and
 * beside a near-vertical wall (nearest face is that side) -- while a shallow ceiling
 * (near-vertical normal, tiny horizontal component) returns null, the honest "too
 * flat to grip horizontally" case. Returns {x,y} unit horizontal or null.
 */
function biteDirsAt(topo, rot, offset, px, py, pz) {
  const pos = topo.pos, nrm = topo.nrm, nF = topo.nFaces;
  const P = [px, py, pz];
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + offset.x,
                       rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + offset.y,
                       rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + offset.z];
  const d2 = new Float64Array(nF);
  let best = Infinity;
  for (let f = 0; f < nF; f++) {
    const o = f * 9;
    d2[f] = ptTriDist2(P, seat(o), seat(o + 3), seat(o + 6));
    if (d2[f] < best) best = d2[f];
  }
  if (!(best < Infinity)) return [];
  // TIES. At an inside corner two faces can be EXACTLY equidistant (a step's
  // underside and the part's side face, 6.7100e-3 both), and which one a strict
  // `<` kept was decided by 1e-15 of float noise -- so an unrelated change that
  // nudged a station by that much flipped tines between biting and missing.
  // Return every tied face (nearest first by index, as before) and let the caller
  // take the first whose bite lands in the part.
  const tol = best * 1e-9 + 1e-12;
  const dirs = [];
  for (let f = 0; f < nF; f++) {
    if (d2[f] > best + tol) continue;
    const nx = nrm[f * 3], ny = nrm[f * 3 + 1], nz = nrm[f * 3 + 2];
    // seated normal, then INWARD (into the part) = negated, horizontal component only
    const sx = rot[0] * nx + rot[3] * ny + rot[6] * nz;
    const sy = rot[1] * nx + rot[4] * ny + rot[7] * nz;
    const hx = -sx, hy = -sy, hm = Math.hypot(hx, hy);
    if (hm < 0.34) continue;                  // face too flat (near-horizontal ceiling) to grip sideways
    dirs.push({ x: hx / hm, y: hy / hm });
  }
  return dirs;
}

/**
 * Nub spacing (mm) for a user "Tine grip" setting in [0 sparse .. 1 dense].
 * DEFAULT (undefined) is dense -- the proven comb. Sparse only ever LOOSENS the
 * requested spacing; emitTines's minGripTines floor still guarantees grip on
 * short walls, so a sparse setting thins surface marking without starving grip.
 */
export function tineStepFor(density) {
  const d = Math.max(0, Math.min(1, density ?? 1));
  return PROP.tineStepSparse - d * (PROP.tineStepSparse - PROP.tineStep);
}

/**
 * Lay a comb of grip tines along a placed wall's top, biting a hair into the
 * part, and return how many actually landed.
 *
 * `line` is the wall's settled TOP contour (each station's z is the part surface
 * directly above it; the wall's own top sits `gap` under that). A tine is one
 * layer-tall nub that reaches horizontally off the wall top into the part. The
 * direction is chosen, not assumed: the part material adjacent to the top lies
 * DOWN-slope (where the underside is lower, the wall-top height is already inside
 * the solid), so the emitter tries both run directions and keeps whichever puts
 * the nub's tip inside the part -- and emits nothing where neither does, which is
 * the honest "this face is too shallow to grip" case a horizontal tine has by
 * nature (fins.js's tineSpanMax rule, expressed as a containment test here).
 *
 * Nubs are the wall's own thickness wide and overlap back into it, so the slicer
 * unions them onto the wall the same way every other solid here is unioned.
 */
export function emitTines(line, tris, topo, rot, offset, out, stepArg = PROP.tineStep,
                          minTop = PROP.baseH + 0.2, tineH = PROP.tineH, body = null) {
  if (line.length < 2) return 0;

  // arc length along the run, to space nubs by a real distance not a station count
  const s = [0];
  for (let i = 1; i < line.length; i++) {
    s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0],
                                 line[i][1] - line[i - 1][1]));
  }
  // `body` = [i0, i1], the station range of a tall wall's full-height BODY (the
  // rest is its low TAILS, withLowTails). It only sizes the spacing below: the
  // minGripTines floor counts the body, as before walls grew tails, so a tail
  // never thins the comb. The comb itself runs the whole wall, anchored at the
  // lowest point a nub grips (see the end), so rows never land where a tail
  // can't take one. Callers without a tail pass nothing.
  const s0 = body ? s[body[0]] : 0;
  const s1 = body ? s[body[1]] : s[s.length - 1];
  const total = s1 - s0;
  if (!(total > 0)) return 0;

  // The caller's step encodes tip-over risk (sparse for a stable part). But grip
  // is a floor no part goes under: a wall gets at least minGripTines along its
  // length, so a squat part's sparse spacing never starves a long wall of grip or
  // leaves a short wall with a single lonely nub. min() only ever TIGHTENS the
  // requested spacing, never loosens it past the dense comb.
  const step = Math.min(stepArg, total / PROP.minGripTines);
  if (total < step) return 0;

  // half the tine's WIDTH across the run -- one nozzle bead (PROP.tineW), NOT the
  // wall thickness. Building it th-wide made a 1mm divot, ~2x Slant3D's spec.
  const half = PROP.tineW / 2;

  let count = 0;
  // Place ONE tine at arc length d0 (relative to the body start s0); true if it
  // landed. Everything below is per-station and unchanged.
  const place = (d0) => {
    const d = d0 + s0;                          // back onto the full run's arc length
    // interpolate the station at arc length d
    let k = 0;
    while (k < s.length - 1 && s[k + 1] < d) k++;
    const seg = Math.max(1e-9, s[k + 1] - s[k]);
    const f = (d - s[k]) / seg;
    const x = line[k][0] + (line[k + 1][0] - line[k][0]) * f;
    const y = line[k][1] + (line[k + 1][1] - line[k][1]) * f;
    const z = line[k][2] + (line[k + 1][2] - line[k][2]) * f;   // surface z
    const wallTop = z - PROP.gap;
    if (wallTop < minTop) return false;   // below the wall's base (flange or brim): no
                                      // face to attach a tine to. minTop defaults to
                                      // the flanged base; a squat wall passes its brim.

    // LAYER-SNAP so the tine prints as exactly ONE bead, not two partial layers.
    // A tine is tineH tall (= the slicer's layer height) precisely so it slices as a
    // single continuous bead that snaps clean. But its top used to be pinned to the
    // part underside `z`, which is almost never on the layer grid -- so a 0.2mm tine
    // straddled a layer boundary and sliced into two thin layers (Matthew's cube: all
    // 22 tines spanned 2 layers, each a 0.15mm + 0.05mm pair). A two-layer tine is a
    // taller, stronger weld that marks worse and won't bend-snap clean. Fix: snap the
    // tine's span onto the layer grid so it fills exactly one cell [tineBot, tineTop].
    //
    // Snap to the NEAREST grid line, not the one below. Flooring (always down) drops a
    // tine whose underside sits just under a layer line by nearly a full layer -- then
    // the part's own sub-layer sliver above it is too thin to print and the slicer
    // leaves a full empty layer between the tine top and the part's first real layer:
    // a "missing layer" with the part edge floating over it (Matthew's cube: every
    // underside sat ~0.19 above a line, so every tine dropped ~0.19). Rounding keeps
    // the tine top within half a layer of the underside, so it lands right where the
    // part's nearest layer begins -- supporting it -- and its bottom stays in the same
    // or the adjacent grid cell as the wall's top layer, so it still rests on the wall.
    // Grid is plate-origin (z = 0) at the layer height: exact when the slicer's first-
    // layer height equals its layer height (the common default); a different first
    // layer just offsets every tine by the same sub-layer amount. The probe below
    // still uses the underside level (zMid), so PLACEMENT is unchanged -- only the
    // built box moves onto the grid.
    const tineTop = Math.round(z / tineH) * tineH;
    const tineBot = tineTop - tineH;
    const zMid = z - tineH / 2;

    // BITE DIRECTION comes from the PART (which way the nearest face points),
    // never from the wall's run: a run-aligned nub lies flat on a leaning face
    // whose level contour the wall follows -- the regression. Then require the
    // nub's full reach to actually land inside the part, or skip it (honest -- no
    // tine gripping air, no tine on a ceiling too shallow to grab sideways).
    const bd = biteDirsAt(topo, rot, offset, x, y, zMid).find((c) =>
      insidePart(topo, rot, offset, x + c.x * PROP.tineBite, y + c.y * PROP.tineBite, zMid));
    if (!bd) return false;
    const dirx = bd.x, diry = bd.y;

    // frame (along = bite dir, across = z x along, up = z) is right-handed
    const ax = -diry, ay = dirx;                                // across = z x along
    const base = [x, y, 0];
    const P = (a, b, c) => [base[0] + dirx * a + ax * b,
                            base[1] + diry * a + ay * b, c];
    // rectangle in (along, across): from -overlap (into the wall) to +bite
    const poly = [
      [-PROP.tineOverlap, -half], [PROP.tineBite, -half],
      [PROP.tineBite, half], [-PROP.tineOverlap, half],
    ];
    boxExtrude(poly, tineBot, tineTop, P, out);
    // Test seam: tests/tines_realparts.test.js sets globalThis.__TINECAP to an array
    // and reads back each tine's seed + bite heading to verify grip on real parts
    // through the whole pipeline. Undefined in the browser -> a zero-cost noop.
    if (globalThis.__TINECAP) globalThis.__TINECAP.push({ x, y, z: zMid, biteX: dirx, biteY: diry });
    count++;
    return true;
  };
  // ONE COMB, LAID UP FROM THE BOTTOM. The wall's LOW end is the part's bottom
  // edge, where a tilted part peels off first (Slant3D's "dense low"), so the comb
  // is anchored there: scan up from the low end a tine-width at a time for the
  // lowest point a nub actually grips (the last stretch is often under minTop, or
  // curls away on a curved part), then step up the WHOLE run (tail + body) at the
  // regular spacing from that anchor. An earlier version stacked three passes --
  // the body comb from half a step in, a forced nub against EACH end, and a tail
  // pass below the body -- which bunched the bottom tines at uneven gaps (35deg
  // cube: 0.8/2.1/2.8 then 2mm) and jammed a nub 0.5mm from the TOP end, where the
  // overhang face ends and it hung past the part's edge. So: no nub within
  // tineTopClear of the top end. That margin is fixed, not half a step, so a sparse
  // comb doesn't lose its last nub to a 2.5mm dead zone. The anchor scan runs as far
  // up as it must: capping it and falling back to an arbitrary phase let the whole
  // comb straddle a narrow grippable stretch and miss it entirely.
  //
  // EDGE-BIASED spacing: dense (`step`) within tineEdgeBand of either end, thinned
  // (`step * tineMidFactor`) across the middle, so the comb clusters at the run's
  // ends/corners and stops marching across a visible flat face (PROP.tineEdgeBand).
  // The step chosen for the NEXT gap depends on where we are now: still dense while
  // the current station sits in either end band. A run <= 2*band is all-edge.
  // The interior step thins by tineMidFactor but never past the slider's OWN
  // sparsest setting: edge-bias must not compound with a user who already dialed
  // grip to light and starve the comb to a few scattered nubs.
  const S = s[s.length - 1];
  const lowFirst = line[0][2] <= line[line.length - 1][2];
  const at = (u) => place((lowFirst ? u : S - u) - s0);   // u = arc length from the LOW end
  const band = Math.min(PROP.tineEdgeBand, S / 2);
  const midStep = Math.min(step * PROP.tineMidFactor, PROP.tineStepSparse);
  const uTop = S - Math.min(step / 2, PROP.tineTopClear);
  const zLo = Math.min(line[0][2], line[line.length - 1][2]);
  const zHi = Math.max(line[0][2], line[line.length - 1][2]);
  if (!body && zHi - zLo < PROP.tineSlopeMin) {
    // A LEVEL line with no tail (most wedges, squat walls): main's plain comb,
    // unchanged -- it was already even, and a level line has no bottom edge to
    // anchor. Re-phasing these moved nubs off the few grippable spots (dense
    // wedges lost 10-20% of their tines). A SLOPED line, tail or not, runs down to
    // the part's bottom edge and takes the bottom-anchored comb below.
    for (let d = step / 2; d < S; ) {
      place(d);
      d += Math.min(d, S - d) <= band ? step : midStep;
    }
    return count;
  }
  // Start and scan scale down with the step on a very short run (a near-vertical
  // wedge line can be 0.1mm long in XY, and step shrinks to fit minGripTines there).
  const scan = Math.min(PROP.tineW, step / 2);
  let u = Math.min(half, step / 2);
  while (u <= uTop && !at(u)) u += scan;
  // Dense while this nub OR the next sparse one sits in an end band: anchoring
  // the comb lower shifts where it crosses into the top band, and judging only the
  // current nub let one 4mm gap straddle the band edge and cost the top a nub.
  for (;;) {
    const dense = Math.min(u, S - u) <= band || S - (u + midStep) <= band;
    u += dense ? step : midStep;
    if (u > uTop) break;
    at(u);
  }
  return count;
}
