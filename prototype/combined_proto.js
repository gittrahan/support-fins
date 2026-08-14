/**
 * PROTOTYPE (render-and-look): the "combined support" Matthew wants -- a thin
 * wall that follows a sloped OVERHANG face 0.2mm off, with horizontal tines
 * fusing it to the part. This is the wall+tines core of fins.js buildFin, but
 * gate-free and driven off the overhang faces directly, so I can SEE the shape
 * on a tilted part before wiring it into the tool. Not shipping code.
 */
import { findWallPatches, patchPoint, tAtZ, zAt, patchProbe } from '../web/planes.js';

const F = {
  gap: 0.2, th: 1.2, tineH: 0.3, tineW: 0.5, baseH: 1.0,
  tineBite: 0.3, tineGrip: 0.4, tineSpanMax: 1.5, tineSpacingU: 14,
  rowsLow: 8, rowGapMin: 0.8, denseZone: 6, rowGrowth: 1.6,
  baseMinor: 9.0, basePad: 3.0, arcSegs: 8, ellipseSegs: 40,
};

function extrude(poly, tLo, tHi, P, out) {
  const n = poly.length;
  const lo = poly.map(([a, b]) => P(a, b, tLo));
  const hi = poly.map(([a, b]) => P(a, b, tHi));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(lo[i], lo[j], hi[j]); out.push(lo[i], hi[j], hi[i]);
  }
  for (let i = 1; i < n - 1; i++) {
    out.push(hi[0], hi[i], hi[i + 1]); out.push(lo[0], lo[i + 1], lo[i]);
  }
}

/** Build a gate-free combined support against `p`. `span` = {u0,u1} places a
 *  narrow fin on part of the face (an edge/corner); default spans the whole face. */
export function buildCombined(p, topo, rot, offset, span = null) {
  const out = [];
  const r = F.th / 2, wIn = F.gap, wOut = F.gap + F.th;
  const u0 = span ? span.u0 : p.u0, u1 = span ? span.u1 : p.u1;
  const tBedIn = tAtZ(p, wIn, 0), tBedOut = tAtZ(p, wOut, 0);
  const tTop = p.t1;
  if (tTop - r <= Math.max(tBedIn, tBedOut) + 0.5) return { out, tines: 0, note: 'no wall' };

  // wall section in (t, w), extruded along u
  const sec = [[tBedIn, wIn], [tTop - r, wIn]];
  for (let i = 1; i < F.arcSegs; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / F.arcSegs;
    sec.push([tTop - r + r * Math.cos(a), F.gap + r + r * Math.sin(a)]);
  }
  sec.push([tTop - r, wOut], [tBedOut, wOut]);
  extrude(sec, u0, u1, (a, b, t) => patchPoint(p, b, t, a), out);

  // base ellipse on the plate, tangent to the wall's inner face
  const nhx = p.n.x / p.h, nhy = p.n.y / p.h;
  const foot = patchPoint(p, wIn, (u0 + u1) / 2, tBedIn);
  const bw = F.baseMinor / 2, bu = (u1 - u0) / 2 + F.basePad;
  const cx = foot[0] + nhx * bw, cy = foot[1] + nhy * bw;
  const ell = [];
  for (let i = 0; i < F.ellipseSegs; i++) {
    const a = (2 * Math.PI * i) / F.ellipseSegs;
    const s = bw * Math.cos(a), t = bu * Math.sin(a);
    ell.push([cx + nhx * s + p.u.x * t, cy + nhy * s + p.u.y * t]);
  }
  extrude(ell, 0, F.baseH, (a, b, t) => [a, b, t], out);

  // horizontal tines, in world axes so each lands in one layer
  const zTop = zAt(p, F.gap + r, tTop);
  const zLo = Math.max(p.z0, F.baseH) + 0.4;
  const zHi = Math.min(zAt(p, 0, tTop), zTop) - F.tineH - 0.5;
  const rows = [];
  if (zHi > zLo) {
    const dense = Math.min(zHi - zLo, F.denseZone);
    let step = Math.max(F.rowGapMin, dense / F.rowsLow);
    for (let z = zLo; z <= zHi; z += step) { rows.push(z); if (z > zLo + dense) step *= F.rowGrowth; }
  }
  const inset = Math.min(F.tineW, (u1 - u0) / 4);
  const sA = u0 + inset, sB = u1 - inset;
  const nU = sB > sA ? Math.max(2, Math.ceil((sB - sA) / F.tineSpacingU) + 1) : 1;
  let tines = 0;
  for (const z of rows) {
    const zMid = z + F.tineH / 2;
    const s1 = (p.d + F.gap + F.tineGrip - p.n.z * zMid) / p.h;
    for (let i = 0; i < nU; i++) {
      const uv = nU === 1 ? (sA + sB) / 2 : sA + ((sB - sA) * i) / (nU - 1);
      let raw = patchProbe(p, uv, tAtZ(p, 0, zMid));
      if (raw === null) continue;
      const refined = patchProbe(p, uv, tAtZ(p, raw, zMid));
      if (refined !== null) raw = refined;
      const dev = raw;
      if (F.gap - dev > F.tineSpanMax) continue;
      const sPart = (p.d + dev - p.n.z * zMid) / p.h;
      const s0 = sPart - F.tineBite / p.h;
      const rect = [[z, s0], [z + F.tineH, s0], [z + F.tineH, s1], [z, s1]];
      extrude(rect, uv - F.tineW / 2, uv + F.tineW / 2,
              (a, b, t) => [nhx * b + p.u.x * t, nhy * b + p.u.y * t, a], out);
      tines++;
    }
  }
  return { out, tines, note: `${rows.length} rows` };
}
