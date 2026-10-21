/**
 * Camera view presets (#350): Front, Back, Left, Right, Top and Bottom, the way
 * Fusion's view cube and the slicers line the view up square to the part. Pure data
 * so tests can pin it; ui/camviews.js glides the camera to one.
 *
 * Front looks along +Y (the camera on -Y, where the default view already sits). A
 * view keeps the orbit target and the distance to it: the spot being drawn at stays
 * in the middle at the same zoom, only seen square. Top and Bottom lean a hair off
 * the vertical -- straight down the camera's up axis (Z) OrbitControls has no
 * heading -- so Top keeps the back of the plate at the top of the screen and Bottom
 * the front, as both CAD packages and slicers show them.
 */
const TILT = 1e-4;

export const VIEWS = {
  front:  { label: 'Front',  hint: 'Look at the part from the front.', dir: [0, -1, 0] },
  back:   { label: 'Back',   hint: 'Look at the part from the back.',  dir: [0, 1, 0] },
  left:   { label: 'Left',   hint: 'Look at the part from the left.',  dir: [-1, 0, 0] },
  right:  { label: 'Right',  hint: 'Look at the part from the right.', dir: [1, 0, 0] },
  top:    { label: 'Top',    hint: 'Look down on the part from above.', dir: [0, -TILT, 1] },
  bottom: { label: 'Bottom', hint: 'Look up at the part from below the plate.', dir: [0, -TILT, -1] },
};

/** Where the camera goes for view `key`, `dist` from `target` ([x, y, z]). */
export function viewPosition(key, target, dist) {
  const d = VIEWS[key].dir;
  const n = Math.hypot(...d);
  return target.map((t, i) => t + (d[i] / n) * dist);
}

/**
 * The camera offset from the target (`from` to `to`, both [x, y, z]) eased `e` of the
 * way, swung around the target rather than straight across: Front to Back is 180°,
 * and a straight line runs through the target (the camera dives into the part and
 * comes out with no heading). Heading and tilt (Z up) turn the short way round and
 * the distance eases on its own.
 */
export function orbitLerp(from, to, e) {
  const sph = ([x, y, z]) => {
    const r = Math.hypot(x, y, z);
    return [r, Math.atan2(y, x), Math.acos(Math.max(-1, Math.min(1, z / r)))];
  };
  const [r0, h0, t0] = sph(from), [r1, h1, t1] = sph(to);
  let dh = (h1 - h0) % (2 * Math.PI);
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const r = r0 + (r1 - r0) * e, h = h0 + dh * e, t = t0 + (t1 - t0) * e;
  return [r * Math.sin(t) * Math.cos(h), r * Math.sin(t) * Math.sin(h), r * Math.cos(t)];
}
