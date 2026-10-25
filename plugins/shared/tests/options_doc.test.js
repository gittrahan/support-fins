// docs/PLUGIN-CONFIG.md's settings tables are generated from options.json: a setting
// added, renamed or re-ranged there must be regenerated into the doc.
//
//   deno test -A plugins/shared/tests/options_doc.test.js
import { DOC, withBlock } from '../options_doc.js';
import { OPTIONS_SCHEMA } from '../engine/fins_entry.js';
import { assert } from '../../../tests/_util.js';

const doc = Deno.readTextFileSync(DOC);

Deno.test('docs/PLUGIN-CONFIG.md settings block matches options.json', () => {
  assert(withBlock(doc) === doc,
    'docs/PLUGIN-CONFIG.md is stale: run deno run -A plugins/shared/options_doc.js');
});

Deno.test('docs/PLUGIN-CONFIG.md lists every option key', () => {
  for (const o of OPTIONS_SCHEMA.options) assert(doc.includes(`| \`${o.key}\` |`), `${o.key} missing from the doc`);
});

Deno.test('docs/PLUGIN-CONFIG.md hand-written examples are valid configs', async () => {
  const { optionsFromDialog } = await import('../engine/fins_entry.js');
  const own = new Set(['enabled', 'apply_to']);    // the Orca plugin's own keys
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert(blocks.length >= 3, 'expected the Orca examples');
  for (const b of blocks) optionsFromDialog(Object.fromEntries(Object.entries(b).filter(([k]) => !own.has(k))));
});
