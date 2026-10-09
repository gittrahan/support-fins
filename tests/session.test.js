// SESSION (#214): a 3MF the site exports carries the hand-drawn walls (as points),
// the fin mode and the settings, so opening it again brings them back. Pinned here:
//   - the session survives the 3MF and is absent / ignored when it should be;
//   - the frame works: a point stored relative to the part's print-space box centre,
//     put back on the reloaded part (moved by the bed shift, re-centred and re-seated
//     as the site does it), rebuilds the SAME wall.
// The page glue (ui/session.js, ui/io.js) needs a DOM; this is the math under it.

import { WEB, assert, block, buildTopology, analyze } from './_util.js';

const { writeThreeMF, readThreeMF, SESSION_PART } = await import(`${WEB}threemf.js`);
const { zipStore } = await import(`${WEB}zip.js`);
const { drawnWall } = await import(`${WEB}draw.js`);

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const triples = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 3) o.push([flat[i], flat[i + 1], flat[i + 2]]); return o; };
const box = (pos) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  return { centre: lo.map((v, k) => (v + hi[k]) / 2), size: lo.map((v, k) => hi[k] - v) };
};

// an L in print space: a base block and a shelf 30 mm above it, the wall under the
// shelf standing on the base (a part-attached wall: the one most sensitive to a shift)
const L = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
const FINS = triples(block(-1, 1, -1, 1, 5, 35));
const A = [-30, 0, 35], B = [30, 0, 35];

async function roundTrip(session) {
  const blob = writeThreeMF(triples(L), FINS, 'shelf', { separate: true, session });
  return readThreeMF(new Uint8Array(await blob.arrayBuffer()));
}

Deno.test('session: written beside the model and read back as it was', async () => {
  const s = { v: 1, part: { size: [80, 20, 39] }, finMode: 'draw', finsVisible: true, form: { gap: '0.25' },
              walls: [{ a: [1, 2, 3], b: [4, 5, 6] }, { kind: 'sway', a: [7, 8, 9] }] };
  const r = await roundTrip(s);
  assert(JSON.stringify(r.session) === JSON.stringify(s), `session changed: ${JSON.stringify(r.session)}`);
  // still a plain two-object 3MF to anyone else
  assert(r.objects.length === 2 && r.objects.some((o) => / supports$/.test(o.name)), 'part + supports objects');
});

Deno.test('session: none written, none read; a bad or unknown one is ignored', async () => {
  assert((await roundTrip(null)).session === null, 'no session expected');
  const model = writeThreeMF(triples(L), [], 'p');
  const entries = async (data) => {
    // the same package with SESSION_PART replaced
    const { unzip } = await import(`${WEB}zip.js`);
    const parts = await unzip(new Uint8Array(await model.arrayBuffer()));
    const list = [...parts.entries()].map(([name, d]) => ({ name, data: d }));
    list.push({ name: SESSION_PART, data });
    return new Uint8Array(await zipStore(list).arrayBuffer());
  };
  assert((await readThreeMF(await entries('{not json'))).session === null, 'garbage read as a session');
  assert((await readThreeMF(await entries('{"v":2}'))).session === null, 'an unknown version read as a session');
});

Deno.test('session: a wall stored in the part frame rebuilds the same wall after the reload', async () => {
  const { centre, size } = box(L);
  const rel = (p) => p.map((v, k) => v - centre[k]);
  const r = await roundTrip({ v: 1, part: { size }, walls: [{ a: rel(A), b: rel(B) }] });
  const obj = r.objects.filter((o) => !/ supports$/.test(o.name));
  assert(obj.length === 1, 'one part object');

  // reload as the site does: centre the mesh on its box (setPart), seat it (analyze)
  const pos = obj[0].positions, c = box(pos).centre;
  assert(Math.abs(c[0] - centre[0]) > 1, 'the separate export should have moved the part on the bed');
  const local = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) local[i] = pos[i] - c[i % 3];
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: local } : null) });
  const off = analyze(topo, 45, IDENTITY).offset;
  const o = [off.x, off.y, off.z];
  const world = new Float32Array(local.length);
  for (let i = 0; i < local.length; i++) world[i] = local[i] + o[i % 3];

  // the stored point IS the new local point; world = local + offset (no rotation)
  const at = (p) => p.map((v, k) => v + o[k]);
  const s = r.session.walls[0];
  const before = drawnWall(A, B, L, 0);
  const after = drawnWall(at(s.a), at(s.b), world, 0);
  assert(before.ok && after.ok, `walls: ${before.reason ?? 'ok'} / ${after.reason ?? 'ok'}`);
  assert(before.partAttached && after.partAttached, 'both stand on the base');
  assert(before.tris.length === after.tris.length, `${before.tris.length} vs ${after.tris.length} vertices`);
  // the same wall, moved with the part
  const d = A.map((v, k) => at(s.a)[k] - v);
  let worst = 0;
  for (let i = 0; i < before.tris.length; i++) {
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(after.tris[i][k] - d[k] - before.tris[i][k]));
  }
  assert(worst < 1e-3, `rebuilt wall off by ${worst.toFixed(5)} mm`);
});
