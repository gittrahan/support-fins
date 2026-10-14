/**
 * Curved walls (issue #25, prop/curved.js), judged on the whole build. With the box
 * ticked, a bending region's downhill walls win their race on holding as much at
 * any weight -- but what builds around them (wedges, short walls, the fill pass)
 * can come out differently, and the downhill judge only compares against the build
 * WITHOUT downhill walls. So the build with the box unticked is built too, and the
 * curved one is kept only if it holds at least as much, grips no higher and keeps
 * every wedge: the box costs plastic, never support.
 */
import { judgeSwap, usedDownhill } from './downhill.js';

/** `build(curvedWalls)` is Auto's judged build with opts.curvedWalls set. */
export const judgeCurved = (topo, result, rot, build) => judgeSwap(topo, result, rot, build, usedDownhill);
