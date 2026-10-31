// Stabilizers (web/sway.js SWAY.stab, Draw > Stabilizer): a short triangular fin on
// the plate against the base of a side, so a part on a small footprint can't tip over.
// Built on an upside-down L -- a 10 x 10mm column with an arm out the top, the part the
// feature was asked for on -- upright and leaning.
//   - it stands on the plate, is watertight, and stops at the clicked height;
//   - the brace settings shape it: Brace depth (100%: as deep as it is tall), the 60mm
//     cap and Full brace depth, Brace grip from and Brace tine spacing;
//   - the rib never fuses into the part -- only the tines bite in -- and it keeps the
//     gap all the way up a side leaning 10 degrees either way (it follows the slant);
//   - its tines are one layer, on the grid, and in the part;
//   - it refuses a side that doesn't reach the plate, a click too low, and a roof,
//     and one stood on top of another;
//   - it has no cross ribs, and a sway brace at the same spot is still a sway brace.

import { block, buildTopology, analyze, insideCount, isClosed, bbox, assert } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const sway = await import(`${WEB}sway.js`);
const { insidePart } = await import(`${WEB}inside.js`);

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LAYER = 0.2;
const topoOf = (pos) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const opts = (reach = 1, extra = {}) => ({ tines: true, layerHeight: LAYER, gap: 0.2, reach, stabilizer: true, ...extra });

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

/** A stabilizer split into its rib + foot and its tines: buildSwayRib emits the rib and
 *  foot first and the tines after, so the same spot built without tines is the prefix. */
function parts(l, z, o = opts()) {
  const r = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(z), l.y, z], o);
  const bare = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(z), l.y, z], { ...o, tines: false });
  return { r, rib: bare.ok ? bare.tris : [], tines: r.ok && bare.ok ? r.tris.slice(bare.tris.length) : [] };
}
/** Each tine's bounding box: its triangles clustered by height (tines stand millimetres
 *  apart, each one layer tall). */
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

Deno.test('stabilizer: stands on the plate at the base of a side, watertight, to the clicked height', () => {
  const l = L();
  const { r, rib } = parts(l, 20);
  assert(r.ok, `stabilizer refused: ${r.reason}`);
  assert(r.stabilizer === true, 'not marked as a stabilizer');
  assert(Math.abs(r.height - 20) < 1e-6, `height ${r.height}, clicked 20`);
  assert(isClosed(r.tris), 'stabilizer is not closed');
  const b = bbox(rib);
  assert(Math.abs(b.lo[2]) < 1e-6, `its foot starts at z=${b.lo[2]}, not on the plate`);
  assert(Math.abs(b.hi[2] - 20) < 1e-6, `its rib tops out at z=${b.hi[2]}`);
  assert(b.hi[0] < l.sideX(0), 'it stands on the wrong side of the face');
  assert(r.cross === 0, 'a stabilizer grew cross ribs');
});

Deno.test('stabilizer: Brace depth sets its depth at the bed, with a brace’s cap and Full brace depth', () => {
  const l = L();
  const at = (z, reach, extra) => sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(z), l.y, z], opts(reach, extra));
  const near = (r, d) => r.ok && Math.abs(r.depth - d) < 1e-6;
  const full = at(20, 1), half = at(20, 0.5), twice = at(20, 2), dflt = at(20, 0.15);
  assert(near(full, 20), `100% of 20mm: ${full.depth ?? full.reason}`);   // a 45-degree triangle
  assert(near(half, 10) && near(twice, 40), `50%/200%: ${half.depth}, ${twice.depth}`);
  assert(near(dflt, 3), `15% of 20mm: ${dflt.depth}`);
  // every step of the field shows: no brace-sized floor under a short stabilizer
  assert(near(at(20, 0.39), 7.8) && near(at(20, 0.4), 8), 'Brace depth under ~40% is swallowed again');
  assert(near(at(20, 0.05), sway.SWAY.stab.minDepth), `5% stops at the stabilizer minimum: ${at(20, 0.05).depth}`);
  // the 60mm cap a brace has, lifted by Full brace depth
  const tall = at(39, 2), uncapped = at(39, 2, { uncappedDepth: true });
  assert(near(tall, sway.SWAY.maxDepth), `capped: ${tall.depth ?? tall.reason}`);
  assert(near(uncapped, 78), `Full brace depth: ${uncapped.depth ?? uncapped.reason}`);
  // a sway brace at the same spot and depth is the same rib but with its own top
  const brace = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(20), l.y, 20], { tines: true, layerHeight: LAYER, reach: 1 });
  assert(brace.ok && !brace.stabilizer && brace.depth === full.depth, 'the plain brace changed');
});

Deno.test('stabilizer: keeps the gap up a side leaning 10 degrees either way -- it follows the slant', () => {
  for (const lean of [0, 10, -10]) {
    const l = L(lean);
    const { r, rib } = parts(l, 20);
    assert(r.ok, `lean ${lean}: ${r.reason}`);
    // no rib vertex in the part (lifted a hair off the plate, as sway.test.js does)
    const inside = insideCount(l.topo, ID, l.res.offset, rib.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
    assert(inside === 0, `lean ${lean}: ${inside} rib verts inside the part`);
    // the rib's inner edge hugs the side all the way up: in every 5mm band, its nearest
    // vertex stands off the side (at that vertex's own height) by about the gap
    for (const z of [2.5, 7.5, 12.5, 17.5]) {
      const near = rib.filter((v) => Math.abs(v[2] - z) <= 2.5 && Math.abs(v[1] - l.y) < 2);
      assert(near.length, `lean ${lean}: no rib near z=${z}`);
      const gap = Math.min(...near.map((v) => l.sideX(v[2]) - v[0]));
      assert(gap > 0.1 && gap < 0.5, `lean ${lean}: near z=${z} the rib stands ${gap.toFixed(2)}mm off the side`);
    }
  }
});

Deno.test('stabilizer: tines are one layer, on the grid, in the part, spaced and started by the brace settings', () => {
  const l = L();
  const { r, tines } = parts(l, 20, opts(1, { tineSpacing: 2 }));
  assert(r.ok, r.reason);
  const boxes = tineBoxes(tines);
  assert(boxes.length === r.tines && r.tines >= 8, `${boxes.length} boxes for ${r.tines} tines`);
  const zs = boxes.map((b) => b.lo[2]).sort((a, b) => a - b);
  assert(zs[0] < 2, `first tine at ${zs[0]}mm`);
  // Brace tine spacing, each snapped to the layer grid (a gap may run one layer over)
  for (let i = 1; i < zs.length; i++) assert(zs[i] - zs[i - 1] <= 2 + LAYER + 1e-6, `tine gap ${zs[i] - zs[i - 1]}`);
  const sparse = parts(l, 20, opts(1, { tineSpacing: 6 }));
  assert(sparse.r.ok && sparse.r.tines < r.tines, `6mm spacing: ${sparse.r.tines} tines vs ${r.tines} at 2mm`);
  // Brace grip from: no tine below it
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

Deno.test('stabilizer: refuses a side off the plate, a click too low, and a roof', () => {
  // a block on a narrow pedestal: its wide sides start 20mm up
  const a = block(-5, 5, -5, 5, 0, 20), b = block(-20, 20, -15, 15, 20, 60);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a);
  pos.set(b, a.length);
  const topo = topoOf(pos), res = analyze(topo, 45, ID);
  let high = -1;
  for (let f = 0; f < topo.nFaces && high < 0; f++) {
    if (topo.nrm[f * 3 + 1] < -0.9 && topo.pos[f * 9 + 2] >= 20) high = f;   // the upper block's -Y side
  }
  const off = sway.swayAtFace(topo, res, ID, high, [res.offset.x, -15 + res.offset.y, 40], opts());
  assert(!off.ok && /come down to the plate/.test(off.reason), `side off the plate: ${off.ok ? 'built' : off.reason}`);

  const l = L();
  const low = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(3), l.y, 3], opts());
  assert(!low.ok && /too low for a stabilizer/.test(low.reason), `3mm click: ${low.ok ? 'built' : low.reason}`);
  let roof = -1;
  for (let f = 0; f < l.topo.nFaces && roof < 0; f++) if (l.topo.nrm[f * 3 + 2] > 0.9) roof = f;
  assert(!sway.faceIsUpright(l.topo, ID, roof), 'the roof reads as upright');
});

Deno.test('stabilizer: a second one on top of the first is refused, not fused into it', () => {
  const l = L();
  const first = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(20), l.y, 20], opts());
  assert(first.ok, first.reason);
  const onTop = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(20), l.y, 20], opts(), [first]);
  assert(!onTop.ok && /another brace or stabilizer/.test(onTop.reason), `on top: ${onTop.ok ? 'built' : onTop.reason}`);
});

Deno.test('stabilizer: a short one gets its tines at the default 6mm spacing, down to 5mm tall', () => {
  // the 6mm default fits one tine under ~8mm, so the spacing squeezes to fit two
  const l = L();
  for (const z of [5, 6, 7, 8, 10]) {
    const { r, tines } = parts(l, z, opts(1, { tineSpacing: 6 }));
    assert(r.ok, `${z}mm at 6mm spacing: ${r.reason}`);
    assert(r.tines >= sway.SWAY.stab.minTines && tineBoxes(tines).length === r.tines, `${z}mm: ${r.tines} tines`);
  }
  // ...and a tall one keeps the spacing it was given
  const tall = parts(l, 30, opts(1, { tineSpacing: 6 })), zs = tineBoxes(tall.tines).map((b) => b.lo[2]).sort((a, b) => a - b);
  assert(tall.r.ok && zs.length >= 4 && zs[1] - zs[0] > 5.5, `30mm at 6mm spacing: ${zs.map((z) => z.toFixed(1))}`);
});

Deno.test('stabilizer: Brace grip from at or over its top refuses it by name; under its top, starts the tines there', () => {
  const l = L();
  for (const grip of [20, 30, 50]) {
    const r = sway.swayAtFace(l.topo, l.res, ID, l.side, [l.sideX(20), l.y, 20], opts(1, { gripFrom: grip }));
    assert(!r.ok && /Brace grip from is above/.test(r.reason), `grip from ${grip} on a 20mm one: ${r.ok ? 'built' : r.reason}`);
  }
  const { r, tines } = parts(l, 8, opts(1, { gripFrom: 5 }));
  assert(r.ok && r.tines >= 2, `grip from 5 on an 8mm one: ${r.ok ? `${r.tines} tines` : r.reason}`);
  assert(Math.min(...tineBoxes(tines).map((b) => b.lo[2])) >= 5 - LAYER, 'a tine below Brace grip from');
});

Deno.test('stabilizer: a ledge over it shortens it under the ledge, as a brace is, rather than refusing', () => {
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
  // clicked over the ledge: the rib would run through it, so it comes down below it
  const over = sway.swayAtFace(topo, res, ID, side, [x, y, 11.5], opts(2));
  assert(over.ok && over.height < 12 && over.height >= sway.SWAY.stab.minH, `over the ledge: ${over.ok ? over.height : over.reason}`);
});
