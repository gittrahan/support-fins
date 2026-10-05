/**
 * Compare two probe.js --json runs (a base engine and a branch), case by case, on
 * the policy number: must% (2026-10-05 -- every red face gets something but tiny
 * holes; see held.js classify). Area-weighted totals at the end, so one big part
 * doesn't hide behind many small ones or the other way round.
 *
 *   deno run -A prototype/examples/probe_diff.js base.json head.json
 *
 * Exits 1 when a case loses more than 2 points of must% -- a scoreboard, so a
 * loss is named, never averaged away.
 */
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
  const flag = d < -2 ? '  LOST' : d > 2 ? '  gained' : '';
  if (d < -2) lost++;
  console.log(pad(k, 50) + pad(b.must.toFixed(0), 10) + pad(pct(b).toFixed(1), 7) + pad(pct(h).toFixed(1), 7)
    + pad((d >= 0 ? '+' : '') + d.toFixed(1), 7) + `${b.walls} -> ${h.walls} / ${b.grams.toFixed(1)} -> ${h.grams.toFixed(1)}${flag}`);
}
for (const k of H.keys()) if (!B.has(k)) console.log(pad(k, 50) + 'new in head');
const tot = (held, must) => (must ? (100 * held) / must : 100).toFixed(1);
console.log(`\nmust-hold, area-weighted: ${tot(heldB, mustB)}% -> ${tot(heldH, mustH)}%   (${mustB.toFixed(0)} mm2)`);
console.log(lost ? `${lost} case(s) lost more than 2 points.` : 'No case lost more than 2 points.');
Deno.exit(lost ? 1 : 0);
