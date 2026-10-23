/** One cached geometry worker; no adaptive pool and no main-thread geometry fallback. */
import { buildDrawn, printTriangles } from "./draw-build.js";
let topology, poseKey, partTris;
self.onmessage = ({ data }) => {
  const { id, model, job } = data;
  try {
    if (model) {
      topology = model;
      poseKey = null;
      partTris = null;
    }
    if (!topology) throw Error("No model supplied to background geometry");
    const key = JSON.stringify([job.rot, job.result.offset]);
    if (key !== poseKey) {
      partTris = printTriangles(topology, job.rot, job.result.offset);
      poseKey = key;
    }
    const run = (requests) =>
      buildDrawn(
        topology,
        job.result,
        job.rot,
        requests,
        job.options,
        job.avoid,
        partTris,
      );
    if (job.kind === "brace") {
      const request = {
        kind: "sway",
        face: job.face,
        a: job.point,
      };
      let built = run([request]),
        r = { ...built.items[0].info, tris: built.triangles },
        full = true,
        point = job.point;
      if (r.ok && job.point[2] < 0.75 * r.height) {
        point = [...job.point];
        point[2] = Math.max(1, Math.round(point[2]));
        built = run([{ ...request, a: point, capped: true }]);
        r = { ...built.items[0].info, tris: built.triangles };
        full = false;
      }
      self.postMessage({ id, built: { r, full, point } });
      return;
    }
    self.postMessage({ id, built: run(job.requests) });
  } catch (e) {
    self.postMessage({ id, error: String(e?.stack ?? e) });
  }
};
