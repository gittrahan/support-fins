import { assert, block } from './_util.js';
import { layerAt, nominalContext, supportPrintability } from '../web/fins/printability.js';

const context = { ...nominalContext(0.4, 0.8, 0.2), lineWidth: 0.82, firstLayerWidth: 0.82, basis: 'test' };
const make = (soups) => {
  const triangles = [], pieces = [];
  soups.forEach((soup, i) => {
    const first = triangles.length / 9;
    triangles.push(...soup);
    pieces.push({ id: String(i), ranges: [[first, triangles.length / 9]] });
  });
  return { triangles, pieces };
};
const inspect = (soups, model = [], settings = context) => {
  const { triangles, pieces } = make(soups);
  const before = JSON.stringify(triangles);
  const report = supportPrintability(triangles, pieces, model, settings);
  assert(before === JSON.stringify(triangles), 'diagnostics mutated supports');
  return report;
};

Deno.test('support diagnostics: later island in the same piece is not hidden by its plate root', () => {
  const r = inspect([[...block(-4, 4, -1, 1, 0, 4), ...block(-4, 4, -1, 1, 8, 12)]]);
  assert(r.status === 'complete');
  assert(r.starts.length === 2, JSON.stringify(r.starts));
  assert(r.starts[0].root === 'plate');
  assert(r.starts[1].root === 'unresolved' && r.starts[1].layer === 20);
  assert(r.starts[1].z === 8.4);
});

Deno.test('support diagnostics: a different established support is recorded as the parent', () => {
  const r = inspect([block(-4, 4, -1, 1, 0, 4), block(-4, 4, -1, 1, 4, 8)]);
  const upper = r.starts.find((s) => s.piece === '1');
  assert(upper.root === 'support' && upper.parents[0] === '0', JSON.stringify(upper));
});

Deno.test('support diagnostics: an unrooted parent cannot certify a child', () => {
  const r = inspect([block(-4, 4, -1, 1, 2, 4), block(-4, 4, -1, 1, 4, 8)]);
  assert(r.starts.every((s) => s.root === 'unresolved'), JSON.stringify(r.starts));
});

Deno.test('support diagnostics: full model footprint is only a possible seat, never print certification', () => {
  const fin = block(-4, 4, -1, 1, 4.4, 8), model = block(-6, 6, -3, 3, 0, 4.2);
  const r = inspect([fin], model);
  assert(r.starts[0].root === 'model-below');
  const partial = inspect([fin], block(-6, 0, -3, 3, 0, 4.2));
  assert(partial.starts[0].root === 'unresolved', 'a partly supported underside was credited');
  const zero = inspect([fin], model, { ...context, bottomGap: 0 });
  assert(zero.starts[0].root === 'unresolved', 'zero gap was treated as a separated seat');
});

Deno.test('support diagnostics: a wedge can lose initial sections before its first ordinary-width layer', () => {
  // A closed prism with its underside climbing in Y. Width at each layer grows
  // from zero even though the triangle mesh is connected from its bottom vertex.
  const soup = Array.from(block(-4, 4, -1, 1, 0, 6));
  for (let i = 0; i < soup.length; i += 3) if (soup[i + 2] === 0) soup[i + 2] = (soup[i + 1] + 1) * 1.5 + 2;
  const r = inspect([soup]);
  assert(r.status === 'complete', JSON.stringify(r.stopped));
  assert(r.narrow.length > 0);
  assert(r.starts[0].root === 'unresolved');
  assert(r.starts[0].z > r.narrow[0].z);
});

Deno.test('support diagnostics: report growth beyond 45 degrees separately from a new island', () => {
  const r = inspect([block(-2, 2, -1, 1, 0, 4), block(-6, 6, -1, 1, 4, 8)]);
  assert(r.starts[1].root === 'support');
  assert(r.growth.some((g) => g.layer === 10 && g.area > 1));
});

Deno.test('support diagnostics: first layer schedule and ordinary widths are independent of fin settings', () => {
  const c = { ...context, firstLayerHeight: 0.2, firstLayerWidth: 1.1 };
  assert(layerAt(0, c).sliceZ === 0.1 && layerAt(1, c).sliceZ === 0.4000000000000001);
  const r = inspect([block(-4, 4, -0.5, 0.5, 0, 3)], [], c);
  assert(r.narrow[0].layer === 0 && r.narrow[0].width === 1.1);
  assert(r.starts[0].layer === 1 && r.starts[0].root === 'unresolved');
  const fine = inspect([block(-4, 4, -0.25, 0.25, 0, 3)], [], nominalContext(0.2, 0.4, 0.2));
  assert(fine.starts[0].root === 'plate');
});

Deno.test('support diagnostics: malformed sections, missing settings and budgets are not passes', () => {
  const r = inspect([block(-1, 1, -1, 1, 0, 3).slice(0, -9)]);
  assert(r.status === 'incomplete' && r.stopped.layer === 0 && r.stopped.piece === '0');
  assert(inspect([], [], { ...context, firstLayerHeight: 0 }).status === 'unavailable');
  assert(inspect([], [], { unavailable: 'variable layers' }).status === 'unavailable');
  assert(inspect([block(-1, 1, -1, 1, 0, 9000)]).status === 'incomplete');
});

Deno.test('support diagnostics: output is deterministic and contains no library or mesh references', () => {
  const args = [block(-1, 1, -1, 1, 0, 3), block(-1, 1, -1, 1, 6, 9)];
  const a = JSON.stringify(inspect(args)), b = JSON.stringify(inspect(args));
  assert(a === b);
  assert(!a.includes('footprint') && !a.includes('triangles'));
});

Deno.test('support diagnostics: an elevated project model does not move the saved plate or layer schedule', () => {
  const c = { ...context, plateZ: -2 };
  const r = inspect([block(-2, 2, -1, 1, 0, 3)], [], c);
  assert(r.starts[0].root === 'unresolved');
  assert(r.starts[0].layer === 5 && Math.abs(r.starts[0].printZ - 2.4) < 1e-9);
  assert(Math.abs(r.starts[0].z - 0.4) < 1e-9);
});

Deno.test('support diagnostics: translations keep the same findings and nozzle-width decisions', () => {
  const src = [block(-3, 3, -1, 1, 0, 4), block(-3, 3, -1, 1, 8, 12)];
  const translated = src.map((s) => Array.from(s, (v, i) => v + (i % 3 === 0 ? 2345 : i % 3 === 1 ? -6789 : 0)));
  const a = inspect(src), b = inspect(translated);
  assert(a.starts.length === b.starts.length && a.narrow.length === b.narrow.length && a.growth.length === b.growth.length);
  a.starts.forEach((s, i) => {
    const t = b.starts[i];
    assert(s.root === t.root && s.layer === t.layer && Math.abs(s.area - t.area) < 1e-5);
    assert(s.bounds.every((v, j) => Math.abs(v - t.bounds[j] + (j % 2 ? -6789 : 2345)) < 1e-6));
  });
});

Deno.test('support diagnostics: exactly one ordinary line fits; a narrower isolated wall is flagged', () => {
  const exact = inspect([block(-4, 4, -0.41, 0.41, 0, 3)]);
  assert(exact.starts[0]?.root === 'plate' && !exact.narrow.length);
  const thin = inspect([block(-4, 4, -0.40, 0.40, 0, 3)]);
  assert(thin.narrow.length === 1 && !thin.starts.length);
});

Deno.test('support diagnostics: a rooted parent still holds a child which also meets an unresolved parent', () => {
  const r = inspect([block(-4, 0, -1, 1, 0, 4), block(0, 4, -1, 1, 2, 4), block(-4, 4, -1, 1, 4, 8)]);
  const child = r.starts.find((s) => s.piece === '2');
  assert(child.root === 'support' && child.parents.length === 2, JSON.stringify(child));
});

Deno.test('support diagnostics: no supports require no model decoding or layer scan', () => {
  let called = false;
  const r = supportPrintability([], [], () => { called = true; return []; }, { ...context, plateZ: -10000 });
  assert(r.status === 'complete' && r.layers === 0 && !called);
});
