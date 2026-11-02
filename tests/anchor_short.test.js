// Short anchor fins (web/sway.js SWAY.anchor): an anchor placed by hand may be a
// doorstop at the foot of a side, so a part on a small footprint can't tip over.
// Built on an upside-down L -- a 10 x 10mm column with an arm out the top -- upright
// and leaning. The L, and most of these checks, are BorisKozo's (#426, Stabilizer).
//   - it stands on the plate, is watertight, and stops at the clicked height, down to 5mm;
//   - Brace depth reaches 200% for an anchor (a brace stops at 50%), the 60mm cap and
//     Full brace depth still apply, and the 8mm depth floor stops at the anchor's height;
//   - it keeps the gap all the way up a side leaning 10 degrees either way;
//   - its tines are one layer, on the grid, in the part; a short one squeezes its
//     spacing to keep the 3-tine floor, a tall one keeps the spacing it was given;
//   - Brace grip from at or over its top refuses it by name;
//   - a click too low, and one on top of another, are refused; a ledge shortens it;
//   - a sway brace at the same spot is unchanged (20mm floor, 50% depth).

import { block, buildTopology, analyze, insideCount, isClosed, bbox, assert } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const sway = await import(`${WEB}sway.js`);
const { insidePart } = await import(`${WEB}inside.js`);

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LAYER = 0.2;
const topoOf = (pos) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const opts = (reach = 1, extra = {}) => ({ tines: true, layerHeight: LAYER, gap: 0.2, reach, anchor: true, ...extra });

/** The upside-down L: column x 0..10, y 0..10, z 0..40; arm x 10..40, z 35..40. Sheared
 *  so the column leans `lean` degrees toward +x (its outer, -x side tips back). */
function L(lean = 0) {
  const a = block(0, 10, 0, 10, 0, 40), b = block(10, 40, 0, 10, 35, 40);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a);
  pos.set(b, a.length);
  const k = Math.tan((lean * Math.PI) / 180);
  for (let i = 0; i < pos.length; i += 3) pos[i] += k * pos[i + 2];
  const topo = topoOf(pos);
  const res = analyze(topo, 45, ID);
  // the column's outer side, and the print-space x of that side at height z
  let side = -1;
  for (let f = 0; f < topo.nFaces && side < 0; f++) if (topo.nrm[f * 3] < -0.9) side = f;
  return { topo, res, side, k, sideX: (z) => k * z + res.offset.x, y: 5 + res.offset.y };
}

const at = (l, z, o = opts(), avoid) => sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(z), l.y, z], o, avoid);

/** An anchor split into its rib + foot and its tines: buildSwayRib emits the rib and
 *  foot first and the tines after, so the same spot built without tines is the prefix. */
function parts(l, z, o = opts()) {
  const r = at(l, z, o);
  const bare = at(l, z, { ...o, tines: false });
  return { r, rib: bare.ok ? bare.tris : [], tines: r.ok && bare.ok ? r.tris.slice(bare.tris.length) : [] };
}
/** Each tine's bounding box: its triangles clustered by height (each one layer tall). */
function tineBoxes(tris) {
  const t = [];
  for (let i = 0; i < tris.length; i += 3) t.push(tris.slice(i, i + 3));
  t.sort((a, b) => Math.min(...a.map((v) => v[2])) - Math.min(...b.map((v) => v[2])));
  const groups = [];
  for (const tri of t) {
    const lo = Math.min(...tri.map((v) => v[2])), g = groups.at(-1);
    if (g && lo <= g.lo + LAYER + 1e-6) g.tris.push(...tri);
    else groups.push({ lo, tris: [...tri] });
  }
  return groups.map((g) => bbox(g.tris));
}

Deno.test('short anchor: stands on the plate at the foot of a side, watertight, to the clicked height', () => {
  const l = L();
  for (const z of [5, 12, 20]) {
    const { r, rib } = parts(l, z);
    assert(r.ok, `${z}mm anchor refused: ${r.reason}`);
    assert(Math.abs(r.height - z) < 1e-6, `height ${r.height}, clicked ${z}`);
    assert(isClosed(r.tris), `${z}mm anchor is not closed`);
    const b = bbox(rib);
    assert(Math.abs(b.lo[2]) < 1e-6, `${z}mm: its foot starts at z=${b.lo[2]}, not on the plate`);
    assert(Math.abs(b.hi[2] - z) < 1e-6, `${z}mm: its rib tops out at z=${b.hi[2]}`);
    assert(b.hi[0] < l.sideX(0), `${z}mm: it stands on the wrong side of the face`);
  }
});

Deno.test('short anchor: Brace depth runs to 200%, the 60mm cap and Full brace depth hold, the floor stops at its height', () => {
  const l = L();
  const near = (r, d) => r.ok && Math.abs(r.depth - d) < 1e-6;
  const full = at(l, 20, opts(1)), half = at(l, 20, opts(0.5)), twice = at(l, 20, opts(2));
  assert(near(full, 20), `100% of 20mm: ${full.depth ?? full.reason}`);   // a 45-degree triangle
  assert(near(half, 10) && near(twice, 40), `50%/200%: ${half.depth}, ${twice.depth}`);
  assert(near(at(l, 20, opts(5)), 40), 'past 200% is clamped to 200%');
  // a brace's 8mm floor, but never deeper than the anchor is tall
  assert(near(at(l, 20, opts(0.15)), sway.SWAY.minDepth), `15% of 20mm: ${at(l, 20, opts(0.15)).depth}`);
  assert(near(at(l, 6, opts(0.15)), 6), `15% of 6mm: ${at(l, 6, opts(0.15)).depth}`);
  // the 60mm cap a brace has, lifted by Full brace depth
  const tall = at(l, 39, opts(2)), uncapped = at(l, 39, opts(2, { uncappedDepth: true }));
  assert(near(tall, sway.SWAY.maxDepth), `capped: ${tall.depth ?? tall.reason}`);
  assert(near(uncapped, 78), `Full brace depth: ${uncapped.depth ?? uncapped.reason}`);
});

Deno.test('short anchor: a sway brace at the same spot keeps its 20mm floor and 50% depth', () => {
  const l = L();
  const brace = (z, reach) => at(l, z, { tines: true, layerHeight: LAYER, gap: 0.2, reach });
  const b = brace(20, 1);
  assert(b.ok && b.depth === 10, `a brace at 100% stops at 50%: ${b.depth ?? b.reason}`);
  const short = brace(12, 0.5);
  assert(!short.ok && /too low for a brace/.test(short.reason), `a 12mm brace: ${short.ok ? 'built' : short.reason}`);
});

Deno.test('short anchor: keeps the gap up a side leaning 10 degrees either way -- it follows the slant', () => {
  for (const lean of [0, 10, -10]) {
    const l = L(lean);
    const { r, rib } = parts(l, 20);
    assert(r.ok, `lean ${lean}: ${r.reason}`);
    // no rib vertex in the part (lifted a hair off the plate, as sway.test.js does)
    const inside = insideCount(l.topo, ID, l.res.offset, rib.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
    assert(inside === 0, `lean ${lean}: ${inside} rib verts inside the part`);
    // in every 5mm band, the rib's nearest vertex stands off the side by about the gap
    for (const z of [2.5, 7.5, 12.5, 17.5]) {
      const near = rib.filter((v) => Math.abs(v[2] - z) <= 2.5 && Math.abs(v[1] - l.y) < 2);
      assert(near.length, `lean ${lean}: no rib near z=${z}`);
      const gap = Math.min(...near.map((v) => l.sideX(v[2]) - v[0]));
      assert(gap > 0.1 && gap < 0.5, `lean ${lean}: near z=${z} the rib stands ${gap.toFixed(2)}mm off the side`);
    }
  }
});

Deno.test('short anchor: tines are one layer, on the grid, in the part, spaced and started by the brace settings', () => {
  const l = L();
  const { r, tines } = parts(l, 20, opts(1, { tineSpacing: 2 }));
  assert(r.ok, r.reason);
  const boxes = tineBoxes(tines);
  assert(boxes.length === r.tines && r.tines >= 8, `${boxes.length} boxes for ${r.tines} tines`);
  const zs = boxes.map((b) => b.lo[2]).sort((a, b) => a - b);
  assert(zs[0] < 2, `first tine at ${zs[0]}mm`);
  for (let i = 1; i < zs.length; i++) assert(zs[i] - zs[i - 1] <= 2 + LAYER + 1e-6, `tine gap ${zs[i] - zs[i - 1]}`);
  const sparse = parts(l, 20, opts(1, { tineSpacing: 6 }));
  assert(sparse.r.ok && sparse.r.tines < r.tines, `6mm spacing: ${sparse.r.tines} tines vs ${r.tines} at 2mm`);
  const high = parts(l, 20, opts(1, { tineSpacing: 2, gripFrom: 10 }));
  assert(high.r.ok, high.r.reason);
  const lowest = Math.min(...tineBoxes(high.tines).map((b) => b.lo[2]));
  assert(lowest >= 10 - LAYER, `grip from 10mm, first tine at ${lowest}mm`);
  for (const b of boxes) {
    const k = b.lo[2] / LAYER;
    assert(Math.abs(k - Math.round(k)) < 1e-6, `tine at z=${b.lo[2]} is off the layer grid`);
    const zMid = (b.lo[2] + b.hi[2]) / 2;
    const corners = [[b.lo[0], b.lo[1]], [b.lo[0], b.hi[1]], [b.hi[0], b.lo[1]], [b.hi[0], b.hi[1]]];
    assert(corners.some(([x, y]) => insidePart(l.topo, ID, l.res.offset, x, y, zMid)), `tine at z=${zMid} grips nothing`);
  }
});

Deno.test('short anchor: a short one keeps the 3-tine floor at the default 6mm spacing; a tall one keeps its spacing', () => {
  const l = L();
  for (const z of [5, 6, 8, 10, 14]) {
    const { r, tines } = parts(l, z, opts(1, { tineSpacing: 6 }));
    assert(r.ok, `${z}mm at 6mm spacing: ${r.reason}`);
    assert(r.tines >= sway.SWAY.minTines && tineBoxes(tines).length === r.tines, `${z}mm: ${r.tines} tines`);
  }
  const tall = parts(l, 30, opts(1, { tineSpacing: 6 })), zs = tineBoxes(tall.tines).map((b) => b.lo[2]).sort((a, b) => a - b);
  assert(tall.r.ok && zs.length >= 4 && zs[1] - zs[0] > 5.5, `30mm at 6mm spacing: ${zs.map((z) => z.toFixed(1))}`);
});

Deno.test('short anchor: Brace grip from at or over its top refuses it by name; under its top, starts the tines there', () => {
  const l = L();
  for (const grip of [20, 30, 50]) {
    const r = at(l, 20, opts(1, { gripFrom: grip }));
    assert(!r.ok && /Brace grip from is above/.test(r.reason), `grip from ${grip} on a 20mm one: ${r.ok ? 'built' : r.reason}`);
  }
  const { r, tines } = parts(l, 10, opts(1, { gripFrom: 5 }));
  assert(r.ok && r.tines >= sway.SWAY.minTines, `grip from 5 on a 10mm one: ${r.ok ? `${r.tines} tines` : r.reason}`);
  assert(Math.min(...tineBoxes(tines).map((b) => b.lo[2])) >= 5 - LAYER, 'a tine below Brace grip from');
});

Deno.test('short anchor: refuses a click under 5mm, and one on top of another', () => {
  const l = L();
  const low = at(l, 3);
  assert(!low.ok && /too low/.test(low.reason), `3mm click: ${low.ok ? 'built' : low.reason}`);
  const first = at(l, 20);
  assert(first.ok, first.reason);
  const onTop = at(l, 20, opts(), [first]);
  assert(!onTop.ok && /another brace/.test(onTop.reason), `on top: ${onTop.ok ? 'built' : onTop.reason}`);
});

Deno.test('short anchor: a ledge over it shortens it under the ledge rather than refusing', () => {
  // a 10mm column with a 5mm ledge out of its -x side at 12..14mm
  const a = block(0, 10, 0, 10, 0, 40), b = block(-5, 0, 0, 10, 12, 14);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a);
  pos.set(b, a.length);
  const topo = topoOf(pos), res = analyze(topo, 45, ID);
  let side = -1;   // the column's own -x side (x = 0), not the ledge's end
  for (let f = 0; f < topo.nFaces && side < 0; f++) {
    if (topo.nrm[f * 3] < -0.9 && Math.abs(topo.pos[f * 9]) < 1e-6 && topo.pos[f * 9 + 2] < 12) side = f;
  }
  assert(side >= 0, 'test setup: no column side below the ledge');
  const x = res.offset.x, y = 5 + res.offset.y;
  const r = sway.swayAtFace(topo, res, ID, side, [x, y, 10], opts(0.5));
  assert(r.ok && Math.abs(r.height - 10) < 1e-6, `under the ledge: ${r.ok ? r.height : r.reason}`);
  const over = sway.swayAtFace(topo, res, ID, side, [x, y, 11.5], opts(2));
  assert(over.ok && over.height < 12 && over.height >= sway.SWAY.anchor.minH, `over the ledge: ${over.ok ? over.height : over.reason}`);
});
