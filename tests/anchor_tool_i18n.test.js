// Anchor fins (GH #351) -- the switch, its tooltip and hint, the preview tip, the
// refusal, the selection and the count -- are translated in every locale, keep
// their placeholders, and every key still matches the English the page shows, so a
// reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/index.html': ['Anchor fins',
    'Hold a leaning part from its back, the side that faces up, instead of standing a wall under it. Hover the back to preview an anchor and click to add it. Takes a back leaning up to 45°, curved or flat. Uses the brace settings below.'],
  'web/ui/walls.js': ['Anchor fins: hover a back that faces up, leaning up to 45°, to preview one, and click to stand it.',
    'Anchor · full height {mm} mm', 'Anchor · {mm} mm · move up for full height',
    'couldn’t place that anchor: {reason}', 'anchor fin {mm}mm tall'],
  'web/ui/readout.js': ['{n} anchor fins'],
};
const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();

Deno.test('anchor fins i18n: every new string is in the source and every locale', async () => {
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = await Deno.readTextFile(new URL(`../${file}`, import.meta.url));
    for (const k of keys) assert(src.includes(k), `${file} no longer says "${k}"; update the key`);
  }
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const k of Object.values(KEYS).flat()) {
      const v = dict[k];
      const forms = typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v) : [];
      assert(forms.length && forms.every((f) => typeof f === 'string' && f.length), `${lang} is missing "${k}"`);
      for (const f of forms) assert(holes(f) === holes(k), `${lang} "${k}" lost a placeholder: ${f}`);
      if (k.includes('45°')) assert(forms.every((f) => f.includes('45°')), `${lang} dropped the angle in "${k}"`);
    }
  }
});
