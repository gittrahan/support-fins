/**
 * Fin keys: how a removed Auto fin is found again in a fresh build (ui/remove.js).
 *
 * A removal is remembered by a spatial key, not the build's sequential id, so it
 * survives a rebuild. The key used to be matched EXACTLY, and it held the wall
 * top's z and height -- both measured below the part by the support gap, so
 * changing the gap re-keyed every fin and the removed ones came back (local issue
 * 045). A rebuild mostly moves a fin up or down, a little sideways at most (gap
 * 0.2 -> 0.3: m4 bracket 92/93 fins within 0.05 mm in x/y, the rest within 1 mm),
 * so a key now matches the NEAREST fin of the same kind and bearing within a
 * tolerance. z stays in the key as a tie-break only: two walls stacked at one x/y
 * on different levels are still two fins.
 *
 * Pure (no DOM, no three.js) so tests can run it against real builds.
 */

const XY_TOL = 1.5;     // mm a fin may move sideways and still be the same fin
const Z_TOL = 2;        // mm up or down: a gap step moves a wall top ~0.1-0.2
const BEARING_TOL = 0.15;   // rad

const r1 = (v) => Math.round(v * 10) / 10;   // 0.1 mm

/** The point halfway along a polyline's length (not its middle vertex, which
 *  jumps when the line gains a point). */
function midAlong(line) {
  if (line.length === 1) return line[0];
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    }
    left -= seg;
  }
  return line[line.length - 1];
}

/** A fin record's key: kind, mid-length point, height, bearing. The same text
 *  format as before 045 (kind:x,y,z:height:bearing), so a saved session's or an
 *  undo snapshot's keys still parse. */
export function finKey(r, legacy = false) {
  if (!r || !r.line || !r.line.length) return null;
  // legacy: the middle VERTEX, what keys saved before 045 were taken at
  const m = legacy ? r.line[Math.floor(r.line.length / 2)] : midAlong(r.line);
  const a = r.line[0], b = r.line[r.line.length - 1];
  return `${r.kind ?? 'prop'}:${r1(m[0])},${r1(m[1])},${r1(m[2])}`
       + `:${r1(r.height ?? 0)}:${r1(Math.atan2(b[1] - a[1], b[0] - a[0]))}`;
}

/** Key each record, UNIQUELY: a symmetric part can give two fins one key, and a
 *  shared key would make one removal click drop both. A repeat gets `#n`. */
export function assignKeys(records) {
  const seen = new Map();
  for (const r of records) {
    const base = finKey(r);
    if (base == null) { r.sig = null; continue; }
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    r.sig = n === 0 ? base : `${base}#${n}`;
    r.legacySig = finKey(r, true);   // matched too, so an older session's removals hold
  }
  return records;
}

/** {kind, x, y, z, bearing} from a key, or null. Ignores the `#n` / `~n`
 *  suffixes that keep keys unique. */
export function parseKey(key) {
  const m = /^([^:]+):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+):(-?[\d.]+):(-?[\d.]+)(?:[#~]\d+)*$/.exec(key ?? '');
  return m ? { kind: m[1], x: +m[2], y: +m[3], z: +m[4], bearing: +m[6] } : null;
}

/** Bearing difference of two undirected lines (a rebuild may run a wall the
 *  other way), in [0, pi/2]. */
function bearingGap(a, b) {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/**
 * Match removed keys to a build's records: each key takes the nearest record of
 * its kind and bearing within the tolerances, one record per key, closest pairs
 * first. A key with no fin near it (another pose, or a fin the new build doesn't
 * make) matches nothing and is kept for later.
 * Returns Map record id -> the removed key it matched.
 */
export function matchRemoved(records, removedKeys) {
  const keys = [...removedKeys].map((k) => [k, parseKey(k)]).filter(([, p]) => p);
  const recs = [];
  for (const r of records) for (const s of [r.sig, r.legacySig]) { const q = parseKey(s); if (q) recs.push([r, q]); }
  const pairs = [];
  for (const [k, p] of keys) {
    for (const [r, q] of recs) {
      if (p.kind !== q.kind || bearingGap(p.bearing, q.bearing) > BEARING_TOL) continue;
      const dxy = Math.hypot(p.x - q.x, p.y - q.y), dz = Math.abs(p.z - q.z);
      if (dxy > XY_TOL || dz > Z_TOL) continue;
      pairs.push([Math.hypot(dxy, dz), k, r]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const out = new Map(), used = new Set();
  for (const [, k, r] of pairs) {
    if (used.has(k) || out.has(r.id)) continue;
    used.add(k); out.set(r.id, k);
  }
  return out;
}
