// Support Fins from a terminal: the command line's logic, with no file system of
// its own. support-fins.js hands it the arguments and a small I/O object (Deno or
// Node), and the tests hand it an in-memory one.
//
// Same engine as every plugin: the part is posed here (--rot), then
// plugins/shared/engine computeFins places the fins exactly as it does for Orca,
// Cura or Fusion. Flags come from options.json, so a flag is a site setting is a
// plugin dialog control.
import { computeFins, optionsFromDialog, optionVisible, OPTIONS_SCHEMA } from '../shared/engine/fins_entry.js';
import { reportLine } from '../shared/engine/report.js';
import { readSTL, writeBinarySTL } from '../../web/stl.js';
import { readThreeMF, writeThreeMF } from '../../web/threemf.js';
import { unzip } from '../../web/zip.js';

// --- flags from options.json -------------------------------------------------

// sway.on -> --sway, sway.gripFrom -> --sway-grip-from, tineDensity -> --tine-density
const flagOf = (key) => key.replace(/\.on$/, '').replace(/\./g, '-')
  .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const OPTION_FLAGS = new Map(OPTIONS_SCHEMA.options.map((o) => [flagOf(o.key), o]));

// A percent option is typed as the site's slider shows it (0-100), not the entry's 0-1.
const shown = (o, v) => (o.percent ? +(v * 100).toFixed(6) : v);

export function helpText() {
  const lines = [
    'support-fins -- bake breakaway support fins into a 3D print (printfins.com, from a terminal)',
    '',
    'usage: support-fins <part.stl|part.3mf>... [options]',
    '',
    '  -o, --output <file>   where to write (.3mf or .stl); one input only.',
    '                        default: <part>-fins.3mf next to the input',
    '  --rot <x,y,z>         pose the part first, in degrees: the site\'s "X · Y · Z" readout',
    '  --fins-only           write only the fins + bed pad, lined up with the part as it is in',
    '                        your file (so not with --rot)',
    '  --object <n|name>     which object of a multi-object 3MF to fin (1-based)',
    '  --json                one JSON line per file instead of the summary',
    '  -h, --help            this text',
    '',
    'settings (the site\'s, same defaults):',
  ];
  for (const [flag, o] of OPTION_FLAGS) {
    let arg = '';
    if (o.type === 'choice') arg = ` <${o.choices.map((c) => c.value).join('|')}>`;
    else if (o.type === 'number') arg = o.percent ? ' <0-100>' : ` <${o.min}-${o.max}>`;
    const name = o.type === 'bool' ? (o.default ? `--no-${flag}` : `--${flag}`) : `--${flag}${arg}`;
    // Units only ("mm", "%"): the site's other hints ("light ⟶ firm") are slider ends.
    const unit = o.hint && /^(mm|°|%)/.test(o.hint) ? ` ${o.hint}` : '';
    const what = o.type === 'bool'
      ? `${o.default ? 'turn off' : 'turn on'} ${o.label.toLowerCase()}${o.hint ? ` (${o.hint})` : ''}`
      : `${o.label}${unit}, default ${shown(o, o.default)}`;
    lines.push(`  ${name.padEnd(38)} ${what}`);
  }
  lines.push('', 'Overhangs a fin can\'t reach are reported, not errors: exit 0. Exit 1 = a file',
    'failed; exit 2 = bad arguments. `--` ends the options (for a file named -x.stl).');
  return lines.join('\n');
}

class UsageError extends Error {}

/** argv (without the program name) -> { inputs, output, rot, finsOnly, object, json, help, dialog } */
export function parseArgs(argv) {
  const out = { inputs: [], output: null, rot: null, finsOnly: false, object: null,
                json: false, help: false, dialog: {} };
  let files = false;
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (files) { out.inputs.push(a); continue; }
    if (a === '--') { files = true; continue; }
    let value = null;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { value = a.slice(eq + 1); a = a.slice(0, eq); }
    const next = () => {
      if (value !== null) return value;
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-o' || a === '--output') out.output = next();
    else if (a === '--rot') out.rot = parseRot(next());
    else if (a === '--fins-only') out.finsOnly = true;
    else if (a === '--object') out.object = next();
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--')) {
      const neg = a.startsWith('--no-');
      const flag = a.slice(neg ? 5 : 2);
      const o = OPTION_FLAGS.get(flag);
      if (!o) throw new UsageError(`unknown option ${a} (see --help)`);
      if (o.type === 'bool') {
        if (value !== null) throw new UsageError(`${a} takes no value`);
        out.dialog[o.key] = !neg;
      } else {
        if (neg) throw new UsageError(`unknown option ${a} (see --help)`);
        const v = next();
        if (o.type === 'number') {
          const n = Number(v);
          if (v.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${flag} must be a number, got ${JSON.stringify(v)}`);
          out.dialog[o.key] = o.percent ? n / 100 : n;
        } else {
          out.dialog[o.key] = v;
        }
      }
    } else if (a.startsWith('-') && a !== '-') {
      throw new UsageError(`unknown option ${a} (see --help)`);
    } else {
      out.inputs.push(a);
    }
  }
  return out;
}

function parseRot(s) {
  const v = s.split(',').map((t) => Number(t.trim()));
  if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) {
    throw new UsageError(`--rot takes three angles in degrees, x,y,z -- got ${JSON.stringify(s)}`);
  }
  return v;
}

// --- geometry ---------------------------------------------------------------

/**
 * Column-major 3x3 (three.js Matrix3.elements) for the site's rotation readout:
 * "X a · Y b · Z c" is three.js Euler(a, b, c, 'XYZ'), i.e. R = Rx * Ry * Rz, so the
 * numbers on printfins.com pose the part the same way here.
 */
export function rotationMatrix([ax, ay, az]) {
  const r = (d) => (d * Math.PI) / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(r(ax)), Math.sin(r(ax)), Math.cos(r(ay)),
    Math.sin(r(ay)), Math.cos(r(az)), Math.sin(r(az))];
  // three.js Matrix4.makeRotationFromEuler, order 'XYZ', stored by column
  return [
    cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
    -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
    sy, -sx * cy, cx * cy,
  ];
}

/** Pose a soup in float64 (Orca poses in double; float32 can flip a borderline tine). */
export function pose(pos, rot) {
  const out = new Float64Array(pos.length);
  if (!rot) { out.set(pos); return out; }
  const m = rotationMatrix(rot);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[3] * y + m[6] * z;
    out[i + 1] = m[1] * x + m[4] * y + m[7] * z;
    out[i + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
  return out;
}

const triples = (flat, add = [0, 0, 0]) => {
  const out = new Array(flat.length / 3);
  for (let i = 0, j = 0; i < flat.length; i += 3, j++) {
    out[j] = [flat[i] + add[0], flat[i + 1] + add[1], flat[i + 2] + add[2]];
  }
  return out;
};

// --- one file ---------------------------------------------------------------

async function readPart(path, bytes, object) {
  if (/\.3mf$/i.test(path)) {
    // Our own export holds part + fins as one object: finning it would put fins
    // under the old fins. Refuse rather than print that.
    const model = (await unzip(bytes)).get('3D/3dmodel.model');
    if (model && new TextDecoder().decode(model).includes('<metadata name="Application">Support Fins</metadata>')) {
      throw new Error('already has fins (a Support Fins export): fin the original part instead');
    }
    const m = await readThreeMF(bytes);
    const objs = m.objects || [];
    if (objs.length <= 1 && object === null) return m.positions;
    if (object === null) {
      throw new Error(`has ${objs.length} objects (${objs.map((o, i) => `${i + 1} ${o.name}`).join(', ')}); `
        + 'pick one with --object');
    }
    const byIndex = /^\d+$/.test(object) ? objs[Number(object) - 1] : null;
    const pick = byIndex || objs.find((o) => o.name === object);
    if (!pick) throw new Error(`no object ${JSON.stringify(object)}; it has ${objs.map((o) => o.name).join(', ')}`);
    return pick.positions;
  }
  if (/\.stl$/i.test(path)) return readSTL(bytes);
  throw new Error('reads .stl and .3mf only');
}

const sameFile = (a, b) => a.replace(/^\.[\\/]/, '') === b.replace(/^\.[\\/]/, '');

function defaultOutput(input, finsOnly) {
  const base = input.replace(/\.(stl|3mf)$/i, '');
  return finsOnly ? `${base}-fins-only.stl` : `${base}-fins.3mf`;
}

/**
 * Fin one file. The part is written as the engine sees it: posed, centred over the
 * plate origin, on z = 0 -- the site's export frame -- with the fins in that frame.
 */
export async function finFile(input, args, io, engineOptions) {
  const output = args.output ?? defaultOutput(input, args.finsOnly);
  if (!/\.(3mf|stl)$/i.test(output)) throw new Error(`output ${output}: write .3mf or .stl`);
  if (args.finsOnly && !/\.stl$/i.test(output)) throw new Error('--fins-only writes an .stl');
  if (sameFile(output, input)) throw new Error(`won't overwrite the input; pick another -o`);
  const posed = pose(await readPart(input, await io.read(input), args.object), args.rot);
  const { triangles, offset, stats } = computeFins(posed, engineOptions);
  const name = (input.split(/[\\/]/).pop() || 'part').replace(/\.(stl|3mf)$/i, '');
  if (args.finsOnly && triangles.length === 0) {
    return { input, output: null, stats, report: `${reportLine(stats)}; no fins, nothing written` };
  }
  // The fins come back in the engine's seated frame. --fins-only maps them back onto
  // the part as it is in the file (fin - offset); otherwise the part moves to them.
  const fins = triples(triangles, args.finsOnly ? [-offset.x, -offset.y, -offset.z] : [0, 0, 0]);
  const part = triples(posed, [offset.x, offset.y, offset.z]);
  const blob = args.finsOnly ? writeBinarySTL(fins, `${name} fins`)
    : /\.3mf$/i.test(output) ? writeThreeMF(part, fins, name)
    : writeBinarySTL([...part, ...fins], name);
  await io.write(output, new Uint8Array(await blob.arrayBuffer()));
  return { input, output, stats, report: reportLine(stats) };
}

// --- the command ------------------------------------------------------------

/**
 * @param {string[]} argv  arguments after the program name
 * @param {{read(path):Promise<Uint8Array>, write(path, bytes):Promise<void>,
 *          out(line):void, err(line):void}} io
 * @returns {Promise<number>} exit code: 0 ok, 1 a file failed, 2 bad arguments
 */
export async function run(argv, io) {
  let args, engineOptions;
  try {
    args = parseArgs(argv);
    if (args.help) { io.out(helpText()); return 0; }
    if (args.inputs.length === 0) throw new UsageError('no input file (see --help)');
    if (args.output && args.inputs.length > 1) throw new UsageError('-o takes one input; with several, each is written next to its input');
    if (args.finsOnly && args.rot) {
      throw new UsageError('--fins-only lines up with the part as it is in your file, so it can\'t take --rot: '
        + 'pose the part in your file, or write part + fins (.3mf)');
    }
    engineOptions = optionsFromDialog(args.dialog);
    // No setting the math ignores goes by silently (the site hides these controls).
    for (const key of Object.keys(args.dialog)) {
      if (!optionVisible(key, args.dialog)) io.err(`support-fins: warning: --${flagOf(key)} does nothing with these settings`);
    }
  } catch (e) {
    // optionsFromDialog speaks in the entry's units; say it in the flag's.
    io.err(`support-fins: ${e instanceof UsageError ? e.message : flagMessage(e.message)}`);
    return 2;
  }
  let failed = 0;
  for (const input of args.inputs) {
    try {
      const r = await finFile(input, args, io, engineOptions);
      io.out(args.json ? JSON.stringify(r) : `${r.input} -> ${r.output ?? '(nothing)'}: ${r.report}`);
    } catch (e) {
      failed++;
      io.err(args.json ? JSON.stringify({ input, error: e.message }) : `support-fins: ${input}: ${e.message}`);
    }
  }
  return failed ? 1 : 0;
}

// "coverage must be 0..1 (a percent control's value / 100), got 1.5" -> "--coverage must be 0..100, got 150"
function flagMessage(msg) {
  const m = msg.match(/^(\S+) must be (\S+?)\.\.(\S+?)(?: \(a percent[^)]*\))?, got (.*)$/);
  const o = m && OPTIONS_SCHEMA.options.find((x) => x.key === m[1]);
  if (!o) {
    const k = msg.match(/^(\S+) /);
    const opt = k && OPTIONS_SCHEMA.options.find((x) => x.key === k[1]);
    return opt ? `--${flagOf(opt.key)}${msg.slice(k[1].length)}` : msg;
  }
  const got = Number(m[4]);
  return `--${flagOf(o.key)} must be ${shown(o, o.min)}..${shown(o, o.max)}, got ${Number.isFinite(got) ? shown(o, got) : m[4]}`;
}
