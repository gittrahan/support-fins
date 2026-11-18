import assert from "node:assert/strict";
import { computeFins } from "../../shared/engine/fins_entry.js";
import { clearances } from "../../shared/engine/seat.js";
import { ENGINE_DEFAULTS } from "../../shared/engine/fins_entry.js";
import { analyze, buildTopology, IDENTITY3 } from "../../../web/overhangs.js";
import { buildFins } from "../../../web/fins.js";
import { plateFinCache, validateTurnSet } from "../project-turning.js";
import { dimensions, finOptions, roofBody } from "./_turning-fixture.js";
Deno.test("shared turning engine and adapter return identical geometry", async () => {
  const positions = await roofBody(),
    opts = { ...ENGINE_DEFAULTS, ...finOptions },
    turning = { dimensions };
  const topo = buildTopology({ getAttribute: () => ({ array: positions }) }),
    analysis = analyze(topo, opts.threshold, IDENTITY3);
  const before = structuredClone(analysis);
  const built = buildFins(topo, analysis, IDENTITY3, {
    ...opts,
    ...clearances(opts),
    turning,
  });
  const adapter = computeFins(positions, { ...opts, turning });
  assert.equal(built.turning.turnedFins, 1);
  assert.deepEqual(
    Float32Array.from(built.triangles.flatMap((p) => p.slice(0, 3))),
    adapter.triangles,
  );
  assert.deepEqual(analysis, before);
  assert.deepEqual(
    computeFins(positions, { ...opts, turning: false }).triangles,
    computeFins(positions, opts).triangles,
  );
});
Deno.test("short upper clearance retains the complete ordinary wall", async () => {
  const positions = await roofBody(.5, .8, true, 34),
    a = computeFins(positions, finOptions),
    b = computeFins(positions, { ...finOptions, turning: { dimensions } });
  assert.equal(b.stats.turnedFins, 0);
  assert.match(b.stats.turningReasons.join(), /height/);
  assert.deepEqual(a.triangles, b.triangles);
});
Deno.test("neighbor fins computed once per plate; errors cached and plate resources released", () => {
  let calls = 0;
  const cache = plateFinCache((pos) => {
    calls++;
    if (pos[0] === -1) throw Error("uninspectable");
    return { triangles: Float32Array.from(pos), offset: { x: 1, y: 2, z: 3 } };
  });
  const a = cache.get("one", 1, [1, 2, 3], {});
  assert.deepEqual([...a], [0, 0, 0]);
  assert.strictEqual(cache.get("one", 1, [7, 8, 9], {}), a);
  assert.equal(calls, 1);
  assert.throws(() => cache.get("one", 2, [-1], {}));
  assert.throws(() => cache.get("one", 2, [1], {}));
  assert.equal(calls, 2);
  cache.get("two", 1, [1, 2, 3], {});
  assert.equal(calls, 3);
  cache.clear();
  cache.get("two", 1, [1, 2, 3], {});
  assert.equal(calls, 4);
  cache.get("two", 1, [1, 2, 3], { nozzle: .4 });
  assert.equal(calls, 5, "changed effective options must recompute");
  cache.get("two", 1, [1, 2, 3], { nozzle: .4 });
  assert.equal(calls, 5);
});

Deno.test("different first layer and translated Z retain world schedule registration", async () => {
  const positions = await roofBody(.5, .8, false), z = 8;
  for (let i = 2; i < positions.length; i += 3) positions[i] += z;
  const generated = computeFins(positions, {
    ...finOptions,
    turning: { dimensions: { ...dimensions, firstLayerHeight: .28 } },
  });
  assert.equal(generated.stats.turnedFins, 1);
  const d = generated.stats.turningDetails[0];
  for (const key of ["firstPrintZ", "lastPrintZ"]) {
    const n = (d[key] - generated.offset.z - .28) / .4;
    assert(Math.abs(n - Math.round(n)) < 1e-8);
  }
});

Deno.test("worker and inline shared turning use identical geometry and metadata", async () => {
  const positions = await roofBody(.5, .8, false),
    options = { ...ENGINE_DEFAULTS, ...finOptions };
  const topo = buildTopology({ getAttribute: () => ({ array: positions }) }),
    result = analyze(topo, options.threshold, IDENTITY3);
  const opts = { ...options, ...clearances(options), turning: { dimensions } };
  const payload = structuredClone({
    id: 17,
    topology: topo,
    result,
    rot: IDENTITY3,
    opts,
  });
  const expected = buildFins(topo, result, IDENTITY3, opts);
  const worker = new Worker(
    new URL("../../../web/finworker.js", import.meta.url).href,
    { type: "module" },
  );
  let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error("turn worker timeout")), 30000);
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(Error(e.message));
      worker.postMessage(payload);
    });
    assert.equal(response.id, 17);
    assert.equal(response.error, undefined);
    assert.deepEqual(response.built, expected);
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
});

Deno.test("automatic two-ended bridge keeps crossing walls instead of turning along roof strands", async () => {
  const positions = await roofBody(.5, .8, false);
  for (const nozzle of [.4, .8]) {
    const options = { ...finOptions, nozzle, layerHeight: nozzle / 2 };
    const plain = computeFins(positions, options),
      on = computeFins(positions, {
        ...options,
        turning: {
          dimensions: {
            ...dimensions,
            bridgeAngle: null,
            nozzle,
            lineWidth: nozzle + .02,
            layerHeight: nozzle / 2,
            firstLayerHeight: nozzle / 2,
          },
        },
      });
    assert.equal(on.stats.turnedFins, 0);
    assert.deepEqual(on.triangles, plain.triangles);
  }
});

Deno.test("plate validation repeats when a refused turn frees another candidate", async () => {
  const checked = [], builds = [];
  const generate = (disabled) => {
    builds.push([...disabled]);
    const pieces = disabled.includes("a")
      ? disabled.includes("b") ? ["c"] : ["b", "c"]
      : ["a", "c"];
    return {
      stats: {
        turningDetails: pieces.map((piece) => ({ piece })),
        turningReasons: [],
      },
    };
  };
  const result = await validateTurnSet(generate, async (_, d) => {
    checked.push(d.piece);
    if (d.piece !== "c") throw Error("blocked neighbor");
  });
  assert.deepEqual(builds, [[], ["a"], ["a", "b"]]);
  assert.deepEqual(checked, ["a", "c", "b", "c", "c"]);
  assert.deepEqual(result.stats.turningDetails, [{ piece: "c" }]);
  assert.equal(result.stats.turningReasons.length, 2);
  await assert.rejects(
    () =>
      validateTurnSet(
        () => ({
          stats: { turningDetails: [{ piece: "a" }], turningReasons: [] },
        }),
        () => {
          throw Error("blocked");
        },
      ),
    /repeated a rejected/,
  );
});
