// The Orca preview panel's page logic (plugins/orca/src/preview_page.js, #477): decoding what
// src/preview.py posts, the colours per triangle, and the orbit camera.
import { assert } from '../../../tests/_util.js';

const src = await Deno.readTextFile(new URL('../src/preview_page.js', import.meta.url));
const SFV = new Function(`${src}\nreturn SFV;`)();

const b64 = (typed) => btoa(String.fromCharCode(...new Uint8Array(typed.buffer)));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

Deno.test('preview page: decodes the plugin\'s little-endian float32 and byte arrays', () => {
  const f = new Float32Array([1.5, -2, 3.25]);
  assert(SFV.floats(b64(f)).join() === '1.5,-2,3.25');
  assert(SFV.bytes(b64(new Uint8Array([0, 1, 2]))).join() === '0,1,2');
  assert(SFV.floats('').length === 0 && SFV.bytes(undefined).length === 0);
});

Deno.test('preview page: each triangle gets its class colour and a normal, fins their own', () => {
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];               // facing +z
  const part = new Float32Array([...tri, ...tri, ...tri]);
  const out = SFV.buffers(part, new Uint8Array([0, 1, 2]), new Float32Array(tri));
  assert(out.length === 4 * 3 * 9);
  const colour = (t) => [...out.slice(t * 27 + 6, t * 27 + 9)];
  const f32 = (c) => c.map(Math.fround);
  assert(colour(0).join() === f32(SFV.COLOURS[0]).join() && colour(1).join() === f32(SFV.COLOURS[1]).join());
  assert(colour(2).join() === f32(SFV.COLOURS[2]).join() && colour(3).join() === f32(SFV.FIN).join());
  assert(near(out[5], 1) && near(out[3], 0));            // normal (0, 0, 1)
});

Deno.test('preview page: the camera puts the target in the middle of the view', () => {
  for (const [yaw, pitch] of [[0, 0.5], [-0.6, 0.5], [2, -0.3]]) {
    const { matrix: m } = SFV.camera(yaw, pitch, 50, [1, 2, 3], 1.5);
    const p = [1, 2, 3, 1];
    const clip = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]);
    assert(near(clip[0] / clip[3], 0, 1e-9) && near(clip[1] / clip[3], 0, 1e-9), clip.join());
    assert(clip[2] / clip[3] > -1 && clip[2] / clip[3] < 1, 'inside the depth range');
  }
});

Deno.test('preview page: up on the plate is up on screen, and front faces the viewer at yaw 0', () => {
  const { matrix: m, eye } = SFV.camera(0, 0.3, 50, [0, 0, 0], 1);
  const ndc = (p) => {
    const c = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    return [c[0] / c[3], c[1] / c[3]];
  };
  assert(ndc([0, 0, 5])[1] > 0, 'z up draws above the centre');
  assert(ndc([5, 0, 0])[0] > 0, '+X draws to the right, as on Orca\'s plate from the front');
  assert(eye[1] < 0, 'the eye is in front of the plate (-Y)');
});

Deno.test('preview page: radius frames everything drawn', () => {
  assert(SFV.radius(new Float32Array([3, 4, 0]), new Float32Array([0, 0, 12])) === 12);
  assert(SFV.radius(new Float32Array(0), new Float32Array(0)) === 1);
});
