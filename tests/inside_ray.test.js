import { fileURLToPath } from 'node:url';
import { assert, insideCount, readSTL } from './_util.js';
import { buildTopology, analyze, IDENTITY3 } from '../web/overhangs.js';
import { buildFins } from '../web/fins.js';
import { insidePart } from '../web/inside.js';

// #450: insidePart's +x ray can run exactly through a shared edge or vertex, where every
// face meeting there counted as a crossing and parity read noise. A part centred on its
// axes lands there: the ball-in-a-ball's hanging ball lost its wall to one false "buried"
// station under its lowest point.
const ZERO = { x: 0, y: 0, z: 0 };
const topoOf = (tris) => {
  const pos = new Float32Array(tris.flat(2));
  return buildTopology({ getAttribute: () => ({ array: pos }) });
};
const inside = (tris, x, y, z) => insidePart(topoOf(tris), IDENTITY3, ZERO, x, y, z);

// Apex on +x: a ray along the axis meets all `n` side faces at one vertex, then the base.
// The hub is off the axis, so the base is crossed once, inside one triangle.
function pyramid(n) {
  const tris = [], apex = [1, 0, 0], hub = [0, 0.3, 0.2];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n + 0.2, b = ((i + 1) * 2 * Math.PI) / n + 0.2;
    const p = [0, Math.cos(a), Math.sin(a)], q = [0, Math.cos(b), Math.sin(b)];
    tris.push([p, q, apex], [q, p, hub]);
  }
  return tris;
}
// A cube with its x = 1 face split along a diagonal through y = z = 0.
const CUBE = (() => {
  const v = (x, y, z) => [x, y, z], tris = [];
  const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
  for (const s of [1, -1]) {
    quad(v(s, -1, -1), v(s, s, -s), v(s, 1, 1), v(s, -s, s));
    quad(v(-1, s, -1), v(-1, s, 1), v(1, s, 1), v(1, s, -1));
    quad(v(-1, -1, s), v(1, -1, s), v(1, 1, s), v(-1, 1, s));
  }
  return tris;
})();

Deno.test('insidePart: a ray through a vertex no longer reads a point outside as inside', () => {
  // 6 faces at the apex + 1 at the base was odd
  assert(!inside(pyramid(6), -1, 0, 0), 'in front of the base, on the axis');
  assert(!inside(pyramid(6), 2, 0, 0), 'past the apex, on the axis');
});

Deno.test('insidePart: a ray through a vertex no longer reads a point inside as outside', () => {
  // the apex's faces alone are ahead of this point: 6 read as even, so outside
  assert(inside(pyramid(6), 0.5, 0, 0), 'inside, on the axis, 6 faces at the apex');
  assert(inside(pyramid(5), 0.5, 0, 0), 'inside, on the axis, 5 faces at the apex');
});

Deno.test('insidePart: a ray through a shared edge counts as one crossing', () => {
  assert(inside(CUBE, 0, 0, 0), 'the cube centre, its ray on the x = 1 diagonal');
  assert(!inside(CUBE, -2, 0, 0), 'outside, through both diagonals');
  assert(!inside(CUBE, 2, 0, 0), 'past the cube');
});

Deno.test('insidePart: a ray clear of every edge answers as before', () => {
  assert(inside(CUBE, 0, 0.3, 0.1), 'inside');
  assert(!inside(CUBE, -2, 0.3, 0.1), 'in front');
  assert(!inside(CUBE, 0, 1.5, 0.1), 'beside');
});

const FIXTURE = fileURLToPath(new URL('./fixtures/ball_in_ball.stl', import.meta.url));

function underBall(dx = 0, dy = 0, opts = {}) {
  const pos = readSTL(Deno.readFileSync(FIXTURE));
  for (let i = 0; i < pos.length; i += 3) { pos[i] += dx; pos[i + 1] += dy; }
  const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
  const result = analyze(topo, 45, IDENTITY3);
  const built = buildFins(topo, result, IDENTITY3, { mode: 'auto', bedPad: true, ...opts });
  // the hanging ball's lowest point: z 28.8 over the axis (gen_ball_in_ball.py)
  const walls = built.fins.filter((w) => w.line.some((p) =>
    Math.hypot(p[0] - dx, p[1] - dy) < 1 && p[2] > 27 && p[2] < 29));
  return { topo, result, built, walls };
}

Deno.test('ball in a ball: the hanging ball gets a wall under its lowest point', () => {
  const { walls } = underBall();
  assert(walls.length >= 1, 'no wall under the hanging ball');
  const span = Math.max(...walls.map((w) => Math.hypot(w.line[0][0] - w.line.at(-1)[0], w.line[0][1] - w.line.at(-1)[1])));
  assert(span > 6, `the wall was cut short: ${span.toFixed(1)} mm`);
});

Deno.test('ball in a ball: the wall does not depend on the part sitting exactly on its axes', () => {
  const centred = underBall().walls.length, off = underBall(0.137, 0.073).walls.length;
  assert(centred === off, `centred ${centred} walls under the ball, nudged ${off}`);
});

Deno.test('ball in a ball: the walls stay out of the part', () => {
  // (tines off: their tips bite into the part by design)
  const { topo, result, built } = underBall(0, 0, { tines: false });
  const n = insideCount(topo, IDENTITY3, result.offset, built.triangles);
  assert(n === 0, `${n} support vertices inside the part`);
});
