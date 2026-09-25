// Per-fin removal data model: every auto fin now carries its triangle segment(s)
// (triRanges, vertex-indexed into built.triangles) so the UI can address and drop
// an individual fin. These tests pin the invariants the click-to-remove feature
// relies on -- that the ranges are well-formed, cover the whole fin mesh exactly
// once, and that filtering by them excludes exactly the removed fin's triangles.
// (Model-free: a tilted plate with a bore yields >=2 flanking fins, same fixture
// as perp_hole.test.js, so this runs without the gitignored stress STLs.)

import { fins, holedPlateTopo, analyze, rotX, isClosed, assert } from './_util.js';

// The same build the UI runs in Auto mode.
function build() {
  const topo = holedPlateTopo(40, 30, 4, 9, 9);
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  return fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
}

/** Flatten one fin's triRanges into a vertex list (mirrors ui/remove.js filteredTriangles
 *  for a single record). */
function finVerts(triangles, fin) {
  const out = [];
  for (const [lo, hi] of (fin.triRanges ?? []))
    for (let t = lo; t < hi; t++) out.push(triangles[t]);
  return out;
}

Deno.test('per-fin: every auto fin carries triRanges + id + kind + line', () => {
  const b = build();
  assert(b.fins.length >= 2, `expected >=2 fins, got ${b.fins.length}`);
  for (const f of b.fins) {
    assert(Array.isArray(f.triRanges) && f.triRanges.length > 0, `fin ${f.id} has no triRanges`);
    assert(f.id != null, `fin missing id`);
    assert(f.kind === 'prop' || f.kind === 'wedge', `fin ${f.id} bad kind ${f.kind}`);
    assert(Array.isArray(f.line) && f.line.length, `fin ${f.id} missing line`);
  }
});

Deno.test('per-fin: triRanges are in-bounds, non-overlapping, and cover every triangle', () => {
  const b = build();
  const n = b.triangles.length;
  // vertex-indexed coverage: mark every vertex index claimed by some fin's range.
  const claimed = new Uint8Array(n);
  let claimedCount = 0;
  for (const f of b.fins) {
    for (const [lo, hi] of f.triRanges) {
      assert(lo >= 0 && hi <= n && lo < hi, `fin ${f.id} range out of bounds: [${lo},${hi}) of ${n}`);
      for (let t = lo; t < hi; t++) {
        assert(claimed[t] === 0, `vertex ${t} claimed by two fins (overlapping ranges)`);
        claimed[t] = 1; claimedCount++;
      }
    }
  }
  // Every fin triangle is accounted for -- no orphan geometry outside any fin.
  assert(claimedCount === n, `triRanges cover ${claimedCount} of ${n} vertices -- gap in coverage`);
});

Deno.test('per-fin: each fin is itself a watertight closed solid', () => {
  const b = build();
  for (const f of b.fins) {
    const verts = finVerts(b.triangles, f);
    assert(verts.length % 3 === 0, `fin ${f.id} vertex count ${verts.length} not a triangle multiple`);
    assert(isClosed(verts), `fin ${f.id} (${f.kind}) is not a closed solid in isolation`);
  }
});

Deno.test('per-fin: filtering out one fin excludes exactly its triangles and no others', () => {
  const b = build();
  const n = b.triangles.length;
  // Pick a fin to "remove" (not the first, to avoid lucky-edge cases).
  const k = Math.min(1, b.fins.length - 1);
  const removed = b.fins[k];
  const removedSet = new Set([removed.id]);
  // Replicate ui/remove.js filteredTriangles: walk records, skip removed, keep the rest.
  const kept = [];
  const removedVerts = new Set();
  for (let i = 0; i < b.fins.length; i++) {
    if (removedSet.has(b.fins[i].id)) {
      for (const [lo, hi] of b.fins[i].triRanges) for (let t = lo; t < hi; t++) removedVerts.add(t);
    } else {
      for (const [lo, hi] of b.fins[i].triRanges) for (let t = lo; t < hi; t++) kept.push(b.triangles[t]);
    }
  }
  // The kept set is exactly the vertices NOT in the removed fin's ranges.
  assert(kept.length === n - removedVerts.size,
    `kept ${kept.length} vs expected ${n - removedVerts.size}`);
  // Sanity: the kept geometry is still watertight (removing a disjoint closed
  // solid doesn't open edges on the rest).
  assert(isClosed(kept), 'kept fins are not watertight after removing one fin');
  // And re-adding the removed fin's vertices back makes the whole mesh closed again.
  const allBack = [...kept, ...finVerts(b.triangles, removed)];
  assert(isClosed(allBack), 'full mesh not watertight after restoring the removed fin');
});
