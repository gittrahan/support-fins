// Every string a stabilizer shows (web/sway.js's refusals, the Draw button, the
// hint and readout lines) is translated in every locale, its {placeholders} kept.
// Each key is checked against the source too, so a reworded string can't leave a stale
// key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/sway.js': [
    'that face leans too far to stand a stabilizer against — pick an upright side',
    'that side doesn’t come down to the plate there — a stabilizer stands at the base of the part',
    'that’s too low for a stabilizer — move up the side',
    'the part sticks out over that spot, so a stabilizer standing on the plate can’t reach up the side',
    'the part’s base spreads out under this side, so there is no room on the plate for the stabilizer’s foot',
    'too little of this side lines up with the stabilizer for its tines to grip — try a flatter part of the side',
    'it would run into another brace or stabilizer — click a spot clear of it',
    'that side is too short there for a stabilizer',
    'Brace grip from is above this stabilizer’s top — lower it, or click higher up the side',
    'that side is too small or curved to stand a stabilizer against',
  ],
  'web/index.html': [
    'Stabilizer',
    'A triangular fin on the plate against the base of a side, so the part can’t tip over: click the side where its top should be',
  ],
  'web/ui/walls.js': [
    'stabilizer {mm}mm tall, {d}mm out',
    'Stabilizer · {mm} mm tall · {d} mm out',
    'couldn’t place that stabilizer: {reason}',
    'Hover an upright side of the part, near its base, to preview a stabilizer: a fin standing on the plate that keeps the part from tipping over. Its top follows the cursor; Brace depth sets how far it reaches out (100% = as far as it is tall), Brace grip from and Brace tine spacing its tines. Click to stand it.',
    'click an upright side of the part, near its base',
  ],
  'web/ui/readout.js': [
    'Click an upright side of the part near its base, where the top of the fin should be, to stand a stabilizer that keeps it from tipping over',
    '{n} stabilizer',
    '{n} stabilizers',
    '{n} stabilizer stands up to {mm}mm before gripping the part — the side isn’t there lower down. Check its first layers in the slicer.',
    '{n} stabilizers stand up to {mm}mm before gripping the part — the side isn’t there lower down. Check their first layers in the slicer.',
  ],
};

const placeholders = (s) => [...s.matchAll(/{\w+}/g)].map((m) => m[0]).sort().join();
// a source string may be split over lines with ' + ': compare with that glue taken out
const glued = (src) => src.replace(/'\s*\+\s*'/g, '');

Deno.test('stabilizer strings: in the source, and translated in every locale with their placeholders', async () => {
  const dicts = {};
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) dicts[lang] = (await import(`../web/i18n/${lang}.js`)).default;
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = glued(await Deno.readTextFile(new URL(`../${file}`, import.meta.url)));
    for (const key of keys) {
      assert(src.includes(key), `${file} no longer says: ${key}`);
      for (const [lang, dict] of Object.entries(dicts)) {
        const v = dict[key];
        assert(v && v !== key, `${lang}: missing ${key}`);
        for (const form of typeof v === 'string' ? [v] : Object.values(v)) {
          assert(placeholders(form) === placeholders(key), `${lang}: ${key} -> ${form} changed its placeholders`);
        }
      }
    }
  }
});
