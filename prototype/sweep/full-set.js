/**
 * The cases for `sweep.js --full`. Full coverage takes seconds to tens of seconds a
 * build, not milliseconds, so this is a chosen set rather than every model x pose:
 * the parts that have shown Full coverage faults or set its limits, plus stock
 * shapes so a checkout without the private models still sweeps something.
 *
 * The real parts are git-ignored. A linked worktree has none of its own, so they're
 * also looked for in the main checkout. A part that isn't found is skipped and
 * named, and base and head always read the same models. Parts we can't name in public
 * go in prototype/examples/real/full-set-extra.txt, git-ignored, one name a line.
 */
const STOCK = ['staircase', 'portal', 'tube', 'wedge'];
const REAL = [
  'issue121_m4_large_front',   // tilted panel, stepped underside: a wall 1.7 mm inside before the step split
  'issue50_knuckle',           // the most bare area, and deep walls at X30
  'issue157_bosch_vac',        // the wall cap test part
  'mini_goblin_janitor',       // reference print set
  'curved_artichoke_lamp_shade_1601406', // the curved walls test part
];
const POSES = ['flat', 'x30'];

export function fullSetModels(root) {
  const roots = [root];
  try {
    const out = new Deno.Command('git', { args: ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], stdout: 'piped', stderr: 'null' }).outputSync();
    const common = new TextDecoder().decode(out.stdout).trim().replace(/\/\.git\/?$/, '');
    if (common) roots.push(`${common}/`);
  } catch { /* not a git checkout: this one's models only */ }
  const dirs = roots.flatMap((r) => ['prototype/stress/models', 'prototype/examples/real', 'prototype/examples/reports', 'web/dev-models'].map((d) => `${r.replace(/\/?$/, '/')}${d}`));
  const extra = roots.flatMap((r) => {
    try { return Deno.readTextFileSync(`${r.replace(/\/?$/, '/')}prototype/examples/real/full-set-extra.txt`).split('\n').map((l) => l.trim()).filter(Boolean); } catch { return []; }
  });
  const found = [], missing = [];
  for (const name of new Set([...STOCK, ...REAL, ...extra])) {
    const path = dirs.map((d) => `${d}/${name}.stl`).find((p) => { try { return Deno.statSync(p).isFile; } catch { return false; } });
    if (path) found.push([name, path]); else missing.push(name);
  }
  return { found, missing };
}

/** A pose gets Full, and X30 gets Full with Curved walls as well. */
export const fullVariants = (pn) => (pn === 'x30'
  ? [['full', {}], ['full+curved', { curvedWalls: true }]]
  : [['full', {}]]);

export const FULL_POSES = POSES;
/** What the page sends for Full at its default settings (web/ui/finbuild.js finOpts). */
export const FULL_OPTS = { mode: 'full', bedPad: true, plateOnly: false, longWalls: true, separateWalls: false, tallRibs: true, tines: true, tineDensity: 0, layerHeight: 0.2 };
