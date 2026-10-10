/** Cached Draw coordinator. Newest-only queue on the page serializes its jobs. */
import { buildDrawn } from './draw-build.js';
import { drawnWall } from './draw.js';
import { applyTunables, buildFins } from './fins.js';
import { seatedPartTris } from './fins/seating.js';
import { DrawPool } from './draw-pool.js';
let topology, poseKey, partTris, pool, idleTimer, restricted = false;
self.onmessage = async ({ data }) => {
  if ('control' in data) { restricted = !!data.control.restricted; pool?.pressure(restricted); return; }
  const { id, model, job } = data;
  clearTimeout(idleTimer);
  try {
    if (model) { pool?.dispose(); topology = model; poseKey = null; pool = null; }
    if (!topology) throw new Error('No model was sent to the Draw worker');
    if (job.kind === 'auto') {
      // Auto runs alone in this queue. Retain the policy and warm wall caches.
      const t0 = performance.now();
      const built = buildFins(topology, job.result, job.rot, job.opts);
      self.postMessage({ id, built, workers: 1, computeMs: performance.now() - t0 });
      return;
    }
    pool ??= new DrawPool(topology, job.hardware ?? {});
    pool.pressure(restricted || !!job.restricted);
    const key = JSON.stringify([job.rot, job.result.offset]);
    if (key !== poseKey) {
      partTris = seatedPartTris(topology, job.rot, job.result.offset); poseKey = key;
    }
    const t0 = performance.now();
    applyTunables(job.options.tunables);
    const serial = () => buildDrawn(topology, job.result, job.rot, job.requests, job.options, job.avoid, partTris);
    let built, workers = 1, fallback;
    if (job.kind === 'preview') built = drawnWall(job.a, job.b, partTris, 0);
    else {
      const reply = await pool.build(job, serial);
      workers = reply.workers; fallback = reply.fallback;
      built = reply.built ?? buildDrawn(topology, job.result, job.rot, job.requests,
        job.options, job.avoid, partTris, reply.candidates);
    }
    self.postMessage({ id, built, workers, fallback, computeMs: performance.now() - t0 });
  } catch (err) { self.postMessage({ id, error: String(err?.stack ?? err) }); }
  finally {
    idleTimer = setTimeout(() => { pool?.dispose(); pool = null; }, 30000);
  }
};
