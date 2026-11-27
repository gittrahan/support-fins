// What a host gets beyond the fins' triangles (fins_entry.js, draw_entry.js, bridge.js):
// the interface crest's triangles (`iface`), each piece's tine count and contact line,
// drawWall on the print's own layers, and bareOverhangs, the count of overhangs the
// walls a host keeps leave bare.
//
//   deno test --allow-read plugins/shared/tests/
import { bareOverhangs, computeFins } from '../engine/fins_entry.js';
import { drawWall } from '../engine/draw_entry.js';
import { b64ToBytes, bytesToB64, computeFinsB64, drawWallB64 } from '../engine/bridge.js';
import { readSTL, MODELS, rotX, rotY, assert, tiltedBlockTopo, prop } from '../../../tests/_util.js';
import { levelsOn } from '../../../web/prop/levels.js';
import { PROP } from '../../../web/prop/config.js';

function posed(name, m, d = [0, 0, 0]) {
  const raw = readSTL(Deno.readFileSync(`${MODELS}${name}.stl`));
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i], y = raw[i + 1], z = raw[i + 2];
    out[i] = m[0] * x + m[3] * y + m[6] * z + d[0];
    out[i + 1] = m[1] * x + m[4] * y + m[7] * z + d[1];
    out[i + 2] = m[2] * x + m[5] * y + m[8] * z + d[2];
  }
  return out;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const ones = (mask) => mask.reduce((n, v) => n + v, 0);
const LBRACKET = () => posed('lbracket', rotX(40), [120, 80, 0]);
// tilted 10 deg, so its undersides are near level: 'flat' crests their walls
const LBRACKET_10 = () => posed('lbracket', rotX(10), [120, 80, 0]);

// a 0.3 mm first layer under 0.2 mm layers, the seated frame from 0
const FIRST_03 = [0, 0.3];
while (FIRST_03.at(-1) < 60) FIRST_03.push(Math.round((FIRST_03.at(-1) + 0.2) * 1e6) / 1e6);

Deno.test('iface: off by default, one zero byte per triangle, and the fins unchanged', () => {
  const part = LBRACKET();
  const r = computeFins(part);
  assert(r.iface instanceof Uint8Array && r.iface.length === r.triangles.length / 9, 'one byte per triangle');
  assert(ones(r.iface) === 0, 'interface triangles with the crest off');
  assert(same(computeFins(part, { iface: false }).triangles, r.triangles), 'iface false moved the fins');
});

Deno.test('iface: the crest is tagged, never on the pad, and \'all\' adds the tines', () => {
  const part = LBRACKET_10();
  const flat = computeFins(part, { iface: 'flat' }), all = computeFins(part, { iface: 'all' });
  for (const [mode, r] of [['flat', flat], ['all', all]]) {
    assert(r.iface.length === r.triangles.length / 9, `${mode}: one byte per triangle`);
    assert(ones(r.iface) > 0, `${mode}: no interface triangles`);
    const pad = r.pieces.find((p) => p.kind === 'pad');
    if (pad) for (const [a, b] of pad.ranges) for (let t = a; t < b; t++) assert(!r.iface[t], `${mode}: pad triangle ${t} tagged`);
  }
  assert(ones(all.iface) > ones(flat.iface), `'all' tagged ${ones(all.iface)}, 'flat' ${ones(flat.iface)}`);
  // a crest triangle sits in the top printed layer of its wall: its cut is the bottom boundary of
  // the highest layer whose mid-height is under the contact line, so at most 1.5 layers under it
  for (const p of flat.pieces.filter((q) => q.kind === 'prop')) {
    const low = Math.min(...p.line.map((q) => q[2]));
    for (const [a, b] of p.ranges) for (let t = a; t < b; t++) {
      if (!flat.iface[t]) continue;
      for (let k = 2; k < 9; k += 3) assert(flat.triangles[9 * t + k] >= low - 0.3 - 1e-3, `${p.id}: crest triangle ${t} below the top layer`);
    }
  }
  assert(PROP.iface === 'all', 'test setup: the last build set the crest mode');
  assert(ones(computeFins(part).iface) === 0, 'the crest mode leaked into the next call');
});

Deno.test('iface: a mode the engine has no crest for fails the call by name', () => {
  let msg = '';
  try { computeFins(LBRACKET(), { iface: 'tines' }); } catch (e) { msg = e.message; }
  assert(/iface/.test(msg), `"${msg}"`);
});

Deno.test('pieces: each carries its tines and a wall its contact line, seated', () => {
  for (const [name, rot] of [['lbracket', rotX(40)], ['cube', rotY(35)], ['arch', rotX(25)]]) {
    const r = computeFins(posed(name, rot, [30, -10, 4]));
    assert(r.pieces.reduce((n, p) => n + p.tines, 0) === r.stats.tines,
           `${name}: pieces hold ${r.pieces.reduce((n, p) => n + p.tines, 0)} tines, stats ${r.stats.tines}`);
    for (const p of r.pieces) {
      assert(Number.isInteger(p.tines) && p.tines >= 0, `${name} ${p.id}: tines ${p.tines}`);
      if (p.kind === 'pad') { assert(p.line === null, `${name}: the pad has a line`); continue; }
      if (p.kind !== 'prop') continue;
      assert(Array.isArray(p.line) && p.line.length >= 2 && p.line.every((q) => q.length === 3 && q.every(Number.isFinite)),
             `${name} ${p.id}: bad line ${JSON.stringify(p.line)?.slice(0, 80)}`);
      // the line runs along the wall's top: inside the wall's own bounding box, seated
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [a, b] of p.ranges) for (let i = 9 * a; i < 9 * b; i += 3) {
        box[0] = Math.min(box[0], r.triangles[i]); box[1] = Math.min(box[1], r.triangles[i + 1]);
        box[2] = Math.max(box[2], r.triangles[i]); box[3] = Math.max(box[3], r.triangles[i + 1]);
      }
      for (const q of p.line) assert(q[0] >= box[0] - 1 && q[0] <= box[2] + 1 && q[1] >= box[1] - 1 && q[1] <= box[3] + 1,
                                     `${name} ${p.id}: line point ${q} off its wall`);
    }
  }
});

Deno.test('bridge: iface rides as base64 bytes, and drawWall\'s line and iface too', () => {
  const part = LBRACKET_10();
  const out = JSON.parse(computeFinsB64(bytesToB64(new Uint8Array(part.buffer)), JSON.stringify({ iface: 'flat' })));
  const direct = computeFins(part, { iface: 'flat' });
  assert(ones(direct.iface) > 0 && same(b64ToBytes(out.iface), direct.iface), 'the bridge carried another mask');
  assert(JSON.stringify(out.pieces) === JSON.stringify(direct.pieces), 'the bridge carried other pieces');
  const { pos, a, b } = tiltedBlock();
  const w = JSON.parse(drawWallB64(bytesToB64(new Uint8Array(pos.buffer)), JSON.stringify(a), JSON.stringify(b), JSON.stringify({ iface: 'all' })));
  const wd = drawWall(pos, a, b, { iface: 'all' });
  assert(w.ok && ones(wd.iface) > 0 && same(b64ToBytes(w.iface), wd.iface) && JSON.stringify(w.line) === JSON.stringify(wd.line), 'drawWall over the bridge differs');
});

// tests/draw.test.js's part: a 40x60x12 block tilted 45 deg about X, and a level
// 16 mm line along X under its underside, a few mm off the plate.
function tiltedBlock() {
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  let best = null;
  for (let y = -25; y <= 25; y += 0.5) {
    const zs = prop.surfaceZsAt(topo.pos, 0, y);
    if (zs.length < 2) continue;
    const under = Math.min(...zs), top = Math.max(...zs);
    if (under < 4 || top - under < 1) continue;
    if (!best || under > best.under) best = { y, under };
  }
  assert(best, 'test setup: found no overhang Y on the tilted block');
  return { pos: Float64Array.from(topo.pos), a: [-8, best.y, best.under], b: [8, best.y, best.under] };
}

Deno.test('drawWall: levels for that wall only, the crest tagged, and its contact line', () => {
  const { pos, a, b } = tiltedBlock();
  const plain = drawWall(pos, a, b, {});
  assert(plain.ok && plain.stats.tines > 0, 'test setup: the drawn wall has no tines');
  assert(same(drawWall(pos, a, b, { levels: null }).triangles, plain.triangles), 'levels null moved the wall');
  const levelled = drawWall(pos, a, b, { levels: FIRST_03 });
  assert(!levelsOn(), 'drawWall left its levels set');
  assert(levelled.ok && !same(levelled.triangles, plain.triangles), 'levels moved nothing');
  assert(same(drawWall(pos, a, b, {}).triangles, plain.triangles), 'a wall after a levelled one changed');
  let msg = '';
  try { drawWall(pos, a, b, { levels: [0.2, 0.4] }); } catch (e) { msg = e.message; }
  assert(/^levels must/.test(msg) && !levelsOn(), `bad levels: "${msg}"`);

  assert(plain.iface.length === plain.triangles.length / 9 && ones(plain.iface) === 0, 'crest off: no interface');
  // the block's underside is 45 deg off level: 'flat' leaves it, 'all' crests it
  assert(ones(drawWall(pos, a, b, { iface: 'flat' }).iface) === 0, 'flat crested a 45 deg underside');
  const crest = drawWall(pos, a, b, { iface: 'all' });
  assert(ones(crest.iface) > 0, 'crest on: no interface triangles');
  assert(ones(drawWall(pos, a, b, {}).iface) === 0, 'the crest mode leaked into the next wall');
  assert(plain.line.length >= 2 && plain.line.every((q) => q.length === 3 && q.every(Number.isFinite)), 'bad line');
});

Deno.test('bareOverhangs: the engine\'s own count for its walls, more when a host drops them', () => {
  for (const [name, rot] of [['lbracket', rotX(40)], ['arch', rotX(25)], ['cube', rotY(35)]]) {
    const part = posed(name, rot, [30, -10, 4]);
    for (const mode of ['auto', 'full']) {
      const r = computeFins(part, { mode });
      // the pieces as a host keeps them, their lines back in the part's frame
      const walls = r.pieces.map((p) => ({ kind: p.kind, line: p.line && p.line.map((q) => [q[0] - r.offset.x, q[1] - r.offset.y, q[2] - r.offset.z]) }));
      const kept = bareOverhangs(part, walls, { mode });
      const none = bareOverhangs(part, [], { mode });
      assert(kept === (r.stats.unserved ?? 0), `${name} ${mode}: recount ${kept}, the build's unserved ${r.stats.unserved}`);
      assert(none >= kept, `${name} ${mode}: no walls leave ${none} bare, its walls ${kept}`);
      const held = walls.filter((w) => w.line);
      if (held.length) {
        const fewer = bareOverhangs(part, walls.filter((w) => w !== held[0]), { mode });
        assert(fewer >= kept, `${name} ${mode}: dropping a wall left fewer bare (${fewer} < ${kept})`);
      }
    }
  }
});

Deno.test('bareOverhangs: a drawn wall serves the overhang it holds', () => {
  // drawn along the line of Auto's first wall
  const part = posed('lbracket', rotX(40), [30, -10, 4]);
  const r = computeFins(part);
  const off = [r.offset.x, r.offset.y, r.offset.z];
  const top = r.pieces.find((p) => p.kind === 'prop').line.map((q) => q.map((v, i) => v - off[i]));
  const w = drawWall(part, top[0], top.at(-1), {});
  assert(w.ok, `test setup: ${w.reason}`);
  const line = w.line.map((q) => [q[0] - w.offset.x, q[1] - w.offset.y, q[2] - w.offset.z]);
  const none = bareOverhangs(part, []);
  assert(none > 0, 'test setup: the part has no bare overhang');
  assert(bareOverhangs(part, [{ kind: 'drawn', line }]) < none, 'the drawn wall served nothing');
});

Deno.test('bareOverhangs: a sway brace\'s foot and the pad hold nothing', () => {
  const part = posed('portal', rotX(40), [30, -10, 4]);
  const r = computeFins(part, { sway: { on: true } });
  const back = (p) => p.line && p.line.map((q) => [q[0] - r.offset.x, q[1] - r.offset.y, q[2] - r.offset.z]);
  const sway = r.pieces.filter((p) => p.kind === 'sway');
  assert(sway.length && sway.every((p) => p.line?.length), 'test setup: no sway brace with a line');
  const none = bareOverhangs(part, []);
  assert(bareOverhangs(part, [...sway, ...r.pieces.filter((p) => p.kind === 'pad')]
    .map((p) => ({ kind: p.kind, line: back(p) }))) === none, 'a sway foot or the pad served an overhang');
});

Deno.test('bareOverhangs: walls it cannot read fail the call by name', () => {
  const part = LBRACKET();
  for (const bad of [null, [[[0, 0, 0]]], [{ kind: 'prop', line: [[0, 0]] }], [{ line: [[0, 0, 0]] }]]) {
    let msg = '';
    try { bareOverhangs(part, bad); } catch (e) { msg = e.message; }
    assert(/^walls must/.test(msg), `${JSON.stringify(bad)}: "${msg}"`);
  }
  assert(bareOverhangs(part, [{ kind: 'pad', line: null }]) === bareOverhangs(part, []), 'a null line held something');
});
