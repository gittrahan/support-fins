/**
 * Fin generation -- M4. The fin stands BESIDE the part on a flat upright face,
 * held off by a standoff, and horizontal tines fuse across that gap into the
 * part. See planes.js for why M3's sweep-under-the-overhang geometry had to be
 * abandoned, and docs/FIN-SPEC.md for where every number below comes from.
 *
 * A fin is three kinds of solid that overlap and get unioned by the slicer -- no
 * boolean kernel anywhere, the same approach the rest of the project uses:
 *   1. the WALL, a thin round-topped blade standing off the part face;
 *   2. the BASE, a wide flat ellipse that keeps the wall stuck to the plate;
 *   3. the TINES, tiny horizontal nubs bridging the standoff into the part.
 *
 * The tines are the point. A wall with only a gap constrains the part in one
 * direction and it falls away sideways -- Slant3D demos a cube doing exactly
 * that mid-print. Tines are what make it a *combined* support.
 *
 * WHY THE TINES ARE HORIZONTAL: a horizontal tine prints as one continuous layer
 * line -- the nozzle runs along the wall, crosses into the part and back out,
 * with no retraction, laying a single strong bead. A vertical tine is its own
 * little tower grown a dot per layer: frail, often never touching the part, and
 * a retraction each. Horizontal tines also lie in the plane of the layer lines,
 * which is what lets you BEND them to snap clean instead of tearing them out.
 *
 * Everything about the wall is built in the patch's frame (planes.js), so a fin
 * serving a leaning face leans with it. The tines are the exception: they are
 * built in world axes, because a tine must occupy ONE layer, and a box that is
 * flat in a leaning frame is not flat in z.
 */
import { findWallPatches, patchProbe, patchPoint, zAt } from './planes.js';
import { BED_EPS } from './overhangs.js';
import { buildProps, noProps, surfaceZAt, emitTines, tineStepFor, PROP } from './prop.js';
import { buildSwayBraces } from './sway.js';
import { CUT, CUTOUT_PATTERNS } from './cutout.js';
import { FIN } from './fins/config.js';

// Moved into web/fins/ (one module per concern); re-exported here so every
// importer of fins.js is unchanged.
export { FIN } from './fins/config.js';

/**
 * Wedge row pitch for a coverage setting, mirroring prop.js's coverRowSpan: 0.5 is
 * the neutral default (coverSparse, the pre-slider behaviour), left of it loosens
 * toward coverExtraSparse, right of it tightens toward coverDense. Kept monotonic.
 */
function coverPitch(coverage) {
  const c = Math.max(0, Math.min(1, coverage));
  return c <= 0.5
    ? FIN.coverSparse + ((0.5 - c) / 0.5) * (FIN.coverExtraSparse - FIN.coverSparse)
    : FIN.coverSparse - ((c - 0.5) / 0.5) * (FIN.coverSparse - FIN.coverDense);
}

/**
 * Apply the page's clearance settings to FIN / PROP / PAD.
 *
 * WHY THIS IS A PARAMETER AND NOT JUST A MODULE EDIT. ui/settings.js sets these objects
 * directly (applyMaterial for the PLA/PETG profiles, the Support gap and Pad grip
 * fields) and that works for anything it builds itself. But the real build runs in
 * finworker.js, a module Worker with its OWN instance of fins.js and prop.js: module
 * state does not cross a Worker boundary, so everything the page set stayed on the
 * page. PETG picked in Auto mode therefore printed PLA's clearances -- silently, since
 * the numbers on screen were right and only the geometry disagreed.
 *
 * So the values travel WITH the build request (opts.tunables, structured-cloned like
 * every other option) and are applied here, in whichever instance is doing the work.
 * Unknown or non-finite entries are ignored, and calling this with nothing leaves the
 * defaults alone -- an old caller that doesn't pass tunables behaves exactly as before.
 */
export function applyTunables(t) {
  if (!t) return;
  const set = (obj, key, v) => { if (Number.isFinite(v)) obj[key] = v; };
  set(FIN, 'gap', t.finGap);
  set(FIN, 'tineBite', t.tineBite);
  set(FIN, 'padH', t.padH);
  set(PAD, 'grab', t.padGrab);
  if (['auto', 'light', 'sure', 'custom'].includes(t.padStyle)) PAD.style = t.padStyle;
  if (t.padCustom) for (const k of Object.keys(PAD.custom)) set(PAD.custom, k, t.padCustom[k]);
  set(PROP, 'gap', t.propGap);
  // The wedge keeps its own copy of the clearance, so the Support gap field and the
  // PETG profile never reached it -- not even on the main thread, where everything
  // else worked. One clearance, applied everywhere it is spelled.
  set(PERP, 'gap', t.propGap);
  // Not a clearance, but module state with the same Worker problem.
  if (CUTOUT_PATTERNS.includes(t.cutout)) CUT.pattern = t.cutout;
}

export const PAD = {
  cell: 1.2,        // mm; radial vertex spacing across the conforming oval disc
  grab: 0.05,       // mm the pad rises PAST the part underside to bite in near the
                    // contact, instead of standing off. A tilted part rests on a
                    // knife edge; a pad held 0.2mm below it never touches (the "huge
                    // gap"), so the part peeled while its own edge did all the
                    // anchoring. The pad is a baked brim -- it has to CONNECT. But a
                    // 0.15mm bite read as "too close"/welded, so this is a light TACK:
                    // just enough to connect the part to the wide open-bed grip
                    // (padMargin), which does the actual holding, while staying thin
                    // enough to snap off clean. Capped at padH so the tack only lands
                    // on the low near-edge strip; bounded by grab it can never
                    // recreate the deep 0.46mm slab weld the old flat pad made.
                    //
                    // May be NEGATIVE: PETG welds to a support far harder than the
                    // PLA this 0.05 tack was tuned for, so the PETG profile sets a
                    // gap (-0.1) -- the pad stands a hair BELOW the part and snaps
                    // off clean. `conform` floors every column at 0.05 so a gap pad
                    // stays a valid watertight solid AND still kisses the part at
                    // the resting edge (where the underside drops to the plate) to
                    // hold it, while gapping off across the rest of the footprint.

  // BRIM-STYLE pad (experimental, off by default). The default pad is 0.5mm (2-3
  // layers) and tacks 0.05mm into the part, so the slicer merges pad + part into
  // ONE region on the first layers and runs solid infill straight across the
  // contact -- a weld. A slicer brim comes off easily for three reasons, and this
  // copies them: it is ONE layer (only the first layer grips the bed, so more
  // layers add stiffness and weld height, never adhesion); it stands a small gap
  // off the part's first-layer outline, so the slicer keeps two regions and runs
  // perimeters PARALLEL to the part (bead beside bead, not infill through); and
  // first-layer squish closes that gap just enough to hold. A tilted part's
  // flank still prints its second layer onto the pad's inner edge, but only a
  // strip ~layer/tan(tilt) wide, since the pad is only one layer tall.
  //
  // Pad styles, picked in the UI (Bed pad):
  //   'auto'  -- the default: 'light', except on a small foot (a first-layer
  //              outline under minGripOutline) where it builds 'sure' instead.
  //   'light' -- the brim-style pad above: one layer, brimGap off the part. It
  //              held a PETG cube on its edge and came off clean.
  //   'sure'  -- the original conforming pad: padH thick, tacked `grab` into the
  //              part. Holds harder, harder to remove.
  //   'custom'-- the brim-style mesh with every number the user's (PAD.custom).
  style: 'auto',
  custom: { h: 0.5, gap: 0.0, grip: 0.05, margin: 4.0 },
  brimGap: 0.12,    // mm off the part's first-layer outline. Orca's brim-object gap
                    // is 0.1, but a brim is generated from the slices; this pad is
                    // geometry, and PrusaSlicer / Orca / Bambu close any slice gap
                    // under 2 x slice_closing_radius (0.049) = 0.098mm. At 0.1 the
                    // gap came through at exactly 45deg and was welded shut at 40deg
                    // (0.089mm) -- so it needs the margin.
  minGripOutline: 20.0, // mm of first-layer outline below which Light can't grip
                    // (a point, a cone tip, a small nub): Light becomes Sure hold.
                    // A judgement call, not a measurement -- the one print that
                    // held had 80mm (a 40mm cube's edge, both sides).
  brimCell: 0.1,    // mm mesh spacing; the gap is only as true as the mesh that
                    // samples it (the 1.2mm oval cells interpolate across it)
};

/**
 * A breakaway pad under the part's bed contact.
 *
 * Not a nicety: a part tilted into a strong orientation rests on an EDGE, so its
 * bed contact is near zero and it peels off before the fins have anything to
 * hold. The pad is a wide, thin footprint -- thin enough to cut off, wide enough
 * to stick.
 *
 * It is fed the part's lowest VERTICES for its outline (a part standing on an
 * edge has no face on the plate at all, so a face-based footprint is empty in
 * precisely the case the pad exists for) AND the seated part triangles, so its
 * TOP can hold `gap` clear of the part instead of welding to it.
 *
 * THE SHAPE: the first pad was a flat 0.5mm slab, so wherever the part's underside
 * dipped into that band -- which is exactly the resting contact the pad exists for
 * -- the two fused solid (measured 0.46mm of interpenetration on a tilted
 * drive_frame) and would not break off. The pad conforms to the part instead, and
 * (Matthew's ask) it is a clean OVAL rather than a boxy grid: a radial mesh of the
 * contact ellipse -- rings of vertices from the centre out to (r1, r2) -- with each
 * vertex given its own top height. OUTBOARD (no part overhead) rises to the full
 * `padH` for the wide bed grip; under the part it caps at `part_low + grab`, a light
 * tack that connects without the deep weld. The disc is one watertight solid (top
 * cap + flat bottom + side wall), so there are no cells to drop and no holes.
 */
/**
 * The whole part, seated into print space, as a flat triangle array -- what
 * `surfaceZAt` needs to know how low the part hangs over each pad cell. Built
 * only when a pad is actually wanted (small bed contact), so the full-mesh pass
 * is not paid on every well-seated part.
 */
function seatedPartTris(topo, rot, offset) {
  const { pos, nFaces } = topo;
  const { x: ox, y: oy, z: oz } = offset;
  const tris = new Float64Array(nFaces * 9);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      tris[o] = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      tris[o + 1] = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      tris[o + 2] = rot[2] * x + rot[5] * y + rot[8] * z + oz;
    }
  }
  return tris;
}

/**
 * The part's first-layer outline: its section at the layer's mid-height (where a
 * slicer cuts), as a flat [x0, y0, x1, y1, ...] segment list, plus its length.
 */
function firstLayerOutline(partTris, zc) {
  const segs = [];
  let length = 0;
  for (let i = 0; i < partTris.length; i += 9) {
    const pts = [];
    for (let a = 0; a < 3; a++) {
      const p = i + a * 3, q = i + ((a + 1) % 3) * 3;
      const za = partTris[p + 2] - zc, zb = partTris[q + 2] - zc;
      if ((za < 0) === (zb < 0)) continue;
      const t = za / (za - zb);
      pts.push([partTris[p] + t * (partTris[q] - partTris[p]), partTris[p + 1] + t * (partTris[q + 1] - partTris[p + 1])]);
    }
    if (pts.length !== 2) continue;
    segs.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    length += Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  }
  return { segs, length };
}

function buildPad(contact, partTris, out, layerH = FIN.tineH) {
  if (contact.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of contact) { cx += p[0]; cy += p[1]; }
  cx /= contact.length; cy /= contact.length;

  // principal axis of the contact, so a long thin edge gets a long thin pad
  // instead of a circle sized to its length
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of contact) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;
  const bx = -ay, by = ax;

  let e1 = 0, e2 = 0;
  for (const p of contact) {
    const dx = p[0] - cx, dy = p[1] - cy;
    e1 = Math.max(e1, Math.abs(dx * ax + dy * ay));
    e2 = Math.max(e2, Math.abs(dx * bx + dy * by));
  }
  const margin = PAD.style === 'custom' ? PAD.custom.margin : FIN.padMargin;
  const r1 = e1 + margin, r2 = e2 + margin;

  // A CONFORMING ELLIPTICAL DISC, not a boxy grid. Matthew wanted the pad to read
  // as a clean oval, but it still has to duck under a tilted part's flank the way
  // the old heightfield did. So build a radial mesh of the ellipse -- rings of
  // vertices from the centre out to (r1, r2) -- and give each vertex its own
  // conformed top height, exactly as a grid cell used to. The result is a smooth
  // oval outline whose TOP follows the part surface. It replaces both the boxy
  // grid AND the flat-ellipse fast path (which only fired on open-bed footprints,
  // so a tilted cube -- the case Matthew was looking at -- never became an oval).
  //
  // Height rule per vertex, unchanged from the grid: OUTBOARD (no part overhead)
  // rises to the full padH for bed grip; UNDER the part it caps at part_low + grab
  // to bite in a hair rather than stand off or weld deep. low+grab is always >= grab
  // (0.05mm) > 0, so every column has positive height and the mesh stays a valid,
  // watertight solid -- no cells to drop, no holes in the disc.
  let sureGrab = PAD.grab;   // raised to >= 0 below when Light swaps to Sure hold
  const conform = (x, y) => {
    const low = surfaceZAt(partTris, x, y);
    if (low === null) return FIN.padH;
    // grab may be negative (a PETG gap). Floor at 0.05 so every column stays
    // positive -- the disc watertight, no dropped cells -- and so a gap pad still
    // kisses the part where its underside drops to the plate (the resting edge) to
    // hold it, while gapping off across the rest of the footprint.
    return Math.max(0.05, Math.min(FIN.padH, low + sureGrab));
  };
  const frame = { cx, cy, ax, ay, bx, by, r1, r2 };
  const L1 = Number.isFinite(layerH) && layerH > 0.05 ? layerH : FIN.tineH;
  // The Light pad holds by first-layer squish along the part's first-layer
  // OUTLINE, 0.12mm off. Along a cube's edge that is 80mm of contact and it held a
  // PETG print; around a part balanced on a point or a small nub (a sphere, a cone
  // tip, the shelter hub's ball foot) the outline is a few mm and there is next
  // to nothing to squish against. Sure hold tacks under the whole low footprint,
  // and it is what the hubs printed with. So below PAD.minGripOutline of outline,
  // Auto builds Sure hold and says so (pad.autoSure); otherwise Light. An explicit
  // Light or Custom is the user's call and is left alone; `smallFoot` rides along
  // so the UI can warn when that pad has a gap.
  const outline = firstLayerOutline(partTris, L1 / 2);
  const smallFoot = outline.length < PAD.minGripOutline;
  const tag = (pad) => pad && Object.assign(pad, { smallFoot, outline: outline.length });
  const light = PAD.style === 'light' || (PAD.style === 'auto' && !smallFoot);
  if (light) return tag(brimPad(partTris, contact, frame, L1, PAD.brimGap, 0, L1, outline.segs, out));
  if (PAD.style === 'custom') {
    const c = PAD.custom;
    return tag(brimPad(partTris, contact, frame, c.h, c.gap, c.grip, L1, outline.segs, out));
  }
  const autoSure = PAD.style === 'auto';
  // The swap exists to HOLD a part that barely touches the plate, so the pad must
  // meet it. PETG's Sure hold stands a gap (grab -0.1) under the part to snap off
  // clean; on a small foot that gap moved the pad ~0.7mm off a sphere's first-layer
  // dot -- further than Light's gap -- so the swap changed the label and nothing
  // else (Matthew, PETG sphere). Here the pad at least touches: flush or the
  // material's tack, never a gap.
  if (autoSure) sureGrab = Math.max(PAD.grab, 0);
  const nTheta = FIN.padSegs;
  const nRing = Math.max(2, Math.ceil(Math.max(r1, r2) / PAD.cell));

  // Ring/segment vertex in world XY, at radial fraction `fr` and angle index `j`.
  const vAt = (fr, j) => {
    const a = (2 * Math.PI * j) / nTheta;
    const s = r1 * fr * Math.cos(a), t = r2 * fr * Math.sin(a);
    return [cx + ax * s + bx * t, cy + ay * s + by * t];
  };
  // Precompute the vertex ring positions + their conformed tops once (reused by the
  // top cap, the side wall, and the flat bottom), so every shared edge is keyed
  // from bit-identical coordinates and the soup stays edge-manifold.
  const V = [];   // V[i][j] = [x, y, topZ], i in 0..nRing, j in 0..nTheta-1
  for (let i = 0; i <= nRing; i++) {
    const fr = i / nRing, row = [];
    for (let j = 0; j < nTheta; j++) {
      const [x, y] = vAt(fr, j);
      row.push([x, y, conform(x, y)]);
    }
    V.push(row);
  }
  const centreTop = V[0][0];   // ring 0 collapses to the centre (fr = 0)
  const tri = (a, b, c) => out.push(a, b, c);
  let maxTop = 0;
  for (const row of V) for (const v of row) if (v[2] > maxTop) maxTop = v[2];

  for (let j = 0; j < nTheta; j++) {
    const jn = (j + 1) % nTheta;
    // TOP surface (normal up). Inner fan from the centre, then quad strips outward.
    tri(centreTop, V[1][j], V[1][jn]);
    for (let i = 1; i < nRing; i++) {
      tri(V[i][j], V[i + 1][j], V[i + 1][jn]);
      tri(V[i][j], V[i + 1][jn], V[i][jn]);
    }
    // BOTTOM surface at z=0 (normal down: reverse the top winding).
    const b0 = [cx, cy, 0];
    const bi = (i, k) => [V[i][k][0], V[i][k][1], 0];
    tri(b0, bi(1, jn), bi(1, j));
    for (let i = 1; i < nRing; i++) {
      tri(bi(i, j), bi(i + 1, jn), bi(i + 1, j));
      tri(bi(i, j), bi(i, jn), bi(i + 1, jn));
    }
    // SIDE wall around the outer ring, top down to the plate (normal outward).
    const oR = nRing;
    const tj = V[oR][j], tjn = V[oR][jn];
    const bj = [tj[0], tj[1], 0], bjn = [tjn[0], tjn[1], 0];
    tri(tj, bj, bjn);
    tri(tj, bjn, tjn);
  }

  return { r1, r2, cells: nTheta * nRing, height: maxTop, points: contact.length, oval: true,
           style: 'sure', autoSure, smallFoot, outline: outline.length };
}

/**
 * The BRIM-STYLE pad (PAD.style 'light', and 'custom'): the same oval, `H` tall
 * (one layer for 'light'), standing `g` off the part's first-layer outline --
 * see PAD.style for why. `grab` raises (or, negative, lowers) its top against
 * the part's underside the way PAD.grab does for the 'sure' pad; 'light' uses 0.
 *
 * The gap has to come through the SLICER, which merges any slice gap under
 * ~0.098mm, so it is held exactly on the first layer: the part's first-layer
 * outline is its section at that layer's mid-height (what the slicer prints),
 * and the pad's top there ramps LINEARLY with the true distance from that
 * outline, crossing mid-height exactly at `g`. A linear ramp survives the mesh's
 * linear interpolation; the earlier min-of-underside field stepped at vertical
 * faces and let the sliced edge drift to 0.036mm off a cube's end face. The pad
 * is also held below the lowest underside within `g` (plus `grab`), which keeps
 * it clear of the part on any layer above the first (Custom thickness).
 *
 * The mesh is columns across the oval's long axis, each running rim to rim with
 * the same number of rows, at `brimCell` spacing, so the outline stays the
 * smooth oval. The two tips close with a fan; the bottom is one flat fan (the
 * ellipse is convex).
 */
function brimPad(partTris, contact, e, h, g, grab, layerH, outline, out) {
  const { cx, cy, ax, ay, bx, by, r1, r2 } = e;
  const H = Number.isFinite(h) && h > 0.05 ? h : FIN.tineH;
  const cell = PAD.brimCell;
  const zc = layerH / 2;                 // first layer's mid-height: the slicer's cut
  const ring = [];
  if (g > 0) for (let k = 0; k < 16; k++) ring.push([g * Math.cos(k * Math.PI / 8), g * Math.sin(k * Math.PI / 8)]);

  // The part's first-layer outline (firstLayerOutline, cut at zc), bucketed.
  const B = 0.5, reach = Math.max(g, 0) + 2 * cell, bucket = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (let i = 0; i < outline.length; i += 4) {
    const x0 = outline[i], y0 = outline[i + 1], x1 = outline[i + 2], y1 = outline[i + 3];
    for (let bi = Math.floor((Math.min(x0, x1) - reach) / B); bi <= Math.floor((Math.max(x0, x1) + reach) / B); bi++) {
      for (let bj = Math.floor((Math.min(y0, y1) - reach) / B); bj <= Math.floor((Math.max(y0, y1) + reach) / B); bj++) {
        const k = key(bi, bj);
        let arr = bucket.get(k); if (!arr) bucket.set(k, (arr = []));
        arr.push(x0, y0, x1, y1);
      }
    }
  }
  // Signed distance to the outline, capped at `reach` (negative = inside it).
  const dist = (x, y) => {
    const arr = bucket.get(key(Math.floor(x / B), Math.floor(y / B)));
    let d2 = reach * reach;
    if (arr) for (let k = 0; k < arr.length; k += 4) {
      const x0 = arr[k], y0 = arr[k + 1], dx = arr[k + 2] - x0, dy = arr[k + 3] - y0;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
      d2 = Math.min(d2, ex * ex + ey * ey);
    }
    const d = Math.sqrt(d2);
    const low = surfaceZAt(partTris, x, y);
    return low !== null && low < zc ? -d : d;
  };
  // Ramp slope: one cell below the crossing is still above the 0.05 floor, so the
  // two vertices around the crossing are never clamped and interpolate exactly.
  const k = Math.max(0.01, zc - 0.05) / cell;
  const top = (x, y) => {
    let low = surfaceZAt(partTris, x, y) ?? Infinity;
    for (const [dx, dy] of ring) low = Math.min(low, surfaceZAt(partTris, x + dx, y + dy) ?? Infinity);
    // With no gap asked for (Custom gap 0) grip alone decides -- a bite is a bite.
    const ramp = g > 0 ? zc + k * (dist(x, y) - g) : Infinity;
    return Math.max(0.05, Math.min(H, low + grab, ramp));
  };
  const at = (s, t) => [cx + ax * s + bx * t, cy + ay * s + by * t];
  const vert = (s, t) => { const [x, y] = at(s, t); return [x, y, top(x, y)]; };

  // Rows are FRACTIONS of each column's half-width, shared by every column so
  // the grid stays structured. They are fine (brimCell) only across the band
  // where the part comes within the pad's height -- the only place the top is
  // not flat -- found by a coarse scan, and 1.2mm apart elsewhere. A full fine
  // grid was ~87k triangles on a 40mm cube and scales with the whole oval.
  const nS = Math.max(3, Math.ceil((2 * r1) / cell) + 1);
  const half = (s) => r2 * Math.sqrt(Math.max(0, 1 - (s / r1) ** 2));
  let band = 0;
  for (let s = -r1 + 0.25; s < r1; s += 0.5) {
    const te = half(s);
    if (te < cell) continue;
    for (let t = 0; t <= te; t += cell) {
      for (const sg of [1, -1]) {
        const [x, y] = at(s, sg * t);
        if (top(x, y) < H - 1e-9) band = Math.max(band, t / te);
      }
    }
  }
  const fine = cell / r2, coarse = Math.max(fine, 1.2 / r2);
  const edge = Math.min(1, band + 2 * fine);
  const fr = new Set([-1, 1]);
  for (let f = 0; f <= edge + 1e-12; f += fine) { fr.add(+Math.min(f, 1).toFixed(9)); fr.add(-Math.min(+f.toFixed(9), 1)); }
  for (let f = edge + coarse; f < 1; f += coarse) { fr.add(+f.toFixed(9)); fr.add(-(+f.toFixed(9))); }
  const rows = [...fr].sort((a, b) => a - b);
  const nT = rows.length;
  const cols = [];                     // interior columns i = 1 .. nS-2
  for (let i = 1; i < nS - 1; i++) {
    const s = -r1 + (2 * r1 * i) / (nS - 1);
    const te = half(s);
    cols.push(rows.map((f) => vert(s, te * f)));
  }
  const tipL = vert(-r1, 0), tipR = vert(r1, 0);
  const tris = [];
  const tri = (a, b, d) => tris.push(a, b, d);
  for (let j = 0; j < nT - 1; j++) {
    tri(tipL, cols[0][j + 1], cols[0][j]);
    const L = cols[cols.length - 1];
    tri(tipR, L[j], L[j + 1]);
  }
  for (let i = 0; i < cols.length - 1; i++) {
    const A = cols[i], B = cols[i + 1];
    for (let j = 0; j < nT - 1; j++) { tri(A[j], B[j], B[j + 1]); tri(A[j], B[j + 1], A[j + 1]); }
  }
  // boundary ring (tipL, the +t rim left to right, tipR, the -t rim right to
  // left), then its side wall and the flat bottom fan
  const rim = [tipL, ...cols.map((col) => col[nT - 1]), tipR, ...cols.map((col) => col[0]).reverse()];
  const flat = rim.map((v) => [v[0], v[1], 0]);
  const b0 = [cx, cy, 0];
  for (let k = 0; k < rim.length; k++) {
    const m = (k + 1) % rim.length;
    tri(rim[k], flat[k], flat[m]); tri(rim[k], flat[m], rim[m]);
    tri(b0, flat[m], flat[k]);
  }
  // One winding was picked above; flip the lot if it came out inside-out.
  let vol = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [p, q, r] = [tris[i], tris[i + 1], tris[i + 2]];
    vol += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  for (let i = 0; i < tris.length; i += 3) {
    if (vol < 0) out.push(tris[i], tris[i + 2], tris[i + 1]); else out.push(tris[i], tris[i + 1], tris[i + 2]);
  }
  return { r1, r2, cells: cols.length * nT, height: H, points: contact.length, oval: true,
           style: PAD.style === 'custom' ? 'custom' : 'light' };
}

/**
 * DRAW mode support: every grippable face in this pose, and a map from any face
 * index to the patch it belongs to. Grip-first Draw lets the user pick the face
 * by hand, so the UI needs to know which faces CAN take a fin (to guide the
 * pointer) and, given a picked face, which patch to stand a fin against. This is
 * findWallPatches plus a face->patch index; the caller caches it per orientation
 * and rebuilds only when the part turns.
 *
 * Only DOWNWARD faces are offered: a support fin is a perpendicular wedge that
 * holds an overhang up from below, so highlighting a vertical side (which the
 * old beside-the-face fin gripped) would just guide the pointer at a face the
 * build then refuses.
 */
export function gripPatches(topo, result, rot) {
  const patches = findWallPatches(topo, rot, result.offset).filter((p) => p.n.z < -0.05);
  const faceMap = new Map();
  for (const p of patches) for (const f of p.faces) if (!faceMap.has(f)) faceMap.set(f, p);
  return { patches, faceMap };
}

/**
 * The part's bed-contact points and its area-weighted centre of mass.
 *
 * Contact comes from VERTICES under BED_EPS, not from bed-flagged faces: a part
 * tilted onto an edge has no face on the plate at all, which is exactly the case
 * the bed pad exists for.
 */
function bedContact(topo, result, rot) {
  const { pos, nFaces, area } = topo;
  const { x: ox, y: oy, z: oz } = result.offset;
  let mx = 0, my = 0, mw = 0;
  const pts = [];
  for (let f = 0; f < nFaces; f++) {
    let gx = 0, gy = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + oz;
      gx += wx; gy += wy;
      if (wz < BED_EPS) pts.push([wx, wy]);
    }
    mx += (gx / 3) * area[f]; my += (gy / 3) * area[f]; mw += area[f];
  }
  if (mw > 0) { mx /= mw; my /= mw; }
  return { pts, mx, my };
}

/**
 * HOW the part meets the plate: on a face, on an edge, or on a single point.
 *
 * This is the question neither support mode was asking, and it is the one that
 * explains hub_post_foot. That part has 0.0 mm^2 of bed contact at EVERY tilt
 * from 0 to 165 degrees -- it balances on the tip of its own tapered foot -- so
 * every overhang on it sits 70-100mm in the air. Stabilize finds nothing to grip
 * and Prop wants a 100mm scaffold, and both then reported some local reason
 * ("no flat face", "part in the way") that sent the user off tuning the wrong
 * thing. The actionable truth is upstream of both: nothing you add to a part
 * balanced on a point will hold it, because the support has nothing to work
 * against. Rotate it until it sits down.
 *
 * A tilted-onto-an-EDGE part is the flagship Stabilize case and must not be
 * caught by this -- it also has ~0 bed area, but its contact is a long line, not
 * a dot. So the discriminator is the footprint's extent, not its area.
 */
const POINT_FOOTPRINT = 2.0;      // mm; contact narrower than this is a point

function seatingOf(result, contactPts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of contactPts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = contactPts.length
    ? Math.hypot(maxX - minX, maxY - minY) : 0;
  // Area decides `face`, because a part can sit on a wide footprint of many
  // separate little pads; extent decides point-vs-edge, because those two differ
  // in shape at the same (~zero) area.
  const kind = result.bedArea >= FIN.padMinArea ? 'face'
    : span < POINT_FOOTPRINT ? 'point' : 'edge';
  return { kind, span, bedArea: result.bedArea };
}

/**
 * The ANGLED perpendicular wedge -- the grip support for a LEANING face a
 * straight-up prop cannot reach.
 *
 * When a wide/long part is tilted steeply (a 300mm plate at 60deg), it leans out
 * OVER the vertical path a prop would need, so prop.js reports every station
 * `blocked` and the overhang goes unserved. The fix is not a vertical wall but a
 * thin WEDGE that fills the open triangular gap between the leaning underside and
 * the bed: its broad face is perpendicular to the part (edge-on, thin across the
 * face `u`), its top rides the underside `gap` below, and it drops to the plate --
 * so it clears the lean instead of driving through it. Tiled across the face at a
 * coverage pitch, this is the "row of fins" a must-tilt plate needs, and it stays
 * the same perpendicular T-rib Matthew approved on the cube.
 */
const PERP = {
  th: 1.2,        // wedge thickness (thin across the face)
  gap: 0.2,       // breakaway clearance under the contact (matches PROP/FIN)
  footHalf: 3.0,  // foot flange half-width past the wedge, each side
  footH: 0.6,
  pitch: 24.0,    // mm between wedges across the face (a ROW, not a wall of plastic)
  tStep: 1.5,     // sampling step up the face
  minH: 2.0,      // skip a wedge shorter than this
  inset: 2.0,     // keep wedges off the very edges of the patch
  maxRow: 14,     // hard cap on wedges per patch, so a wide face never sprays
  // A wedge is for a BROAD leaning face props can't reach. Below this face area
  // (or u-extent) it is a small/curved patch better left to props or draw-mode --
  // wedging it just sprays spikes (the hook's curved arm).
  minArea: 500,
  minWidth: 22,
};

/** Push a closed solid, flipping winding to outward if its signed volume is negative. */
function pushSolid(local, out) {
  let V = 0;
  for (let i = 0; i < local.length; i += 3) {
    const a = local[i], b = local[i + 1], c = local[i + 2];
    V += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  if (V < 0) for (let i = 0; i < local.length; i += 3) out.push(local[i], local[i + 2], local[i + 1]);
  else for (const v of local) out.push(v);
}

/** Extrude a planar ring (a list of [x,y,z]) by +/- half along the horizontal uDir. */
function extrudeRing(ring, uDir, half, out) {
  const n = ring.length;
  const lo = ring.map((p) => [p[0] - uDir.x * half, p[1] - uDir.y * half, p[2]]);
  const hi = ring.map((p) => [p[0] + uDir.x * half, p[1] + uDir.y * half, p[2]]);
  const local = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    local.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]);
  }
  for (let i = 1; i < n - 1; i++) {          // convex fan caps (a monotone wedge is convex)
    local.push(hi[0], hi[i], hi[i + 1], lo[0], lo[i + 1], lo[i]);
  }
  pushSolid(local, out);
}

/**
 * A flat foot flange under the wedge's bed footprint (a -> b at z=0).
 *
 * The flange reaches `footHalf` past both ends of the run, and past the LOW end
 * that is under the part: a wedge under a cube stood on its edge ran its foot
 * straight across the edge and under the far flank, so the slicer printed foot
 * and part as one solid region for the foot's three layers -- a weld the wedge's
 * breakaway gap and tines were meant to avoid. So when `partTris` is given the
 * flange keeps only its longest stretch along the run where nothing of the part
 * hangs lower than footH + gap over the flange's full width (plus the gap
 * sideways): the same clearance the wedge keeps, applied to its foot.
 */
function emitFoot(a, b, uDir, out, partTris = null) {
  const sx = b[0] - a[0], sy = b[1] - a[1];
  const L = Math.hypot(sx, sy);
  if (L < 1e-6) return;
  const ux = sx / L, uy = sy / L;                 // along the run (bed footprint)
  const hw = PERP.th / 2 + PERP.footHalf, hl = L / 2 + PERP.footHalf;
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const P = (s, w, z) => [cx + ux * s + uDir.x * w, cy + uy * s + uDir.y * w, z];
  let s0 = -hl, s1 = hl;
  if (partTris) {
    const step = 0.1, need = PERP.footH + PERP.gap, reach = hw + PERP.gap;
    const nS = Math.ceil((2 * hl) / step), nW = Math.ceil((2 * reach) / step);
    const clearAt = (s) => {
      for (let k = 0; k <= nW; k++) {
        const [x, y] = P(s, -reach + (2 * reach * k) / nW, 0);
        const low = surfaceZAt(partTris, x, y);
        if (low !== null && low < need) return false;
      }
      return true;
    };
    let best = null, start = null;
    for (let i = 0; i <= nS; i++) {
      const s = -hl + (2 * hl * i) / nS;
      const ok = clearAt(s);
      if (ok && start === null) start = s;
      if (start !== null && (!ok || i === nS)) {
        const end = ok ? s : s - (2 * hl) / nS;
        if (!best || end - start > best[1] - best[0]) best = [start, end];
        start = null;
      }
    }
    if (!best || best[1] - best[0] < PERP.th) return;   // nowhere to stand a flange
    // Pull back one more sample so the kept edge is clear, not the last clear sample.
    s0 = best[0] > -hl ? best[0] + PERP.gap : best[0];
    s1 = best[1] < hl ? best[1] - PERP.gap : best[1];
  }
  const rect = [[s0, -hw], [s1, -hw], [s1, hw], [s0, hw]];
  const lo = rect.map(([s, w]) => P(s, w, 0)), hi = rect.map(([s, w]) => P(s, w, PERP.footH));
  const local = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; local.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]); }
  for (let i = 1; i < 3; i++) local.push(hi[0], hi[i], hi[i + 1], lo[0], lo[i + 1], lo[i]);
  pushSolid(local, out);
}

/**
 * Is a wedge at this u standable AND uninterrupted by a bore? Two conditions:
 *   - its first contiguous contact run (from the bed up) is tall enough to matter;
 *   - the face does NOT resume ABOVE a gap -- material / void / material is a BORE
 *     punched through the face, and a column there dies at the void (the angle-
 *     bracket bug). A clean top is material / void / END (past the top), which is
 *     fine. The resume must persist a couple of samples so a sliver gap in the
 *     triangulation is not mistaken for a hole.
 */
function columnClear(p, u) {
  const nT = Math.max(2, Math.ceil((p.t1 - p.t0) / PERP.tStep));
  let started = false, ended = false, top = 0, resume = 0;
  for (let i = 0; i <= nT; i++) {
    const t = p.t0 + ((p.t1 - p.t0) * i) / nT;
    const dev = patchProbe(p, u, t);
    if (dev === null) { if (started) ended = true; continue; }
    if (ended) { resume++; continue; }                      // material above a gap
    started = true;
    const z = zAt(p, dev, t) - PERP.gap;
    if (z > top) top = z;
  }
  return top >= PERP.minH && resume < 2;
}

/**
 * The u positions to stand wedges at across [lo, hi]. With no hole this is the
 * old even row (round(span/pitch) columns). A bore/slot splits the standable u's
 * into BANDS on either side of it; each band gets its own row, so a drawn or auto
 * fin lands as two fins FLANKING the bore instead of one column dying at the void
 * (a tilted bore prints poorly and must not be finned -- rotate hole-up or draw).
 */
export function perpColumns(p, lo, hi, pitch) {
  const span = hi - lo;
  if (span <= 0) return [];
  const nS = Math.max(2, Math.ceil(span / 1.0));
  const clear = [];
  for (let i = 0; i <= nS; i++) clear.push(columnClear(p, lo + (span * i) / nS));

  // contiguous clear samples -> u-bands (the void is the gap between them)
  const bands = [];
  let s = -1;
  for (let i = 0; i <= nS; i++) {
    if (clear[i] && s < 0) s = i;
    if (s >= 0 && (!clear[i] || i === nS)) {
      const e = clear[i] ? i : i - 1;
      if (e >= s) bands.push([lo + (span * s) / nS, lo + (span * e) / nS]);
      s = -1;
    }
  }
  if (!bands.length) bands.push([lo, hi]);   // nothing read as clear: fall back to one row

  const cols = [];
  for (const [a, b] of bands) {
    const w = b - a;
    const m = Math.max(1, Math.min(PERP.maxRow, Math.round(w / pitch)));
    for (let k = 0; k < m; k++) cols.push(m === 1 ? (a + b) / 2 : a + (w * k) / (m - 1));
  }
  return cols.slice(0, PERP.maxRow);
}

/**
 * Tile perpendicular wedges across one down-facing patch. Returns
 * { triangles, tines, count }.
 */
function buildPerpFins(p, topo, rot, offset, opts = {}) {
  const uDir = { x: p.u.x, y: p.u.y };            // horizontal, across the face (unit)
  const half = PERP.th / 2;
  const lo = p.u0 + PERP.inset, hi = p.u1 - PERP.inset;
  if (hi - lo <= 0) return { triangles: [], tines: 0, count: 0, wedges: [] };
  const out = [];
  const wedges = [];   // per-wedge records: { triRange, line, height, span }
  let tineTotal = 0, count = 0;
  let partTris = null;   // seated part, built on the first foot that needs it

  for (const uc of perpColumns(p, lo, hi, opts.pitch ?? PERP.pitch)) {
    // contact profile up the face at this u (stop at the first hole after starting)
    const contact = [];
    const nT = Math.max(2, Math.ceil((p.t1 - p.t0) / PERP.tStep));
    for (let i = 0; i <= nT; i++) {
      const t = p.t0 + ((p.t1 - p.t0) * i) / nT;
      const dev = patchProbe(p, uc, t);
      if (dev === null) { if (contact.length) break; else continue; }
      const w = patchPoint(p, dev, uc, t);
      if (w[2] > 0.3) contact.push(w);
    }
    if (contact.length < 2) continue;
    const top = contact.map((w) => [w[0], w[1], w[2] - PERP.gap]);
    if (Math.max(...top.map((q) => q[2])) < PERP.minH) continue;

    // ring: up the bed edge, along the top, down the bed edge (closes along the bed)
    const ring = [[top[0][0], top[0][1], 0], ...top,
                  [top[top.length - 1][0], top[top.length - 1][1], 0]];
    const before = out.length;
    extrudeRing(ring, uDir, half, out);
    partTris ??= seatedPartTris(topo, rot, offset);
    emitFoot([top[0][0], top[0][1], 0], [top[top.length - 1][0], top[top.length - 1][1], 0], uDir, out, partTris);
    if (opts.tines !== false) tineTotal += emitTines(contact, null, topo, rot, offset, out, tineStepFor(opts.tineDensity));
    if (out.length > before) {
      count++;
      // One wedge = ring + foot + its tines, all pushed contiguously since
      // emitTines ran inside this loop iteration. Record the range so the UI
      // can address/remove this individual wedge.
      const hMax = Math.max(...top.map((q) => q[2]));
      const sp = Math.hypot(contact[contact.length - 1][0] - contact[0][0],
                           contact[contact.length - 1][1] - contact[0][1]);
      wedges.push({ triRange: [before, out.length], line: contact, height: hMax, span: sp });
    }
  }
  return { triangles: out, tines: tineTotal, count, wedges };
}

/**
 * Does a prop wall already stand under this patch's footprint? Decided in space,
 * not by face index: a prop `line` is a centreline of [x,y,z] points, and the
 * patch's world footprint is the xy bbox of its four (u,t) corners. If any prop
 * point lands in that box (plus a small margin) the patch is already served and a
 * wedge would just double it.
 */
function propServesPatch(p, props) {
  if (!props || !props.length) return false;
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
  for (const u of [p.u0, p.u1]) for (const t of [p.t0, p.t1]) {
    const q = patchPoint(p, 0, u, t);
    if (q[0] < xLo) xLo = q[0]; if (q[0] > xHi) xHi = q[0];
    if (q[1] < yLo) yLo = q[1]; if (q[1] > yHi) yHi = q[1];
  }
  const m = 8;
  for (const q of props) {
    for (const pt of (q.line ?? [])) {
      // A tall wall's low TAIL (prop/clearance.js withLowTails) runs down into the corner
      // where this face may meet the one the wall serves; its sub-minHeight tip
      // landing in the margin is not a wall under this face (it dropped the wedge
      // on a steep cube face). Squat props are low by design and still count.
      if (!q.squat && pt[2] < PROP.minHeight) continue;
      if (pt[0] >= xLo - m && pt[0] <= xHi + m && pt[1] >= yLo - m && pt[1] <= yHi + m) return true;
    }
  }
  return false;
}

/**
 * Overhang regions still unsupported once the wedges are in: neither served by a
 * prop wall nor standing over any wedge. This used to be `unserved - wedged
 * PATCHES` -- a patch count off a region count, two different segmentations --
 * so wedges under one region hid others nothing supports (hub_corner X45: a
 * 1025mm2 region with no support within reach reported "0 unserved";
 * voron_filter_housing X25 hid two). Credit is SPATIAL, like propServesPatch and
 * check_stl's coverage, because a wall-patch and a region don't share faces:
 * a region counts when some wedge vertex sits within maxUnsupportedSpan of one
 * of its faces in plan and 0..3mm below it. Dropped overhangs are surfaced.
 */
function unservedAfterWedges(topo, rot, result, servedRegions, wedgeTris) {
  const { pos } = topo, o = result.offset, served = new Set(servedRegions);
  const span2 = PROP.maxUnsupportedSpan * PROP.maxUnsupportedSpan;
  let n = 0;
  result.regions.forEach((g, i) => {
    if (served.has(i)) return;
    for (const f of g.faces) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < 3; j++) {
        const x = pos[f * 9 + j * 3], y = pos[f * 9 + j * 3 + 1], z = pos[f * 9 + j * 3 + 2];
        cx += (rot[0] * x + rot[3] * y + rot[6] * z + o.x) / 3;
        cy += (rot[1] * x + rot[4] * y + rot[7] * z + o.y) / 3;
        cz += (rot[2] * x + rot[5] * y + rot[8] * z + o.z) / 3;
      }
      for (const v of wedgeTris) {
        if (v[2] > cz - 3 && v[2] < cz + 0.5 && (v[0] - cx) ** 2 + (v[1] - cy) ** 2 <= span2) return;
      }
    }
    n++;
  });
  return n;
}

/**
 * Generate supports for the part in its current orientation.
 *
 * @param opts.mode     'prop' (the default: a vertical breakaway wall under
 *                      each overhang), 'stabilize' (the Brace: a tined fin
 *                      against toppling; docs/FIN-SPEC.md), or 'auto' (props for
 *                      the overhangs PLUS bracing fins if the part would topple)
 * @param opts.bedPad   add the pad when bed contact is too small to hold
 */
export function buildFins(topo, result, rot, opts = {}) {
  applyTunables(opts.tunables);
  const built = buildFinsCore(topo, result, rot, opts);
  // Sway braces are an optional ADD-ON to whatever the mode placed (sway.js): a
  // tall part still needs its overhangs held, and bracing its sides is a
  // separate job on separate faces.
  if (!opts.sway?.on) return built;
  // Braces run LAST, so everything this mode placed is already on the plate: hand
  // the props' and wedges' centrelines over as things to stand clear of. Fused to
  // one of those, a brace is no longer a piece that snaps off by itself.
  const walls = (built.fins ?? []).map((f) => f.line).filter((l) => Array.isArray(l) && l.length);
  const sw = buildSwayBraces(topo, result, rot,
    { ...opts.sway, tines: opts.tines, layerHeight: opts.layerHeight, avoid: { walls } });
  // Each brace also gets a fin record: the Auto view draws and exports only the
  // triangles some record claims (per-fin removal), so an unrecorded brace would
  // be counted in the readout but never shown or written out.
  const base = built.triangles.length;
  const fins = built.fins ?? [];
  let id = fins.reduce((m, f) => Math.max(m, (f.id ?? -1) + 1), fins.length);
  const braces = sw.ribs.map((r) => ({
    height: r.height, length: r.depth, tines: r.tines, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
    id: id++, kind: 'sway',
    triRanges: [[r.triRange[0] + base, r.triRange[1] + base]],
    line: r.foot, span: r.depth,
  }));
  return {
    ...built,
    triangles: [...built.triangles, ...sw.triangles],
    fins: [...fins, ...braces],
    sway: { count: sw.count, tines: sw.tines, skipped: sw.skipped, reason: sw.reason,
            // The outlines travel back so a brace the user then clicks by hand can be
            // checked against these: Auto builds in the Worker, so the page has no
            // other way to know where they stand. Plain data, structured-cloneable.
            braces: (sw.ribs ?? []).map((r) => ({ foot: r.foot, halfW: r.halfW, th: r.th,
                                          height: r.height, levels: r.levels })) },
  };
}

function buildFinsCore(topo, result, rot, opts = {}) {
  const mode = opts.mode ?? 'prop';
  const padOut = [];

  // THE COMBINED SUPPORT IS A TINED PERPENDICULAR RIB (prop.js), not the old
  // beside-the-face fin that lay FLAT against the part. A support fin has to stand
  // PERPENDICULAR to the part -- a wall UNDER the overhang, rising off the plate as
  // an upside-down T, gripped along its top by a comb of tines -- the way a human
  // draws one and the way it actually prints. The earlier geometry leaned the wall
  // parallel to the face (planes.js "the fin leans with the part"), which put a
  // 35deg-raked blade flat on a 35deg-tilted cube: wrong, and the reason this was
  // rebuilt.
  //
  // So both the grip mode ('stabilize') and the recommendation ('auto') now
  // deliver prop.js's rib with the tine comb ON. prop.js already sites these
  // correctly: one wall down a curved tube's lowest line, rows across a wide flat
  // overhang, part-attached where a floor sits under the overhang -- all watertight
  // and weld-certified. Tines default ON here (that is what makes it "combined"
  // rather than a plain breakaway prop); 'prop' proper leaves them off. The old
  // leaning-fin machinery (rankSites / chooseSpan / buildFin) was deleted once
  // nothing reached it; git history has it.
  if (mode === 'auto' || mode === 'stabilize') {
    const withTines = opts.tines ?? true;
    // Wide-face coverage (0 sparse .. 1 dense) drives how densely a broad face is
    // lined -- the prop rows (buildProps reads opts.coverage, forwarded below) and
    // the wedge row pitch here. Denser only ADDS supports and never loosens past
    // the structural cap, so dragging it right can't strand an overhang. Pinned by
    // tests/coverage.test.js.
    const coverage = Math.max(0, Math.min(1, opts.coverage ?? FIN.coverDefault));
    const covPitch = coverPitch(coverage);
    const base = buildFinsCore(topo, result, rot, { ...opts, mode: 'prop', tines: withTines });

    // Add ANGLED WEDGES on grippable down-facing patches that NO prop wall
    // reached -- the wide/long leaning face where a vertical wall is blocked by
    // the part itself. "Reached" is decided in SPACE (a prop line under the
    // patch's footprint), not by face-index, because a wall-patch and an overhang
    // region grow from different seeds and don't share a face set. Patches props
    // already serve are left untouched, so the reachable parts don't change.
    const patches = findWallPatches(topo, rot, result.offset);
    const wedgeTris = [];
    const wedgeRecs = [];   // per-wedge records, triRange into wedgeTris (pre-offset)
    let wedgeTines = 0;
    let wedgedPatches = 0;
    for (const p of patches) {
      if (p.n.z >= -0.05) continue;                 // downward faces only
      if (p.area < PERP.minArea || (p.u1 - p.u0) < PERP.minWidth) continue; // broad faces only
      if (propServesPatch(p, base.props)) continue; // a prop already stands under it
      const w = buildPerpFins(p, topo, rot, result.offset, { tines: withTines, pitch: covPitch, tineDensity: opts.tineDensity });
      if (!w.count) continue;
      // Offset each wedge's range from its per-call `out` into the merged
      // wedgeTris array, so the range lands correctly in the final triangles.
      const off = wedgeTris.length;
      for (const v of w.triangles) wedgeTris.push(v);
      for (const wd of w.wedges) {
        wedgeRecs.push({ triRange: [wd.triRange[0] + off, wd.triRange[1] + off],
                         line: wd.line, height: wd.height, span: wd.span });
      }
      wedgeTines += w.tines; wedgedPatches++;
    }
    const wedgeCount = wedgeRecs.length;

    // Unified per-fin array: each entry carries its triangle segment(s) into the
    // final `built.triangles`, so the UI can address and remove an individual fin
    // by its geometry. Prop ranges already index `base.triangles` (the prefix of
    // the merged array); wedge ranges are offset past it by base.triangles.length.
    // base.fins[i] is order-aligned with base.props[i] (it is built from it), so
    // the existing stats fields carry over and only triRanges/id/kind are added.
    const baseLen = base.triangles.length;
    const fins = base.props.map((q, i) => ({
      ...(base.fins[i] ?? {}),                     // existing stats (height/length/tines/...)
      id: q.id ?? i, kind: 'prop',
      triRanges: q.triRanges ?? [],
      line: q.line, span: q.span, height: q.height,
    }));
    let wid = fins.length;
    for (const wd of wedgeRecs) {
      fins.push({
        height: wd.height, length: wd.span, tines: 0, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
        id: wid++, kind: 'wedge',
        triRanges: [[wd.triRange[0] + baseLen, wd.triRange[1] + baseLen]],
        line: wd.line, span: wd.span,
      });
    }
    return {
      ...base, mode,
      triangles: [...base.triangles, ...wedgeTris],
      fins,
      tines: (base.tines ?? 0) + wedgeTines,
      // A tined rib/wedge IS the combined support (a "brace"); a tineless one is a
      // plain prop. Report the split so the stress harness / UI metrics keep working.
      braceCount: withTines ? fins.length : wedgeCount,
      propCount: withTines ? 0 : base.fins.length,
      unserved: wedgedPatches ? unservedAfterWedges(topo, rot, result, base.servedRegions ?? [], wedgeTris)
                              : (base.unserved ?? 0),
    };
  }

  // Prop (and any other mode) is its own support, built by its own module -- a
  // wall UNDER each overhang with no tines.
  const contact = bedContact(topo, result, rot);
  const seating = seatingOf(result, contact.pts);
  const pad = (opts.bedPad ?? true) && result.bedArea < FIN.padMinArea
    ? buildPad(contact.pts, seatedPartTris(topo, rot, result.offset), padOut, opts.layerHeight) : null;
  // A part seated on a POINT gets no props -- nothing standing on the plate
  // can hold a part that never touches it -- UNLESS the bed pad is on, in
  // which case the pad is what seats it and the walls have something to work
  // against. That is not speculation, it is the shelter workflow this whole
  // tool descends from: hub.py's apex hub is a SPHERE-bottomed part with
  // 0.0 mm2 of bed contact, and it printed cleanly as core pad + two webs
  // (tools/shelter/hub.py --supports). The first version of this gate
  // refused it -- the flagship real-world part, the one breakaway.py was
  // written for -- while the readout said "rotate", which is exactly the
  // advice the printed evidence contradicts. Refuse only when the user has
  // turned the pad off.
  const built = seating.kind === 'point' && !pad
    ? noProps() : buildProps(topo, result, rot, opts);
  return {
    triangles: built.triangles, padTriangles: padOut, pad, mode,
    // Carry each prop's triangle range + identity up so per-fin removal can
    // address an individual fin regardless of which mode produced it. The stats
    // fields (height/length/tines/...) are preserved; triRanges/id/kind/line are
    // additive on top of built.props (which already carry them).
    fins: built.props.map((q) => ({
      height: q.height, length: q.span, tines: 0, rows: 0,
      stilt: 0, lean: 0, bearing: 0, site: null,
      id: q.id, kind: q.kind ?? 'prop',
      triRanges: q.triRanges ?? [], line: q.line, span: q.span,
    })),
    props: built.props,
    volume: built.volume,
    // Prop's own reasons, unflattened. These USED to be squashed into the
    // stabilize-shaped object below, which keeps only `blocked` -- so noLine,
    // notALine, stub, degenerate and buried were dropped before anything could
    // read them. M5 was then measured through that channel and recorded as
    // working on parts where it built nothing: hub_post_foot reported
    // `blocked: 0` at 0 degrees when the real reason was `buried: 1`.
    // Whatever explains a failure has to survive the trip to the UI.
    skipped: built.skipped,
    rejected: { blocked: built.skipped.blocked, tooFewTines: 0,
                sites: result.regions.length,
                tried: result.regions.length },
    patchCount: 0, patchStats: {}, tines: built.tines ?? 0,
    servedRegions: built.servedRegions ?? [],
    // regions minus SERVED REGIONS, not minus the prop count: a region can
    // yield several walls now that it is split into sub-patches, and the old
    // subtraction would go negative.
    unserved: result.regions.length - built.served,
    sagRisk: built.sagRisk ?? false,
    seating,
    tip: null,
  };
}
