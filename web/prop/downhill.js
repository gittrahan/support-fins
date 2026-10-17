/**
 * Downhill lines (issue #25): walls that run DOWN an overhang and follow it to the
 * plate, the way the reporter drew them -- one from each end of the overhang's top
 * edge and one every maxUnsupportedSpan between, each tracing the surface's steepest
 * descent. On a flat slope that is a straight line (what patchTracks already lays);
 * on a curved one the descent bends, and so does the wall, in plan.
 *
 * Why downhill and not along the region's edges (#125's curve paths): across a wall
 * that runs downhill the surface is level, so its top settles to `gap` and clears
 * the part on both flanks. A wall laid ALONG a 45deg slope has the surface dropping
 * beside its top and fails stationIsClear at every station (measured on the #25
 * fixture: both edge loops and the centre line, 0 walls).
 *
 * Returns tracks in tubeLine's shape -- [x, y, z] stations `step` apart, z the
 * region's surface -- for buildProps's per-line pipeline, or null when the region
 * has no slope to run down (a level ceiling: rows handle it).
 */
import { PROP } from './config.js';
import { surfaceZAt } from './surface.js';

export const DOWNHILL = {
  grid: 1.0,        // mm: the region footprint sampled for its top edge
  h: 0.5,           // mm: central-difference step for the slope
  minSlope: 0.05,   // |grad z| under this is level: no downhill to follow
  inset: 1.0,       // mm: the end seeds sit this far in from the top edge's ends
  join: 3.0,        // mm: a line that comes this close to an earlier one stops (they merge)
  maxSteps: 600,
  maxLines: 60,     // Curved walls' coverage seeds stop at this many lines under one surface
  maxGrow: 1.5,     // a region swaps to downhill walls only if they weigh at most this x its walls...
  race: 0.03,       // ...and hold this share more than they do (raster needs RACE_REL, 10%: the
                    // #25 fixture's curved end is +9.8%, and the weight cap guards the rest)
};

/** Plan gradient of the surface z at (x, y), or null off the region. */
function grad(tris, x, y, h = DOWNHILL.h) {
  const z = surfaceZAt(tris, x, y);
  if (z === null) return null;
  const d = (dx, dy) => {
    const a = surfaceZAt(tris, x - dx, y - dy), b = surfaceZAt(tris, x + dx, y + dy);
    if (a !== null && b !== null) return (b - a) / (2 * h);
    if (b !== null) return (b - z) / h;
    if (a !== null) return (z - a) / h;
    return 0;
  };
  return [d(h, 0), d(0, h), z];
}

/**
 * Downhill tracks under one region. `regionPts` are its seated vertices and face
 * centroids (buildProps's), `regionTris` its seated triangles.
 *
 * `o` (Curved walls on a grown surface, prop/trace.js): `h` the slope's step;
 * `cover`, the [x, y, z] red the lines must cover. With `cover`, each line is
 * trimmed to the stations within `reach` of red (the grown surface runs past it),
 * and red still farther than `reach` from every line seeds a line of its own,
 * highest first, so the lines cover the overhang and the fill pass takes scraps.
 */
export function downhillLines(regionPts, regionTris, step = PROP.stationStep,
                              pitch = PROP.maxUnsupportedSpan, o = {}) {
  const { grid, minSlope, inset, join, maxSteps } = DOWNHILL;
  const h = o.h ?? DOWNHILL.h, cover = o.cover ?? null, reach = o.reach ?? PROP.maxUnsupportedSpan / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of regionPts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }

  // The top edge: footprint samples from which the region ends within `grid` of
  // climbing. The climb is followed in quarter steps, re-aimed each time: one
  // straight step uphill on a CURVED slope (a spiral ramp's underside) cuts across
  // the curve and leaves through the side edges, which then read as the top.
  const leavesUphill = (x, y) => {
    for (let s = 0; s < 4; s++) {
      const g = grad(regionTris, x, y, h);
      if (!g) return true;
      const m = Math.hypot(g[0], g[1]);
      if (m < minSlope) return false;
      x += (g[0] / m) * (grid / 4); y += (g[1] / m) * (grid / 4);
    }
    return surfaceZAt(regionTris, x, y) === null;
  };
  // The top samples' own mean downhill orders them across the slope: on a curved
  // region the whole region's mean is a chord that foreshortens the top edge.
  const top = [];
  let mx = 0, my = 0, sloped = 0, n = 0;
  for (let y = y0 + grid / 2; y < y1; y += grid) {
    for (let x = x0 + grid / 2; x < x1; x += grid) {
      const g = grad(regionTris, x, y, h);
      if (!g) continue;
      n++;
      const m = Math.hypot(g[0], g[1]);
      if (m < minSlope) continue;
      sloped++;
      if (leavesUphill(x, y)) { top.push([x, y]); mx -= g[0] / m; my -= g[1] / m; }
    }
  }
  if (!n || sloped < n / 2 || !top.length) return null;     // mostly level: rows' job
  const mm = Math.hypot(mx, my);
  if (mm < 1e-9) return null;
  const ax = -my / mm, ay = mx / mm;                         // across the slope

  // Seeds: the top edge's two ends (inset) and every `pitch` between, evenly.
  // Rounded to 1e-6 mm, ties broken on rounded x then y: a symmetric part (a tube
  // at X40) puts two top samples exactly as far from a seed target, and float noise
  // must not pick between them (tests/stability.test.js).
  const q6 = (v) => Math.round(v * 1e6) / 1e6;
  const across = top.map((p) => [q6(p[0] * ax + p[1] * ay), p])
    .sort((a, b) => a[0] - b[0] || q6(a[1][0]) - q6(b[1][0]) || q6(a[1][1]) - q6(b[1][1]));
  const uLo = across[0][0] + inset, uHi = across[across.length - 1][0] - inset;
  const nT = uHi <= uLo ? 1 : Math.ceil((uHi - uLo) / pitch) + 1;
  const targets = nT === 1 ? [(uLo + uHi) / 2]
    : Array.from({ length: nT }, (_, i) => uLo + ((uHi - uLo) * i) / (nT - 1));
  const seeds = [];
  for (const u of targets) {
    let best = null, bd = Infinity;
    for (const [v, p] of across) if (q6(Math.abs(v - u)) < bd) { bd = q6(Math.abs(v - u)); best = p; }
    if (best && !seeds.includes(best)) seeds.push(best);
  }

  // Trace each seed down the steepest descent, `step` at a time, until it leaves
  // the region, levels out, turns back, or meets a line already traced.
  // `near`: within `join` of an earlier line, through a plan hash of their stations
  // (a linear scan of every station was O(lines^2 x steps^2) on a wide region)
  const lines = [], cells = new Map(), key = (i, j) => i * 100003 + j;
  const near = (x, y) => {
    const i0 = Math.floor(x / join), j0 = Math.floor(y / join);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const q of cells.get(key(i, j)) ?? []) if (Math.hypot(q[0] - x, q[1] - y) < join) return true;
    }
    return false;
  };
  // plan hash of the red, for the trim and the coverage seeds
  const redCells = new Map(), rkey = (x, y) => key(Math.floor(x / reach), Math.floor(y / reach));
  for (const p of cover ?? []) (redCells.get(rkey(p[0], p[1])) ?? redCells.set(rkey(p[0], p[1]), []).get(rkey(p[0], p[1]))).push(p);
  const nearRed = (x, y) => {
    const i0 = Math.floor(x / reach), j0 = Math.floor(y / reach);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const q of redCells.get(key(i, j)) ?? []) if (Math.hypot(q[0] - x, q[1] - y) <= reach) return true;
    }
    return false;
  };
  const trace = (s) => {
    const line = [];
    let x = s[0], y = s[1], px = 0, py = 0;
    for (let k = 0; k < maxSteps; k++) {
      const g = grad(regionTris, x, y, h);
      if (!g) break;
      const m = Math.hypot(g[0], g[1]);
      if (m < minSlope) break;
      const dx = -g[0] / m, dy = -g[1] / m;
      if (k && dx * px + dy * py < 0) break;                 // a trough: it would turn back
      if (k > 2 && near(x, y)) break;
      line.push([x, y, g[2]]);
      px = dx; py = dy;
      x += dx * step; y += dy * step;
    }
    if (cover) {
      let a = 0, b = line.length;
      while (a < b && !nearRed(line[a][0], line[a][1])) a++;
      while (b > a && !nearRed(line[b - 1][0], line[b - 1][1])) b--;
      line.splice(b); line.splice(0, a);
    }
    if (line.length < PROP.minStations) return null;
    lines.push(line);
    for (const q of line) {
      const k = key(Math.floor(q[0] / join), Math.floor(q[1] / join));
      (cells.get(k) ?? cells.set(k, []).get(k)).push(q);
    }
    return line;
  };
  for (const s of seeds) trace(s);

  // Coverage seeds: the highest red no line reaches starts a line of its own. A
  // seed that traces nothing still counts its own reach as tried, so the loop ends.
  if (cover) {
    const done = new Uint8Array(cover.length), at = new Map();
    cover.forEach((p, i) => { const k = rkey(p[0], p[1]); (at.get(k) ?? at.set(k, []).get(k)).push(i); });
    const reached = (l) => {
      for (const q of l) {
        const i0 = Math.floor(q[0] / reach), j0 = Math.floor(q[1] / reach);
        for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
          for (const c of at.get(key(i, j)) ?? []) {
            if (!done[c] && Math.hypot(q[0] - cover[c][0], q[1] - cover[c][1]) <= reach) done[c] = 1;
          }
        }
      }
    };
    for (const l of lines) reached(l);
    const order = cover.map((_, i) => i).filter((i) => !done[i])
      .sort((a, b) => cover[b][2] - cover[a][2] || cover[a][0] - cover[b][0] || cover[a][1] - cover[b][1]);
    for (const i of order) {
      if (done[i]) continue;
      if (lines.length >= DOWNHILL.maxLines) break;
      reached(trace(cover[i]) ?? [cover[i]]);
    }
  }
  return lines.length ? lines : null;
}
