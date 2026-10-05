// The SolidWorks dialog's part handling (SupportFins/page/host.js) against the real
// engine: the bed poses the part the way the site would, the fins come back in
// SolidWorks' frame, and each piece is a closed, consistently wound STL (what an
// import as a solid body needs).
//
//   deno test --allow-read plugins/solidworks/tests/
import * as engine from '../../shared/engine/bridge.js';
import { readSTL } from '../../../web/stl.js';
import { BEDS, PREFIX, finsFor, frameFor, pieceNames, pose, stlBytes, toModel, upFor } from '../SupportFins/page/host.js';

const ROOT = new URL('../../../', import.meta.url);
const load = (rel) => Float64Array.from(readSTL(Deno.readFileSync(new URL(rel, ROOT))));
const LEDGE = 'prototype/stress/models/lowledge.stl';
const SPHERE = 'prototype/stress/models/sphere.stl';

function assert(c, msg) { if (!c) throw new Error(msg); }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const det = (R) => R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
  - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
// The model-frame copy of a print-pose (z up) part, for a model whose up is `up`.
const unposed = (soup, up) => toModel(soup, { x: 0, y: 0, z: 0 }, frameFor(up));

Deno.test('frameFor: up goes to +z, never a mirror; Y up is (x, -z, y), Z up is the identity', () => {
  for (const up of [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, -1, 0], [0.3, -0.5, 0.8]]) {
    const R = frameFor(up);
    near(det(R), 1, 1e-12, `det for ${up}`);
    const z = pose(Float64Array.from(up), R);
    const n = Math.hypot(...up);
    near(z[0], 0, 1e-12, 'x'); near(z[1], 0, 1e-12, 'y'); near(z[2], n, 1e-12, 'z');
  }
  assert(JSON.stringify(pose(Float64Array.of(1, 2, 3), frameFor([0, 1, 0]))) === JSON.stringify(Float64Array.of(1, -3, 2)), 'Y up');
  assert(JSON.stringify(frameFor([0, 0, 1])) === JSON.stringify([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 'Z up');
});

Deno.test('toModel undoes pose, offset included', () => {
  const p = Float64Array.of(10, 20, 30, -4, 5.5, 0.25);
  const R = frameFor([0.2, 0.9, -0.1]);
  const off = { x: 1, y: -2, z: 3 };
  const seated = pose(p, R).map((v, i) => v + [off.x, off.y, off.z][i % 3]);
  toModel(seated, off, R).forEach((v, i) => near(v, p[i], 1e-9, `coord ${i}`));
});

Deno.test('upFor: named planes, and a face points up whichever way its normal faces', () => {
  const soup = load(LEDGE);
  assert(JSON.stringify(upFor('top', soup)) === '[0,1,0]', 'top');
  assert(JSON.stringify(upFor('front', soup)) === '[0,0,1]', 'front');
  let minZ = Infinity;
  for (let i = 2; i < soup.length; i += 3) minZ = Math.min(minZ, soup[i]);
  for (const normal of [[0, 0, -1], [0, 0, 2]]) {
    const up = upFor('face', soup, { normal, point: [0, 0, minZ] });
    assert(JSON.stringify(up) === '[0,0,1]', `${normal} -> ${up}`);
  }
  assert(upFor('face', soup, null).error, 'no face selected');
  assert(BEDS.map((b) => b.value).join() === 'top,front,face', 'dialog beds');
});

Deno.test('the fins are the website\'s, whichever way up the model is drawn', () => {
  // lowledge both ways up; sphere (tines, which move under the least noise, and a bed pad) Y up
  for (const [rel, beds] of [[LEDGE, [['front', [0, 0, 1]], ['top', [0, 1, 0]]]], [SPHERE, [['top', [0, 1, 0]]]]]) {
    const print = load(rel);                      // z up: as the engine takes it
    const want = engine.computeFins(print, {});
    assert(want.pieces.length > 0, `${rel}: no fins to compare`);
    if (rel === SPHERE) assert(want.stats.tines > 0, 'sphere lost its tines');
    const wantModel = toModel(want.triangles, want.offset, frameFor([0, 0, 1]));
    for (const [bed, up] of beds) {
      const got = finsFor(engine, unposed(print, up), bed, null, {});
      assert(!got.error, got.error);
      assert(got.stats.tines === want.stats.tines && got.stats.braces === want.stats.braces,
        `${rel} ${bed}: ${got.line} vs ${engine.reportLine(want.stats)}`);
      // Back in the print pose, the triangles are the site's to well under a micron.
      // Pieces regroup the soup, so compare as sorted vertex lists.
      const tris = pose(Float64Array.from(got.pieces.flatMap((p) => [...p.triangles])), frameFor(up));
      assert(tris.length === wantModel.length, `${rel} ${bed}: ${tris.length / 9} vs ${wantModel.length / 9} triangles`);
      const key = (a) => Array.from({ length: a.length / 3 }, (_, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]])
        .sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
      const [g, w] = [key(tris), key(wantModel)];
      let worst = 0;
      g.forEach((p, i) => { for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p[k] - w[i][k])); });
      assert(worst < 1e-4, `${rel} ${bed}: ${worst} mm off`);
    }
  }
});

Deno.test('every piece is a closed, consistently wound STL that reads back as written', () => {
  for (const rel of [LEDGE, SPHERE]) {
    const got = finsFor(engine, load(rel), 'front', null, { padStyle: 'sure' });
    assert(got.pieces.length > 0, `${rel}: no pieces`);
    for (const p of got.pieces) {
      const back = readSTL(stlBytes(p.triangles, p.name));
      assert(back.length === p.triangles.length, `${p.name}: length`);
      back.forEach((v, i) => near(v, p.triangles[i], 1e-3, `${p.name} coord ${i}`));
      const q = (i) => `${Math.round(back[i] * 1e3)},${Math.round(back[i + 1] * 1e3)},${Math.round(back[i + 2] * 1e3)}`;
      const edges = new Map();
      for (let f = 0; f < back.length / 9; f++) {
        const v = [q(9 * f), q(9 * f + 3), q(9 * f + 6)];
        for (let e = 0; e < 3; e++) {
          const k = `${v[e]}|${v[(e + 1) % 3]}`;
          edges.set(k, (edges.get(k) || 0) + 1);
        }
      }
      for (const [k, n] of edges) {
        const [a, b] = k.split('|');
        if (a === b) continue;                    // a sliver collapsed by the rounding
        assert(n === 1, `${rel} ${p.name}: edge ${k} walked ${n} times the same way`);
        assert(edges.has(`${b}|${a}`), `${rel} ${p.name}: open edge ${k}`);
      }
    }
  }
});

Deno.test('pieceNames: numbered per kind, all under one prefix the next run skips', () => {
  const names = pieceNames([{ kind: 'prop' }, { kind: 'prop' }, { kind: 'sway' }, { kind: 'pad' }]);
  assert(names.join('|') === 'Support Fins wall 1|Support Fins wall 2|Support Fins sway brace 1|Support Fins bed pad', names.join('|'));
  assert(names.every((n) => n.startsWith(PREFIX)), 'prefix');
});

Deno.test('a face bed with nothing selected says so instead of guessing', () => {
  const got = finsFor(engine, load(LEDGE), 'face', null, {});
  assert(/Select the flat face/.test(got.error), JSON.stringify(got));
});
