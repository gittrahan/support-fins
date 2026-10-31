// Hand-placed braces on sides that CURVE up their height (GH #351): the back of an
// arm whose lean changes along its length, convex (leaning further toward the top,
// so the back rolls over) and concave (straightening up). On a flat patch these
// were refused at most spots ("only reaches 20mm up", "the part sticks out"); a
// hand-placed brace now stands on its own strip of the part (web/swaycolumn.js)
// and its inner edge follows the curve.
//   - every spot up the back takes a brace, and the concave one runs full height;
//   - the convex one stops about where the back passes 45 degrees;
//   - the rib stays out of the part, never overhangs past 45, and its tines are short.

import { buildTopology, analyze, insideCount, isClosed, bbox, assert } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const sway = await import(`${WEB}sway.js`);

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LAYER = 0.2;
const LENGTH = 190, THICK = 12, WIDTH = 50;

/** A 12 mm arm, 50 wide, whose lean goes from lean0 at the foot to lean1 at the top
 *  (degrees off vertical, toward -X), on a flat foot. Its back faces +X and up. */
function bentArm(lean0, lean1, n = 60) {
  const r = (d) => (d * Math.PI) / 180;
  const spine = [[0, (THICK / 2) * Math.sin(r(lean0))]];
  const leans = [];
  for (let k = 0; k <= n; k++) leans.push(r(lean0 + ((lean1 - lean0) * k) / n));
  for (let k = 0; k < n; k++) {
    const [x, z] = spine[k];
    spine.push([x - Math.sin(leans[k]) * (LENGTH / n), z + Math.cos(leans[k]) * (LENGTH / n)]);
  }
  const off = (k, sgn) => [spine[k][0] + sgn * Math.cos(leans[k]) * THICK / 2,
                           spine[k][1] + sgn * Math.sin(leans[k]) * THICK / 2];
  const back = spine.map((_, k) => off(k, 1)), front = spine.map((_, k) => off(k, -1));
  // the foot: the back runs on down its own line to the plate, so the base is level
  const [bx, bz] = back[0];
  const footBack = [bx + Math.sin(leans[0]) * bz / Math.cos(leans[0]), 0];
  let ring = [front[0], footBack, ...back, ...front.slice(1).reverse()];
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) ring = ring.reverse();   // counter-clockwise in (x, z): outward is (dz, -dx)

  const tris = [];
  const push = (a, b, c, want) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (nrm[0] * want[0] + nrm[1] * want[1] + nrm[2] * want[2] < 0) tris.push(...a, ...c, ...b);
    else tris.push(...a, ...b, ...c);
  };
  const y0 = -WIDTH / 2, y1 = WIDTH / 2;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const out = [b[1] - a[1], 0, -(b[0] - a[0])];
    const A0 = [a[0], y0, a[1]], B0 = [b[0], y0, b[1]], A1 = [a[0], y1, a[1]], B1 = [b[0], y1, b[1]];
    push(A0, B0, B1, out);
    push(A0, B1, A1, out);
  }
  // the end caps, as the quad strip between back and front (plus the foot's triangle)
  const strips = [[front[0], footBack, back[0]]];
  for (let k = 0; k < n; k++) strips.push([front[k], back[k], back[k + 1]], [front[k], back[k + 1], front[k + 1]]);
  for (const [a, b, c] of strips) {
    push([a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y0, c[1]], [0, -1, 0]);
    push([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [0, 1, 0]);
  }
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: new Float32Array(tris) } : null) });
  const res = analyze(topo, 45, ID);
  /** A click on the back mid-width at height z: the face there and the point. */
  const at = (z) => {
    let best = null;
    const P = topo.pos;
    for (let f = 0; f < topo.nFaces; f++) {
      if (!(topo.nrm[f * 3] > 0.3) || !sway.faceIsUpright(topo, ID, f)) continue;
      const c = [0, 1, 2].map((k) => (P[f * 9 + k] + P[f * 9 + 3 + k] + P[f * 9 + 6 + k]) / 3);
      const pt = [c[0] + res.offset.x, 0 + res.offset.y, c[2] + res.offset.z];
      const d = Math.abs(pt[2] - z);
      if (Math.abs(c[1]) < WIDTH / 2 - 1 && (!best || d < best.d)) best = { f, d, pt };
    }
    return best;
  };
  return { topo, res, at };
}

const CONVEX = [20, 60], CONCAVE = [45, 5];

/** The worst overhang on a brace's surface, in degrees off vertical (its plate-side face aside). */
function worstOverhang(tris) {
  let worst = 0;
  for (let i = 0; i + 3 <= tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    if (Math.max(a[2], b[2], c[2]) < 0.01) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    if (n[2] < 0) worst = Math.max(worst, (Math.asin(Math.min(1, -n[2] / len)) * 180) / Math.PI);
  }
  return worst;
}

Deno.test('sway curved: every spot up a back that curves takes a brace (GH #351)', () => {
  for (const [lean0, lean1] of [CONVEX, CONCAVE]) {
    const { topo, res, at } = bentArm(lean0, lean1);
    for (const z of [30, 50, 70, 90]) {
      const c = at(z);
      for (const full of [true, false]) {
        const r = sway.swayAtFace(topo, res, ID, c.f, c.pt, { tines: true, layerHeight: LAYER, full });
        assert(r.ok, `${lean0}->${lean1} deg arm, click at ${z}mm${full ? ' (full)' : ''}: ${r.reason}`);
        assert(isClosed(r.tris), `${lean0}->${lean1}, ${z}mm: the brace is not closed`);
      }
    }
  }
});

Deno.test('sway curved: a concave back is braced full height, a convex one up to where it passes 45', () => {
  const concave = bentArm(...CONCAVE), cc = concave.at(60);
  const tall = sway.swayAtFace(concave.topo, concave.res, ID, cc.f, cc.pt, { tines: true, layerHeight: LAYER, full: true });
  const top = concave.res.size.z;
  assert(tall.height > top - 10, `the concave back should be braced to near its top (${top.toFixed(0)}), got ${tall.height.toFixed(0)}`);
  assert(tall.tines >= 20, `it should grip all the way up, got ${tall.tines} tines`);

  // the convex back passes 45 degrees (lean 20 + 40 t) at t = 0.625 of its length
  const convex = bentArm(...CONVEX), cv = convex.at(60);
  const r = sway.swayAtFace(convex.topo, convex.res, ID, cv.f, cv.pt, { tines: true, layerHeight: LAYER, full: true });
  let z45 = (THICK / 2) * Math.sin((20 * Math.PI) / 180);
  for (let k = 0; k < 60 * 0.625; k++) z45 += Math.cos(((20 + (40 * k) / 60) * Math.PI) / 180) * (LENGTH / 60);
  assert(Math.abs(r.height - z45) < 12, `the convex brace should stop near ${z45.toFixed(0)}mm, got ${r.height.toFixed(0)}`);
});

Deno.test('sway curved: the brace stays out of the part, never overhangs past 45, and its tines are short', () => {
  for (const [lean0, lean1] of [CONVEX, CONCAVE]) {
    const { topo, res, at } = bentArm(lean0, lean1);
    for (const z of [40, 80]) {
      const c = at(z);
      const opts = { layerHeight: LAYER, full: true, crossAbove: 100 };
      const rib = sway.swayAtFace(topo, res, ID, c.f, c.pt, { ...opts, tines: false });
      assert(rib.ok, `${lean0}->${lean1}, ${z}mm: ${rib.reason}`);
      const inside = insideCount(topo, ID, res.offset, rib.tris.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
      assert(inside === 0, `${lean0}->${lean1}, ${z}mm: ${inside} rib verts are inside the arm`);
      const worst = worstOverhang(rib.tris);
      assert(worst <= 45 + 0.01, `${lean0}->${lean1}, ${z}mm: the brace overhangs ${worst.toFixed(1)} degrees`);
      // every tine is a short bite across the gap, not a bridge: one layer tall, and
      // no longer than the span a tine may cross plus its overlap into the rib and its end
      const r = sway.swayAtFace(topo, res, ID, c.f, c.pt, { ...opts, tines: true });
      let tines = 0;
      for (let i = 0; i + 36 <= r.tris.length; i += 36) {
        const b = bbox(r.tris.slice(i, i + 36));
        if (Math.abs((b.hi[2] - b.lo[2]) - LAYER) > 1e-6) continue;
        tines++;
        const len = b.hi[0] - b.lo[0];   // the back faces +X, so a tine runs along X
        assert(len < sway.SWAY.tineSpanMax + sway.SWAY.tineOverlap + 1, `${lean0}->${lean1}, ${z}mm: a ${len.toFixed(2)}mm tine`);
      }
      assert(tines >= 10, `${lean0}->${lean1}, ${z}mm: only ${tines} tines`);
    }
  }
});
