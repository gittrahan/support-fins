// GOLDEN OUTPUT: legacy engine settings and the browser's current nozzle defaults.
// Every other test pins counts (walls, tines, coverage), and
// a change that keeps the counts slips past them -- PR #149's wall steps changed the
// default cube at X40 on every count-preserving axis, and only Matthew's eye caught it.
// This file fails on ANY change to the built geometry and says which scene and how.
//
// A change you mean: re-record with
//     UPDATE_GOLDEN=1 deno test -A tests/golden.test.js
// and commit tests/golden/*.json with the PR, saying why in its body. The golden diff
// is how a reviewer sees that the default output moved.
//
// Scenes mirror the app's call exactly (ui/pose.js + ui/part.js + ui/finbuild.js finOpts
// + ui/walls.js): the pose is what the rotate ring makes (snapped 5 deg steps about the
// world axes, three.js quaternion -> Matrix3), analyze(topo, 45, rot), then buildFins
// with the form's defaults -- Auto, pad Auto, tines on, density 0, 0.2 mm layers,
// coverage 50, sway off, PLA.
//
// Every build passes the WHOLE set of tunables. buildFins writes them into module state
// (fins.js applyTunables), so reading defaults back from FIN / PAD / PROP would carry
// one scene's material into the next -- the PETG scene did, into four PLA goldens.

import { fileURLToPath } from 'node:url';
import { r3, run } from './_scene.js';

const DIR = fileURLToPath(new URL('./golden/', import.meta.url));
const UPDATE = Deno.env.get('UPDATE_GOLDEN') === '1';
// Read actual browser defaults so changing the form changes these golden builds.
const HTML = Deno.readTextFileSync(new URL('../web/index.html', import.meta.url));
const defaultValue = (id) => Number(HTML.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*value="([^"]+)"`))?.[1]);
const profile = { nozzle: defaultValue('nozzle'), wallLines: defaultValue('wall-lines') };

const SCENES = [
  // Matthew's manual check on the site: cube.stl at X 40.
  { name: 'cube-x40-auto', model: 'cube', rot: [40, 0, 0] },
  { name: 'cube-x40-draw', model: 'cube', rot: [40, 0, 0], draw: [[-15, 13, 13], [15, 13, 13]] },
  { name: 'cube-x40-petg', model: 'cube', rot: [40, 0, 0], set: { material: 'petg' } },
  // A flat-enough underside (<= PROP.edgeFlatDeg) moves its end rows out flush:
  // #143 added two there instead and the cube went 3 -> 5 walls, unseen at X40.
  { name: 'cube-x20-auto', model: 'cube', rot: [20, 0, 0] },
  { name: 'cube-x30-auto', model: 'cube', rot: [30, 0, 0] },
  { name: 'lbracket-x35-auto', model: 'lbracket', rot: [35, 0, 0] },
  { name: 'sphere-auto', model: 'sphere', rot: [0, 0, 0] },
  { name: 'torus-x30-auto', model: 'torus', rot: [30, 0, 0] },
  { name: 'staircase-x40-auto', model: 'staircase', rot: [40, 0, 0] },
  { name: 'bar-sway', model: 'bar', rot: [0, 0, 0], set: { sway: true } },
  // Every stress model as loaded and at X40, Auto, PLA: a change on ANY of them shows
  // up (lowledge's doubled edge walls from #143 went unseen with fewer scenes).
  ...[...Deno.readDirSync(new URL('../prototype/stress/models/', import.meta.url))]
    .map((e) => e.name.replace(/\.stl$/, '')).sort()
    .flatMap((model) => [{ name: `stress-${model}-up`, model, rot: [0, 0, 0] },
                         { name: `stress-${model}-x40`, model, rot: [40, 0, 0] }]),
  // New browser defaults: 0.4mm nozzle and two lines. Keep the
  // existing files above as compatibility coverage for unchanged plugin callers.
  { name: 'profile-cube-x40-auto', model: 'cube', rot: [40, 0, 0], set: { profile } },
  { name: 'profile-cube-x40-draw', model: 'cube', rot: [40, 0, 0],
    draw: [[-15, 13, 13], [15, 13, 13]], set: { profile } },
  { name: 'profile-cube-x40-petg', model: 'cube', rot: [40, 0, 0], set: { material: 'petg', profile } },
  { name: 'profile-bar-sway', model: 'bar', rot: [0, 0, 0], set: { sway: true, profile } },
];

/** What a reviewer reads in the golden diff, plus a hash that catches everything else. */
async function record(out) {
  // 1e-5 mm: below any real change, above float noise between machines
  const flat = (tris) => tris.flatMap((v) => v.map((x) => Math.round(x * 1e5)));
  const bytes = new TextEncoder().encode(JSON.stringify([flat(out.tris), flat(out.pad)]));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    walls: out.walls,
    tines: out.tines,
    unserved: out.unserved,
    triangles: out.tris.length / 3,
    padTriangles: out.pad.length / 3,
    fins: out.summary.map((f) => Object.fromEntries(Object.entries(f)
      .map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v]))),
    sha256: hash,
  };
}

for (const scene of SCENES) {
  Deno.test(`golden: ${scene.name} builds exactly what it did`, async () => {
    const got = await record(run(scene));
    const file = `${DIR}${scene.name}.json`;
    if (UPDATE) {
      Deno.mkdirSync(DIR, { recursive: true });
      Deno.writeTextFileSync(file, JSON.stringify({ scene, ...got }, null, 2) + '\n');
      return;
    }
    let want;
    try { want = JSON.parse(Deno.readTextFileSync(file)); } catch {
      throw new Error(`no golden for ${scene.name}: run UPDATE_GOLDEN=1 deno test -A tests/golden.test.js`);
    }
    const diffs = [];
    for (const k of ['walls', 'tines', 'unserved', 'triangles', 'padTriangles']) {
      if (got[k] !== want[k]) diffs.push(`${k} ${want[k]} -> ${got[k]}`);
    }
    if (JSON.stringify(got.fins) !== JSON.stringify(want.fins)) diffs.push('per-wall height/length/tines changed');
    if (got.sha256 !== want.sha256) diffs.push('geometry changed (sha256)');
    if (diffs.length) {
      throw new Error(`${scene.name} (${scene.model} at X${scene.rot[0]} Y${scene.rot[1]} Z${scene.rot[2]}) `
        + `no longer builds its golden output: ${diffs.join('; ')}.\n`
        + 'If this change is meant, re-record (UPDATE_GOLDEN=1 deno test -A tests/golden.test.js), '
        + 'commit tests/golden/, and say why in the PR.');
    }
  });
}

Deno.test('golden: every recorded file belongs to a scene (a removed scene takes its golden with it)', () => {
  const names = new Set(SCENES.map((s) => `${s.name}.json`));
  const stale = [...Deno.readDirSync(DIR)].map((e) => e.name).filter((n) => !names.has(n));
  if (UPDATE) { for (const n of stale) Deno.removeSync(`${DIR}${n}`); return; }
  if (stale.length) throw new Error(`tests/golden/ has files no scene records: ${stale.join(', ')}`);
});
