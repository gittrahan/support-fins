/**
 * LIVE PROGRESS for a Full coverage build (ui/livebuild.js shows it; finworker.js
 * wires it). Matthew 2026-11-04: Full should "build fins and pop them in so it looks
 * kind of interactive", with a progress bar -- a big part takes 30 s and more.
 *
 * WHAT IS SHOWN. A Full build lays up to four layouts and keeps the best: the whole
 * build twice when a downhill wall swaps in (fins/downhill.js, `run(true)` first), and
 * within each, the fill pass twice -- without Long walls rows, then with
 * (fins/fill.js fillCoverage, the plain one first). Only the FIRST layout's walls
 * are posted as they go in: its Auto walls, then its plain fill run's walls one by
 * one. The rest only move the bar ("comparing layouts"), so nothing pops in and
 * then vanishes; the build that lands at the end may be another layout.
 *
 * STOP. The Worker can't be told anything mid-build (one synchronous call, and the
 * site isn't cross-origin isolated, so no shared flag). Stop ends it and builds the
 * shown layout alone (`stopOpts`): the first layout's options, the plain fill run,
 * and `fillStopAt` the walls shown. The build is deterministic, so those are the
 * same walls, in a complete build (pad, braces, readout) that says it stopped.
 *
 * THE BAR. Units: per whole build 1 for Auto + 2 per fill run, the most that can run
 * (both builds, both fill runs). A fill run's share moves with the most-used of its
 * FILL budgets (walls, tries, checks). A layout that doesn't run is skipped, so the
 * bar only ever jumps forward; it stops short of full until the build lands.
 *
 * Nothing here changes what is built: the engine only calls `auto`, `fillRun` and
 * the run's `wall` / `tick`, and reads nothing back.
 */
import { FILL } from './fill.js';

/** xyz of a triangle list ([x, y, z(, tag)] vertices) as one Float32Array, for a
 *  transferable post. */
export function flatTris(tris) {
  const out = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) { const v = tris[i]; out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2]; }
  return out;
}

/** The fill budget used so far, 0..1: the most-used of FILL's caps. */
export const budgetUsed = (s) => Math.min(1, Math.max(s.walls / FILL.maxWalls, s.tries / FILL.maxTries, s.checks / FILL.maxChecks));

/**
 * The progress reporter a Full build carries as `opts.progress`. `post(msg)` gets
 * { type: 'auto', tris } (the first layout's Auto walls, a Float32Array), { type:
 * 'wall', tris } (each of its fill walls as it goes in) and { type: 'tick', frac,
 * phase: 'auto' | 'fill' | 'compare', walls } (the bar; at most every `every` ms
 * unless the phase changes). `now` is injectable for tests.
 */
export function liveProgress(opts, post, { now = () => performance.now(), every = 100 } = {}) {
  const builds = opts.downhill === undefined && opts.raster !== false ? 2 : 1;
  const runs = opts.longWalls !== false && (opts.coverage ?? 0.5) >= FILL.sparseBelow ? 2 : 1;
  const per = 1 + 2 * runs, total = builds * per;
  let autos = 0, fills = 0, frac = 0, last = -Infinity, phase = 'auto', shown = 0;
  const tick = (base, part, ph) => {
    frac = Math.max(frac, Math.min(0.99, (base + part) / total));
    const t = now();
    if (ph === phase && t - last < every) return;
    phase = ph; last = t;
    post({ type: 'tick', frac, phase, walls: shown });
  };
  return {
    /** One layout's Auto walls are built and its fill pass starts. */
    auto(tris) {
      const k = autos++;
      fills = 0;
      if (k === 0) post({ type: 'auto', tris: flatTris(tris) });
      tick(k * per + 1, 0, k === 0 ? 'fill' : 'compare');
    },
    /** A fill run starts: its `wall(tris)` and `tick(stats)`. */
    fillRun() {
      const k = Math.max(0, autos - 1), j = fills++;
      const live = k === 0 && j === 0, base = k * per + 1 + 2 * j, ph = live ? 'fill' : 'compare';
      tick(base, 0, ph);
      return {
        live,
        wall(tris) {
          if (!live) return;
          shown++;
          post({ type: 'wall', tris: flatTris(tris) });
        },
        tick(stats) { tick(base, 2 * budgetUsed(stats), ph); },
      };
    },
    /** The walls posted so far (Stop builds this many). */
    get shown() { return shown; },
  };
}

/**
 * The request that builds what was shown, alone: the first layout (downhill walls
 * on, as fins/downhill.js runs first), the plain fill run (no rows), stopped after
 * `walls` fill walls. `opts` is the original request.
 */
export function stopOpts(opts, walls) {
  // (a request that names its downhill build, or turns the races off, built one only)
  const downhill = opts.downhill ?? (opts.raster === false ? false : true);
  return { ...opts, downhill, longWalls: false, fillStopAt: walls, progress: undefined };
}
