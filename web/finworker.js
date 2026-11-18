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
import { buildFins, inspectFins } from './fins.js';
import { liveProgress } from './fins/progress.js';

let inspection = null; // one completed request, released after inspection/supersession
self.onmessage = (e) => {
  if (e.data.type === 'inspect') {
    const request = inspection;
    inspection = null;
    if (!request || request.id !== e.data.id) return;
    const { id, topology, result, rot, opts, built } = request;
    try { self.postMessage({ id, inspection: inspectFins(topology, result, rot, built, opts) }); }
    catch (error) { self.postMessage({ id, inspectionError: String(error?.stack || error) }); }
    return;
  }
  const { id, topology, result, rot, opts } = e.data;
  inspection = null;
  try {
    // A live Full build (ui/livebuild.js): its walls and bar posted as they go
    // (fins/progress.js), the triangles transferred, not copied
    const progress = opts.live ? liveProgress(opts, (m) => self.postMessage({ id, progress: m }, m.tris ? [m.tris.buffer] : []))
      : undefined;
    const built = buildFins(topology, result, rot, { ...opts, progress, diagnostics: null });
    if (opts.diagnostics && opts.tunables?.tineDir !== 'vertical'
        && ['auto', 'full', 'stabilize'].includes(opts.mode)) inspection = { id, topology, result, rot, opts, built };
    self.postMessage({ id, built });
  } catch (err) {
    // Report rather than die silently -- the main thread falls back to an inline
    // build so a worker-only failure never leaves the user with no support.
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
