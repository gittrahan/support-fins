// HOW MANY WALLS the reference parts get. The rest of the suite pins what makes
// a wall right (closed, clear of the part, gripping), not where walls go -- so a
// placement change can add two walls to a plain cube with every test green (#143:
// Matthew saw it in the test build first). A change that moves walls on purpose
// updates these numbers in the same PR, where review sees it; one that didn't
// mean to fails here. Wall COUNTS only: tine counts shift with float noise
// (plugins/shared/ENGINE-SENSITIVITY.md). Auto, bed pad, default coverage.
import { loadModel, analyze, fins, rotX, rotY, assert } from './_util.js';

const PINS = [
  // model, pose, rotation, walls
  ['cube', 'X25', rotX(25), 3],       // the end rows move out flush to the free edges, same count (#143 had added two)
  ['cube', 'X35', rotX(35), 3],
  ['cube', 'X60', rotX(60), 3],
  ['cube', 'Y35', rotY(35), 3],
  ['lbracket', 'X35', rotX(35), 4],   // the plugins' reference part (plugins/*/tests pin its tines too)
  ['lbracket', 'Y35', rotY(35), 4],
  ['ramp', 'X45', rotX(45), 0],
  ['wedge', 'X45', rotX(45), 0],
  ['tube', 'X25', rotX(25), 4],
  ['arch', 'X25', rotX(25), 4],       // likewise (#143 had 6)
];

for (const [name, pose, rot, want] of PINS) {
  Deno.test(`layout: ${name} ${pose} gets ${want} walls`, () => {
    const topo = loadModel(name), res = analyze(topo, 45, rot);
    const got = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 }).props.length;
    assert(got === want, `${name} ${pose}: ${got} walls, pinned ${want} -- if the change is meant, update the pin`);
  });
}
