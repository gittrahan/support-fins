// The MCP server (plugins/mcp). Pins:
//   - it is the command line underneath: a tool call writes the same bytes the CLI
//     writes for the same file and flags, so it inherits every CLI pin;
//   - the settings schema is the CLI's flags (options.json), in the site's units;
//   - bad input is a tool error that says what's wrong and writes nothing, and a
//     request always gets an answer (notifications get none);
//   - over real stdio (Deno and Node), stdout carries only protocol lines.
//
//   deno test -A plugins/mcp/tests/
import { handle, callTool, TOOLS, PROTOCOL_VERSIONS } from '../server.js';
import { run, OPTION_FLAGS } from '../../cli/cli.js';
import { MODELS, assert } from '../../../tests/_util.js';

const LBRACKET = Deno.readFileSync(`${MODELS}lbracket.stl`);
const ENTRY = new URL('../support-fins-mcp.js', import.meta.url).pathname;

function memIO(files = { 'lb.stl': LBRACKET }) {
  const fs = new Map(Object.entries(files));
  return {
    fs,
    read: async (p) => { if (!fs.has(p)) throw new Error(`No such file: ${p}`); return fs.get(p); },
    write: async (p, b) => { fs.set(p, b); },
  };
}
async function viaCLI(argv) {
  const io = memIO();
  const code = await run(argv, { ...io, out: () => {}, err: () => {} });
  return { code, fs: io.fs };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

Deno.test('mcp: initialize negotiates the protocol and offers tools', async () => {
  const r = await handle(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }), memIO());
  assert(r.result.protocolVersion === '2025-06-18', 'a version we speak is echoed');
  assert(r.result.capabilities.tools && r.result.serverInfo.name === 'support-fins', 'tools + server name');
  const odd = await handle(rpc('initialize', { protocolVersion: '1999-01-01' }), memIO());
  assert(odd.result.protocolVersion === PROTOCOL_VERSIONS[0], 'an unknown version gets our newest');
  assert(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, memIO()) === null, 'no answer to a notification');
  assert((await handle(rpc('ping'), memIO())).result, 'ping');
  assert((await handle(rpc('resources/list'), memIO())).error.code === -32601, 'unknown method');
  assert((await handle(rpc('tools/call', { name: 'nope' }), memIO())).error.code === -32602, 'unknown tool');
  assert((await handle({ id: 3 }, memIO())).error.code === -32600, 'not a request');
  assert((await handle({ jsonrpc: '2.0', id: {}, method: 'ping' }, memIO())).error.code === -32600, 'an id is a string or integer');
  assert(TOOLS.every((t) => t.annotations.destructiveHint), 'output may replace an existing file: clients should ask');
});

Deno.test('mcp: the settings schema is the CLI\'s flags, in the site\'s units', async () => {
  const { result } = await handle(rpc('tools/list'), memIO());
  assert(result.tools.map((t) => t.name).join() === 'fin_part,fins_only', 'two tools');
  for (const t of result.tools) {
    const s = t.inputSchema.properties.settings.properties;
    assert(Object.keys(s).join() === [...OPTION_FLAGS.keys()].join(), `${t.name}: one setting per CLI flag`);
    assert(s.coverage.default === 50 && s.coverage.maximum === 100, 'percent sliders read 0-100, like the site');
    assert(s.gap.default === 0.2 && s['pad-style'].enum.includes('sure'), 'mm and choices as the site has them');
    assert(/only used when tines is on/.test(s['tine-density'].description), 'when a setting matters is said');
  }
  assert(!('rot' in TOOLS[1].inputSchema.properties), 'fins_only lines up with the file: no rot');
});

Deno.test('mcp: fin_part writes exactly what the command line writes', async () => {
  const io = memIO();
  const r = await callTool('fin_part', { path: 'lb.stl', rot: [0, 35, 0], settings: { coverage: 70, sway: true } }, io);
  assert(!r.isError, r.content[0].text);
  const cli = await viaCLI(['lb.stl', '--rot', '0,35,0', '--coverage', '70', '--sway']);
  assert(cli.code === 0 && same(io.fs.get('lb-fins.3mf'), cli.fs.get('lb-fins.3mf')), '3MF differs from the CLI\'s');
  assert(r.structuredContent.output === 'lb-fins.3mf' && r.structuredContent.stats.braces >= 1, 'output + stats');
  assert(/^wrote lb-fins\.3mf: \d+ walls?, \d+ tines?/.test(r.content[0].text), r.content[0].text);
  // a merged STL, and fins only
  const stl = await callTool('fin_part', { path: 'lb.stl', output: 'out.stl', rot: [0, 35, 0] }, io);
  assert(!stl.isError && same(io.fs.get('out.stl'), (await viaCLI(['lb.stl', '--rot', '0,35,0', '-o', 'out.stl'])).fs.get('out.stl')), 'merged STL');
  const none = await callTool('fins_only', { path: 'lb.stl' }, io);
  assert(!none.isError && none.structuredContent.output === null && /nothing written/.test(none.content[0].text), 'no overhang, no file');
});

Deno.test('mcp: bad input is a tool error that says why, and writes nothing', async () => {
  const cases = [
    [{ path: 'lb.stl', settings: { coverage: 150 } }, /coverage must be 0\.\.100, got 150/],
    [{ path: 'lb.stl', settings: { coverage: '70' } }, /coverage must be a number/],
    [{ path: 'lb.stl', settings: { sparkle: 1 } }, /unknown setting "sparkle"; the settings are mode, threshold, tines/],
    [{ path: 'lb.stl', rot: [0, 35] }, /rot must be \[x, y, z\]/],
    [{ path: 'missing.stl' }, /No such file: missing\.stl/],
    [{ path: 'lb.stl', output: 'lb.stl' }, /won't overwrite the input/],
    [{ settings: {} }, /path/],
    [{ path: 'lb.stl', object: {} }, /object is a 1-based number or a name/],
    [{ path: 'lb.stl', toString: 5 }, /fin_part takes no "toString"/],
    [{ path: 'lb.stl', settings: { constructor: 1 } }, /unknown setting "constructor"/],
  ];
  for (const [args, want] of cases) {
    const io = memIO();
    const r = await callTool('fin_part', args, io);
    assert(r.isError && want.test(r.content[0].text), `${JSON.stringify(args)}: ${r.content[0].text}`);
    assert(io.fs.size === 1, `${JSON.stringify(args)} wrote something`);
  }
  const f3 = await callTool('fins_only', { path: 'lb.stl', output: 'f.3mf' }, memIO());
  assert(f3.isError && f3.content[0].text === 'fins-only writes an .stl', `errors name settings, not flags: ${f3.content[0].text}`);
  const rot = await callTool('fins_only', { path: 'lb.stl', rot: [0, 35, 0] }, memIO());
  assert(rot.isError && /fins_only takes no "rot"/.test(rot.content[0].text), rot.content[0].text);
  // a setting the math ignores runs, with the CLI's warning in the setting's name
  const hidden = await callTool('fin_part', { path: 'lb.stl', rot: [0, 35, 0], settings: { 'sway-reach': 20 } }, memIO());
  assert(!hidden.isError && /warning: sway-reach does nothing/.test(hidden.content[0].text), hidden.content[0].text);
});

/** Talk to the real entry over stdio; returns the parsed stdout lines. */
async function stdio(cmd, args, messages, cwd) {
  const p = new Deno.Command(cmd, { args, cwd, stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n'));
  await w.close();
  const { code, stdout, stderr } = await p.output();
  const text = new TextDecoder().decode(stdout);
  assert(code === 0, `exit ${code}: ${new TextDecoder().decode(stderr)}`);
  return text.trim().split('\n').map((l) => JSON.parse(l));   // every stdout line is JSON
}

for (const [runtime, cmd, args] of [['deno', Deno.execPath(), ['run', '-RWE', ENTRY]], ['node', 'node', [ENTRY]]]) {
  Deno.test({
    name: `mcp: over stdio (${runtime}), the whole exchange; relative paths are the server's directory`,
    ignore: runtime === 'node' && !(await new Deno.Command('node', { args: ['-v'] }).output().then((o) => o.success, () => false)),
    fn: async () => {
      const dir = await Deno.makeTempDir();
      await Deno.writeFile(`${dir}/lb.stl`, LBRACKET);
      const lines = await stdio(cmd, args, [
        rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }, 1),
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        'not json',
        rpc('tools/call', { name: 'fin_part', arguments: { path: `${dir}/lb.stl`, rot: [0, 35, 0] } }, 2),
        rpc('tools/call', { name: 'fin_part', arguments: { path: 'lb.stl', output: 'rel.stl' } }, 3),
      ], dir);
      const byId = new Map(lines.map((l) => [l.id, l]));
      assert(lines.length === 4, `${lines.length} replies: ${JSON.stringify(lines)}`);
      assert(byId.get(1).result.serverInfo.name === 'support-fins', 'initialize');
      assert(byId.get(null).error.code === -32700, 'a bad line is a parse error, not a crash');
      assert(byId.get(2).result.isError === false, JSON.stringify(byId.get(2)));
      const cli = await viaCLI(['lb.stl', '--rot', '0,35,0']);
      assert(same(await Deno.readFile(`${dir}/lb-fins.3mf`), cli.fs.get('lb-fins.3mf')), 'file on disk = the CLI\'s');
      assert(byId.get(3).result.structuredContent.output === `${await Deno.realPath(dir)}/rel.stl`, JSON.stringify(byId.get(3)));
      assert((await Deno.stat(`${dir}/rel.stl`)).size > 0, 'relative output lands in the server\'s directory');
      await Deno.remove(dir, { recursive: true });
    },
  });
}
