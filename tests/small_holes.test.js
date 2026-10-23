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
      assert(built.smallHoleMask instanceof Uint8Array);
      assertEquals(built.smallHoleMask, automaticTargets(topo, res, IDENTITY3).excludedSupportFaces);
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
    assert(!built.smallHoleMask.some(Boolean));
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
  assert(targets.excludedSupportVolumes.length > 0, 'Full reserves the cavity without emitting it');
  const lowest = Math.min(...targets.excludedSupportVolumes.map((p) => p[2]));
  assert(lowest >= 7.49 + res.offset.z && lowest < 8 + res.offset.z,
    'the keep-clear volume ends at the actual bore floor');
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
  assert(!built.smallHoleMask.some(Boolean));
});

Deno.test('small holes: Draw does not apply the automatic exclusion', () => {
  const topo = topology(circularBore());
  const res = analyze(topo, 45, IDENTITY3);
  const built = buildFins(topo, res, IDENTITY3, { mode: 'draw', bedPad: true });
  assertEquals(built.smallHoleRegions, 0);
  assertEquals(built.smallHoleMask, null);
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
    assert(plugin.overFaces.length > 0, 'the neighbouring overhang remains red');
    assert(plugin.smallFaces.length > 0, 'the excluded ceiling is amber');
    const amber = new Set(plugin.smallFaces);
    assert(plugin.overFaces.every((f) => !amber.has(f)), 'red and amber never overlap');
    assert(plugin.overFaces instanceof Int32Array && plugin.smallFaces instanceof Int32Array);
    for (let f = 0; f < res.over.length; f++) {
      assertEquals(amber.has(f), !!(res.over[f] && (!res.kept[f] || built.smallHoleMask[f])));
    }
  }
});

Deno.test('small holes: Full keeps nearby ceilings supported without routing through the bore', () => {
  const pos = Float64Array.from([...circularBore(),
    ...block(16, 40, -10, 10, 10, 15), ...block(-40, -16, -10, 10, 10, 15)]);
  const topo = topology(pos), result = analyze(topo, 45, IDENTITY3);
  const built = buildFins(topo, result, IDENTITY3, { mode: 'full', coverage: 1, bedPad: true });
  assertEquals(built.smallHoleRegions, 1);
  assert(built.props.some((p) => p.line?.some((q) => q[0] > 16 + result.offset.x)));
  assert(built.props.some((p) => p.line?.some((q) => q[0] < -16 + result.offset.x)));
  for (const p of built.triangles) {
    const [x, y, z] = [p[0] - result.offset.x, p[1] - result.offset.y, p[2] - result.offset.z];
    assert(!(Math.abs(x) < 14.9 && Math.hypot(y, z - 10) < 2.49), 'Full routed a wall through the excluded cavity');
  }
  assert(built.bare.area < 0.02 * built.bare.total, 'neighbouring ceilings must retain coverage');
});

// A CAD export may split a bore lengthwise at its centre. A containment ray
// there can hit two triangles of one surface; that must not turn air into solid.
function seamBore(diameter, segments, axialSegments, yaw, translated) {
  const pos = circularBore({ diameter, segments, axialSegments });
  const [c, s] = yaw === 90 ? [0, 1] : [1, 0];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1];
    pos[i] = c * x - s * y + (translated ? 30 : 0);
    pos[i + 1] = s * x + c * y + (translated ? 110 : 0);
  }
  return pos;
}

Deno.test('small holes: coincident mesh seams do not change classification across seating paths', () => {
  for (const segments of [64, 96]) for (const axialSegments of [1, 2]) {
    for (const yaw of [0, 90]) for (const translated of [false, true]) {
      const pos = seamBore(4, segments, axialSegments, yaw, translated);
      const label = `${segments} facets, ${axialSegments} axial strips, ${yaw}°, translated=${translated}`;
      const topo = topology(pos), res = analyze(topo, 45, IDENTITY3);
      assertEquals(automaticTargets(topo, res, IDENTITY3).smallHoleRegions, 1, label);
      const plugin = computeFins(pos, { mode: 'auto', threshold: 45 });
      assertEquals(plugin.stats.smallHoleRegions, 1, `shared adapter: ${label}`);
      assertEquals(plugin.triangles.length, 0, `shared adapter: ${label}`);
      assertEquals(plugin.overFaces.length, 0, `red exempt ceiling: ${label}`);
      assert(plugin.smallFaces.length > 0, `missing amber: ${label}`);
    }
  }
});

Deno.test('small holes: seam-tessellated bores stay empty in Auto and Full, with larger controls supported', () => {
  for (const mode of ['auto', 'full']) for (const diameter of [4, 5, 5.8, 10]) {
    const pos = seamBore(diameter, 64, 2, 90, true);
    const topo = topology(pos), res = analyze(topo, 45, IDENTITY3);
    const built = buildFins(topo, res, IDENTITY3, { mode, bedPad: true, curvedWalls: true });
    const plugin = computeFins(pos, { mode, threshold: 45 });
    const excluded = diameter < 6 ? 1 : 0;
    assertEquals(built.smallHoleRegions, excluded, `${mode}: ${diameter} mm`);
    assertEquals(plugin.stats.smallHoleRegions, excluded, `shared ${mode}: ${diameter} mm`);
    if (excluded) {
      assertEquals(built.triangles.length, 0);
      assertEquals(plugin.triangles.length, 0);
    } else {
      assert(built.props.length > 0, 'large-bore control must retain support');
      assert(plugin.stats.braces + plugin.stats.props > 0);
    }
  }
});
