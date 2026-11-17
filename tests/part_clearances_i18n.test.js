import { assert } from './_util.js';
import schema from '../plugins/shared/engine/options.json' with { type: 'json' };

Deno.test('part clearance controls are translated in every locale', async () => {
  const keys = schema.options.filter(o => ['sideClearance', 'bottomGap'].includes(o.key))
    .flatMap(o => [o.label, o.tooltip]);
  keys.push("Side clearance is zero: support walls may fuse to the model. Increase it for removable supports.");
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) assert(dict[key] && dict[key] !== key, `${lang}: missing ${key}`);
  }
});
