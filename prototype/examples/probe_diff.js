/**
 * Compare two probe.js --json runs (a base engine and a branch), case by case, on
 * the policy number: must% (2026-10-05 -- every red face gets something but tiny
 * holes; see held.js classify). Area-weighted totals at the end, so one big part
 * doesn't hide behind many small ones or the other way round.
 *
 *   deno run -A prototype/examples/probe_diff.js base.json head.json
 *
 * Exits 1 when a case loses more than 2 points of must% AND at least MIN_LOSS mm2
 * -- a scoreboard, so a loss is named, never averaged away; the area floor keeps
 * one face on a 5 mm2 mini pose from failing the run.
 */
const MIN_LOSS = 1.0;
const [baseF, headF] = Deno.args;
const load = (f) => new Map(JSON.parse(Deno.readTextFileSync(f)).map((r) => [`${r.model}|${r.pose}`, r]));
const B = load(baseF), H = load(headF);
const pct = (r) => (r.must ? (100 * r.mustHeld) / r.must : 100);
const pad = (s, n) => String(s).padEnd(n);

let mustB = 0, heldB = 0, mustH = 0, heldH = 0, lost = 0;
console.log(pad('case', 50) + pad('must mm2', 10) + pad('base%', 7) + pad('head%', 7) + pad('delta', 7) + 'walls / g');
for (const [k, b] of B) {
  const h = H.get(k);
  if (!h) { console.log(pad(k, 50) + 'MISSING in head'); lost++; continue; }
  mustB += b.must; heldB += b.mustHeld; mustH += h.must; heldH += h.mustHeld;
  const d = pct(h) - pct(b);
  const loss = d < -2 && b.mustHeld - h.mustHeld >= MIN_LOSS;
  const flag = loss ? '  LOST' : d > 2 ? '  gained' : '';
  if (loss) lost++;
  console.log(pad(k, 50) + pad(b.must.toFixed(0), 10) + pad(pct(b).toFixed(1), 7) + pad(pct(h).toFixed(1), 7)
    + pad((d >= 0 ? '+' : '') + d.toFixed(1), 7) + `${b.walls} -> ${h.walls} / ${b.grams.toFixed(1)} -> ${h.grams.toFixed(1)}${flag}`);
}
for (const k of H.keys()) if (!B.has(k)) console.log(pad(k, 50) + 'new in head');
const tot = (held, must) => (must ? (100 * held) / must : 100).toFixed(1);
console.log(`\nmust-hold, area-weighted: ${tot(heldB, mustB)}% -> ${tot(heldH, mustH)}%   (${mustB.toFixed(0)} mm2)`);
const sum = (M, k) => [...M.values()].reduce((s, r) => s + (r[k] ?? 0), 0);
console.log(`near-plate strip held (reported apart, not in must%): ${tot(sum(B, 'lowHeld'), sum(B, 'low'))}% -> `
  + `${tot(sum(H, 'lowHeld'), sum(H, 'low'))}%   (${sum(B, 'low').toFixed(0)} mm2)`);
const cost = (k, f) => `${f(sum(B, k))} -> ${f(sum(H, k))}`;
console.log(`cost: walls ${cost('walls', (x) => x)}, grams ${cost('grams', (x) => x.toFixed(1))}`
  + (sum(H, 'secs') ? `, build s ${cost('secs', (x) => x.toFixed(0))}` : ''));
console.log(lost ? `${lost} case(s) lost more than 2 points.` : 'No case lost more than 2 points.');
Deno.exit(lost ? 1 : 0);
