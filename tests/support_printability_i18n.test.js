import { assert, assertEquals } from 'jsr:@std/assert';

const keys = [
  "Checking support sections…",
  "Support-section checks are unavailable. Inspect supports in the slicer.",
  "Show findings",
  "Hide findings",
  "Previous finding",
  "Next finding",
  "Unsupported start",
  "Narrow section",
  "Rapid growth",
  "Finding {n} of {total}: {kind}; support {id}, Z {z} mm.",
  "X {x0}–{x1} mm, Y {y0}–{y1} mm.",
  'Support-section checks describe the original generation. Inspect supports again after manual changes.',
  'Support-section checks are incomplete. Inspect all supports in the slicer.',
  'Support-section checks are unavailable for these settings.',
  '{n} support-section finding needs slicer inspection (first at {z} mm).',
  '{n} support-section findings need slicer inspection (first at {z} mm).',
  'These geometric checks locate narrow sections, new starts and rapid growth. Model material below a start does not prove a printable seat. Check extrusion paths and gaps in the slicer.',
  'Section widths use the selected nozzle as a proxy; actual slicer line widths and first-layer settings may differ.',
];

Deno.test('support diagnostics: all translations preserve plural forms and locations', async () => {
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) {
      const value = dict[key];
      assert(value, `${lang}: missing ${key}`);
      if (typeof value === 'object') for (const c of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) assert(value[c], `${lang}: ${c}`);
      for (const text of typeof value === 'string' ? [value] : Object.values(value)) {
        assert(text !== key && text.length);
        assertEquals([...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), [...key.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
      }
    }
  }
});
