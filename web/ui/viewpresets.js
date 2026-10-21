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
export const viewPosition = (key, target, dist) => dirPosition(VIEWS[key].dir, target, dist);

/** Where the camera goes looking back along `dir` (any length) at `target`, `dist`
 *  from it. Straight up or down leans TILT toward the front, as Top and Bottom do. */
export function dirPosition(dir, target, dist) {
  let [x, y, z] = dir;
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) y = -TILT * Math.abs(z);
  const n = Math.hypot(x, y, z);
  return [target[0] + (x / n) * dist, target[1] + (y / n) * dist, target[2] + (z / n) * dist];
}

/** The default view's direction (scene.js frame()): front right, from above. */
export const HOME_DIR = [0.62, -0.72, 0.55];

/**
 * The view cube's faces (ui/viewcube.js). `n` points out of the face, `u` is right
 * and `v` down on it as read from outside, so its label stands upright in that face's
 * own view (Top: the back of the plate up, Bottom: the front up). Each face is a 3x3
 * grid of click targets: the middle one is the face, an edge strip the view halfway
 * to the face beyond it, a corner the view from that corner of the cube.
 */
export const CUBE_FACES = {
  front:  { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, -1] },
  back:   { n: [0, 1, 0],  u: [-1, 0, 0], v: [0, 0, -1] },
  left:   { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, -1] },
  right:  { n: [1, 0, 0],  u: [0, 1, 0],  v: [0, 0, -1] },
  top:    { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, -1, 0] },
  bottom: { n: [0, 0, -1], u: [1, 0, 0],  v: [0, 1, 0] },
};

/** The view direction for cell (`col`, `row`), each -1, 0 or 1, of cube face `key`. */
export function cubeCellDir(key, col, row) {
  const { n, u, v } = CUBE_FACES[key];
  return n.map((c, i) => c + col * u[i] + row * v[i]);
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
