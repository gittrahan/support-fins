/**
 * Diff two sweep.js runs and sort every difference into BLOCKING regressions vs
 * informational changes.
 *
 *   deno run -A prototype/sweep/compare.js <base.json> <head.json> [--changed <keys.json>]
 *
 * Exit 1 when anything blocks. "Blocks" means the branch supports LESS than the
 * base somewhere -- the kind of loss a check on the complaint's own part never
 * shows. A deliberate trade (e.g. fewer walls on purpose) still shows up here and
 * has to be explained in the PR; that's the point. `--changed` writes the keys of
 * every case that differs, for vs-base.sh to export and run check_stl.py on.
 */
const [baseF, headF] = Deno.args.filter((a) => !a.startsWith('--'));
const ci = Deno.args.indexOf('--changed');
const changedOut = ci >= 0 ? Deno.args[ci + 1] : null;
const B = JSON.parse(Deno.readTextFileSync(baseF));
const H = JSON.parse(Deno.readTextFileSync(headF));

// Thresholds: small enough to catch one lost wall or a dropped tine row, large
// enough that float-level wobble in a wall end doesn't cry wolf.
const LEN_MM = 5, LEN_FRAC = 0.05;            // wall length lost
const TINE_N = 3, TINE_FRAC = 0.05;           // tines lost
const LOWTINE_MM = 0.1;                       // lowest tine rising (base grip)
// Overhang coverage (sweep.js `cov`, check_stl's metric) is what the proxies
// above stand in for. Losing >2 points blocks (check_diff's rule). And when
// coverage HELD (within COV_HELD of base, or better), lost tines / wall length
// are a layout trade, not a loss -- tube X25 sparse gives up a wedge's tines for
// real walls and covers 51% -> 76%. They are listed under info as a trade.
const COV_PTS = 2, COV_HELD = 0.5;

const blocking = { error: [], unserved: [], cov: [], wallLen: [], tines: [], lowTine: [], vanished: [] };
const info = { traded: [], covUp: [], walls: [], squat: [], tinesUp: [], lenUp: [], lowTineDown: [], lowTopDown: [], grams: [] };
const changed = [];
let identical = 0;
const strip = (r) => JSON.stringify({ ...r, ms: 0 });

for (const k of Object.keys(B)) {
  const b = B[k], h = H[k];
  if (!h) { blocking.vanished.push([k, 'case missing from head']); continue; }
  if (strip(b) === strip(h)) { identical++; continue; }
  changed.push(k);
  if (h.error && !b.error) { blocking.error.push([k, h.error]); continue; }
  if (b.error) continue;
  const lost = (x, y, n, f) => x - y > Math.max(n, f * x);
  if (h.unserved > b.unserved) blocking.unserved.push([k, `${b.unserved} -> ${h.unserved} unserved regions`]);
  const hasCov = b.cov != null && h.cov != null;
  if (hasCov && b.cov - h.cov > COV_PTS) blocking.cov.push([k, `${b.cov} -> ${h.cov} %`]);
  if (hasCov && h.cov - b.cov > COV_PTS) info.covUp.push([k, `${b.cov} -> ${h.cov} %`]);
  const held = hasCov && h.cov >= b.cov - COV_HELD;
  const proxy = (cat, d) => (held ? info.traded.push([k, `${d}, coverage ${b.cov} -> ${h.cov} %`]) : blocking[cat].push([k, d]));
  if (lost(b.wallLen, h.wallLen, LEN_MM, LEN_FRAC)) proxy('wallLen', `wall ${b.wallLen} -> ${h.wallLen} mm`);
  if (lost(b.tines, h.tines, TINE_N, TINE_FRAC)) proxy('tines', `tines ${b.tines} -> ${h.tines}`);
  if (b.lowTine != null && (h.lowTine == null || h.lowTine > b.lowTine + LOWTINE_MM)) {
    blocking.lowTine.push([k, `${b.lowTine} -> ${h.lowTine ?? 'none'} mm`]);
  }
  if (h.walls !== b.walls) info.walls.push([k, `${b.walls} -> ${h.walls}`]);
  if (h.squat !== b.squat) info.squat.push([k, `${b.squat} -> ${h.squat}`]);
  if (h.tines > b.tines) info.tinesUp.push([k, `${b.tines} -> ${h.tines}`]);
  if (h.wallLen > b.wallLen + LEN_MM) info.lenUp.push([k, `${b.wallLen} -> ${h.wallLen}`]);
  if (b.lowTine != null && h.lowTine != null && h.lowTine < b.lowTine - LOWTINE_MM) info.lowTineDown.push([k, `${b.lowTine} -> ${h.lowTine}`]);
  if (b.lowTop != null && h.lowTop != null && h.lowTop < b.lowTop - 0.1) info.lowTopDown.push([k, `${b.lowTop} -> ${h.lowTop}`]);
  if (Math.abs(h.grams - b.grams) > 0.5) info.grams.push([k, `${b.grams} -> ${h.grams} g`]);
}

const sum = (D, f) => Object.values(D).reduce((s, r) => s + (r[f] || 0), 0);
const n = Object.keys(B).length;
console.log(`${n} cases: ${identical} identical, ${changed.length} changed`);
console.log(`totals  tines ${sum(B, 'tines')} -> ${sum(H, 'tines')}   wall length ${Math.round(sum(B, 'wallLen'))} -> ${Math.round(sum(H, 'wallLen'))} mm` +
            `   plastic ${Math.round(sum(B, 'grams'))} -> ${Math.round(sum(H, 'grams'))} g   time ${sum(B, 'ms')} -> ${sum(H, 'ms')} ms`);
const both = Object.keys(B).filter((k) => B[k].cov != null && H[k]?.cov != null);
const mean = (D) => (both.length ? (both.reduce((s, k) => s + D[k].cov, 0) / both.length).toFixed(1) : 'n/a');
console.log(`mean overhang coverage ${mean(B)}% -> ${mean(H)}%  (${both.length} cases with overhangs)`);

const LABEL = {
  error: 'NEW CRASH', unserved: 'overhang region went UNSERVED', cov: `overhang coverage LOST (>${COV_PTS} pts)`,
  traded: 'tines/wall lost, coverage held (trade)', covUp: `overhang coverage gained (>${COV_PTS} pts)`,
  wallLen: 'wall length LOST (coverage fell)',
  tines: 'tines LOST (coverage fell)', lowTine: 'lowest tine ROSE (base grip)', vanished: 'case missing',
  walls: 'wall count changed', squat: 'squat walls changed', tinesUp: 'tines gained', lenUp: 'wall length gained',
  lowTineDown: 'lowest tine lowered', lowTopDown: 'walls reach lower', grams: 'plastic changed >0.5g',
};
let blocked = 0;
console.log('\nBLOCKING (the branch supports less than the base):');
for (const [cat, rows] of Object.entries(blocking)) {
  blocked += rows.length;
  console.log(`  ${rows.length ? '✗' : '✓'} ${LABEL[cat]}: ${rows.length}`);
  for (const [k, d] of rows) console.log(`      ${k.padEnd(40)} ${d}`);
}
console.log('\ninfo:');
for (const [cat, rows] of Object.entries(info)) {
  console.log(`    ${LABEL[cat]}: ${rows.length}`);
  if (cat === 'traded' && Deno.args.includes('--trades')) for (const [k, d] of rows) console.log(`      ${k.padEnd(40)} ${d}`);
}

if (changedOut) Deno.writeTextFileSync(changedOut, JSON.stringify(changed));
console.log(blocked ? `\n${blocked} blocking regression(s).` : '\nNo blocking regressions.');
Deno.exit(blocked ? 1 : 0);
