/**
 * Angled wedges: the perpendicular rib auto stands under a broad downward face
 * no prop wall reached. `buildPerpFins` tiles wedges along a patch
 * (`perpColumns` picks the stations, `emitFoot` the plate foot), `gripPatches`
 * lists the faces a wedge can stand under, `propServesPatch` skips faces a prop
 * already holds, and `unservedAfterWedges` / `bareAfterWedges` recount what is still red.
 *
 * Split out of fins.js, which re-exports the public names.
 */
import { cutWall } from '../cutout.js';
import { findWallPatches, patchPoint, patchProbe, zAt } from '../planes.js';
import { emitTines, PROP, surfaceZAt, tineStepFor } from '../prop.js';
import { seatedPartTris } from './seating.js';

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
export const PERP = {
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
 * The wedge's blade, with the Cutouts pattern through it when one is picked.
 *
 * A cube stood on its edge at 45deg is held by wedges, not prop walls, so a
 * wedge that only ever extruded solid left Cutouts doing nothing there. The
 * blade is a flat-topped section per contact station handed to cutWall, the same
 * as a prop wall's: the top band keeps the contact and the tines solid, the
 * bottom band sits over the foot flange, and cutWall's end posts hold the two
 * ends. When cutWall declines (pattern off, too small to be worth it) the blade
 * is the solid extrusion it always was.
 */
const CUT_TOP = 0.05;
function emitBlade(top, ring, uDir, half, out) {
  const st = [], full = [];
  for (let i = 0; i < top.length; i++) {
    const a = top[Math.max(0, i - 1)], b = top[Math.min(top.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) { st.length = 0; break; }   // a vertical step: no (s, z) plane to cut in
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;                    // across the blade, as prop/sweep.js
    const p = top[i], z = p[2];
    const P = (o, zz) => [p[0] + sx * o, p[1] + sy * o, zz];
    full.push([P(+half, 0), P(+half, z), P(-half, z), P(-half, 0)]);
    // the blade's top is flat, not a tip: ztip a hair under it keeps the top
    // band's section free of repeated corners
    st.push({ p, sx, sy, top: z, ztip: z - CUT_TOP, bot: 0, botTip: PERP.footH, taperBot: false });
  }
  if (st.length && cutWall(st, full, out, { th: PERP.th, tip: PERP.th, minStations: 3 })) return;
  extrudeRing(ring, uDir, half, out);
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
 * fin lands as two fins FLANKING the bore instead of one column dying at the void.
 * (The bore's own ceiling is a separate overhang; a part-attached wall serves it.)
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
export function buildPerpFins(p, topo, rot, offset, opts = {}) {
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
    emitBlade(top, ring, uDir, half, out);
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
export function propServesPatch(p, props) {
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
 * The veto buildProps applies to raster walls (web/prop/raster.js) in auto mode:
 * a raster wall may not stand under a patch the normal pass's walls leave to a
 * WEDGE, because the wedge's tines grip from the bed. bore_bracket X45: a raster
 * wall under the leaning face dropped its wedge and the part's lowest grip rose
 * 1.2 -> 22.9 mm. Only patches where a wedge actually builds count -- a veto on
 * every broad down-facing patch also refused the dome and bowl their raster walls.
 * `patches` = the wedge candidates (down-facing, broad), as buildFins filters
 * them; `wedgeOpts` = buildPerpFins's options there.
 */
export function wedgeVeto(patches, topo, rot, offset, wedgeOpts) {
  let seen = null, open = [];
  return (q, normalProps) => {
    if (normalProps !== seen) {          // once per build: the patches left to wedges
      seen = normalProps;
      open = patches.filter((p) => !propServesPatch(p, normalProps)
                                && buildPerpFins(p, topo, rot, offset, wedgeOpts).count > 0);
    }
    return open.some((p) => propServesPatch(p, [q]));
  };
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
export function unservedAfterWedges(topo, rot, result, servedRegions, wedgeTris) {
  return bareAfterWedges(topo, rot, result, servedRegions, wedgeTris).length;
}

/** The regions unservedAfterWedges counts, as indices into result.regions. */
export function bareAfterWedges(topo, rot, result, servedRegions, wedgeTris) {
  const { pos } = topo, o = result.offset, served = new Set(servedRegions);
  const span2 = PROP.maxUnsupportedSpan * PROP.maxUnsupportedSpan;
  const bare = [];
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
    bare.push(i);
  });
  return bare;
}
