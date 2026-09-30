// The command line (plugins/cli). Pins:
//   - it runs the plugins' engine path: the CLI's fins are computeFins' fins on the
//     posed part, bit for bit, and match the website's own path the way every
//     plugin does (same overhangs + fin count, tines within 3: ENGINE-SENSITIVITY.md);
//   - --rot reads the site's "X · Y · Z" readout (three.js Euler XYZ = Rx*Ry*Rz);
//   - what it writes: a 3MF with the part and the fins seated together on z = 0,
//     an STL with both, or the fins alone lined up with the part as it is in the file;
//   - it won't fin its own output, overwrite its input, or take a setting the math
//     ignores without saying so;
//   - the flags reach the engine, in the site's units (percent sliders 0-100);
//   - failures are loud and scoped: a bad flag is exit 2 before anything runs, a bad
//     file is exit 1 and the other files still get their fins.
//
//   deno test -A plugins/cli/tests/
import { run, pose, rotationMatrix, parseArgs } from '../cli.js';
import { computeFins, ENGINE_DEFAULTS } from '../../shared/engine/fins_entry.js';
import { reportLine } from '../../shared/engine/report.js';
import { readSTL, MODELS, analyze, fins, rotX, rotY, assert, assertClose, block } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
import { readThreeMF } from '../../../web/threemf.js';
import { writeBinarySTL } from '../../../web/stl.js';

const LBRACKET = Deno.readFileSync(`${MODELS}lbracket.stl`);

/** An in-memory file system + captured output. */
function memIO(files = {}) {
  const fs = new Map(Object.entries(files));
  const io = {
    fs, out: [], err: [],
    read: async (p) => { if (!fs.has(p)) throw new Error(`No such file: ${p}`); return fs.get(p); },
    write: async (p, b) => { fs.set(p, b); },
  };
  io.out = []; io.err = [];
  return { ...io, out: (l) => io.out.push(l), err: (l) => io.err.push(l), lines: io };
}
async function cli(argv, files = { 'lb.stl': LBRACKET }) {
  const io = memIO(files);
  const code = await run(argv, io);
  return { code, out: io.lines.out, err: io.lines.err, fs: io.fs };
}

function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  }
  return { lo, hi };
}

// v' = A (B v), column-major like three.js Matrix3.elements
const mul = (A, B) => { const C = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[c * 3 + r] += A[k * 3 + r] * B[c * 3 + k];
  return C; };
const rotZ = (d) => { const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180); return [c, s, 0, -s, c, 0, 0, 0, 1]; };

Deno.test('cli: --rot is the site\'s readout, three.js Euler XYZ (Rx * Ry * Rz)', () => {
  const same = (a, b, msg) => a.forEach((v, i) => assertClose(v, b[i], 1e-12, `${msg}[${i}]`));
  same(rotationMatrix([30, 0, 0]), rotX(30), 'X');
  same(rotationMatrix([0, 35, 0]), rotY(35), 'Y');
  same(rotationMatrix([30, 35, 20]), mul(rotX(30), mul(rotY(35), rotZ(20))), 'XYZ');
  // X 90 · Y 90: (0,1,0) is untouched by Y, then X turns it onto +Z
  const p = pose([0, 1, 0, 0, 0, 0, 0, 0, 0], [90, 90, 0]);
  assertClose(p[0], 0, 1e-12, 'x'); assertClose(p[1], 0, 1e-12, 'y'); assertClose(p[2], 1, 1e-12, 'z');
});

Deno.test('cli: fins are computeFins\' on the posed part, and match the website like every plugin', async () => {
  const { code, out, fs } = await cli(['lb.stl', '--rot', '0,35,0', '--json']);
  assert(code === 0, `exit ${code}`);
  const r = JSON.parse(out[0]);
  const direct = computeFins(pose(readSTL(LBRACKET), [0, 35, 0]));
  assert(JSON.stringify(r.stats) === JSON.stringify(direct.stats), 'CLI stats differ from computeFins');
  // The website: the raw STL, rotation handed to analyze (ui/part.js shade), and the
  // options panel's defaults. buildFins' own defaults are NOT the site's: with them
  // the comb is denser (29 tines here, not 17), so pass what the panel sends.
  const pos = readSTL(LBRACKET);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, rotY(35));
  const { mode, bedPad, tines, tineDensity, coverage, layerHeight } = ENGINE_DEFAULTS;
  const web = fins.buildFins(topo, res, rotY(35), { mode, bedPad, tines, tineDensity, coverage, layerHeight });
  assert(r.stats.overhangRegions === res.regions.length, 'overhang analysis differs');
  assert(r.stats.braces === web.braceCount, `fins ${r.stats.braces} vs site ${web.braceCount}`);
  assert(Math.abs(r.stats.tines - web.tines) <= 3, `tines ${r.stats.tines} vs site ${web.tines}`);
  assert(r.stats.braces >= 1 && r.stats.tines >= 1, 'no tined fins placed');
  assert(fs.has('lb-fins.3mf'), 'default output is <part>-fins.3mf next to the input');
});

Deno.test('cli: the 3MF holds the part and its fins, seated together on the plate', async () => {
  const { fs } = await cli(['lb.stl', '--rot', '0,35,0']);
  const m = await readThreeMF(fs.get('lb-fins.3mf'));
  assert(m.meshes === 2, `${m.meshes} meshes, want part + fins`);
  const direct = computeFins(pose(readSTL(LBRACKET), [0, 35, 0]));
  const partTris = readSTL(LBRACKET).length / 9;
  assert(m.positions.length / 9 === partTris + direct.triangles.length / 9, 'triangle count');
  const b = bounds(m.positions);
  assertClose(b.lo[2], 0, 1e-4, 'sits on z = 0');
  // the part comes first, moved by exactly the engine's offset: the fins' frame
  const posed = pose(readSTL(LBRACKET), [0, 35, 0]);
  const off = [direct.offset.x, direct.offset.y, direct.offset.z];
  for (let i = 0; i < posed.length; i++) {
    assertClose(m.positions[i], posed[i] + off[i % 3], 1e-4, `part value ${i}`);
  }
  const pb = bounds(m.positions.subarray(0, posed.length));
  assertClose((pb.lo[0] + pb.hi[0]) / 2, 0, 1e-4, 'part centred in x');
  assertClose((pb.lo[1] + pb.hi[1]) / 2, 0, 1e-4, 'part centred in y');
  // the part alone is centred over the origin (the site's export frame)
  const part = bounds(pose(readSTL(LBRACKET), [0, 35, 0]));
  const partCentre = [(part.lo[0] + part.hi[0]) / 2, (part.lo[1] + part.hi[1]) / 2];
  const fin = bounds(direct.triangles);
  assert(fin.lo[2] >= -1e-4, 'fins start on the plate');
  // fins sit under the part: their footprint's centre is within the part's footprint
  const fc = [(fin.lo[0] + fin.hi[0]) / 2, (fin.lo[1] + fin.hi[1]) / 2];
  const half = [(part.hi[0] - part.lo[0]) / 2, (part.hi[1] - part.lo[1]) / 2];
  assert(Math.abs(fc[0]) <= half[0] && Math.abs(fc[1]) <= half[1],
    `fins centred at ${fc} are off the part (half size ${half}, raw centre ${partCentre})`);
});

Deno.test('cli: .stl output merges part + fins; --fins-only lines the fins up with the file\'s part', async () => {
  const direct = computeFins(pose(readSTL(LBRACKET), [0, 35, 0]));
  const partN = readSTL(LBRACKET).length / 9, finN = direct.triangles.length / 9;
  const both = await cli(['lb.stl', '--rot', '0,35,0', '-o', 'out.stl']);
  assert(readSTL(both.fs.get('out.stl')).length / 9 === partN + finN, 'merged STL count');
  // A part already posed in its file (at x=137 on some plate): the fins-only STL
  // must land under it there, as in the user's own slicer.
  const posed = pose(readSTL(LBRACKET), [0, 35, 0]).map((v, i) => v + [137, 88, 5][i % 3]);
  const file = new Uint8Array(await writeBinarySTL([...Array(posed.length / 3)].map((_, j) => [posed[j * 3], posed[j * 3 + 1], posed[j * 3 + 2]]), 'posed').arrayBuffer());
  const only = await cli(['posed.stl', '--fins-only'], { 'posed.stl': file });
  assert(only.code === 0, `exit ${only.code}: ${only.err}`);
  const got = readSTL(only.fs.get('posed-fins-only.stl'));
  const ref = computeFins(readSTL(file));
  assert(got.length === ref.triangles.length && got.length > 0, 'fins-only count');
  const off = [ref.offset.x, ref.offset.y, ref.offset.z];
  for (let i = 0; i < got.length; i++) assertClose(got[i], ref.triangles[i] - off[i % 3], 1e-4, `fins-only value ${i}`);
  const fb = bounds(got), pb = bounds(readSTL(file));
  assertClose(fb.lo[2], pb.lo[2], 1e-3, 'fins start where the part\'s plate is');
  // with no overhang there are no fins, and no empty file
  const none = await cli(['lb.stl', '--fins-only']);
  assert(none.code === 0 && !none.fs.has('lb-fins-only.stl') && /nothing written/.test(none.out[0]), none.out[0]);
});

Deno.test('cli: flags reach the engine in the site\'s units', async () => {
  const base = JSON.parse((await cli(['lb.stl', '--rot', '0,35,0', '--json'])).out[0]).stats;
  const off = JSON.parse((await cli(['lb.stl', '--rot', '0,35,0', '--json', '--no-tines'])).out[0]).stats;
  assert(off.tines === 0 && off.props >= 1, `--no-tines: ${off.tines} tines, ${off.props} plain walls`);
  const dense = JSON.parse((await cli(['lb.stl', '--rot=0,35,0', '--json', '--coverage', '100'])).out[0]).stats;
  const want = computeFins(pose(readSTL(LBRACKET), [0, 35, 0]), { coverage: 1 }).stats;
  assert(JSON.stringify(dense) === JSON.stringify(want), '--coverage 100 is the entry\'s coverage 1');
  const nopad = JSON.parse((await cli(['lb.stl', '--rot', '0,35,0', '--json', '--pad-style', 'off'])).out[0]).stats;
  assert(base.padTriangles > 0 && nopad.padTriangles === 0, 'pad style off drops the pad');
  const a = parseArgs(['x.stl', '--sway', '--sway-reach', '20', '--material', 'petg']);
  assert(a.dialog['sway.on'] === true && a.dialog['sway.reach'] === 0.2 && a.dialog.material === 'petg', JSON.stringify(a.dialog));
});

Deno.test('cli: bad arguments are exit 2 with a message in the flag\'s own units', async () => {
  const cases = [
    [['lb.stl', '--coverage', '150'], /--coverage must be 0\.\.100, got 150/],
    [['lb.stl', '--material', 'abs'], /--material must be one of pla, petg/],
    [['lb.stl', '--frobnicate'], /unknown option --frobnicate/],
    [['lb.stl', '--rot', '35'], /--rot takes three angles/],
    [['lb.stl', '--layer-height', 'thick'], /--layer-height must be a number/],
    [['a.stl', 'b.stl', '-o', 'x.3mf'], /-o takes one input/],
    [['lb.stl', '--fins-only', '--rot', '0,35,0'], /--fins-only .* can't take --rot/],
    [['lb.stl', '--no-coverage'], /unknown option --no-coverage/],
    [[], /no input file/],
  ];
  for (const [argv, re] of cases) {
    const { code, err, fs } = await cli(argv);
    assert(code === 2, `${argv.join(' ')}: exit ${code}`);
    assert(re.test(err.join('\n')), `${argv.join(' ')}: said ${JSON.stringify(err)}`);
    assert(fs.size === 1, `${argv.join(' ')}: wrote a file`);
  }
  const warned = await cli(['lb.stl', '--rot', '0,35,0', '--sway-reach', '40', '--no-tines', '--sway-tine-spacing', '4']);
  assert(warned.code === 0, `warnings are not errors: exit ${warned.code}`);
  assert(/--sway-reach does nothing/.test(warned.err.join('\n')) && /--sway-tine-spacing does nothing/.test(warned.err.join('\n')),
    `ignored settings must warn: ${JSON.stringify(warned.err)}`);
  const quiet = await cli(['lb.stl', '--rot', '0,35,0', '--sway', '--sway-reach', '40']);
  assert(quiet.err.length === 0, `a used setting warned: ${quiet.err}`);
  const dashed = await cli(['--', '-x.stl'], { '-x.stl': LBRACKET });
  assert(dashed.code === 0 && dashed.fs.has('-x-fins.3mf'), `-- ends the options: ${dashed.err}`);
  const help = await cli(['--help']);
  assert(help.code === 0 && /--coverage <0-100>/.test(help.out[0]), 'help lists the settings');
});

Deno.test('cli: a bad file is exit 1 and the other files still get their fins', async () => {
  const { code, out, err, fs } = await cli(['broken.stl', 'lb.stl', 'missing.stl', 'notes.txt'],
    { 'lb.stl': LBRACKET, 'broken.stl': LBRACKET.subarray(0, 200), 'notes.txt': new Uint8Array(3) });
  assert(code === 1, `exit ${code}`);
  assert(fs.has('lb-fins.3mf') && out.length === 1, 'the good file was still finned');
  assert(err.length === 3, `errors: ${JSON.stringify(err)}`);
  assert(/broken\.stl: not an STL/.test(err[0]), err[0]);
  assert(/notes\.txt: reads \.stl and \.3mf only/.test(err[2]), err[2]);
  const self = await cli(['lb.stl', '-o', 'lb.stl']);
  assert(self.code === 1 && /won't overwrite the input/.test(self.err[0]) && self.fs.get('lb.stl') === LBRACKET, self.err[0]);
});

Deno.test('cli: its own 3MF (part + fins) is refused, not finned again', async () => {
  const first = await cli(['lb.stl', '--rot', '0,35,0']);
  const again = await cli(['lb-fins.3mf'], { 'lb-fins.3mf': first.fs.get('lb-fins.3mf') });
  assert(again.code === 1 && /already has fins/.test(again.err[0]), JSON.stringify(again.err));
  assert(!again.fs.has('lb-fins-fins.3mf'), 'wrote fins on fins');
});

// A 3MF as a slicer writes it: one mesh object per entry of `objects` (flat soups).
async function plate3MF(objects) {
  const { zipStore } = await import('../../../web/zip.js');
  const obj = (flat, id) => {
    let v = '', t = '';
    for (let i = 0; i < flat.length; i += 3) v += `<vertex x="${flat[i]}" y="${flat[i + 1]}" z="${flat[i + 2]}"/>`;
    for (let f = 0; f < flat.length / 9; f++) t += `<triangle v1="${f * 3}" v2="${f * 3 + 1}" v3="${f * 3 + 2}"/>`;
    return `<object id="${id}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
  };
  const xml = '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + `<metadata name="Application">SomeSlicer</metadata><resources>${objects.map((o, i) => obj(o, i + 1)).join('')}</resources>`
    + `<build>${objects.map((_, i) => `<item objectid="${i + 1}"/>`).join('')}</build></model>`;
  const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return new Uint8Array(await zipStore([
    { name: '_rels/.rels', data: new TextEncoder().encode(rels) },
    { name: '3D/3dmodel.model', data: new TextEncoder().encode(xml) },
  ]).arrayBuffer());
}

Deno.test('cli: a 3MF input reads; one with several objects asks which', async () => {
  const cube = block(0, 20, 0, 20, 0, 20);
  const r1 = await cli(['c.3mf', '--rot', '45,0,0', '--json'], { 'c.3mf': await plate3MF([cube]) });
  assert(r1.code === 0, `exit ${r1.code}: ${r1.err}`);
  const want = computeFins(pose(cube, [45, 0, 0])).stats;
  assert(JSON.stringify(JSON.parse(r1.out[0]).stats) === JSON.stringify(want), '3MF input fins = STL input fins');

  // A plate of two objects: refused without --object, finned with it.
  const two = await plate3MF([cube, block(40, 60, 0, 20, 0, 20)]);
  const refused = await cli(['plate.3mf'], { 'plate.3mf': two });
  assert(refused.code === 1 && /has 2 objects .*pick one with --object/.test(refused.err[0]), refused.err[0]);
  const picked = await cli(['plate.3mf', '--object', '2', '--rot', '45,0,0', '--json'], { 'plate.3mf': two });
  assert(picked.code === 0 && picked.fs.has('plate-fins.3mf'), `--object 2: ${picked.err}`);
  assert(JSON.stringify(JSON.parse(picked.out[0]).stats) === JSON.stringify(want), '--object 2 fins that cube alone');
});

Deno.test('cli: the summary line says what was left unsupported, word for word with the Python hosts', async () => {
  const samples = [
    { braces: 3, props: 1, tines: 12 },
    { braces: 1, props: 0, tines: 1, swayBraces: 2, unserved: 1 },
    { braces: 0, props: 2, tines: 0, unserved: 3, floating: 1, floatingDrop: 4.26 },
    { braces: 2, tines: 5, floating: 2, floatingDrop: 12 },
    { braces: 1, tines: 2, floating: 1, floatingDrop: 4.25 },   // a tie: Python rounds to even
  ];
  assert(/1 overhang is too shallow/.test(reportLine(samples[1])), reportLine(samples[1]));
  assert(/one piece isn't joined to the rest: it starts 4\.3 mm up/.test(reportLine(samples[2])), reportLine(samples[2]));
  assert(/it starts 4\.2 mm up/.test(reportLine(samples[4])), reportLine(samples[4]));
  let py;
  try {
    py = new Deno.Command('python3', {
      args: ['-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); from supportfins_host import host_report; '
        + 'print(json.dumps([host_report(s) for s in json.loads(sys.argv[2])]))',
      new URL('../../shared/py/', import.meta.url).pathname, JSON.stringify(samples)],
      stdout: 'piped', stderr: 'piped',
    }).outputSync();
  } catch { return; }   // no python3 here: the JS line is still pinned above
  if (!py.success) return;   // supportfins_host needs a dependency this machine lacks
  const want = JSON.parse(new TextDecoder().decode(py.stdout));
  samples.forEach((s, i) => assert(reportLine(s) === want[i], `JS "${reportLine(s)}" vs Python "${want[i]}"`));
});
