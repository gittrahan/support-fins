// The settings reference in docs/PLUGIN-CONFIG.md, written from options.json so it
// can't drift: the block between the BEGIN/END markers is this script's output, and
// plugins/shared/tests/options_doc.test.js fails when it is stale.
//
//   deno run -A plugins/shared/options_doc.js     rewrite the block
import { OPTIONS_SCHEMA } from './engine/fins_entry.js';
import { flagOf } from '../cli/cli.js';

export const DOC = new URL('../../docs/PLUGIN-CONFIG.md', import.meta.url);
export const BEGIN = '<!-- BEGIN options.json (plugins/shared/options_doc.js writes this block) -->';
export const END = '<!-- END options.json -->';

const code = (v) => `\`${typeof v === 'string' ? v : JSON.stringify(v)}\``;
const byKey = Object.fromEntries(OPTIONS_SCHEMA.options.map((o) => [o.key, o]));
const labelOf = (key) => byKey[key]?.label ?? key;

function when(item) {
  if (typeof item === 'string') return `${labelOf(item)} is on`;
  if (item.any) return item.any.map(when).join(', or ');
  return `${labelOf(item.key)} is ${item.in.map((v) => byKey[item.key].choices.find((c) => c.value === v)?.label.split(' — ')[0] ?? v).join(' or ')}`;
}

// The JSON value range, in the entry's units (what a config file and options.json hold).
function values(o) {
  if (o.type === 'bool') return '`true` / `false`';
  if (o.type === 'choice') return o.choices.map((c) => code(c.value)).join(', ');
  return `${o.min} to ${o.max}`;
}

function flag(o) {
  const f = flagOf(o.key);
  if (o.type === 'bool') return o.default ? `\`--no-${f}\`` : `\`--${f}\``;
  return `\`--${f}\``;
}

export function optionsBlock() {
  const out = [BEGIN, ''];
  for (const s of OPTIONS_SCHEMA.sections) {
    const opts = OPTIONS_SCHEMA.options.filter((o) => o.section === s.id);
    if (!opts.length) continue;
    out.push(`### ${s.label}`, '',
      '| Setting | JSON key | Values (JSON) | Default | CLI flag |',
      '|---|---|---|---|---|');
    for (const o of opts) {
      out.push(`| ${o.label} | ${code(o.key)} | ${values(o)} | ${code(o.default)} | ${flag(o)} |`);
    }
    out.push('');
    for (const o of opts) {
      const notes = [];
      if (o.percent) notes.push(`A percent: the site and the CLI show ${o.min * 100}-${o.max * 100}, a JSON config holds that / 100.`);
      if (o.showIf) notes.push(`Only used when ${o.showIf.map(when).join(' and ')}.`);
      if (o.hostSupplied === 'slicer') notes.push('Slicer plugins take this from the slicer\'s own settings; leave it out of their config.');
      out.push(`- **${o.label}** (${code(o.key)}): ${o.tooltip}${notes.length ? ' ' + notes.join(' ') : ''}`);
    }
    out.push('');
  }
  out.push(END);
  return out.join('\n');
}

export function withBlock(doc) {
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/PLUGIN-CONFIG.md: missing the ${BEGIN} ... ${END} markers`);
  return doc.slice(0, a) + optionsBlock() + doc.slice(b + END.length);
}

if (import.meta.main) Deno.writeTextFileSync(DOC, withBlock(Deno.readTextFileSync(DOC)));
