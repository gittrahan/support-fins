import { LatestWorker } from './worker-queue.js';
import { CpuPolicy, workerLimit } from './cpu-policy.js';

/** Only independent walls fan out; assembly and Sway remain on the coordinator. */
export class DrawPool {
  constructor(model, hardware, makeQueue = () => new LatestWorker(new URL('./wallworker.js', import.meta.url)),
      now = () => performance.now()) {
    this.model = model; this.makeQueue = makeQueue; this.now = now;
    this.policy = new CpuPolicy(workerLimit(hardware, model), now);
    this.queues = [];
  }
  pressure(value) { this.policy.pressure(value); }
  dispose() { this.queues.forEach((q) => q.dispose()); this.queues = []; }
  trim(n) {
    while (this.queues.length > n) this.queues.pop().dispose();
  }
  async build(job, serial) {
    const indices = job.requests.flatMap((w, i) => w.kind === 'sway' ? [] : [i]);
    const width = this.policy.choose(indices.length);
    if (width <= 1) {
      this.trim(0);
      const start = this.now(), built = serial();
      this.policy.observe({ width: 1, count: indices.length, workMs: this.now() - start,
        elapsedMs: this.now() - start });
      return { built, workers: 1 };
    }
    const cold = this.queues.length < width;
    while (this.queues.length < width) this.queues.push(this.makeQueue());
    let next = 0, workMs = 0;
    const candidates = [], start = this.now();
    try {
      await Promise.all(this.queues.slice(0, width).map(async (q, lane) => {
        while (next < indices.length) {
          // Pressure stops extra lanes between jobs; already running jobs finish.
          if (lane >= this.policy.choose(indices.length)) return;
          const i = indices[next++], w = job.requests[i];
          const reply = await q.run('build', this.model, { ...job, requests: undefined, avoid: undefined, ...w });
          if (!reply) throw new Error('Independent wall job was cancelled');
          candidates[i] = reply.built; workMs += reply.computeMs;
        }
      }));
      // lane 0 drains any remaining jobs after a pressure reduction.
      this.policy.observe({ width, count: indices.length, workMs, elapsedMs: this.now() - start, cold });
      return { candidates, workers: width };
    } catch (error) {
      this.dispose(); this.policy.pressure(true);
      // Recover in the coordinator worker, never on the UI thread.
      return { built: serial(), workers: 1, fallback: String(error) };
    } finally { this.trim(this.policy.choose(indices.length) <= 1 ? 0 : width); }
  }
}
