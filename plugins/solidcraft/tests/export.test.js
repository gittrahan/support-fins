// The SolidCraft export slots against the command line, with a stand-in for SolidCraft:
// a design whose body is a stress model, read through `model.mesh` as the app gives it.
// Each slot must write the file plugins/cli/cli.js writes for the same part, pose and
// settings, byte for byte: the same engine, the same pose, the same writer.
//
//   deno test -A plugins/solidcraft/tests/
import { exportFile, placementsOf, posedSoup, readOptions, rotationMatrix } from '../src/export.js';
import { finFile, rotationMatrix as cliRotation } from '../../cli/cli.js';
import { MODELS, assert, assertClose, readSTL } from '../../../tests/_util.js';

const stl = (name) => Deno.readFileSync(`${MODELS}${name}.stl`);

/** model.mesh's reply for a soup: every corner its own position, in the soup's order. */
function meshReply(body, soup, component = 0) {
  const positions = [];
  const triangles = [];
  for (let i = 0; i < soup.length; i += 9) {
    const t = positions.length;
    for (let k = 0; k < 9; k += 3) positions.push([soup[i + k], soup[i + k + 1], soup[i + k + 2]]);
    triangles.push([t, t + 1, t + 2]);
  }
  return { body, component, frame: 'component-local-mm', positions, triangles };
}

/** SolidCraft as an export sees it: a design named `name` holding `meshes`. */
function standIn(name, meshes, { components = [], budget = Infinity } = {}) {
  const calls = [];
  const logs = [];
  const refuse = (tag, val) => Object.assign(new Error(typeof val === 'string' ? val : val.reason), { payload: { tag, val } });
  return {
    calls, logs,
    run(command, json) {
      const args = JSON.parse(json);
      calls.push([command, args]);
      if (command === 'document.inspect') {
        return JSON.stringify({ name, bodies: meshes.map((m) => ({ name: m.body, visible: m.visible ?? true })) });
      }
      if (command === 'component.list') return JSON.stringify({ components });
      if (command === 'model.mesh') {
        const m = meshes.find((x) => x.body === args.body);
        if (!m) throw refuse('invalid-input', { field: 'body', reason: `no body ${args.body}` });
        const n = Math.ceil(m.triangles.length * (0.05 / args.tolerance));
        if (n > budget) {
          throw refuse('invalid-input', { field: 'body', reason: `invalid parameters for \`model.mesh\`: mesh exceeds the plugin transfer budget: ${n} triangles, at most ${budget}` });
        }
        const { visible, ...reply } = m;
        return JSON.stringify(reply);
      }
      throw refuse('permission-denied', `command ${command} is not granted`);
    },
    log: (level, message) => logs.push([level, message]),
    progress: () => {},
  };
}

/** What the command line writes for `name`.stl with `args` (finFile, through a stand-in io). */
async function cli(name, args) {
  let written = null;
  const io = { read: async () => stl(name), write: async (_, bytes) => { written = bytes; }, err: () => {} };
  await finFile(`${name}.stl`, { object: null, rot: null, finsOnly: false, ...args }, io, {});
  return written;
}

const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

Deno.test('export-stl writes the command line\'s STL for the part as it is in the design', async () => {
  const host = standIn('lbracket', [meshReply('lbracket', readSTL(stl('lbracket')))]);
  const ours = await exportFile(host, 'export-stl', '{}');
  assert(same(ours, await cli('lbracket', { output: 'lbracket-fins.stl' })), 'STL differs from the command line\'s');
  assert(host.calls.map(([c]) => c).join() === 'document.inspect,model.mesh', `calls ${host.calls.map(([c]) => c)}`);
});

Deno.test('export-3mf writes the command line\'s 3MF, posed by the site\'s rotation readout', async () => {
  const host = standIn('lbracket', [meshReply('lbracket', readSTL(stl('lbracket')))]);
  const ours = await exportFile(host, 'export-3mf', JSON.stringify({ 'rot-y': 40 }));
  assert(same(ours, await cli('lbracket', { output: 'lbracket-fins.3mf', rot: [0, 40, 0] })), '3MF differs from the command line\'s --rot 0,40,0');
});

Deno.test('Fins only writes the command line\'s --fins-only STL, lined up with the part in the design', async () => {
  const host = standIn('sphere', [meshReply('sphere', readSTL(stl('sphere')))]);
  const ours = await exportFile(host, 'export-stl', JSON.stringify({ 'fins-only': true }));
  const theirs = await cli('sphere', { output: 'sphere-fins-only.stl', finsOnly: true });
  assert(theirs && theirs.length > 84, 'the command line wrote no fins for the sphere');
  assert(same(ours, theirs), 'fins-only STL differs from the command line\'s');
});

Deno.test('the rotation readout is the command line\'s matrix', () => {
  for (const rot of [[0, 0, 0], [35, 0, 0], [0, 40, 0], [10, -20, 30], [90, 45, 180]]) {
    const a = rotationMatrix(rot), b = cliRotation(rot);
    for (let i = 0; i < 9; i++) assert(a[i] === b[i], `${rot}: element ${i} ${a[i]} vs ${b[i]}`);
  }
});

Deno.test('a body in a placed component is finned where the design shows it', async () => {
  // turned 90 deg about Z and moved, as component.list gives it: by column, origin last
  const turn = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [10, 20, 5, 1]];
  const part = readSTL(stl('lbracket'));
  const components = [
    { id: 0, occurrences: [] },
    { id: 1, occurrences: [{ id: 2, component: 1, parent: 0, transform: turn }] },
  ];
  const host = standIn('lbracket', [meshReply('lbracket', part, 1)], { components });
  const placed = posedSoup([{ ...meshReply('lbracket', part), places: placementsOf(components, 1) }]);
  for (let i = 0; i < part.length; i += 3) {
    assertClose(placed[i], -part[i + 1] + 10, 1e-12, 'x');
    assertClose(placed[i + 1], part[i] + 20, 1e-12, 'y');
    assertClose(placed[i + 2], part[i + 2] + 5, 1e-12, 'z');
  }
  const ours = await exportFile(host, 'export-stl', '{}');
  assert(host.calls.some(([c]) => c === 'component.list'), 'component.list not read');
  const direct = await exportFile(standIn('lbracket', [meshReply('lbracket', placed)]), 'export-stl', '{}');
  assert(same(ours, direct), 'a placed body differs from the same body placed by hand');
});

Deno.test('a component placed inside another, twice, is every copy', () => {
  const shift = (x) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, 0, 0, 1]];
  const components = [
    { id: 0, occurrences: [] },
    { id: 1, occurrences: [{ id: 3, component: 1, parent: 2, transform: shift(1) }] },
    { id: 2, occurrences: [{ id: 4, component: 2, parent: 0, transform: shift(10) }, { id: 5, component: 2, parent: 0, transform: shift(20) }] },
  ];
  const places = placementsOf(components, 1);
  assert(places.length === 2, `${places.length} placements`);
  assert(places[0][3][0] === 11 && places[1][3][0] === 21, `origins ${places.map((p) => p[3][0])}`);
  assert(placementsOf([{ id: 1, occurrences: [{ parent: 1, transform: shift(1) }] }], 1).length === 0, 'a loop is no placement');
});

Deno.test('a body too dense for one read is read again at a coarser chord, and said', async () => {
  const mesh = meshReply('sphere', readSTL(stl('sphere')));
  const host = standIn('sphere', [mesh], { budget: Math.ceil(mesh.triangles.length * 0.6) });
  await exportFile(host, 'export-stl', '{}');
  const reads = host.calls.filter(([c]) => c === 'model.mesh').map(([, a]) => a.tolerance);
  assert(reads.join() === '0.05,0.1', `reads at ${reads}`);
  assert(host.logs.some(([level, m]) => level === 'warn' && /0\.1 mm chord/.test(m)), 'no warning about the coarser chord');
});

Deno.test('the form\'s values become the engine\'s options: percents, defaults, refusals', () => {
  const { engine } = readOptions(JSON.stringify({ 'tine-density': 50, coverage: 70, sway: true, 'sway-reach': 20, nozzle: '0.6' }), 'export-3mf');
  assertClose(engine.tineDensity, 0.5, 1e-12, 'tine density');
  assertClose(engine.coverage, 0.7, 1e-12, 'coverage');
  assertClose(engine.sway.reach, 0.2, 1e-12, 'sway reach');
  assert(engine.sway.on === true && engine.nozzle === 0.6, JSON.stringify(engine));
  assert(Object.keys(readOptions('{}', 'export-3mf').engine).length === 0, 'an empty form is the engine\'s defaults');
  const refused = (json, slot, field) => {
    try {
      readOptions(json, slot);
    } catch (e) {
      return e.payload?.tag === 'invalid-input' && e.payload.val.field === field;
    }
    return false;
  };
  assert(refused('{"coverage": 170}', 'export-3mf', 'options'), 'coverage over 100% is refused');
  assert(refused('{"fins-only": true}', 'export-3mf', 'fins-only'), 'fins only is an STL');
  assert(refused('{"fins-only": true, "rot-x": 30}', 'export-stl', 'fins-only'), 'fins only takes no rotation');
  assert(refused('{"bodies": "Body1"}', 'export-stl', 'bodies'), 'bodies is a list');
});

Deno.test('what to fin: the picked bodies, else every visible one; refusals say why', async () => {
  const a = meshReply('A', readSTL(stl('cube')));
  const b = { ...meshReply('B', readSTL(stl('bar'))), visible: false };
  const host = standIn('two', [a, b]);
  await exportFile(host, 'export-stl', '{}');
  assert(host.calls.filter(([c]) => c === 'model.mesh').map(([, x]) => x.body).join() === 'A', 'only the visible body is read');
  const fails = async (h, json, tag, text) => {
    try {
      await exportFile(h, 'export-stl', json);
    } catch (e) {
      return e.payload?.tag === tag && text.test(e.message);
    }
    return false;
  };
  assert(await fails(standIn('two', [a, b]), '{"bodies": ["C"]}', 'invalid-input', /no visible body "C"/), 'an unknown body is refused by name');
  assert(await fails(standIn('empty', []), '{}', 'unsupported', /no visible body/), 'an empty design is unsupported');
  assert(await fails(standIn('two', [a]), '{}', 'unsupported', /^no export slot/) === false, 'a known slot runs');
});
