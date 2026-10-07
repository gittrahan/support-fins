/**
 * The bed pad: a thin breakaway footprint under a part whose bed contact is
 * too small to hold it. `PAD` holds the style knobs, `buildPad` builds the
 * conforming oval or hands off to `brimPad` (the one-layer brim-style pad cut
 * around `firstLayerOutline`).
 *
 * Split out of fins.js, which re-exports the public names.
 */
import { surfaceZAt } from '../prop.js';
import { FIN } from './config.js';

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
export function buildPad(contact, partTris, out, layerH = FIN.tineH) {
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
    // wound like the tip fans, side wall and bottom (it once ran the other way: the
    // top was inside-out against the rest, and Bambu, reading a broken pad, refused
    // the separate-object 3MF over a G-code path conflict with the part)
    for (let j = 0; j < nT - 1; j++) { tri(A[j], B[j + 1], B[j]); tri(A[j], A[j + 1], B[j + 1]); }
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
