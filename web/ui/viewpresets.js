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
