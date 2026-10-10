/** One active job and one latest pending job per channel; no unbounded preview queue. */
export class LatestWorker {
  constructor(url, makeWorker = (u) => new Worker(u, { type: 'module' })) {
    this.url = url; this.makeWorker = makeWorker;
    this.pending = new Map(); this.latest = new Map(); this.serial = 0;
  }
  run(channel, model, job) {
    if (this.model !== model) { this.dispose(); this.model = model; }
    const id = ++this.serial;
    this.latest.set(channel, id);
    this.pending.get(channel)?.resolve(null);
    return new Promise((resolve, reject) => {
      this.pending.set(channel, { channel, id, job, resolve, reject });
      this.pump();
    });
  }
  cancel(channel) {
    this.latest.delete(channel);
    this.pending.get(channel)?.resolve(null);
    this.pending.delete(channel);
  }
  control(value) {
    this.controlValue = value;
    this.worker?.postMessage({ control: value });
  }
  dispose() {
    this.worker?.terminate(); this.worker = null; this.sentModel = null;
    this.active?.resolve(null); this.active = null;
    for (const q of this.pending.values()) q.resolve(null);
    this.pending.clear(); this.latest.clear();
  }
  fail(error) {
    const current = this.active;
    // Auto/seating gets one fresh-worker retry. Preserve pending Draw work, and
    // never retry an obsolete pose or execute heavy geometry on the UI thread.
    if (current?.channel === 'auto' && ((current.attempts ?? 0) < 1
        || this.latest.get('auto') !== current.id)) {
      this.worker?.terminate(); this.worker = null; this.sentModel = null;
      this.active = null;
      if (this.latest.get('auto') === current.id) {
        current.attempts = 1;
        this.pending.set('auto', current);
      } else current.resolve(null);
      this.pump();
      return;
    }
    this.active?.reject(error); this.active = null;
    for (const q of this.pending.values()) q.reject(error);
    this.pending.clear(); this.latest.clear();
    this.worker?.terminate(); this.worker = null; this.sentModel = null;
  }
  pump() {
    if (this.active || !this.pending.size) return;
    // Committed supports take priority over hover previews.
    const key = this.pending.has('auto') ? 'auto'
      : this.pending.has('build') ? 'build' : this.pending.keys().next().value;
    const q = this.pending.get(key);
    this.pending.delete(key); this.active = q;
    try {
      if (!this.worker) {
        const worker = this.makeWorker(this.url);
        this.worker = worker;
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker) return;
          const current = this.active;
          if (!current || data.id !== current.id) return;
          this.active = null;
          if (data.error && current.channel === 'auto') {
            this.active = current;
            this.fail(new Error(data.error));
            return;
          }
          if (data.error) current.reject(new Error(data.error));
          else current.resolve(this.latest.get(current.channel) === current.id ? data : null);
          this.pump();
        };
        worker.onerror = () => {
          if (this.worker === worker) this.fail(new Error('Background geometry worker failed. Try again or reload.'));
        };
      }
      let model;
      if (this.sentModel !== this.model) {
        model = { ...this.model };
        delete model._insideGrid; // This cache contains functions; the worker rebuilds it.
      }
      if (this.controlValue) this.worker.postMessage({ control: this.controlValue });
      this.worker.postMessage({ id: q.id, model, job: q.job });
      this.sentModel = this.model;
    } catch (error) { this.fail(error); }
  }
}
