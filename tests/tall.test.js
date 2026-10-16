// TALL-WALL RIBS (web/fins/tall.js, local issue 046): a wall over BRACE.tallH gets
// face ribs at the plate, last, around everything else placed. Pinned: a shelf 110 mm
// up gets them and a 60 mm one doesn't, unticked builds exactly as without the pass,
// no rib runs into another support, and a drawn wall gets them too.
import { assert, analyze, buildTopology, fins, prop } from './_util.js';
const { BRACE, PROP } = prop;
const { drawnWall } = await import('../web/draw.js');

function box(x0, x1, y0, y1, z0, z1, out) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [a, b, c] of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) out.push(...v[a], ...v[b], ...v[c]);
}
/** A post with a 60 x 20 mm shelf out from its top, the shelf's underside `h` up. */
function shelf(h) {
  const t = [];
  box(0, 10, 0, 20, 0, h + 2, t); box(10, 70, 0, 20, h, h + 2, t);
  const pos = new Float32Array(t);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return { topo, rot, res: analyze(topo, 45, rot) };
}
const build = (s, o = {}) => fins.buildFins(s.topo, s.res, s.rot, { mode: 'auto', bedPad: true, ...o });
const bbox = (vs) => {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], v[k]); b[k + 3] = Math.max(b[k + 3], v[k]); }
  return b;
};

Deno.test('tall: walls 110 mm up get face ribs; unticked is the build without them', () => {
  const s = shelf(110);
  const on = build(s), off = build(s, { tallRibs: false });
  assert(on.tallRibs >= 4, `ribs on the tall walls: ${on.tallRibs}`);
  assert(off.tallRibs === undefined, 'unticked: the pass never runs');
  assert(on.triangles.length > off.triangles.length, 'the ribs are in the mesh');
  // everything before the ribs is the unticked build, triangle for triangle
  for (let i = 0; i < off.triangles.length; i++) {
    const a = on.triangles[i], b = off.triangles[i];
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) throw new Error(`vertex ${i} moved`);
  }
  const ribbed = on.fins.filter((f) => f.ribs);
  assert(ribbed.length >= 2 && ribbed.every((f) => f.height > BRACE.tallH), 'only walls over tallH');
  for (const f of ribbed) {
    const [a, b] = f.triRanges.at(-1);
    const r = bbox(on.triangles.slice(a, b));
    assert(r[2] > -1e-6 && r[2] < 1e-6, 'a rib stands on the plate');
    assert(r[5] < f.height - PROP.tipH - 0.9, 'a rib stops under the tip taper');
  }
});

Deno.test('tall: a shelf 60 mm up gets none', () => {
  const on = build(shelf(60));
  assert(on.tallRibs === 0, `no ribs under ${BRACE.tallH} mm: ${on.tallRibs}`);
});

Deno.test('tall: no rib runs into another support', () => {
  const on = build(shelf(110));
  const ribbed = on.fins.filter((f) => f.ribs);
  for (const f of ribbed) {
    const [a, b] = f.triRanges.at(-1);
    const r = bbox(on.triangles.slice(a, b));
    for (const g of on.fins) {
      if (g === f) continue;
      for (const [c, d] of g.triRanges) {
        const o = bbox(on.triangles.slice(c, d));
        // the other wall's own body: its ribs are checked as their own range
        const apart = r[3] + PROP.sideClear <= o[0] || o[3] + PROP.sideClear <= r[0]
          || r[4] + PROP.sideClear <= o[1] || o[4] + PROP.sideClear <= r[1];
        if (!apart) {
          // boxes overlap in plan: a thin rib beside a long wall still has to clear it
          // triangle by triangle -- check every vertex of the rib against the other's box
          const inside = on.triangles.slice(a, b).some((v) => v[0] > o[0] && v[0] < o[3] && v[1] > o[1] && v[1] < o[4] && v[2] < o[5]);
          assert(!inside, 'a rib runs into another support');
        }
      }
    }
  }
});

Deno.test('tall: a drawn wall over tallH gets face ribs with braceTall, none without', () => {
  const s = shelf(110);
  const tris = [];
  const t = [];
  box(0, 10, 0, 20, 0, 112, t); box(10, 70, 0, 20, 110, 112, t);
  const off = s.res.offset;
  for (let i = 0; i < t.length; i += 3) tris.push(t[i] + off.x, t[i + 1] + off.y, t[i + 2] + off.z);
  const part = Float64Array.from(tris);
  const at = (x, y) => [x + off.x, y + off.y, 110 + off.z];
  const plain = drawnWall(at(20, 10), at(60, 10), part, 0, {});
  const ribbed = drawnWall(at(20, 10), at(60, 10), part, 0, { braceTall: true });
  assert(plain.ok && ribbed.ok, 'both walls build');
  assert(!plain.braces, 'no ribs unless asked');
  assert(ribbed.braces === 2, `one face pair on a 40 mm wall: ${ribbed.braces}`);
});
