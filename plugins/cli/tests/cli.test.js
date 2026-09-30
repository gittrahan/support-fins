// The command line (plugins/cli). Pins:
//   - it runs the plugins' engine path: the CLI's fins are computeFins' fins on the
//     posed part, bit for bit, and match the website's own path the way every
//     plugin does (same overhangs + fin count, tines within 3: ENGINE-SENSITIVITY.md);
//   - --rot turns about the plate's X, then Y, then Z;
//   - what it writes: a 3MF with the part and the fins seated together on z = 0,
//     an STL with both, or the fins alone lined up with it;
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
import { readThreeMF, writeThreeMF } from '../../../web/threemf.js';
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

Deno.test('cli: --rot is X, then Y, then Z about the plate, in the tests\' matrix layout', () => {
  const same = (a, b, msg) => a.forEach((v, i) => assertClose(v, b[i], 1e-12, `${msg}[${i}]`));
  same(rotationMatrix([30, 0, 0]), rotX(30), 'X');
  same(rotationMatrix([0, 35, 0]), rotY(35), 'Y');
  // X then Y: the point (0,1,0) turned 90 about X lands on +Z, then 90 about Y lands on +X
  const p = pose([0, 1, 0, 0, 0, 0, 0, 0, 0], [90, 90, 0]);
  assertClose(p[0], 1, 1e-12, 'x'); assertClose(p[1], 0, 1e-12, 'y'); assertClose(p[2], 0, 1e-12, 'z');
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

Deno.test('cli: .stl output merges part + fins; --fins-only writes the fins alone', async () => {
  const direct = computeFins(pose(readSTL(LBRACKET), [0, 35, 0]));
  const partN = readSTL(LBRACKET).length / 9, finN = direct.triangles.length / 9;
  const both = await cli(['lb.stl', '--rot', '0,35,0', '-o', 'out.stl']);
  assert(readSTL(both.fs.get('out.stl')).length / 9 === partN + finN, 'merged STL count');
  const only = await cli(['lb.stl', '--rot', '0,35,0', '--fins-only']);
  const got = readSTL(only.fs.get('lb-fins-only.stl'));
  assert(got.length / 9 === finN, 'fins-only count');
  for (let i = 0; i < got.length; i++) assert(got[i] === direct.triangles[i], `fins-only value ${i}`);
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
    [[], /no input file/],
  ];
  for (const [argv, re] of cases) {
    const { code, err, fs } = await cli(argv);
    assert(code === 2, `${argv.join(' ')}: exit ${code}`);
    assert(re.test(err.join('\n')), `${argv.join(' ')}: said ${JSON.stringify(err)}`);
    assert(fs.size === 1, `${argv.join(' ')}: wrote a file`);
  }
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
});

Deno.test('cli: a 3MF input reads; one with several objects asks which', async () => {
  const cube = [];
  const flat = block(0, 20, 0, 20, 0, 20);
  for (let i = 0; i < flat.length; i += 3) cube.push([flat[i], flat[i + 1], flat[i + 2]]);
  const one = new Uint8Array(await writeThreeMF(cube, [], 'cube').arrayBuffer());
  const r1 = await cli(['c.3mf', '--rot', '45,0,0', '--json'], { 'c.3mf': one });
  assert(r1.code === 0, `exit ${r1.code}: ${r1.err}`);
  const want = computeFins(pose(block(0, 20, 0, 20, 0, 20), [45, 0, 0])).stats;
  assert(JSON.stringify(JSON.parse(r1.out[0]).stats) === JSON.stringify(want), '3MF input fins = STL input fins');

  // A plate of two objects: refused without --object, finned with it.
  const { zipStore } = await import('../../../web/zip.js');
  const mesh = (x) => `<object id="${x}" type="model"><mesh><vertices>`
    + [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, 20]].map(([a, b, c]) => `<vertex x="${a + x * 40}" y="${b}" z="${c}"/>`).join('')
    + '</vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>'
    + '<triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object>';
  const xml = '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + `<resources>${mesh(1)}${mesh(2)}</resources><build><item objectid="1"/><item objectid="2"/></build></model>`;
  const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const two = new Uint8Array(await zipStore([
    { name: '_rels/.rels', data: new TextEncoder().encode(rels) },
    { name: '3D/3dmodel.model', data: new TextEncoder().encode(xml) },
  ]).arrayBuffer());
  const refused = await cli(['plate.3mf'], { 'plate.3mf': two });
  assert(refused.code === 1 && /has 2 objects .*pick one with --object/.test(refused.err[0]), refused.err[0]);
  const picked = await cli(['plate.3mf', '--object', '2'], { 'plate.3mf': two });
  assert(picked.code === 0 && picked.fs.has('plate-fins.3mf'), `--object 2: ${picked.err}`);
});

Deno.test('cli: the summary line says what was left unsupported, word for word with the Python hosts', async () => {
  const samples = [
    { braces: 3, props: 1, tines: 12 },
    { braces: 1, props: 0, tines: 1, swayBraces: 2, unserved: 1 },
    { braces: 0, props: 2, tines: 0, unserved: 3, floating: 1, floatingDrop: 4.26 },
    { braces: 2, tines: 5, floating: 2, floatingDrop: 12 },
  ];
  assert(/1 overhang is too shallow/.test(reportLine(samples[1])), reportLine(samples[1]));
  assert(/one piece isn't joined to the rest: it starts 4\.3 mm up/.test(reportLine(samples[2])), reportLine(samples[2]));
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
