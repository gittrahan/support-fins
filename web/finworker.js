// Off-main-thread support generation.
//
// buildFins -- and everything it imports (prop.js + web/prop/, inside.js, planes.js,
// overhangs.js) -- is pure mesh math with no DOM or three.js dependency; that is
// exactly why prototype/verify_fins.js can run it headless. So the whole build
// moves into a Worker. On a large or badly-posed part a single build can take a
// couple of seconds, and running it inline froze the entire page (orbit,
// buttons, sliders) until it finished. Here the main thread posts the topology +
// analysis + pose + options, we build, and post the triangles back; the page
// stays live the whole time.
//
// `analyze` deliberately stays on the main thread: it is ~1-2ms even on a big
// part and its result is shared with draw/orient/export, so duplicating it here
// would only add a place for the two to drift.
import { buildFins } from './fins.js';
import { liveProgress } from './fins/progress.js';

self.onmessage = (e) => {
  const { id, topology, result, rot, opts } = e.data;
  try {
    // A live Full build (ui/livebuild.js): its walls and bar posted as they go
    // (fins/progress.js), the triangles transferred, not copied
    const progress = opts.live ? liveProgress(opts, (m) => self.postMessage({ id, progress: m }, m.tris ? [m.tris.buffer] : []))
      : undefined;
    const built = buildFins(topology, result, rot, progress ? { ...opts, progress } : opts);
    self.postMessage({ id, built });
  } catch (err) {
    // Report rather than die silently -- the main thread falls back to an inline
    // build so a worker-only failure never leaves the user with no support.
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
