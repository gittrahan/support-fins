/**
 * GUSSETS -- a breakaway fin that stands off a SIDE of the part instead of the plate.
 *
 * Every other support here hangs straight down from its contact line to whatever is
 * under it: the plate, or a lower piece of the part. Under an upside-down L that is
 * the plate, so the overhang gets a tall wall from the bed even though the L's own
 * upright is right there. A gusset uses the upright: a triangle in the vertical plane
 * square off the side, its inner edge tined to the side at the breakaway gap, its top
 * edge the usual tip under the overhang, and its underside climbing out from the side
 * at GUSSET.angle -- steep enough to print without support of its own, so nothing
 * under it ever reaches the plate.
 *
 *            overhang
 *   ██████████████████████
 *   ██      ▔▔▔▔▔▔▔▔▔▔▔▔ ← tip, PROP.gap under the overhang (tines when Tines is on)
 *   ██≡    ▕          ╱
 *   ██≡    ▕        ╱    ← underside at GUSSET.angle from level
 *   ██≡    ▕      ╱
 *   ██≡    ▕    ╱
 *   ██ ↑   ▕  ╱
 *   ██ tines into the side, one layer tall, at the gap
 *   ██
 *
 * Built from the same pieces as the rest: the body is prop/sweep.js's `sweepBetween`
 * run OUT from the side (its floor line is the sloped underside, so its stations, tip,
 * gap and holes are a part-attached wall's), the top tines are prop/tines.js's comb,
 * and the side tines are sway.js's (kissEnds, one layer, SWAY's widths).
 *
 * Placement is by hand only (Draw > Gusset): a click on the side, then a click on the
 * overhang it should reach. The fin runs square off the side (the clicked face's
 * normal, which the placed gusset keeps); the second click only sets how far it reaches.
 */
import { insidePart, solidClearance } from './inside.js';
import { kissEnds } from './kiss.js';
import { PROP, emitTines, tineStepFor, crestOn, crestPart } from './prop.js';
import { clearBetween, trimmedEnds } from './prop/attached.js';
import { welds } from './prop/clearance.js';
import { surfaceHitsAt } from './prop/surface.js';
import { sweepBetween } from './prop/sweep.js';
import { AnchorContactError } from './prop/anchors.js';
import { loftExtrude } from './solids.js';
import { SWAY } from './sway.js';

export const GUSSET = {
  angle: 50,          // deg from level, the underside's climb: steeper than the 45 a printer holds
  minAngle: 45,       // ...and a setting may not go flatter than this
  minReach: 3,        // mm out from the side: shorter than this is a tine, not a fin
  maxReach: 40,       // mm: past this a gusset is a sail -- stand a wall on the plate
  endDepth: 2,        // mm: the fin's outer end stands this tall under the overhang, not a knife edge
  wallProbe: 0.5,     // mm into the side: where "is the side solid here?" is asked
  wallShare: 0.8,     // ...and how much of the fin's inner edge must have side behind it
  tineSpacing: 2,     // mm between side tines up the inner edge
  maxUpright: 30,     // deg: the clicked face may lean no further than this from upright
};

/** The side's outward normal in part coordinates: `side` is a face index (the click),
 *  or the normal itself, as a placed gusset keeps it -- a reopened session finds faces
 *  by nearest point, and a point on the side's top edge is as near the arm's underside. */
export function sideNormal(topo, side) {
  if (typeof side !== 'number') return side;
  const i = side * 3, n = topo.nrm;
  return [n[i], n[i + 1], n[i + 2]];
}

/** The side's outward normal (`side`: as `sideNormal`), turned to the pose and levelled:
 *  the way the fin runs. Null when it isn't a side (a floor, a roof, or leaning past
 *  GUSSET.maxUpright). */
export function gussetDir(topo, rot, side) {
  const n = sideNormal(topo, side);
  const x = rot[0] * n[0] + rot[3] * n[1] + rot[6] * n[2];
  const y = rot[1] * n[0] + rot[4] * n[1] + rot[7] * n[2];
  const z = rot[2] * n[0] + rot[5] * n[1] + rot[8] * n[2];
  const h = Math.hypot(x, y);
  if (h < 1e-6 || Math.abs(z) > Math.sin((GUSSET.maxUpright * Math.PI) / 180)) return null;
  return [x / h, y / h];
}

/** The underside the fin holds up at (x, y): the lowest down-facing surface above
 *  `zMin`. Null when there is none (open sky over that station). */
function undersideAt(tris, x, y, zMin) {
  let best = null;
  for (const [z, nz] of surfaceHitsAt(tris, x, y)) {
    if (nz < 0 && z > zMin && (best === null || z < best)) best = z;
  }
  return best;
}

/**
 * The gusset off the side at `w` (print space, a point on the side `side`: its face
 * index or its normal, as `sideNormal`) out to the overhang at `o`. `tris`: the part in print space; `opts`: { topo, rot, offset,
 * angle?, tines?, tineDensity?, layerHeight?, supports? } (topo, rot and offset are required:
 * the side and the clearance are checked against the solid). `supports`: the other
 * supports standing, as fins/fill.js's boxGrid, for the gusset to keep PROP.sideClear off.
 *
 * Returns { ok: true, tris, reach, height, tines, sideTines, top, floors } or
 * { ok: false, reason, why, params }: `reason` in English, `why` the same with its
 * numbers as {placeholders} and `params` those numbers, for the UI to translate.
 */
export function gussetAt(w, o, side, tris, opts) {
  const { topo, rot, offset } = opts;
  const dir = gussetDir(topo, rot, side);
  if (!dir) return { ok: false, reason: 'start a gusset on a side of the part — an upright face under the overhang' };
  const [nx, ny] = dir;
  const reach = (o[0] - w[0]) * nx + (o[1] - w[1]) * ny;
  if (reach < GUSSET.minReach) {
    return refused('gusset too short — reaches {reach}mm out from the side, needs {min}mm',
                   { reach: Math.max(0, reach).toFixed(1), min: GUSSET.minReach });
  }
  if (reach > GUSSET.maxReach) {
    return refused('gusset too long — {reach}mm out from the side, at most {max}mm; stand a wall on the plate instead',
                   { reach: reach.toFixed(0), max: GUSSET.maxReach });
  }
  const angle = Math.max(GUSSET.minAngle, Number.isFinite(opts.angle) ? opts.angle : GUSSET.angle);
  const slope = Math.tan((angle * Math.PI) / 180);
  const layerH = opts.layerHeight ?? PROP.tineH;

  // Stations out from the side: the first at sideClear (the inner end stands off the
  // side as a flank must -- `welds` fails one closer than 0.205 -- and the tines bridge
  // it), then every stationStep to the clicked reach.
  const u0 = PROP.sideClear;
  let u1 = reach;
  const n = Math.max(PROP.minStations, Math.ceil((u1 - u0) / PROP.stationStep) + 1);
  const at = (u) => [w[0] + nx * u, w[1] + ny * u];
  let top = [];
  for (let k = 0; k < n; k++) {
    const u = u0 + ((u1 - u0) * k) / (n - 1);
    const [x, y] = at(u);
    const z = undersideAt(tris, x, y, w[2]);
    if (z === null) return { ok: false, reason: 'nothing overhangs there — the gusset has to run out under the overhang' };
    top.push([x, y, z]);
  }

  // The underside: up from the inner end at `slope` to GUSSET.endDepth under the outer
  // tip. A station whose underside would sink under the plate stands on it instead
  // (sweepBetween's floor of 0): a fin that long off a side that low is half a wall.
  const zEnd = top[n - 1][2] - PROP.gap - Math.max(GUSSET.endDepth, PROP.minHeight + PROP.footGap + 0.1);
  let floors = top.map((p, k) => {
    const u = u0 + ((u1 - u0) * k) / (n - 1);
    const z = zEnd - (u1 - u) * slope;
    return [p[0], p[1], z < 0.5 ? 0 : z];
  });

  // The body keeps clear of the part the way a drawn part wall does (draw.js): its ends
  // trimmed while clearBetween refuses them (trimmedEnds), then every station kept
  // checked. The outer end may come in -- a lip hanging off the overhang shortens the
  // reach -- but the inner end is what the side tines hold, so it may not move.
  const keep = trimmedEnds(top, floors, topo, rot, offset);
  if (!keep || keep[0] > 0) return intoPart();
  if (keep[1] < n) {
    top = top.slice(0, keep[1]);
    floors = floors.slice(0, keep[1]);
    u1 = u0 + ((u1 - u0) * (keep[1] - 1)) / (n - 1);
    if (u1 < GUSSET.minReach) return intoPart();
  }
  for (let k = 1; k < top.length - 1; k++) {
    if (!clearBetween(top, floors, k, topo, rot, offset)) return intoPart();
  }

  // The side has to be there behind the inner edge, all the way down it: an L whose
  // upright stops short (or a click past the side's end) leaves the fin hanging.
  const zLo = floors[0][2] + PROP.footGap, zHi = top[0][2] - PROP.gap;
  const [bx, by] = at(-GUSSET.wallProbe);
  let behind = 0, asked = 0;
  for (let z = zLo + 0.25; z < zHi - 0.25; z += 0.5) {
    asked++;
    if (insidePart(topo, rot, offset, bx, by, z)) behind++;
  }
  // ...and right at the bottom: the fin's lowest layer is its first, and only a tine
  // into the side there keeps it from printing in air (`sideTineLevels`)
  const zFirst = Math.floor(zLo / layerH) * layerH;
  if (!asked || behind < GUSSET.wallShare * asked
      || !insidePart(topo, rot, offset, bx, by, zFirst + layerH / 2)) {
    return refused('the side doesn’t run far enough down for a gusset this long at {angle}° — reach less far, or start it lower on the side',
                   { angle });
  }

  const out = [];
  if (crestOn()) crestPart(tris, layerH);
  try {
    if (!sweepBetween(top, floors, out, PROP.minHeightSquat, null, tris)) {
      return { ok: false, reason: 'too little room under the overhang there for a gusset' };
    }
  } catch (e) {
    if (!(e instanceof AnchorContactError)) throw e;
    return { ok: false, reason: e.message };
  }
  // ...and then the swept body is MEASURED against the whole part, as Auto's walls are
  // (prop.js): the stations above are a mm apart, and a rib thinner than that between
  // two of them is seen only by the solid's own triangles (solidClearance).
  const hit = solidClearance(topo, rot, offset, out, 0.25);
  if (hit && welds(hit)) return intoPart();
  let height = 0;
  for (let k = 0; k < top.length; k++) height = Math.max(height, top[k][2] - PROP.gap - floors[k][2]);

  // Side tines: one layer each up the inner edge, from just inside the fin's end
  // across the gap into the side (sway.js's tine, kissed). Always built, Tines on or
  // off: the side is all that holds a gusset up until the overhang prints over it.
  // The first sits in the fin's very first layer and the last in its top layer, so
  // neither end of the inner edge starts or finishes in air.
  const tw = SWAY.tineW / 2;
  const ox = w[0] + nx * u0, oy = w[1] + ny * u0, ax = -nx, ay = -ny;
  let sideTines = 0;
  for (const bot of sideTineLevels(zLo, zHi, layerH)) {
    const tp = bot + layerH;
    const e = kissEnds(topo, rot, offset, ox, oy, ax, ay, bot, tp,
                       { half: tw, back: SWAY.tineOverlap, reach: u0 + SWAY.tineReach });
    if (Math.max(...e.bot, ...e.top) > u0 + SWAY.tineSpanMax) continue;   // a bridge, not a tine
    const P = (a, b, zz) => [ox + ax * a - ay * b, oy + ay * a + ax * b, zz];
    const outline = (h) => [[-SWAY.tineOverlap, -tw], [e[h][0], -tw], [e[h][1], tw], [-SWAY.tineOverlap, tw]];
    const local = [];
    loftExtrude(outline('bot'), outline('top'), bot, tp, P, local);
    pushOutward(local, out);
    sideTines++;
  }
  // Top tines: the comb every drawn wall gets along its contact line, when Tines is
  // on. Horizontal tines bite sideways, so a sloped underside takes them and a flat
  // one doesn't (FIN-SPEC, why the tines must be horizontal).
  const tines = opts.tines
    ? emitTines(top, tris, topo, rot, offset, out, tineStepFor(opts.tineDensity ?? 1), undefined, layerH)
    : 0;
  // Last, the other supports: one standing within sideClear -- an Auto wall under the
  // same arm, a brace on the same side, a wall or gusset placed before -- would fuse
  // with this one into a piece that doesn't break away (the list drawn walls' ribs keep
  // clear of, ui/walls.js).
  if (opts.supports?.hits(out, PROP.sideClear)) {
    return { ok: false, reason: 'the gusset would fuse with a support already standing there — place it clear of that support' };
  }

  return { ok: true, tris: out, reach: u1, height, angle, tines, sideTines, top, floors: floors.map((f) => f[2]) };
}

/** The body would cut into the part (or weld to it), wherever it was found. */
function intoPart() {
  return { ok: false, reason: 'the gusset runs into the part — start it where the side is flat and clear out to the overhang' };
}

/**
 * The layer cells (their bottoms) the side tines sit in, for an inner edge running
 * from `zLo` (the fin's lowest point) to `zHi` (its top, under the gap): the cell
 * holding zLo, the last whole cell under zHi, and as many evenly between as keep
 * them no more than GUSSET.tineSpacing apart.
 */
export function sideTineLevels(zLo, zHi, layerH) {
  const first = Math.floor(zLo / layerH + 1e-9);
  const last = Math.floor(zHi / layerH + 1e-9) - 1;
  if (last <= first) return [first * layerH];
  const gaps = Math.ceil(((last - first) * layerH) / GUSSET.tineSpacing - 1e-9);
  const cells = new Set();
  for (let i = 0; i <= gaps; i++) cells.add(Math.round(first + ((last - first) * i) / gaps));
  return [...cells].sort((a, b) => a - b).map((c) => c * layerH);
}

/** A refusal whose reason carries numbers: `why` with them filled in as `reason`. */
function refused(why, params) {
  const reason = why.replace(/{(\w+)}/g, (_, k) => String(params[k]));
  return { ok: false, reason, why, params };
}

/** Append a closed solid wound outward (positive volume), flipping it if not. */
function pushOutward(local, out) {
  let V = 0;
  for (let i = 0; i < local.length; i += 3) {
    const a = local[i], b = local[i + 1], c = local[i + 2];
    V += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
       + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (V < 0) for (let i = 0; i < local.length; i += 3) out.push(local[i], local[i + 2], local[i + 1]);
  else for (const v of local) out.push(v);
}
