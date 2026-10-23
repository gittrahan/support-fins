import { assert, assertEquals } from 'jsr:@std/assert';

// These messages include both the existing bridging advice and the completed
// generation's headline/legend. Each locale must supply its own plural forms.
const keys = [
  "recognised small-hole ceilings are left unsupported to keep their openings clear; check bridging in the slicer",
  "{n} small-hole ceilings left unsupported for bridging — check the slicer preview and print settings.",
  "none needed: small holes left for bridging",
  "Amber after generation: small-hole ceilings left for bridging",
  "{n} small holes left for bridging",
  "Shade small overhangs amber: area-based slivers and, after generation, small-hole ceilings left for bridging. Off hides their shading; the readout still counts them."
];

Deno.test('small-hole messages cover every locale, plural category and placeholder', async () => {
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) {
      const entry = dict[key];
      assert(entry, `${lang}: missing ${key}`);
      if (typeof entry === 'object') {
        for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
          assert(entry[category], `${lang}: missing ${category} for ${key}`);
        }
      }
      for (const value of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        assert(value && value !== key, `${lang}: untranslated ${key}`);
        assertEquals([...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
          [...key.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), `${lang}: placeholders`);
      }
    }
  }
});
