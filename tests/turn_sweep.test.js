import assert from "node:assert/strict";
import { sweep, sweepBetween } from "../web/prop/sweep.js";
import { turnFrame } from "../web/prop/turn-frame.js";
import { PROP } from "../web/prop/config.js";
import { crestPart } from "../web/prop/crest.js";
import { CUT } from "../web/cutout.js";
import { solid } from "../plugins/cli/tests/_turning-fixture.js";
import { turningRuntime } from "../plugins/cli/project-turning-geometry.js";
const line = Array.from({ length: 9 }, (_, i) => [i - 4, 0, 30]);
const makeFrame = (degrees = 90) =>
  turnFrame({
    center: [0, 0],
    start: 8,
    end: 26,
    degrees,
    layerHeight: .2,
    radius: 5,
  });
function closed(tris) {
  const edges = new Map();
  const key = (p) => p.slice(0, 3).join(",");
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = tris.slice(i, i + 3);
    const u = b.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j]);
    assert(
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) > 0,
      "degenerate face",
    );
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const x = key(p), y = key(q), k = [x, y].sort().join("|");
      const e = edges.get(k) ?? [0, 0];
      e[0]++;
      e[1] += x < y ? 1 : -1;
      edges.set(k, e);
    }
  }
  assert(
    [...edges.values()].every(([n, b]) => n === 2 && b === 0),
    "nonconforming or open sweep",
  );
}
for (const floor of [false, true]) {
  for (const iface of [false, "all"]) {
    Deno.test(`turn sweep preserves profile and closure: floor=${floor}, interface=${iface}`, async () => {
      const saved = { ...PROP }, cut = CUT.pattern;
      try {
        Object.assign(PROP, {
          iface,
          ifaceLayers: 2,
          tineDir: "horizontal",
          footGap: .2,
        });
        CUT.pattern = "none";
        crestPart(null, .2);
        const build = (out) =>
          floor
            ? sweepBetween(
              line,
              line.map((p) => [p[0], p[1], 2 + p[0] / 4]),
              out,
            )
            : sweep(line, 0, out);
        const plain = [];
        build(plain);
        const turned = [];
        const frame = makeFrame();
        if (floor) {
          sweepBetween(
            line,
            line.map((p) => [p[0], p[1], 2 + p[0] / 4]),
            turned,
            PROP.minHeight,
            frame,
          );
        } else sweep(line, 0, turned, PROP.minHeight, frame);
        closed(turned);
        assert(turned.some((p) => p[3] === 1) === !!iface);
        // Exact positions and tags survive below the frame's first active height.
        const low = plain.filter((p) => p[2] < 8);
        for (const p of low) assert(turned.some((q) => q.join() === p.join()));
        const w = await turningRuntime(),
          a = solid(w, plain.flatMap((p) => p.slice(0, 3))),
          b = solid(w, turned.flatMap((p) => p.slice(0, 3)));
        try {
          for (const z of [3.5, 7, 10, 18, 27, 29.5]) {
            const x = a.slice(z), y = b.slice(z);
            try {
              assert(
                Math.abs(x.area() - y.area()) < .002,
                `profile changed at ${z}: ${x.area()} vs ${y.area()}`,
              );
            } finally {
              x.delete();
              y.delete();
            }
          }
        } finally {
          a.delete();
          b.delete();
        }
      } finally {
        Object.assign(PROP, saved);
        CUT.pattern = cut;
        crestPart(null);
      }
    });
  }
}
Deno.test("turn sweep zero frame is exact; steep or invalid frame refuses", () => {
  const a = [], b = [];
  sweep(line, 0, a);
  sweep(line, 0, b, PROP.minHeight, makeFrame(0));
  assert.deepEqual(a, b);
  assert.throws(
    () =>
      turnFrame({
        center: [0, 0],
        start: 10,
        end: 11,
        degrees: 90,
        layerHeight: .2,
        radius: 5,
      }),
    /45-degree/,
  );
  assert.throws(
    () =>
      turnFrame({
        center: [NaN, 0],
        start: 0,
        end: 20,
        degrees: 90,
        layerHeight: .2,
        radius: 5,
      }),
    /invalid/,
  );
});

for (const degrees of [-90, -60, -30, 30, 60, 90]) {
  Deno.test(`turn frame ${degrees} respects actual layer growth`, () => {
    const frame = turnFrame({
      center: [12, -7],
      start: 3,
      end: 28,
      degrees,
      layerHeight: .4,
      radius: 5,
      axis: 37,
      endScale: .75,
    });
    const a = 37 * Math.PI / 180;
    for (const first of [.2, .28, .4]) {
      for (const h of [.2, .4]) {
        let prev = null;
        const planes = [
          first / 2,
          ...Array.from(
            { length: Math.ceil((31 - first) / h) },
            (_, i) => first + (i + .5) * h,
          ),
        ];
        let priorZ;
        for (const z of planes) {
          const p = frame.at([12 + 4 * Math.cos(a), -7 + 4 * Math.sin(a), z]);
          if (prev) {
            assert(
              Math.hypot(p[0] - prev[0], p[1] - prev[1]) <= z - priorZ + 1e-10,
            );
          }
          prev = p;
          priorZ = z;
        }
      }
    }
  });
}
Deno.test("sweep framing commutes with XY rotation/translation and preserves winding", () => {
  const frame = makeFrame(), orig = [];
  sweep(line, 0, orig, PROP.minHeight, frame);
  const a = 37 * Math.PI / 180,
    move = (p) => [
      20 + p[0] * Math.cos(a) - p[1] * Math.sin(a),
      -15 + p[0] * Math.sin(a) + p[1] * Math.cos(a),
      p[2],
    ];
  const frame2 = turnFrame({
    center: [20, -15],
    start: 8,
    end: 26,
    degrees: 90,
    layerHeight: .2,
    radius: 5,
  });
  const placed = [];
  sweep(line.map(move), 0, placed, PROP.minHeight, frame2);
  closed(placed);
  assert.equal(orig.length, placed.length);
  for (let i = 0; i < orig.length; i++) {
    for (let j = 0; j < 3; j++) {
      assert(Math.abs(move(orig[i])[j] - placed[i][j]) < 1e-10);
    }
  }
});
