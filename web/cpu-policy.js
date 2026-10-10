/** Browser hints set ceilings, never a promise to reserve OS cores or free RAM. */
const MiB = 1024 * 1024;
export function workerLimit(hardware = {}, model = {}) {
  const cores = Number.isFinite(hardware.cores) ? Math.max(1, Math.floor(hardware.cores)) : 2;
  const cpu = Math.max(1, Math.min(4, Math.floor(cores / 2)));
  const memory = Number.isFinite(hardware.memory) && hardware.memory > 0 ? hardware.memory : 4;
  const budget = Math.max(64, Math.min(512, memory * 1024 / 16)) * MiB;
  // Typed arrays + posed triangles + conservative per-face grids/scratch allowance.
  const arrays = Object.values(model).reduce((n, a) => n + (ArrayBuffer.isView(a) ? a.byteLength : 0), 0);
  const copy = arrays + Math.max(0, model.nFaces ?? 0) * 232 + MiB;
  // Reserve the UI, coordinator and automatic scratch before child copies.
  return Math.max(1, Math.min(cpu, Math.floor(budget / copy) - 3));
}

export class CpuPolicy {
  constructor(limit = 1, now = () => performance.now()) {
    this.limit = limit; this.now = now; this.width = 1; this.holdUntil = 0;
    this.restricted = false;
  }
  pressure(restricted) {
    this.restricted = restricted;
    if (restricted) { this.width = 1; this.holdUntil = this.now() + 10000; }
  }
  choose(count) {
    return this.restricted || this.now() < this.holdUntil
      ? 1 : Math.min(this.width, this.limit, count);
  }
  observe({ width, count, workMs, elapsedMs, cold = false }) {
    if (this.restricted || this.now() < this.holdUntil) return;
    // Allow one warm observation before judging new worker/module startup costs.
    // Never add another lane until the current warm pool demonstrates a gain.
    if (width > 1 && cold) { this.width = width; return; }
    if (width > 1 && (!(elapsedMs > 0) || !Number.isFinite(workMs)
        || !Number.isFinite(elapsedMs) || workMs / elapsedMs < 1.15)) {
      this.width = 1; this.holdUntil = this.now() + 30000;
    } else if (count >= 4 && workMs >= 40) {
      // One step per measured batch; warm message transfers count as overhead.
      this.width = Math.min(this.limit, width + 1);
    } else {
      this.width = width; // Tiny jobs cannot justify starting more workers.
    }
  }
}
