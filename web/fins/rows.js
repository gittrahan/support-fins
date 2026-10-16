/**
 * ROWS -- long walls along the model's length, laid before the fill pass's patch
 * lines (fins/fill.js, opts.longWalls). Matthew 2026-10-15: a hand-drawn wall "fits
 * along the model so nicely"; the fill pass built a figure a dozen 3-5 mm stubs at
 * five headings, because each line is cut to the stretch under one red patch.
 *
 * A row is a line along `heading` (fins/field.js) at one offset across it and one
 * height hint, spanning all the bare red within R across and ROWS.zBand of that
 * height. One wall the whole length rarely builds on a figure (its own body sits
 * under the line somewhere, without headroom), so each row keeps its LONGEST
 * buildable pieces: the line is bisected until each half builds (or is under
 * 2 x ROWS.minPiece), and neighbouring pieces are re-joined left to right while the
 * join still builds. Every build is Draw's (draw.js drawnWall), tines off while
 * searching.
 *
 * Then greedily, the piece holding the most still-bare red goes in, if it keeps
 * PROP.sideClear off every support (flanges may join on the plate, #196), rebuilt
 * with tines; until no piece holds FILL.minGain. Measured (prototype/fill-rows):
 * Isaac upright, must-hold 76 -> 89%; the fill pass after it takes what rows can't
 * reach (scattered patches: an android zombie's 90% fell to 76% on rows alone).
 */
import { drawnWall } from '../draw.js';
import { reachOf } from './coverage.js';

export const ROWS = {
  step: 1.0,        // mm between rows (across the heading); the greedy pick spaces them
  zStep: 3.0,       // mm between a row's height hints
  zBand: 6.0,       // mm: a row spans the red within this of its height
  minPiece: 3.0,    // mm: a failed piece is bisected while its halves are at least this
  minKeep: 3.0,     // mm: a row piece shorter than this is left to the patch lines (at 6 a small
                    // figure's short rows went: the guardian lion upright held 86 -> 54%)
  maxRows: 160,     // rows searched, heaviest red first
  maxBuilds: 900,   // drawnWall calls while searching (a count, not a clock)...
  fullFaces: 250e3, // ...at up to this many part faces; a denser part gets proportionally fewer
  minBuilds: 150,   // (but never under this many)
};

/**
 * rowWalls({ pts, heading, R, tris, drawOpts, fits, keep, minGain, room }) lays the
 * rows. `pts` the bare red [x, y, z, area]; `fits(r)` -- r keeps clear of every
 * support, its flange joining others on the plate as the patch lines' second pass
 * allows (#196); `keep(r)` adds it (and its tops to the caller's reach set); `room()`
 * -- the caller's wall cap not yet hit. `nFaces` scales the search budget. Plate only
 * rides in drawOpts (drawnWall refuses a row over the part). Returns { walls, builds }.
 */
export function rowWalls({ pts, heading, R, tris, drawOpts, fits, keep, minGain, room, nFaces = 0 }) {
  const ux = Math.cos(heading), uy = Math.sin(heading);
  const acr = (p) => -uy * p[0] + ux * p[1], alo = (p) => ux * p[0] + uy * p[1];
  if (!pts.length) return { walls: 0, builds: 0 };
  const maxBuilds = Math.max(ROWS.minBuilds,
    Math.round(ROWS.maxBuilds * Math.min(1, ROWS.fullFaces / Math.max(1, nFaces))));
  // the points by their offset across the heading, so a row reads only its own band
  const byAcr = pts.map((p) => [acr(p), p]).sort((a, b) => a[0] - b[0]);
  const from = (v) => { let lo = 0, hi = byAcr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (byAcr[m][0] < v) lo = m + 1; else hi = m; } return lo; };
  let zMin = Infinity, zMax = -Infinity;
  for (const p of pts) { zMin = Math.min(zMin, p[2]); zMax = Math.max(zMax, p[2]); }
  const vMin = byAcr[0][0], vMax = byAcr[byAcr.length - 1][0];
  // the rows, heaviest band of red first
  const rows = [];
  for (let v = vMin; v <= vMax + 1e-9; v += ROWS.step) {
    const i0 = from(v - R), i1 = from(v + R + 1e-9);
    for (let h = zMin; h <= zMax + 1e-9; h += ROWS.zStep) {
      let w = 0, t1 = Infinity, t2 = -Infinity;
      for (let i = i0; i < i1; i++) {
        const p = byAcr[i][1];
        if (Math.abs(p[2] - h) > ROWS.zBand) continue;
        w += p[3]; const t = alo(p); t1 = Math.min(t1, t); t2 = Math.max(t2, t);
      }
      if (w > 0 && t2 - t1 >= ROWS.minKeep - 2) rows.push({ v, h, w, t1: t1 - 1, t2: t2 + 1 });
    }
  }
  rows.sort((a, b) => b.w - a.w || a.v - b.v || a.h - b.h);
  const search = { ...drawOpts, tines: false };
  let builds = 0;
  const pieces = [];
  for (const row of rows.slice(0, ROWS.maxRows)) {
    const at = (t) => [ux * t - uy * row.v, uy * t + ux * row.v, row.h];
    const build = (p, q) => {
      if (builds >= maxBuilds) return null;
      builds++;
      const r = drawnWall(at(p), at(q), tris, 0, search);
      return r.ok ? r : null;
    };
    const leaves = [];
    const split = (p, q) => {
      const r = build(p, q);
      if (r) { leaves.push({ p, q, r }); return; }
      if (q - p < 2 * ROWS.minPiece || builds >= maxBuilds) return;
      const m = (p + q) / 2; split(p, m); split(m, q);
    };
    split(row.t1, row.t2);
    let cur = null;
    for (const L of leaves) {
      if (cur && Math.abs(cur.q - L.p) < 1e-9) {
        const r = build(cur.p, L.q);
        if (r) { cur = { p: cur.p, q: L.q, r }; continue; }
      }
      if (cur && cur.q - cur.p >= ROWS.minKeep) pieces.push({ ...cur, a: at(cur.p), b: at(cur.q) });
      cur = L;
    }
    if (cur && cur.q - cur.p >= ROWS.minKeep) pieces.push({ ...cur, a: at(cur.p), b: at(cur.q) });
    if (builds >= maxBuilds) break;
  }
  // each piece's red: the points its top reaches
  for (const c of pieces) {
    const reach = reachOf(c.r.top, R);
    c.serves = [];
    pts.forEach((p, i) => { if (reach(p[0], p[1], p[2])) c.serves.push(i); });
  }
  const held = new Uint8Array(pts.length);
  let walls = 0;
  while (room()) {
    let best = null, bestGain = minGain;
    for (const c of pieces) {
      if (c.done) continue;
      let g = 0;
      for (const i of c.serves) if (!held[i]) g += pts[i][3];
      if (g >= bestGain && (!best || g > bestGain)) { best = c; bestGain = g; }
    }
    if (!best) break;
    best.done = true;
    if (!fits(best.r)) continue;
    // the wall that goes in carries its tines (the search built them off)
    const r = drawOpts.tines ? drawnWall(best.a, best.b, tris, 0, drawOpts) : best.r;
    builds++;
    if (!r.ok || !fits(r)) continue;
    keep(r);
    walls++;
    const reach = reachOf(r.top, R);
    pts.forEach((p, i) => { if (!held[i] && reach(p[0], p[1], p[2])) held[i] = 1; });
  }
  return { walls, builds };
}
