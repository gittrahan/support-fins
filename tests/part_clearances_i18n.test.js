import { assert } from './_util.js';
import schema from '../plugins/shared/engine/options.json' with { type: 'json' };

Deno.test('part clearance controls and anchor refusals are translated in every locale', async () => {
  const keys = schema.options.filter(o => ['sideClearance', 'bottomGap', 'bottomAnchors'].includes(o.key))
    .flatMap(o => [o.label, o.tooltip]);
  keys.push('Line anchors need the model geometry to validate floor contact.',
    'No safe line anchors fit this floor. Turn off Line anchors or change the support placement.');
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) assert(dict[key] && dict[key] !== key, `${lang}: missing ${key}`);
  }
});
