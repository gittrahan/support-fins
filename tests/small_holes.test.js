import { assert, assertEquals } from 'jsr:@std/assert';
import { buildTopology, analyze, IDENTITY3 } from '../web/overhangs.js';
import { buildFins } from '../web/fins.js';
import { automaticTargets, classify, HOLE, touchesSmallHole } from '../web/fins/coverage.js';
import { findWallPatches } from '../web/planes.js';
import { circularBore } from './_bore.js';
import { block } from './_util.js';
import { computeFins } from '../plugins/shared/engine/fins_entry.js';
import { drawWall } from '../plugins/shared/engine/draw_entry.js';

const topology = (pos) => buildTopology({ getAttribute: () => ({ array: pos }) });

Deno.test('small holes: Auto and Full leave a recognised circular bore clear', () => {
  for (const mode of ['auto', 'full']) {
    for (const diameter of [3, 5]) {
      const topo = topology(circularBore({ diameter }));
      const res = analyze(topo, 45, IDENTITY3);
      const over = res.over.slice(), kept = res.kept.slice(), regions = res.regions;
      assert(classify(topo, res, IDENTITY3).some((c) => c === HOLE));
      const built = buildFins(topo, res, IDENTITY3, { mode, bedPad: true, curvedWalls: true });
      assertEquals(built.smallHoleRegions, 1);
      assertEquals(built.props.length, 0);
      assertEquals(built.triangles.length, 0);
      assertEquals(built.unserved, 0, 'an intentional exclusion is not a failed placement');
      assertEquals(res.over, over, 'the original overhang highlighting must survive');
      assertEquals(res.kept, kept);
      assert(res.regions === regions, 'the caller owns its original regions');
    }
  }
});

Deno.test('small holes: larger circular bores retain automatic support', () => {
  const topo = topology(circularBore({ diameter: 10 }));
  const res = analyze(topo, 45, IDENTITY3);
  for (const mode of ['auto', 'full']) {
    const built = buildFins(topo, res, IDENTITY3, { mode, bedPad: true });
    assertEquals(built.smallHoleRegions, 0);
    assert(built.props.some((p) => p.inBore), `${mode}: missing larger-bore support`);
  }
});

Deno.test('small holes: reuse the existing classifier boundary rather than adding a diameter rule', () => {
  for (const [diameter, threshold, count] of [[5.9, 45, 1], [6, 45, 1], [6.1, 45, 0], [4, 70, 1], [5, 70, 0]]) {
    const topo = topology(circularBore({ diameter }));
    const res = analyze(topo, threshold, IDENTITY3);
    assertEquals(automaticTargets(topo, res, IDENTITY3).smallHoleRegions, count, `${diameter} mm at ${threshold}°`);
  }
});

Deno.test('small holes: one generation shares its classification, without caching a later pose', () => {
  const topo = topology(circularBore());
  const res = analyze(topo, 45, IDENTITY3);
  const targets = automaticTargets(topo, res, IDENTITY3);
  assert(classify(topo, targets, IDENTITY3) === targets.coverageClasses);
  assertEquals(targets.regions.length, 0);
  const inHole = [0 + res.offset.x, res.offset.y, 12.5 + res.offset.z];
  assert(touchesSmallHole(targets, [inHole]), 'a later pass must reject the exempt ceiling');
  assert(!touchesSmallHole(targets, [[inHole[0], inHole[1], inHole[2] + 10]]),
    'a separate ceiling above the bore must remain available');
  const wedges = findWallPatches(topo, IDENTITY3, targets.offset, null, targets.excludedSupportFaces);
  for (const p of wedges) assert(p.faces.every((f) => !targets.excludedSupportFaces[f]));
  // Turn the bore upright: the same topology and analyze scratch are reused.
  const rot = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const upright = analyze(topo, 45, rot);
  const built = buildFins(topo, upright, rot, { mode: 'auto', bedPad: true });
  assertEquals(built.smallHoleRegions, 0);
});

Deno.test('small holes: Draw does not apply the automatic exclusion', () => {
  const topo = topology(circularBore());
  const res = analyze(topo, 45, IDENTITY3);
  const built = buildFins(topo, res, IDENTITY3, { mode: 'draw', bedPad: true });
  assertEquals(built.smallHoleRegions, 0);
  assert(res.regions.length > 0);
  const drawn = drawWall(circularBore(), [-12, 0, 12.5], [12, 0, 12.5]);
  assert(drawn.ok && drawn.stats.partAttached && drawn.triangles.length > 0,
    'an explicitly drawn wall can still stand inside the bore');
});

Deno.test('small holes: an open-sided channel remains an automatic target', () => {
  const pos = Float64Array.from([
    ...block(-15, 15, -3, 3, 0, 2),
    ...block(-15, 15, -3, -2, 2, 6),
    ...block(-15, 15, -3, 3, 6, 8),
  ]);
  for (const mode of ['auto', 'full']) {
    const topo = topology(pos), res = analyze(topo, 45, IDENTITY3);
    const built = buildFins(topo, res, IDENTITY3, { mode, bedPad: true });
    assertEquals(built.smallHoleRegions, 0);
    assert(built.props.length > 0, 'the accessible channel must keep its supports');
  }
});

Deno.test('small holes: keep neighbouring overhangs supported, and report through the shared adapter', () => {
  const pos = Float64Array.from([...circularBore(), ...block(30, 60, -10, 10, 10, 15)]);
  for (const mode of ['auto', 'full']) {
    const topo = topology(pos), res = analyze(topo, 45, IDENTITY3);
    const built = buildFins(topo, res, IDENTITY3, { mode, bedPad: true });
    assertEquals(built.smallHoleRegions, 1);
    assert(built.props.length > 0, 'the neighbouring ceiling must keep its supports');
    for (const p of built.triangles) {
      const x = p[0] - res.offset.x, y = p[1] - res.offset.y, z = p[2] - res.offset.z;
      assert(!(Math.abs(x) < 14.9 && Math.hypot(y, z - 10) < 2.49), 'a later pass put a fin in the hole');
    }
    const plugin = computeFins(pos, { mode, threshold: 45 });
    assertEquals(plugin.stats.smallHoleRegions, 1);
    assertEquals(plugin.stats.braces + plugin.stats.props, built.props.length);
    assert(plugin.overFaces.length > 0, 'intentional exclusions stay highlighted');
  }
});
