/** Independent ordinary-wall kernel. No ordered placement decisions happen here. */
import { drawnWall } from './draw.js';
import { applyTunables } from './fins.js';
import { seatedPartTris } from './fins/seating.js';
let topology, poseKey, tris;
self.onmessage = ({ data: { id, model, job } }) => {
  try {
    const start = performance.now();
    if (model) { topology = model; poseKey = null; }
    const key = JSON.stringify([job.rot, job.result.offset]);
    if (key !== poseKey) {
      tris = seatedPartTris(topology, job.rot, job.result.offset); poseKey = key;
    }
    applyTunables(job.options.tunables);
    const built = drawnWall(job.a, job.b, tris, 0,
      { ...job.options.draw, topo: topology, rot: job.rot, offset: job.result.offset });
    self.postMessage({ id, built, computeMs: performance.now() - start });
  } catch (error) { self.postMessage({ id, error: String(error?.stack ?? error) }); }
};
