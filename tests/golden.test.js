// GOLDEN OUTPUT: the exact supports the site builds for a few reference scenes, at the
// site's default settings. Every other test pins counts (walls, tines, coverage), and
// a change that keeps the counts slips past them -- PR #149's wall steps changed the
// default cube at X40 on every count-preserving axis, and only Matthew's eye caught it.
// This file fails on ANY change to the built geometry and says which scene and how.
//
// A change you mean: re-record with
//     UPDATE_GOLDEN=1 deno test -A tests/golden.test.js
// and commit tests/golden/*.json with the PR, saying why in its body. The golden diff
// is how a reviewer sees that the default output moved.
//
// Scenes mirror the app's call (ui/part.js + ui/finbuild.js finOpts + ui/walls.js):
// the pose is the site's X·Y·Z readout (plugins/cli rotationMatrix, three.js Euler
// XYZ), analyze(topo, 45, rot), then buildFins with the form's defaults -- Auto, pad
// Auto, tines on, density 0, 0.2 mm layers, coverage 50, sway off, PLA.

import { analyze, loadModel, fins, prop } from './_util.js';
import { rotationMatrix } from '../plugins/cli/cli.js';

const { buildFins, FIN, PAD } = fins;
const { PROP } = prop;
const { CUT } = await import('../web/cutout.js');
const { drawnWall } = await import('../web/draw.js');
const DIR = new URL('./golden/', import.meta.url).pathname;
const UPDATE = Deno.env.get('UPDATE_GOLDEN') === '1';

/** The site's finOpts() with the form untouched; `over` changes one setting. */
function siteOpts(over = {}) {
  return {
    mode: 'auto', bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2, coverage: 0.5,
    sway: undefined,
    tunables: { tineBite: FIN.tineBite, padH: FIN.padH, padGrab: PAD.grab, padStyle: PAD.style,
                padCustom: { ...PAD.custom }, propGap: PROP.gap, cutout: CUT.pattern },
    ...over,
  };
}

const { MATERIAL } = await import('../web/materials.js');
// The site's Material select: its clearances travel in tunables (finOpts).
const PETG = (({ tineBite, padH, padGrab, propGap }) => ({ tineBite, padH, padGrab, propGap }))(MATERIAL.petg);
// The site's sway fields untouched (ui/finbuild.js swayOpts + index.html defaults).
const SWAY = { on: true, gripFrom: 0, tineSpacing: 6, reach: 0.15, gap: PROP.gap, bite: FIN.tineBite,
               tines: true, layerHeight: 0.2 };

const SCENES = [
  // Matthew's manual check on the site: cube.stl at X 40.
  { name: 'cube-x40-auto', model: 'cube', rot: [40, 0, 0] },
  { name: 'cube-x40-draw', model: 'cube', rot: [40, 0, 0], draw: [[-15, 13, 13], [15, 13, 13]] },
  { name: 'cube-x40-petg', model: 'cube', rot: [40, 0, 0],
    opts: (o) => ({ tunables: { ...o.tunables, ...PETG } }) },
  { name: 'lbracket-x35-auto', model: 'lbracket', rot: [35, 0, 0] },
  { name: 'sphere-auto', model: 'sphere', rot: [0, 0, 0] },
  { name: 'torus-x30-auto', model: 'torus', rot: [30, 0, 0] },
  { name: 'staircase-x40-auto', model: 'staircase', rot: [40, 0, 0] },
  { name: 'bar-sway', model: 'bar', rot: [0, 0, 0], opts: () => ({ sway: SWAY }) },
];

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Seat the part as ui/walls.js partPrintTriangles does. */
function seated(topo, rot, o) {
  const { pos, nFaces } = topo;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i] = rot[0] * x + rot[3] * y + rot[6] * z + o.x;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + o.y;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + o.z;
  }
  return a;
}

function run(scene) {
  const topo = loadModel(scene.model);
  const rot = rotationMatrix(scene.rot);
  const res = analyze(topo, 45, rot);
  const base = siteOpts();
  const opts = { ...base, ...(scene.opts ? scene.opts(base) : {}) };
  if (scene.draw) {
    const r = drawnWall(scene.draw[0], scene.draw[1], seated(topo, rot, res.offset), 0,
      { tines: opts.tines, tineDensity: opts.tineDensity, layerHeight: opts.layerHeight,
        topo, rot, offset: res.offset });
    return { tris: r.ok ? r.tris : [], pad: [], walls: r.ok ? 1 : 0, tines: r.tines ?? 0, unserved: 0,
             summary: r.ok ? [{ height: r.height, length: r.length }] : [{ refused: r.reason }] };
  }
  const b = buildFins(topo, res, rot, opts);
  return {
    tris: b.triangles, pad: b.padTriangles ?? [],
    walls: (b.braceCount ?? 0) + (b.propCount ?? 0), tines: b.tines, unserved: b.unserved ?? 0,
    // where each wall runs, so a golden diff shows a wall that moved, not just a hash
    summary: (b.fins ?? []).map((f) => ({ kind: f.kind, height: f.height, length: f.length,
                                         tines: f.tines,
                                         from: f.line?.[0]?.map(r3), to: f.line?.at(-1)?.map(r3) })),
  };
}

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
      Deno.writeTextFileSync(file, JSON.stringify({ scene: { ...scene, opts: undefined }, ...got }, null, 2) + '\n');
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
