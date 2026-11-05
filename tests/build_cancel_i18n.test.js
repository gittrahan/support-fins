// Cancel on a fin build (the spinner and a live Full build's bar): its label and
// tooltip are translated in every locale, and the keys still match the English the
// page shows, so a reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = { 'web/index.html': ['Cancel', 'Stop building and turn fins off.'] };

Deno.test('build cancel i18n: every new string is in the source and every locale', async () => {
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = await Deno.readTextFile(new URL(`../${file}`, import.meta.url));
    for (const k of keys) assert(src.includes(k), `${file} no longer says "${k}"; update the key`);
  }
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const k of Object.values(KEYS).flat()) {
      assert(typeof dict[k] === 'string' && dict[k].length, `${lang} is missing "${k}"`);
    }
  }
});

Deno.test('build cancel: the spinner label has its own element, so a relabel never hits Cancel', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  const io = await Deno.readTextFile(new URL('../web/ui/io.js', import.meta.url));
  assert(/id="spinner-label"/.test(html), 'spinner label id');
  assert(!io.includes('spinner.lastChild'), 'io.js relabels the spinner by position again');
});
