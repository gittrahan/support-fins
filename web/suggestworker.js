// Off-main-thread Suggest orientation.
//
// suggestOrientations analyses every candidate pose and then runs a full support
// build on the finalists to score them. On a 250k-face figure that was 15-35 s with
// the page frozen (no orbit, no Cancel, the browser offering to kill the tab). It
// is pure mesh math like buildFins, so it runs here, the way finworker.js runs the
// support build.
//
// The finalists' builds read the engine's settings (gap, pad, nozzle, wall lines,
// ...), and this Worker has its own copy of those modules that never sees the
// page's fields -- so the page sends the same tunables an Auto build sends, and
// they are applied before ranking. Without that a changed Support gap would rank
// with the default gap.
import { applyTunables } from './fins.js';
import { suggestOrientations } from './orient.js';

self.onmessage = (e) => {
  const { id, topology, threshold, tunables } = e.data;
  try {
    applyTunables(tunables);
    self.postMessage({ id, ranked: suggestOrientations(topology, { top: 3, threshold }) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
