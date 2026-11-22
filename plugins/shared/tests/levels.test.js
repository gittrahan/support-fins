// `levels` through the plugin entry (fins_entry.js computeFins, bridge.js): a slicer host's own layer boundaries reach the engine, set
// for that call only, and a host that sends none gets exactly what it got before.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins } from '../engine/fins_entry.js';
import { b64ToBytes, bytesToB64, computeFinsB64 } from '../engine/bridge.js';
import { readSTL, MODELS, rotX, assert } from '../../../tests/_util.js';
import { levelsOn } from '../../../web/prop/levels.js';

// a 0.3 mm first layer under 0.2 mm layers, the seated frame from 0
const FIRST_03 = [0, 0.3];
while (FIRST_03.at(-1) < 60) FIRST_03.push(Math.round((FIRST_03.at(-1) + 0.2) * 1e6) / 1e6);

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

Deno.test('levels: computeFins passes them to the build, for that call only', () => {
  const part = posed('lbracket', rotX(40), [120, 80, 0]);
  for (const mode of ['auto', 'full']) {
    const plain = computeFins(part, { mode });
    assert(same(computeFins(part, { mode, levels: null }).triangles, plain.triangles), `${mode}: levels null moved the fins`);
    const levelled = computeFins(part, { mode, levels: FIRST_03 });
    assert(!levelsOn(), `${mode}: computeFins left its levels set`);
    assert(!same(levelled.triangles, plain.triangles), `${mode}: levels moved nothing`);
    assert(levelled.stats.tines > 0 && levelled.stats.braces === plain.stats.braces,
           `${mode}: ${levelled.stats.braces} tined walls with levels, ${plain.stats.braces} without`);
    assert(same(computeFins(part, { mode }).triangles, plain.triangles), `${mode}: a build after a levelled one changed`);
  }
});

Deno.test('levels: a list the engine cannot use fails the call by name', () => {
  const part = posed('cube', rotX(45));
  for (const bad of [[0.2, 0.4], [0, 0.3, 0.3], [0]]) {
    let msg = '';
    try { computeFins(part, { levels: bad }); } catch (e) { msg = e.message; }
    assert(/^levels must/.test(msg), `${JSON.stringify(bad)}: "${msg}"`);
    assert(!levelsOn());
  }
});

Deno.test('levels: the base64 bridge carries them as JSON, as a Python host sends them', () => {
  const part = posed('cube', rotX(45), [50, 60, 0]);
  const viaBridge = JSON.parse(computeFinsB64(bytesToB64(new Uint8Array(part.buffer)), JSON.stringify({ levels: FIRST_03 })));
  const direct = computeFins(part, { levels: FIRST_03 });
  assert(viaBridge.stats.tines === direct.stats.tines && viaBridge.stats.tines > 0);
  const tris = new Float32Array(b64ToBytes(viaBridge.triangles).buffer);
  assert(same(tris, direct.triangles), 'the bridge built other fins');
});
