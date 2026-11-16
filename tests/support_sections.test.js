import { assert, assertClose, block } from './_util.js';
import { area, components, difference, intersection, offset, sectionAt, sectionMesh } from '../web/fins/sections.js';

const section = (soup, z) => sectionAt(sectionMesh(soup), z);
const fails = (fn, text) => {
  let error;
  try { fn(); } catch (e) { error = e; }
  assert(error?.message.includes(text), `expected ${text}, got ${error?.message}`);
};
const reverse = (soup) => {
  const out = Array.from(soup);
  for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
  return out;
};

Deno.test('support sections: closed sections, exact layer boundaries and preserved input', () => {
  const soup = block(-5, 5, -2, 2, 0, 10), before = soup.slice(), mesh = sectionMesh(soup);
  for (const z of [0, 0.1, 4.5, 9.999]) assertClose(area(sectionAt(mesh, z)), 40, 1e-10);
  assert(sectionAt(mesh, 10).length === 0);
  assert(sectionAt(mesh, -0.01).length === 0);
  assert(soup.every((v, i) => v === before[i]), 'source geometry changed');
  assertClose(area(sectionAt(sectionMesh(Array.from({ length: soup.length / 3 }, (_, i) => Array.from(soup.slice(i * 3, i * 3 + 3)))), 1)), 40, 1e-10);
});

Deno.test('support sections: overlapping shells union, holes and nested islands retain winding', () => {
  const outer = block(-5, 5, -5, 5, 0, 10), hole = reverse(block(-3, 3, -3, 3, 0, 10));
  const island = block(-1, 1, -1, 1, 0, 10);
  const paths = section([...outer, ...hole, ...island], 2);
  assertClose(area(paths), 68, 1e-10);
  assert(components(paths).length === 2);
  assertClose(area(section([...outer, ...block(0, 10, 0, 10, 0, 10)], 2)), 175, 1e-10);
});

Deno.test('support sections: equal touching edges and repeated shells do not become holes', () => {
  const a = block(0, 2, 0, 2, 0, 2), b = block(2, 4, 0, 2, 0, 2);
  assertClose(area(section([...a, ...b, ...a], 1)), 8, 1e-10);
  assert(components(section([...a, ...b], 1)).length === 1);
});

Deno.test('support sections: translation, off-axis rotation and mirrored winding', () => {
  const source = block(-5, 5, -2, 2, 0, 10), transformed = [];
  const a = 0.731, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < source.length; i += 3) {
    transformed.push(30 - source[i] * c + source[i + 1] * s,
      -10 + source[i] * s + source[i + 1] * c, source[i + 2] + 3);
  }
  assertClose(area(section(reverse(transformed), 7.1)), 40, 0.00002);
});

Deno.test('support sections: ordinary-width cores detect thin and disconnected sections', () => {
  const thin = section(block(-4, 4, -0.2, 0.2, 0, 5), 1);
  assert(offset(thin, -0.41).length === 0);
  const broad = section(block(-4, 4, -1, 1, 0, 5), 1);
  assert(area(offset(broad, -0.41)) > 0);
  const upper = section(block(10, 12, -1, 1, 0, 5), 1);
  assert(area(intersection(broad, upper)) === 0);
  assertClose(area(difference(broad, upper)), area(broad), 1e-10);
});

Deno.test('support sections: malformed geometry fails without closing contours', () => {
  const soup = block(-1, 1, -1, 1, 0, 2);
  fails(() => section(soup.slice(0, -9), 1), 'open');
  fails(() => sectionMesh([0, 0]), 'incomplete');
  fails(() => sectionMesh([...soup, NaN, 0, 0, 1, 0, 0, 0, 1, 0]), 'non-finite');
  fails(() => sectionMesh(soup, [[0, 100]]), 'range');
});
