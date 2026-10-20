// Sway braces (web/sway.js): buttress ribs that keep a TALL part from drifting or
// wobbling as it grows. Built on plain blocks so they run without the stress models.
//   - a tall part gets braces on its sides, and they are watertight;
//   - the rib never fuses into the part -- only the tines bite in;
//   - every tine is one layer tall, on the layer grid, and actually in the part;
//   - the tines run all the way up (the sway is at the top), not just near the bed;
//   - "Brace grip from" keeps tines below that height off;
//   - a short part gets none, and says why;
//   - Draw's one-click brace works on an upright side and refuses a roof;
//   - off by default: buildFins without the option is unchanged.

import { block, blockTopo, tiltedBlockTopo, buildTopology, analyze, fins, insideCount, isClosed, bbox, assert } from './_util.js';

const topoOf = (pos) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });

const WEB = new URL('../web/', import.meta.url).href;
const sway = await import(`${WEB}sway.js`);
const { insidePart } = await import(`${WEB}inside.js`);

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LAYER = 0.2;

/** A 40 x 30 x 150mm post -- tall and slender, the case sway braces exist for. */
function post(h = 150) {
  const topo = blockTopo(-20, 20, -15, 15, 0, h);
  const res = analyze(topo, 45, ID);
  return { topo, res };
}

/** Split a triangle soup into its closed solids' tine boxes: 12-triangle prisms
 *  exactly one layer tall. (Ribs and feet are taller or wider; tines are neither.) */
function tineBoxes(tris) {
  const boxes = [];
  for (let i = 0; i + 36 <= tris.length; i += 36) {
    const b = bbox(tris.slice(i, i + 36));
    if (Math.abs((b.hi[2] - b.lo[2]) - LAYER) < 1e-6) boxes.push(b);
  }
  return boxes;
}

Deno.test('sway: a tall post gets watertight braces on its sides', () => {
  const { topo, res } = post();
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER });
  assert(s.count >= 2, `expected braces on a 150mm post, got ${s.count} (${s.reason})`);
  assert(isClosed(s.triangles), 'sway brace geometry is not closed');
});

Deno.test('sway: the rib never fuses into the part -- only tines bite in', () => {
  const { topo, res } = post();
  const s = sway.buildSwayBraces(topo, res, ID, { tines: false, layerHeight: LAYER });
  assert(s.count >= 2, 'no braces to check');
  // Lifted a hair off the plate: exactly at z = 0 the parity ray runs along the
  // block's bottom edge and counts a crossing, so a foot corner 22mm clear of the
  // part reads as "inside". 0.001mm is far below any real overlap.
  const inside = insideCount(topo, ID, res.offset,
    s.triangles.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
  assert(inside === 0, `${inside} rib verts are inside the part (it should stand off by the gap)`);
});

Deno.test('sway: every tine is one layer, on the grid, and bites into the part', () => {
  const { topo, res } = post();
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER });
  const boxes = tineBoxes(s.triangles);
  assert(boxes.length === s.tines, `found ${boxes.length} one-layer boxes for ${s.tines} tines`);
  for (const b of boxes) {
    const k = b.lo[2] / LAYER;
    assert(Math.abs(k - Math.round(k)) < 1e-6, `tine at z=${b.lo[2]} is off the layer grid`);
    // at least one corner of the box is in solid part -- it grips, not air
    const zMid = (b.lo[2] + b.hi[2]) / 2;
    const corners = [[b.lo[0], b.lo[1]], [b.lo[0], b.hi[1]], [b.hi[0], b.lo[1]], [b.hi[0], b.hi[1]]];
    assert(corners.some(([x, y]) => insidePart(topo, ID, res.offset, x, y, zMid)),
           `tine at z=${zMid.toFixed(2)} grips nothing`);
  }
});

Deno.test('sway: tines run all the way up, evenly -- the sway is at the top', () => {
  const H = 150;
  const { topo, res } = post(H);
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER, tineSpacing: 6 });
  const zs = tineBoxes(s.triangles).map((b) => b.lo[2]);
  assert(Math.max(...zs) > 0.9 * H, `highest tine at ${Math.max(...zs).toFixed(1)}mm on a ${H}mm post`);
  // per rib the gaps are the requested spacing (to a layer), never spreading out
  const byRib = new Map();
  for (const b of tineBoxes(s.triangles)) {
    const key = `${Math.round(b.lo[0])},${Math.round(b.lo[1])}`;
    if (!byRib.has(key)) byRib.set(key, []);
    byRib.get(key).push(b.lo[2]);
  }
  for (const list of byRib.values()) {
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i] - list[i - 1];
      assert(Math.abs(gap - 6) <= LAYER + 1e-6, `tine gap ${gap.toFixed(2)}mm, asked for 6`);
    }
  }
});

Deno.test('sway: "grip from" keeps tines off below that height', () => {
  const { topo, res } = post();
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER, gripFrom: 80 });
  const zs = tineBoxes(s.triangles).map((b) => b.lo[2]);
  assert(zs.length > 0, 'no tines at all');
  assert(Math.min(...zs) >= 80 - LAYER, `a tine at ${Math.min(...zs).toFixed(1)}mm, below the 80mm start`);
});

Deno.test('sway: a short part gets no braces, and says why', () => {
  const { topo, res } = post(20);
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER });
  assert(s.count === 0, `a 20mm block got ${s.count} braces`);
  assert(typeof s.reason === 'string' && s.reason.length > 0, 'no reason given');
});

Deno.test('sway: Draw stands a brace on an upright side, and refuses the roof', () => {
  const { topo, res } = post();
  let side = -1, roof = -1;
  for (let f = 0; f < topo.nFaces; f++) {
    const nz = topo.nrm[f * 3 + 2], ny = topo.nrm[f * 3 + 1];
    if (side < 0 && ny < -0.9) side = f;         // the -Y side
    if (roof < 0 && nz > 0.9) roof = f;
  }
  assert(sway.faceIsUpright(topo, ID, side), 'the side should read as upright');
  assert(!sway.faceIsUpright(topo, ID, roof), 'the roof should not read as upright');
  const r = sway.swayAtFace(topo, res, ID, side, [0, -15, 60], { tines: true, layerHeight: LAYER });
  assert(r.ok, `hand brace failed: ${r.reason}`);
  assert(Math.abs(r.height - 60) < 1e-6, `hand brace exceeds or misses the clicked height: ${r.height}`);
  assert(isClosed(r.tris), 'hand brace is not closed');
});

Deno.test('sway: off by default -- buildFins without the option adds none', () => {
  const { topo, res } = post();
  const plain = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true });
  assert(plain.sway === undefined, 'buildFins reported sway braces nobody asked for');
  const withSway = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true,
                                                   layerHeight: LAYER, sway: { on: true } });
  assert(withSway.sway.count >= 2, 'sway: { on: true } placed no braces');
  assert(withSway.triangles.length > plain.triangles.length, 'sway braces were not added to the output');
});

Deno.test('sway: a brace facing another across a channel is refused, a staggered one is not', () => {
  // Two 150mm walls with a 40mm channel between them. A 150mm brace reaches
  // ~22mm out at the bed, so two braces straight across from each other meet.
  const a = block(-40, 40, -30, -20, 0, 150), b = block(-40, 40, 20, 30, 0, 150);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a, 0); pos.set(b, a.length);
  const topo = topoOf(pos);
  const res = analyze(topo, 45, ID);
  const faceFacing = (ny, y) => {
    for (let f = 0; f < topo.nFaces; f++) {
      if (topo.nrm[f * 3 + 1] * ny > 0.9 && Math.abs(topo.pos[f * 9 + 1] - y) < 1e-3) return f;
    }
    return -1;
  };
  const inA = faceFacing(1, -20), inB = faceFacing(-1, 20);   // the two channel walls
  const opts = { tines: true, layerHeight: LAYER };
  const first = sway.swayAtFace(topo, res, ID, inA, [0, -20, 150], opts);
  assert(first.ok, `first brace failed: ${first.reason}`);
  const across = sway.swayAtFace(topo, res, ID, inB, [0, 20, 150], opts, [first]);
  assert(!across.ok && /run into another brace/.test(across.reason),
         `a brace straight across the channel was not refused (${across.ok ? 'built' : across.reason})`);
  const staggered = sway.swayAtFace(topo, res, ID, inB, [20, 20, 150], opts, [first]);
  assert(staggered.ok, `a staggered brace was refused: ${staggered.reason}`);
  assert(!sway.swayClashes(staggered, [first]), 'the staggered brace still reads as clashing');
});

Deno.test('sway: auto never stands two braces into each other', () => {
  const a = block(-40, 40, -30, -20, 0, 150), b = block(-40, 40, 20, 30, 0, 150);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a, 0); pos.set(b, a.length);
  const topo = topoOf(pos);
  const res = analyze(topo, 45, ID);
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER });
  assert(s.count >= 2, `expected braces, got ${s.count}`);
  assert(isClosed(s.triangles), 'not closed');
});

Deno.test('sway: auto braces carry fin records, so the per-fin filter keeps them', () => {
  // The Auto view draws and exports only triangles some built.fins record claims
  // (per-fin removal). A brace appended without a record vanished from both.
  const { topo, res } = post(150);
  const b = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true,
    layerHeight: LAYER, sway: { on: true } });
  const recs = b.fins.filter((f) => f.kind === 'sway');
  assert(recs.length === b.sway.count && recs.length > 0, `${recs.length} sway records for ${b.sway.count} braces`);
  const claimed = new Set();
  for (const f of b.fins) for (const [lo, hi] of f.triRanges) for (let t = lo; t < hi; t++) claimed.add(t);
  assert(claimed.size === b.triangles.length, `${b.triangles.length - claimed.size} vertices claimed by no fin`);
  assert(new Set(b.fins.map((f) => f.id)).size === b.fins.length, 'fin ids collide');
});

Deno.test('sway: a part too short to brace builds without throwing', () => {
  // buildSwayBraces returns early here, and the caller maps over `ribs` to make
  // its per-fin records -- so an early return with no `ribs` threw instead of
  // quietly placing nothing.
  const { topo, res } = post(20);
  const built = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true,
                                                layerHeight: LAYER, sway: { on: true } });
  assert(built.sway.count === 0, `a 20mm part got ${built.sway.count} braces`);
  assert(typeof built.sway.reason === 'string', 'no reason given');
});

Deno.test('sway: a brace never lands on a support that is already there', () => {
  const { topo, res } = post();
  const partTris = (() => {
    const a = [];
    for (let f = 0; f < topo.nFaces; f++) {
      for (let i = 0; i < 3; i++) {
        const o = f * 9 + i * 3;
        a.push([topo.pos[o] + res.offset.x, topo.pos[o + 1] + res.offset.y, topo.pos[o + 2] + res.offset.z]);
      }
    }
    return a;
  })();
  assert(partTris.length > 0, 'no part triangles');

  // Stand one brace by hand, then lay a "wall" (a prop's centreline) right along
  // its foot: a second brace there has to be refused, not fused to it.
  const opts = { tines: true, layerHeight: LAYER };
  let side = -1;
  for (let f = 0; f < topo.nFaces; f++) if (topo.nrm[f * 3 + 1] < -0.9) { side = f; break; }
  const first = sway.swayAtFace(topo, res, ID, side, [0, -15, 60], opts);
  assert(first.ok, `first brace failed: ${first.reason}`);

  const alongTheFoot = [first.foot[0], first.foot[1]];
  assert(sway.swayClashesWall(first, [alongTheFoot]), 'a wall on its own foot did not read as a clash');

  const blocked = sway.swayAtFace(topo, res, ID, side, [0, -15, 60], opts, { walls: [alongTheFoot] });
  assert(!blocked.ok && /would fuse/.test(blocked.reason),
         `a brace on top of a wall was not refused (${blocked.ok ? 'built' : blocked.reason})`);

  // ...and a wall well away from the face leaves placement alone.
  const farAway = [[200, 200, 0], [220, 200, 0]];
  const fine = sway.swayAtFace(topo, res, ID, side, [0, -15, 60], opts, { walls: [farAway] });
  assert(fine.ok, `a distant wall blocked a brace: ${fine.reason}`);
});

Deno.test('sway: auto refuses a stilt, a hand-placed brace builds one and reports it', () => {
  // A wide block held up on a narrow pedestal: its sides start 70mm off the plate,
  // so a brace there prints as a lone wall for 70mm before its first tine. Raised
  // on #29 by a part tilted onto a corner, where every face starts high.
  const foot = block(-8, 8, -8, 8, 0, 70);          // the pedestal
  const top = block(-20, 20, -15, 15, 70, 150);     // the part being braced
  const pos = new Float32Array(foot.length + top.length);
  pos.set(foot, 0); pos.set(top, foot.length);
  const topo = topoOf(pos);
  const res = analyze(topo, 45, ID);

  let side = -1;
  for (let f = 0; f < topo.nFaces; f++) {
    if (topo.nrm[f * 3 + 1] < -0.9 && topo.pos[f * 9 + 2] > 69) { side = f; break; }
  }
  assert(side >= 0, 'no raised side face found');
  // AUTO won't stand one there...
  const auto = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER });
  assert(auto.count === 0, `auto stood ${auto.count} braces on stilts`);

  // ...but a brace the user clicks is built anyway, reporting how far it stands
  // before it grips, so the readout can say so. The tool suggests; you decide.
  const r = sway.swayAtFace(topo, res, ID, side, [0, -15, 110], { tines: true, layerHeight: LAYER });
  assert(r.ok, `a hand-placed brace was refused: ${r.reason}`);
  assert(r.stilt > 60, `stilt reported as ${r.stilt?.toFixed(1)}mm, expected ~70`);

  // ...and the same call can still be held to Auto's rule when asked.
  const strict = sway.swayAtFace(topo, res, ID, side, [0, -15, 110],
                                 { tines: true, layerHeight: LAYER, allowStilt: false });
  assert(!strict.ok && /holding nothing/.test(strict.reason),
         `allowStilt:false did not refuse (${strict.ok ? 'built' : strict.reason})`);
});

Deno.test('sway: "grip from" is the user\'s choice, not a stilt to refuse', () => {
  // The same rule must not fight the setting: gripping only above 80mm on a part
  // whose face reaches the plate is deliberate, and still builds.
  const { topo, res } = post();
  const s = sway.buildSwayBraces(topo, res, ID, { tines: true, layerHeight: LAYER, gripFrom: 80 });
  assert(s.count >= 2, `"grip from" 80mm was refused as a stilt (${s.count} braces, ${s.reason})`);
});

Deno.test('sway: Draw runs a brace up the whole side with `full`, and a low click says why', () => {
  const { topo, res } = post();
  let side = -1;
  for (let f = 0; f < topo.nFaces && side < 0; f++) if (topo.nrm[f * 3 + 1] < -0.9) side = f;
  const opts = { tines: true, layerHeight: LAYER };
  const full = sway.swayAtFace(topo, res, ID, side, [0, -15, 60], { ...opts, full: true });
  const auto = sway.buildSwayBraces(topo, res, ID, opts).ribs[0];
  assert(full.ok, `full-height hand brace failed: ${full.reason}`);
  assert(full.height > 100 && Math.abs(full.height - auto.height) < 1e-6,
         `a full hand brace should stand as tall as Auto's (${auto.height}), got ${full.height}`);
  const low = sway.swayAtFace(topo, res, ID, side, [0, -15, 10], opts);
  assert(!low.ok && /too low/.test(low.reason), `a 10mm click should be too low, got ${low.ok ? 'a brace' : low.reason}`);
});

Deno.test('sway: "Brace tall walls" cross-ribs a brace over its start height, clear of the part', () => {
  const { topo, res } = post();
  const opts = { tines: true, layerHeight: LAYER };
  const plain = sway.buildSwayBraces(topo, res, ID, opts);
  // what the page sends with Brace tall walls ticked (ui/finbuild.js swayOpts)
  const ribbed = sway.buildSwayBraces(topo, res, ID, { ...opts, crossAbove: 100, crossRise: 0.5 });
  assert(ribbed.count === plain.count && ribbed.tines === plain.tines, 'cross ribs cost a brace or its tines');
  for (let i = 0; i < ribbed.ribs.length; i++) {
    const r = ribbed.ribs[i], extra = r.tris.slice(plain.ribs[i].tris.length);
    assert(r.cross === 2, `a ${r.height.toFixed(0)}mm brace got ${r.cross} cross ribs, expected 2`);
    assert(isClosed(extra), 'a cross rib is not closed');
    const inside = insideCount(topo, ID, res.offset, extra.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
    assert(inside === 0, `${inside} cross-rib verts are inside the part`);
  }
  const under = sway.buildSwayBraces(topo, res, ID, { ...opts, crossAbove: 200, crossRise: 0.5 });
  assert(under.ribs.every((r) => !r.cross), 'a brace under the start height got cross ribs');
});

/** A 50 x 12 x 190mm arm tilted `deg` off vertical, seated on its low edge, and its
 *  biggest +Y-facing (the back, facing up) and -Y-facing (the underside) faces. */
function leaningArm(deg) {
  const topo = tiltedBlockTopo(-25, 25, -6, 6, 0, 190, deg);
  const res = analyze(topo, 45, ID);
  let back = -1, under = -1;
  // the long faces, not the end caps (tilted, a cap's normal has a big Y part too)
  for (let f = 0; f < topo.nFaces; f++) {
    const ny = topo.nrm[f * 3 + 1];
    if (ny > 0.5 && (back < 0 || topo.area[f] > topo.area[back])) back = f;
    if (ny < -0.5 && (under < 0 || topo.area[f] > topo.area[under])) under = f;
  }
  // a click on face f, 60mm up its middle: its centroid, slid along the face to z = 60
  const at = (f) => {
    const P = topo.pos, c = [0, 1, 2].map((k) => (P[f * 9 + k] + P[f * 9 + 3 + k] + P[f * 9 + 6 + k]) / 3);
    const n = [topo.nrm[f * 3], topo.nrm[f * 3 + 1], topo.nrm[f * 3 + 2]];
    // up the face: horizontal x n, which climbs in z; scale it to land at z = 60
    const up = [0, -n[2], n[1]].map((v) => v * Math.sign(n[1]));
    const k = (60 - (c[2] + res.offset.z)) / up[2];
    return [0, c[1] + res.offset.y + k * up[1], 60];
  };
  return { topo, res, back, under, at };
}

Deno.test('sway: Draw anchors a leaning arm from its up-facing back (GH #351), not its underside', () => {
  const { topo, res, back, under, at } = leaningArm(40);
  assert(sway.faceIsUpright(topo, ID, back), 'a back leaning 40 degrees and facing up should take a brace');
  assert(!sway.faceIsUpright(topo, ID, under), 'an underside leaning 40 degrees is an overhang, not a side');
  const opts = { tines: true, layerHeight: LAYER, full: true };
  const r = sway.swayAtFace(topo, res, ID, back, at(back), opts);
  assert(r.ok, `anchor brace failed: ${r.reason}`);
  assert(r.height > 100, `the anchor should run most of the way up the arm, got ${r.height.toFixed(0)}mm`);
  assert(isClosed(r.tris), 'anchor brace is not closed');
  // it leans with the arm and stands off it: nothing of the rib is in the part
  const ribOnly = sway.swayAtFace(topo, res, ID, back, at(back), { ...opts, tines: false });
  const inside = insideCount(topo, ID, res.offset, ribOnly.tris.map((v) => [v[0], v[1], Math.max(v[2], 1e-3)]));
  assert(inside === 0, `${inside} rib verts are inside the arm`);
  assert(r.tines >= 10, `the anchor should grip all the way up, got ${r.tines} tines`);
  assert(!sway.swayAtFace(topo, res, ID, under, at(under), opts).ok, 'the underside should refuse a brace');
});

Deno.test('sway: a back leaning past 45 degrees refuses an anchor -- its own edge would overhang', () => {
  const { topo, res, back, at } = leaningArm(50);
  assert(!sway.faceIsUpright(topo, ID, back), 'a back leaning 50 degrees should not take a brace');
  const r = sway.swayAtFace(topo, res, ID, back, at(back), { tines: true, layerHeight: LAYER, full: true });
  assert(!r.ok, 'a 50-degree back should be refused');
});
