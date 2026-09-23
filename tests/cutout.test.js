// Issue #34: wall cutouts. A tall breakaway wall can be opened up with a row of
// holes to save filament. These pin what makes that safe to print:
//   - every piece is a closed, outward-wound solid (the slicer unions them);
//   - the cut wall never reaches outside the solid wall it replaces;
//   - the contact top, the foot and the end posts stay solid;
//   - no hole has a roof flatter than 45deg (nothing bridges open air);
//   - a wall too short for a hole comes out exactly as before, and so does every
//     wall with the pattern off.

import { WEB, block, prop, fins, buildTopology, analyze, loadModel, isClosed, assert } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);
const { PROP } = prop;
const { CUT, holesFor } = await import(`${WEB}cutout.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A floating slab: its underside at z=30 is a flat overhang with open air to the
// plate, so a drawn line under it builds a plate-standing wall ~30mm tall along X.
const SLAB = block(-40, 40, -10, 10, 30, 34);
const LOW = block(-40, 40, -10, 10, 6, 10);     // same, only 6mm up: no room for holes

// A SLOPED overhang, like the underside of a cube tipped onto its edge: a slab
// tilted 35deg about Y, so a wall drawn along X under it is a tall triangle-ish
// fin whose top climbs the slope. Issue #34's screenshot: here the lattice has to
// follow the slope, not stop at the first cell that is short at one end.
function tiltedSlab(deg) {
  const t = block(-45, 45, -10, 10, 0, 4);
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], z = t[i + 2];
    out[i] = c * x + s * z; out[i + 1] = t[i + 1]; out[i + 2] = -s * x + c * z + 32;
  }
  return out;
}
const SLOPE = tiltedSlab(35);
const slopeZ = (x) => 32 - Math.tan((35 * Math.PI) / 180) * x;   // underside height at x
const sloped = (pattern) => wall(pattern, SLOPE, slopeZ(-30), slopeZ(30));

function wall(pattern, tris = SLAB, z = 30, z2 = z) {
  const was = CUT.pattern;
  CUT.pattern = pattern;
  try {
    const r = drawnWall([-30, 0, z], [30, 0, z2], tris, 0);
    assert(r.ok, `wall failed (${pattern}): ${r.reason}`);
    return r.tris;
  } finally { CUT.pattern = was; }
}

/** Split a triangle soup into its separate closed solids (shared vertices). */
function shells(tris) {
  const key = (p) => p.map((v) => v.toFixed(6)).join(',');
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (const p of tris) if (!parent.has(key(p))) parent.set(key(p), key(p));
  for (let i = 0; i < tris.length; i += 3) {
    const a = find(key(tris[i]));
    for (const q of [tris[i + 1], tris[i + 2]]) { const b = find(key(q)); if (a !== b) parent.set(b, a); }
  }
  const groups = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const r = find(key(tris[i]));
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(tris[i], tris[i + 1], tris[i + 2]);
  }
  return [...groups.values()];
}

const volume = (t) => {
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};

/**
 * Winding number of a closed soup about (x, y, z), counted along a +Y ray: each
 * crossing adds the sign of the face's Y normal. Overlapping solids (the band and
 * the post share a stretch) each add 1, so > 0 means "inside the union" -- ray
 * parity would call a doubly covered point empty.
 */
function winding(t, x, y, z) {
  let n = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
    const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    if (a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]) > y) n += d > 0 ? -1 : 1;
  }
  return n;
}

/** Sample the wall's mid-plane (y=0) on a grid: [row z][col x] -> material? */
function midPlane(tris, step = 0.15) {
  const parts = shells(tris);
  const boxes = parts.map((t) => {
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const p of t) { lo[0] = Math.min(lo[0], p[0]); hi[0] = Math.max(hi[0], p[0]); lo[1] = Math.min(lo[1], p[2]); hi[1] = Math.max(hi[1], p[2]); }
    return { t, lo, hi };
  });
  // offset the sample grid off the round numbers every edge sits on
  const xs = [], zs = [];
  const zTop = Math.max(...tris.map((p) => p[2]));
  for (let x = -31 + step * 0.37; x < 31; x += step) xs.push(x);
  for (let z = step * 0.41; z < zTop; z += step) zs.push(z);
  const grid = zs.map((z) => xs.map((x) => {
    let w = 0;
    for (const b of boxes) {
      if (x >= b.lo[0] && x <= b.hi[0] && z >= b.lo[1] && z <= b.hi[1]) w += winding(b.t, x, 0.0123, z);
    }
    return w > 0;
  }));
  return { grid, xs, zs };
}

Deno.test('cutout: every piece is a closed, outward-wound solid', () => {
  for (const pattern of ['diamond', 'triangle', 'arch', 'lattice']) {
    const tris = wall(pattern);
    assert(isClosed(tris), `${pattern}: not closed`);
    for (const s of shells(tris)) assert(volume(s) > 0, `${pattern}: a piece is wound inside-out`);
  }
});

Deno.test('cutout: pattern off, and a wall too short for a hole, are unchanged', () => {
  const solid = wall('none');
  CUT.pattern = 'none';
  assert(JSON.stringify(wall('none')) === JSON.stringify(solid), 'off is not deterministic');
  for (const pattern of ['diamond', 'triangle', 'arch', 'lattice']) {
    assert(JSON.stringify(wall(pattern, LOW, 6)) === JSON.stringify(wall('none', LOW, 6)),
      `${pattern}: a 6mm wall got cut`);
  }
});

// Mid-plane sampling is the slow part; share one pass per pattern.
const solidPlane = midPlane(wall('none'));
const slopeSolid = midPlane(sloped('none'), 0.2);
const slopeLattice = midPlane(sloped('lattice'), 0.2);
const planes = Object.fromEntries(['diamond', 'triangle', 'arch', 'lattice']
  .map((p) => [p, midPlane(wall(p))]));

Deno.test('cutout: stays inside the solid wall and removes real material', () => {
  for (const [pattern, { grid }] of Object.entries(planes)) {
    let solid = 0, cut = 0, outside = 0;
    grid.forEach((row, i) => row.forEach((m, j) => {
      const s = solidPlane.grid[i][j];
      if (s) solid++;
      if (m) cut++;
      if (m && !s) outside++;
    }));
    // a hair of eps overlap at piece seams can poke past a tapered edge; nothing more
    assert(outside / solid < 0.002, `${pattern}: ${outside} samples outside the solid wall`);
    const saved = 1 - cut / solid;
    assert(saved > 0.25, `${pattern}: only ${(saved * 100).toFixed(0)}% of the wall removed`);
  }
});

Deno.test('cutout: contact top, foot and end posts stay solid', () => {
  for (const [pattern, { grid, xs, zs }] of Object.entries(planes)) {
    const topZ = 30 - PROP.gap;
    zs.forEach((z, i) => xs.forEach((x, j) => {
      if (!solidPlane.grid[i][j]) return;
      const band = z > topZ - PROP.tipH - 0.9 || z < PROP.baseH + 0.9;   // top/bottom bands
      const post = Math.abs(x) > 30 - 1.9;                              // end posts
      if (band || post) assert(grid[i][j], `${pattern}: hole at x=${x.toFixed(2)} z=${z.toFixed(2)}`);
    }));
  }
});

Deno.test('cutout: no hole roof is flatter than 45 degrees', () => {
  for (const [pattern, { grid, xs }] of Object.entries(planes)) {
    // Material with air directly below must have material diagonally below it
    // (one step over, one step down): the 45deg rule a printer can build.
    for (let i = 1; i < grid.length; i++) {
      for (let j = 1; j < xs.length - 1; j++) {
        if (!grid[i][j] || grid[i - 1][j]) continue;
        assert(grid[i - 1][j - 1] || grid[i - 1][j + 1],
          `${pattern}: unsupported roof at x=${xs[j].toFixed(2)}`);
      }
    }
  }
});

Deno.test('cutout: a wall standing on the part (not the plate) is cut and stays closed', () => {
  // an L: a base block the wall stands on, and a shelf 30mm above it
  const shelf = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
  const solid = wall('none', shelf, 35);
  const cut = wall('diamond', shelf, 35);
  assert(isClosed(cut), 'part-attached cut wall is not closed');
  for (const s of shells(cut)) assert(volume(s) > 0, 'a part-attached piece is inside-out');
  assert(volume(cut) < volume(solid) * 0.9, 'part-attached wall barely changed');
});

Deno.test('cutout: the setting reaches an Auto build through tunables', () => {
  // The Worker has its own PROP, so the pick must ride in opts.tunables. A shelf
  // high over its base gets auto walls tall enough to cut.
  const pos = new Float32Array([...block(-30, 30, -10, 10, 0, 5), ...block(-30, 30, -10, 10, 35, 39)]);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const was = CUT.pattern;
  const vol = (cutout) => {
    const res = analyze(topo, 45, IDENTITY);
    const built = fins.buildFins(topo, res, IDENTITY,
      { mode: 'auto', bedPad: true, tines: true, tunables: { cutout } });
    assert(built.triangles.length > 0, 'auto built nothing under the shelf');
    return volume(built.triangles);
  };
  try {
    const solid = vol('none');
    const cut = vol('diamond');
    assert(CUT.pattern === 'diamond', 'applyTunables did not set the pattern');
    assert(cut < solid * 0.9, `auto walls not cut: ${cut.toFixed(0)} vs ${solid.toFixed(0)} mm3`);
    fins.applyTunables({ cutout: 'bogus' });
    assert(CUT.pattern === 'diamond', 'an unknown pattern name was applied');
  } finally { CUT.pattern = was; }
});

Deno.test('cutout: on a sloped fin the lattice climbs the slope, and still never bridges', () => {
  const { grid, xs } = slopeLattice;
  let solid = 0, cut = 0, outside = 0;
  grid.forEach((row, i) => row.forEach((m, j) => {
    const s = slopeSolid.grid[i][j];
    if (s) solid++;
    if (m) cut++;
    if (m && !s) outside++;
  }));
  assert(outside / solid < 0.002, `${outside} samples outside the solid fin`);
  // the old per-cell lattice cut ~0% here: every cell was short at its low end
  const saved = 1 - cut / solid;
  assert(saved > 0.3, `only ${(saved * 100).toFixed(0)}% of the sloped fin removed`);
  for (let i = 1; i < grid.length; i++) {
    for (let j = 1; j < xs.length - 1; j++) {
      if (!grid[i][j] || grid[i - 1][j]) continue;
      assert(grid[i - 1][j - 1] || grid[i - 1][j + 1], `unsupported roof at x=${xs[j].toFixed(2)}`);
    }
  }
  const tris = sloped('lattice');
  assert(isClosed(tris), 'sloped lattice not closed');
  for (const s of shells(tris)) assert(volume(s) > 0, 'a sloped lattice piece is inside-out');
});

Deno.test('cutout: on real parts no pattern throws, leaves a hole in the mesh, or ADDS plastic', () => {
  // A wall where only a speck of a hole fits used to come out heavier than solid
  // (bands overlapping the end posts outweighed the hole), so picking a cutout
  // could raise the grams readout. Whatever the pattern, the support must be closed
  // and never heavier than the solid build.
  const cases = [['wedge', 'x', 60], ['lbracket', 'x', 60], ['tshape', 'x', 60], ['cylinder', 'y', 25]];
  for (const [name, ax, deg] of cases) {
    const topo = loadModel(name);
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const rot = ax === 'x' ? [1, 0, 0, 0, c, s, 0, -s, c] : [c, 0, -s, 0, 1, 0, s, 0, c];
    const res = analyze(topo, 45, rot);
    const build = (p) => fins.buildFins(topo, res, rot,
      { mode: 'auto', bedPad: true, tines: true, tunables: { cutout: p } }).triangles;
    const solid = volume(build('none'));
    for (const p of ['diamond', 'triangle', 'arch', 'lattice']) {
      const t = build(p);
      assert(isClosed(t), `${name} ${ax}${deg} ${p}: not closed`);
      assert(volume(t) <= solid * 1.02 + 1,
        `${name} ${ax}${deg} ${p}: ${volume(t).toFixed(0)} mm3 vs ${solid.toFixed(0)} solid`);
    }
  }
  CUT.pattern = 'none';
});

Deno.test('cutout: a hole never outgrows its cell, whatever the cell height', () => {
  // PR #43 review: a narrow cell whose height sat just past a stacking threshold
  // (w=8, H~19.3) fell back to ONE hole and "narrowed" it to a=6.89 -- a 13.8mm
  // diamond in an 8mm cell. Neighbours overlapped, the webs vanished, and the top
  // band was left bridging post to post.
  for (const kind of ['diamond', 'triangle', 'arch']) {
    for (let w = 4; w <= 16; w += 0.5) {
      const aMax = (w - CUT.web) / 2;
      for (let H = 1; H <= 80; H += 0.05) {
        const holes = holesFor(kind, w, H);
        for (const h of holes) {
          assert(h.a <= aMax + 1e-9, `${kind} w=${w} H=${H.toFixed(2)}: a=${h.a.toFixed(2)} > ${aMax}`);
          assert(h.z0 >= -1e-9 && h.z1 <= H + 1e-9, `${kind} w=${w} H=${H.toFixed(2)}: hole leaves the cell`);
        }
        for (let j = 1; j < holes.length; j++) {
          assert(holes[j].z0 - holes[j - 1].z1 >= CUT.web - 1e-9, `${kind} w=${w} H=${H.toFixed(2)}: stacked holes touch`);
        }
      }
    }
  }
  const [d] = holesFor('diamond', 8, 19.3);
  assert(d && Math.abs(d.a - 3.2) < 1e-9, `w=8 H=19.3 should keep one full-width diamond, got ${JSON.stringify(d)}`);
});
