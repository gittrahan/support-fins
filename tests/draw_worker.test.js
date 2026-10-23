import { LatestWorker } from "../web/worker-queue.js";
import { buildDrawn } from "../web/draw-build.js";
import { printTriangles } from "../web/draw-build.js";
import { drawnWall } from "../web/draw.js";
import { swayAtFace } from "../web/sway.js";
import { block, buildTopology, loadModel, rotX } from "./_util.js";
import { analyze, assert, blockTopo, fins, isClosed, prop } from "./_util.js";
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
Deno.test("Draw worker: a two-point wall has the exact current engine geometry and owned range", async () => {
  const topology = loadModel("cube"),
    rot = rotX(40),
    result = analyze(topology, 45, rot),
    q = new LatestWorker(new URL("../web/drawworker.js", import.meta.url));
  const requests = [{ a: [-15, 13, 13], b: [15, 13, 13] }];
  try {
    for (const [nozzle, iface] of [[0.4, false], [0.8, "all"]]) {
      const options = {
        draw: {
          tines: true,
          tineDensity: .5,
          layerHeight: .2,
          braceTall: true,
        },
        tunables: { nozzle, wallLines: 2, iface, tineDir: "horizontal" },
      };
      fins.applyTunables(options.tunables);
      const direct = drawnWall(
        requests[0].a,
        requests[0].b,
        printTriangles(topology, rot, result.offset),
        0,
        { ...options.draw, topo: topology, rot, offset: result.offset },
      );
      const b = (await q.run("build", topology, {
        kind: "build",
        rot,
        result,
        requests,
        options,
      })).built;
      assert(
        direct.ok && b.items[0].ok,
        direct.reason ?? b.items[0].info.reason,
      );
      assert(JSON.stringify(b.triangles) === JSON.stringify(direct.tris));
      assert(
        b.items[0].triEnd * 3 === b.triangles.length && isClosed(b.triangles),
      );
    }
  } finally {
    q.dispose();
    fins.applyTunables({ nozzle: .4, wallLines: 2, iface: false });
  }
});
Deno.test("Draw worker: current tall-wall ribs avoid earlier supports and keep each result owned", () => {
  const pos = Float32Array.from([
    ...block(0, 10, 0, 20, 0, 112),
    ...block(10, 70, 0, 20, 110, 112),
  ]);
  const topology = buildTopology({ getAttribute: () => ({ array: pos }) }),
    result = analyze(topology, 45, ID),
    o = result.offset;
  const at = (x, y) => [x + o.x, y + o.y, 110 + o.z];
  const requests = [{ a: at(20, 5), b: at(60, 5) }, {
      a: at(20, 15),
      b: at(60, 15),
    }],
    options = {
      draw: { braceTall: true, tines: true, layerHeight: .2 },
      tunables: { nozzle: .4, wallLines: 2 },
    };
  const b = buildDrawn(topology, result, ID, requests, options);
  assert(b.items.every((w) => w.ok));
  assert(
    b.items[0].info.braces > 0 && b.items[0].triEnd === b.items[1].triStart,
  );
  for (const w of b.items) {
    assert(isClosed(b.triangles.slice(w.triStart * 3, w.triEnd * 3)));
  }
  assert(b.items.at(-1).triEnd * 3 === b.triangles.length);
});
class FakeWorker {
  messages = [];
  postMessage(m) {
    this.messages.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(error) {
    const last = this.messages.at(-1);
    this.onmessage({ data: { id: last.id, error, built: { ok: true } } });
  }
}
Deno.test("Draw queue: only the latest preview waits; committed placements and rebuilds have priority", async () => {
  const worker = new FakeWorker(),
    q = new LatestWorker("", () => worker),
    model = { pos: [], vid: [1], _vgraph: [1], _insideGrid: { cell: () => 0 } };
  const active = q.run("preview", model, { n: 1 }),
    dropped = q.run("preview", model, { n: 2 }),
    latest = q.run("preview", model, { n: 3 });
  const build = q.run("build", model, { n: 4 }),
    place = q.run("place", model, { n: 5 });
  assert(await dropped === null);
  assert(
    !("_insideGrid" in worker.messages[0].model) &&
      !("vid" in worker.messages[0].model),
  );
  worker.reply();
  assert(await active === null);
  for (const [n, promise] of [[5, place], [4, build], [3, latest]]) {
    assert(worker.messages.at(-1).job.n === n);
    assert(!worker.messages.at(-1).model);
    worker.reply();
    assert(await promise);
  }
  q.dispose();
});
Deno.test("Draw queue: a changed model, cancelled request and old worker errors cannot change fresh work", async () => {
  const workers = [],
    q = new LatestWorker("", () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
  const old = q.run("build", { pos: [1] }, {}),
    fresh = q.run("build", { pos: [2] }, {});
  assert(await old === null && workers[0].terminated);
  workers[0].onerror({ preventDefault() {} });
  assert(!workers[1].terminated);
  q.cancel("build");
  workers[1].reply();
  assert(await fresh === null);
  q.dispose();
});
Deno.test("Draw queue: worker errors and unreadable replies retry once, then settle with a recoverable error", async () => {
  const workers = [],
    q = new LatestWorker("", () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
  const promise = q.run("place", { pos: [] }, {});
  workers[0].reply("failed");
  assert(workers.length === 2 && workers[0].terminated);
  workers[1].onmessageerror();
  let error;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert(error && workers.length === 2 && !q.active && !q.pending.size);
  const next = q.run("place", q.model, {});
  workers[2].reply();
  assert(await next);
  q.dispose();
});
Deno.test("Draw queue: unavailable workers settle after two attempts without an inline calculation", async () => {
  let attempts = 0;
  const q = new LatestWorker("", () => {
    attempts++;
    throw Error("unavailable");
  });
  let failed = false;
  try {
    await q.run("build", { pos: [] }, {});
  } catch {
    failed = true;
  }
  assert(failed && attempts === 2 && !q.active);
});
function brace() {
  const topology = blockTopo(-40, 40, -5, 5, 0, 200),
    result = analyze(topology, 45, ID);
  const face = Array.from({ length: topology.nFaces }, (_, f) => f).find((f) =>
    topology.nrm[f * 3 + 1] < -.9
  );
  return {
    topology,
    result,
    requests: [{ kind: "sway", face, a: [0, -5, 180] }],
  };
}
Deno.test("Draw worker: current Sway meshes, contacts and ownership survive FDM/resin settings and worker reuse", async () => {
  const { topology, result, requests } = brace(),
    q = new LatestWorker(new URL("../web/drawworker.js", import.meta.url));
  try {
    for (
      const [tineDir, nozzle, roundFeet, iface] of [
        ["horizontal", 0.4, false, false],
        ["horizontal", 0.8, true, "all"],
        ["vertical", 0.4, true, "all"],
        ["horizontal", 0.4, false, false],
      ]
    ) {
      const options = {
        sway: { tines: true, iface, layerHeight: 0.2, crossAbove: 100 },
        draw: { tines: true, layerHeight: 0.2 },
        tunables: { tineDir, nozzle, roundFeet, iface, wallLines: 2 },
      };
      const b = (await q.run("build", topology, {
        kind: "build",
        rot: ID,
        result,
        requests,
        options,
      })).built;
      assert(
        b.items[0].ok && b.items[0].info.tines >= 3,
        b.items[0].info.reason,
      );
      fins.applyTunables(options.tunables);
      const req = requests[0],
        direct = swayAtFace(
          topology,
          result,
          ID,
          req.face,
          req.a,
          { ...options.sway, full: true },
          { braces: [], walls: [] },
        );
      assert(
        direct.ok &&
          JSON.stringify(b.triangles) === JSON.stringify(direct.tris),
      );
      assert(
        b.items[0].triStart === 0 &&
          b.items[0].triEnd * 3 === b.triangles.length && isClosed(b.triangles),
      );
      const { body, iface: contact } = prop.splitInterface(b.triangles);
      assert(isClosed(body) && isClosed(contact));
    }
  } finally {
    q.dispose();
    fins.applyTunables({
      tineDir: "horizontal",
      nozzle: 0.4,
      wallLines: 2,
      iface: false,
    });
  }
});
Deno.test("Draw worker: an ordinary brace keeps full-height snapping and a 1 mm clicked-height cap", async () => {
  const { topology, result, requests } = brace(),
    q = new LatestWorker(new URL("../web/drawworker.js", import.meta.url)),
    options = {
      sway: { tines: true, layerHeight: 0.2 },
      tunables: { nozzle: 0.4, wallLines: 2 },
    },
    face = requests[0].face;
  try {
    for (const [z, full, cappedZ] of [[180, true, 180], [41.3, false, 41]]) {
      const point = [0, -5, z];
      const b = (await q.run("place", topology, {
        kind: "brace",
        face,
        point,
        rot: ID,
        result,
        options,
      })).built;
      fins.applyTunables(options.tunables);
      const direct = swayAtFace(topology, result, ID, face, [0, -5, cappedZ], {
        ...options.sway,
        full,
      }, { braces: [], walls: [] });
      assert(b.r.ok && direct.ok && b.full === full);
      assert(b.point[2] === cappedZ && b.r.tines >= 3);
      assert(JSON.stringify(b.r.tris) === JSON.stringify(direct.tris));
    }
  } finally {
    q.dispose();
    fins.applyTunables({ nozzle: 0.4, wallLines: 2 });
  }
});
Deno.test("Draw worker: duplicate/facing collision rules and removed Auto braces retain their meaning", () => {
  const { topology, result, requests } = brace(),
    options = {
      sway: { tines: true, layerHeight: 0.2 },
      tunables: { nozzle: 0.4, wallLines: 2 },
    };
  const first = buildDrawn(topology, result, ID, requests, options);
  assert(first.items[0].ok);
  const duplicate = buildDrawn(
    topology,
    result,
    ID,
    [requests[0], requests[0]],
    options,
  );
  assert(
    duplicate.items[0].ok && !duplicate.items[1].ok &&
      duplicate.items[1].triStart === duplicate.items[1].triEnd,
  );
  assert(
    JSON.stringify(duplicate.triangles) === JSON.stringify(first.triangles),
  );
  const auto = {
    triangles: first.triangles,
    padTriangles: [],
    fins: [{ id: 42, kind: "sway", triRanges: [[0, first.triangles.length]] }],
    sway: { braces: [first.items[0].info] },
  };
  assert(
    !buildDrawn(topology, result, ID, requests, { ...options, auto }).items[0]
      .ok,
  );
  assert(
    buildDrawn(topology, result, ID, requests, { ...options, auto, gone: [42] })
      .items[0].ok,
  );
});
