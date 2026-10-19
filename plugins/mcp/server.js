// Support Fins as an MCP server: the command line's job, as tools an AI client
// (Claude Code, Claude Desktop, any MCP host) can call. No file system or transport
// of its own: support-fins-mcp.js hands it stdio and a disk, the tests an in-memory one.
//
// It IS the command line underneath: a tool call becomes the argv the CLI would
// get, and cli.js run() fins the file -- same engine, same checks, same refusals,
// same report. The settings schema is built from the CLI's flags (so from
// options.json), in the site's units: percent sliders 0-100.
import { run, OPTION_FLAGS, shown } from '../cli/cli.js';
import { VERSION } from '../cli/version.js';

export const SERVER_VERSION = VERSION;   // plugins/cli/version.js: stamped by the build
// newest first; an unknown request gets the newest (the client then decides)
// (not 2025-03-26: its clients may send JSON-RPC batches, which this server doesn't take)
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2024-11-05'];

const INSTRUCTIONS = [
  'Support Fins (printfins.com) bakes breakaway support walls ("fins") into a part for FDM printing,',
  'so it prints with the slicer\'s supports off. fin_part writes the part + fins as a 3MF (or one STL)',
  'that opens in any slicer; fins_only writes just the fins, lined up with the part as it is in its file.',
  'Paths are on this computer; give absolute ones. The part is finned the way it sits in its file',
  '(z up) unless rot turns it: rot is printfins.com\'s "X · Y · Z" readout in degrees.',
  'Overhangs a fin can\'t reach are reported in the result, not raised as errors: tell the user,',
  'and suggest a steeper pose (rot) when the report says to tilt the part.',
].join(' ');

// --- the settings schema, from the CLI's flags ---------------------------------

/** showIf -> "only when tines is on", in setting names. */
function when(items) {
  const one = (it) => {
    if (typeof it === 'string') return `${flagName(it)} is on`;
    if (it.any) return it.any.map(one).join(' or ');
    return `${flagName(it.key)} is ${it.in.join(' or ')}`;
  };
  return items.map(one).join(' and ');
}
const flagName = (key) => [...OPTION_FLAGS].find(([, o]) => o.key === key)?.[0] ?? key;

function settingSchema(o) {
  let s;
  if (o.type === 'bool') s = { type: 'boolean', default: o.default };
  else if (o.type === 'choice') s = { type: 'string', enum: o.choices.map((c) => c.value), default: o.default };
  else s = { type: 'number', minimum: shown(o, o.min), maximum: shown(o, o.max), default: shown(o, o.default) };
  let d = o.label;
  if (o.type === 'number' && o.percent) d += ', percent 0-100';
  if (o.hint && !(o.percent && o.hint === '%')) d += ` (${o.hint})`;
  if (o.showIf) d += `; only used when ${when(o.showIf)}`;
  if (o.key === 'threshold') d += '; measured from the plate, not a slicer\'s support angle';
  s.description = d;
  return s;
}

const SETTINGS = {
  type: 'object',
  description: 'printfins.com\'s settings, in the site\'s units; anything left out is the site\'s default.',
  properties: Object.fromEntries([...OPTION_FLAGS].map(([flag, o]) => [flag, settingSchema(o)])),
  additionalProperties: false,
};

const PATH = { type: 'string', description: 'The part: an .stl, .3mf or .obj on this computer (absolute path).' };
// a plain string: some hosts turn tool schemas into other vendors' formats, which refuse type arrays
const OBJECT = {
  type: 'string',
  description: 'Which object of a 3MF with several to fin: its 1-based number ("2") or its name.',
};

export const TOOLS = [
  {
    name: 'fin_part',
    title: 'Fin a part',
    description: 'Bake support fins into a part. Writes the part + fins (posed, centred on the plate, '
      + 'seated on z = 0, as printfins.com exports) to a 3MF next to it, <part>-fins.3mf, or to output '
      + '(.3mf, or .stl for one merged mesh). Returns what was placed and what was left unsupported.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        output: { type: 'string', description: 'Where to write: .3mf or .stl. Default <part>-fins.3mf beside the part.' },
        rot: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: 'Pose the part first: [x, y, z] degrees, printfins.com\'s "X · Y · Z" readout.',
        },
        object: OBJECT,
        settings: SETTINGS,
      },
      required: ['path'],
      additionalProperties: false,
    },
    // destructive: output may name an existing file, which is replaced
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'fins_only',
    title: 'Fins only',
    description: 'Write only the fins (+ bed pad) as an STL, lined up with the part exactly where it is in '
      + 'its file, to add beside the part in a slicer or CAD scene. The part is not moved, so pose it in '
      + 'its file first. Default output <part>-fins-only.stl beside the part; nothing is written when the '
      + 'part needs no fins.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        output: { type: 'string', description: 'Where to write: an .stl. Default <part>-fins-only.stl beside the part.' },
        object: OBJECT,
        settings: SETTINGS,
      },
      required: ['path'],
      additionalProperties: false,
    },
    // destructive: output may name an existing file, which is replaced
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

// --- a tool call is a command line ------------------------------------------------

class ToolInputError extends Error {}

/** A tool's arguments -> the CLI's argv. Type checks here; ranges are the CLI's. */
export function argvFor(name, a) {
  if (!a || typeof a !== 'object') throw new ToolInputError('arguments must be an object');
  const tool = TOOLS.find((t) => t.name === name);
  for (const k of Object.keys(a)) {
    if (!Object.hasOwn(tool.inputSchema.properties, k)) throw new ToolInputError(`${name} takes no "${k}"`);
  }
  if (typeof a.path !== 'string' || a.path === '') throw new ToolInputError('path: the part\'s file, as a string');
  const argv = ['--json'];
  if (name === 'fins_only') argv.push('--fins-only');
  if (a.output != null) {
    if (typeof a.output !== 'string') throw new ToolInputError('output must be a path string');
    argv.push('--output', a.output);
  }
  if (a.rot != null) {
    if (!Array.isArray(a.rot) || a.rot.length !== 3 || a.rot.some((v) => typeof v !== 'number')) {
      throw new ToolInputError('rot must be [x, y, z] in degrees');
    }
    argv.push('--rot', a.rot.join(','));
  }
  if (a.object != null) {
    if (typeof a.object !== 'string' && !Number.isInteger(a.object)) throw new ToolInputError('object is a 1-based number or a name');
    argv.push('--object', String(a.object));
  }
  const settings = a.settings ?? {};
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new ToolInputError('settings must be an object');
  for (const [k, v] of Object.entries(settings)) {
    const o = OPTION_FLAGS.get(k);
    if (!o) throw new ToolInputError(`unknown setting "${k}"; the settings are ${[...OPTION_FLAGS.keys()].join(', ')}`);
    if (v === null) continue;   // the default
    if (o.type === 'bool') {
      if (typeof v !== 'boolean') throw new ToolInputError(`${k} is true or false`);
      argv.push(v ? `--${k}` : `--no-${k}`);
    } else {
      if (o.type === 'number' && typeof v !== 'number') throw new ToolInputError(`${k} must be a number`);
      if (o.type === 'choice' && typeof v !== 'string') throw new ToolInputError(`${k} is one of ${o.choices.map((c) => c.value).join(', ')}`);
      argv.push(`--${k}=${v}`);
    }
  }
  argv.push('--', a.path);
  return argv;
}

// The CLI speaks in flags ("--coverage must be 0..100"); a tool caller set "coverage".
const unflag = (line) => line.replace(/^support-fins: /, '').replace(/(^|\s)--(?=[a-z])/g, '$1');

/**
 * Run one tool. io is the CLI's ({read, write}), plus resolve(path) to make a
 * relative path absolute against the server's directory.
 */
export async function callTool(name, args, io) {
  let argv;
  try {
    if (!TOOLS.some((t) => t.name === name)) throw new ToolInputError(`no tool ${name}`);
    const a = { ...args };
    if (io.resolve) for (const k of ['path', 'output']) if (typeof a[k] === 'string' && a[k]) a[k] = io.resolve(a[k]);
    argv = argvFor(name, a);
  } catch (e) {
    if (!(e instanceof ToolInputError)) throw e;
    return fail(e.message);
  }
  const out = [], err = [];
  const code = await run(argv, { read: io.read, write: io.write, out: (l) => out.push(l), err: (l) => err.push(l) });
  if (code !== 0) {
    // exit 1: the file's {input, error} line; exit 2: a usage line
    const msgs = err.map((l) => { try { return unflag(JSON.parse(l).error); } catch { return unflag(l); } });
    return fail(msgs.join('\n'));
  }
  const r = JSON.parse(out[0]);
  const warnings = err.map((l) => unflag(l).replace(/^.*?warning: /, ''));
  const text = [r.output ? `wrote ${r.output}: ${r.report}` : r.report, ...warnings.map((w) => `warning: ${w}`)];
  return {
    content: [{ type: 'text', text: text.join('\n') }],
    structuredContent: { output: r.output, report: r.report, stats: r.stats, warnings },
    isError: false,
  };
}

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

// --- JSON-RPC ----------------------------------------------------------------------

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * One message in, its response out (null for a notification). Never throws: a
 * request always gets an answer.
 */
export async function handle(msg, io) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // a response from the client (we never ask it anything) is dropped quietly
    if (msg && typeof msg === 'object' && !Array.isArray(msg) && ('result' in msg || 'error' in msg)) return null;
    return rpcError(msg?.id, -32600, 'not a JSON-RPC 2.0 request');
  }
  const { id, method, params } = msg;
  if (id === undefined) return null;   // notifications/initialized, cancelled, ...: nothing to answer
  if (typeof id !== 'string' && !Number.isInteger(id)) return rpcError(null, -32600, 'id must be a string or an integer');
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  try {
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'support-fins', title: 'Support Fins', version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        if (!TOOLS.some((t) => t.name === params?.name)) return rpcError(id, -32602, `unknown tool ${params?.name}`);
        return ok(await callTool(params.name, params.arguments ?? {}, io));
      }
      default: return rpcError(id, -32601, `no method ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, e?.message || String(e));
  }
}
