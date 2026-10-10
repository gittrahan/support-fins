/** Keep a busy notice visible until all current background stages finish. */
export class BuildActivity {
  pending = new Set();
  timer = null;
  visible = false;
  constructor(show, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id), delay = 150) {
    Object.assign(this, { show, schedule, cancel, delay });
  }
  set(stage, busy) {
    if (busy) this.pending.add(stage);
    else this.pending.delete(stage);
    if (this.pending.size) {
      if (!this.visible && this.timer === null) this.timer = this.schedule(() => {
        this.timer = null;
        this.visible = true;
        this.show(true);
      }, this.delay);
    } else {
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = null;
      if (this.visible) { this.visible = false; this.show(false); }
    }
  }
}
