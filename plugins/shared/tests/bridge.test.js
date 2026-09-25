// The base64 bridge must round-trip bytes exactly and give the same fins as
// calling the engine directly.
import { b64ToBytes, bytesToB64, computeFinsB64 } from '../engine/bridge.js';
import { computeFins } from '../engine/fins_entry.js';
import { readSTL, MODELS, rotX, assert } from '../../../tests/_util.js';

Deno.test('base64 round-trips every length mod 3', () => {
  for (let n = 0; n < 50; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
    const back = b64ToBytes(bytesToB64(b));
    assert(back.length === n && back.every((v, i) => v === b[i]), `length ${n} failed`);
  }
});

Deno.test('matches the platform btoa on random data', () => {
  const b = new Uint8Array(100000).map(() => (Math.random() * 256) | 0);
  let bin = '';
  for (const v of b) bin += String.fromCharCode(v);
  assert(bytesToB64(b) === btoa(bin), 'differs from btoa');
});

Deno.test('bridge gives the same fins as the direct call', () => {
  const raw = readSTL(Deno.readFileSync(`${MODELS}cube.stl`));
  const m = rotX(45);
  const posed = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i], y = raw[i + 1], z = raw[i + 2];
    posed[i] = m[0] * x + m[3] * y + m[6] * z + 50;
    posed[i + 1] = m[1] * x + m[4] * y + m[7] * z + 60;
    posed[i + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
  const direct = computeFins(posed, { layerHeight: 0.2 });
  const viaB64 = JSON.parse(computeFinsB64(bytesToB64(new Uint8Array(posed.buffer)), JSON.stringify({ layerHeight: 0.2 })));
  const bytes = b64ToBytes(viaB64.triangles);
  const tris = new Float32Array(bytes.buffer);
  assert(tris.length === direct.triangles.length, 'triangle count differs');
  assert(tris.every((v, i) => v === direct.triangles[i]), 'triangles differ');
  assert(JSON.stringify(viaB64.offset) === JSON.stringify(direct.offset), 'offset differs');
});
