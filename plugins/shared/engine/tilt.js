// A tilt to try, for a host whose fins left overhangs too shallow for a fin this way up
// (#477). The site's Suggest panel shows ranked poses to click; a slicer plugin can only
// say it, so this turns the best one into words for the slicer's own rotate or
// "Lay on face" tool, and only names it after checking that it helps.
//
//   tiltHint(positions, options, unserved, floating) -> { degrees, down, rot, phrase, unserved } | null
//
// positions  the posed part as computeFins takes it (flat xyz triangle soup, mm, z up)
// options    the same engine options as the fins next to it
// unserved   computeFins(...).stats.unserved for the pose as it is
// floating   computeFins(...).stats.floating for it: a pose that leaves more pieces held
//            only by supports isn't named, however few overhangs it leaves bare
//
// The poses are the site's suggestOrientations (web/orient.js), ranked by its cheap pass
// alone (no fin builds, as for a part over RANK_CHEAP_FACES), so ranking costs one
// analyze() per candidate. Then, quality first, the top TRY poses that differ from the
// current one are built with computeFins and the first that leaves fewer overhangs bare
// is named; none is named when none does. Each one costs a fin build, so a host calls
// this only when something was left bare.
import { buildTopology } from '../../../web/overhangs.js';
import { suggestOrientations } from '../../../web/orient.js';
import { computeFins, ENGINE_DEFAULTS } from './fins_entry.js';
import { seatSoup } from './seat.js';

const TRY = 2;
const SAME_POSE = 0.996;        // cos of ~5deg: orient.js dedups downs at the same
const AXIS = Math.cos(20 * Math.PI / 180);   // a side within 20deg of an axis is named by it

// The face direction (in the part's current frame) a pose puts on the plate. orient.js's
// rot (column-major) takes that direction onto (0, 0, -1), so it is -(R's third row).
export function downOf(rot) {
  const d = [-rot[2], -rot[5], -rot[8]];
  const n = Math.hypot(...d);
  return d.map((v) => v / n);
}

export function rotate(positions, R) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = R[0] * x + R[3] * y + R[6] * z;
    out[i + 1] = R[1] * x + R[4] * y + R[7] * z;
    out[i + 2] = R[2] * x + R[5] * y + R[8] * z;
  }
  return out;
}

// Plate directions as a slicer shows them: +X right, +Y back (away from the front edge).
// [word, axis label] for the side a horizontal direction points to.
function side(x, y) {
  const n = Math.hypot(x, y);
  x /= n; y /= n;
  if (x >= AXIS) return ['right', '+X'];
  if (x <= -AXIS) return ['left', '-X'];
  if (y >= AXIS) return ['back', '+Y'];
  if (y <= -AXIS) return ['front', '-Y'];
  return [`${y > 0 ? 'back' : 'front'}-${x > 0 ? 'right' : 'left'}`, `${y > 0 ? '+' : '-'}Y ${x > 0 ? '+' : '-'}X`];
}

/** Words for "put the face pointing `down` on the plate", from the part's current pose. */
export function tiltPhrase(down) {
  const [x, y, z] = down;
  const degrees = Math.round(Math.acos(Math.max(-1, Math.min(1, -z))) * 180 / Math.PI);
  if (degrees >= 175 || Math.hypot(x, y) < 1e-6) return { degrees, phrase: 'turning it upside down' };
  const [word, axis] = side(x, y);
  if (Math.abs(degrees - 90) <= 5) return { degrees, phrase: `laying it on its ${word} side (${axis})` };
  return { degrees, phrase: `tilting it ${degrees}° toward the ${word} (${axis})` };
}

export function tiltHint(positions, options = {}, unserved = 0, floating = 0) {
  if (!(unserved > 0)) return null;
  const threshold = options.threshold ?? ENGINE_DEFAULTS.threshold;
  const { pos } = seatSoup(positions);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const { candidates } = suggestOrientations(topo, { top: 6, threshold, cheapAbove: 0 });
  let tried = 0;
  for (const c of candidates) {
    const down = downOf(c.rot);
    if (-down[2] > SAME_POSE) continue;   // the pose it's already in
    if (tried++ >= TRY) break;
    const s = computeFins(rotate(positions, c.rot), options).stats;
    // a count the build didn't give (null) is unknown, not zero: say nothing on it
    if (typeof s.unserved !== 'number') continue;
    if (s.unserved < unserved && (s.floating || 0) <= (floating || 0)) {
      return { ...tiltPhrase(down), down, rot: c.rot, unserved: s.unserved };
    }
  }
  return null;
}
