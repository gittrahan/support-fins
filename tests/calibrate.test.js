// The Calibrate menu's files (web/ui/calibrate.js). The site serves only web/, so
// web/calibration/ holds copies of the coupons' committed print/ files, and
// prototype/calibration/estimate.py slices each into coupons.json. These pin that
// the copies still match their print/ originals (a coupon rebuilt without
// re-running estimate.py would ship the old file), that each estimate was sliced from
// that exact file (its sha256), that every menu row's file is there with an estimate,
// and nothing stale is left over.

import { WEB, assert } from './_util.js';
import { unzip } from '../web/zip.js';
import { readThreeMF } from '../web/threemf.js';

const DIR = new URL('../web/calibration/', import.meta.url);
const PROTO = new URL('../prototype/calibration/', import.meta.url);

// calibrate.js touches the DOM on import, so read its file list from the source
const src = await Deno.readTextFile(new URL('ui/calibrate.js', WEB));
const files = [...src.matchAll(/file: '([^']+)'/g)].map((m) => m[1]);
const est = JSON.parse(await Deno.readTextFile(new URL('coupons.json', DIR)));

Deno.test('calibrate: every menu row has its file and an estimate', () => {
  assert(files.length >= 5, `only ${files.length} coupons found in calibrate.js`);
  for (const f of files) {
    const e = est.coupons[f];
    assert(e && e.minutes > 0 && e.grams > 0, `${f}: no estimate in coupons.json`);
    assert(Deno.statSync(new URL(f, DIR)).size > 0, `${f}: missing from web/calibration/`);
  }
  assert(/mm layers/.test(est.profile), `coupons.json names no profile (${est.profile})`);
});

Deno.test('calibrate: the served files match the coupons\' print/ files, and their estimates are for them', async () => {
  for (const f of files) {
    const name = f.replace(/-coupon\..*$/, '');
    const a = await Deno.readFile(new URL(f, DIR));
    const b = await Deno.readFile(new URL(`${name}/print/${f}`, PROTO));
    assert(a.length === b.length && a.every((x, i) => x === b[i]),
           `${f} differs from prototype/calibration/${name}/print/ -- re-run estimate.py`);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', a)),
                            (x) => x.toString(16).padStart(2, '0')).join('');
    assert(est.coupons[f].sha256 === hash, `${f}: coupons.json's estimate is for another version -- re-run estimate.py`);
  }
});

Deno.test('calibrate: nothing in web/calibration/ the menu doesn\'t list', () => {
  for (const { name } of Deno.readDirSync(DIR)) {
    assert(name === 'coupons.json' || files.includes(name), `stale file web/calibration/${name}`);
    if (name !== 'coupons.json') assert(name in est.coupons, `${name}: no estimate`);
  }
  for (const f of Object.keys(est.coupons)) assert(files.includes(f), `coupons.json lists ${f}, the menu doesn't`);
});

// #472: edge-standing cubes can have no printable first-layer extrusion on their
// own. The pads and cubes must be components of one build item, not two objects.
Deno.test('calibrate: Pad ships as one assembly with unchanged calibration meshes', async () => {
  const bytes = await Deno.readFile(new URL('pad-coupon.3mf', DIR));
  const files = await unzip(bytes);
  const xml = new TextDecoder().decode(files.get('3D/3dmodel.model'));
  const items = [...xml.matchAll(/<item\b[^>]*objectid="([^"]+)"[^>]*\/>/g)];
  assert(items.length === 1, 'Pad must open as one printable object');
  const assembly = [...xml.matchAll(/<object\b[^>]*id="([^"]+)"[^>]*>(.*?)<\/object>/gs)]
    .find((m) => m[1] === items[0][1]);
  assert(assembly, 'Pad build item must reference an object');
  const parts = [...assembly[2].matchAll(/<component objectid="([^"]+)"\/>/g)];
  assert(parts.length === 2 && parts[0][1] !== parts[1][1], 'Keep cubes and pads as two mesh parts');
  // Pin the published geometry so an export fix cannot silently change gaps,
  // labels, contact footprints or the cubes' edge-standing pose.
  const meshes = [...xml.matchAll(/<mesh>.*?<\/mesh>/gs)].map((m) => m[0]);
  const expected = ['91123e292de58ddc210e7f3f4579c2539c34d090cf0b203c242b3587e596440b', 'd10ad6fbec898bedf5ba225ab3a0e6944ede8e214557cfc8cdd7dd56cf6ac656'];
  assert(meshes.length === expected.length, 'Only the original two meshes belong in the coupon');
  for (let i = 0; i < meshes.length; i++) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(meshes[i])));
    const hash = Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
    assert(hash === expected[i], `Pad mesh ${i} changed: review calibration geometry before updating this hash`);
  }
  const loaded = await readThreeMF(bytes);
  assert(loaded.meshes === 2 && loaded.positions.length / 9 === 66044,
    'Both the cubes and their pads must survive import');
});
