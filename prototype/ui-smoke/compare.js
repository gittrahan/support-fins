/**
 * Step-by-step diff of two ui-smoke.js dumps. Exit 1 on any difference or on a
 * console error in the head run.
 *
 *   deno run -A prototype/ui-smoke/compare.js base.json head.json
 */
const [a, b] = Deno.args.map((f) => JSON.parse(Deno.readTextFileSync(f)));
const show = (v) => JSON.stringify(v)?.slice(0, 300);
let n = 0;

a.steps.forEach((s, i) => {
  const t = b.steps[i];
  if (!t) { console.log(`missing step ${s.name}`); n++; return; }
  for (const k of Object.keys(s)) {
    if (JSON.stringify(s[k]) === JSON.stringify(t[k])) continue;
    n++;
    if (k !== 'dom') { console.log(`${s.name}  ${k}  ${show(s[k])}  →  ${show(t[k])}`); continue; }
    for (const id of new Set([...Object.keys(s.dom), ...Object.keys(t.dom)])) {
      if (JSON.stringify(s.dom[id]) !== JSON.stringify(t.dom[id])) {
        console.log(`${s.name}  #${id}  ${show(s.dom[id])}  →  ${show(t.dom[id])}`);
      }
    }
  }
});
if (a.steps.length !== b.steps.length) {
  console.log(`step count ${a.steps.length} → ${b.steps.length}`);
  n++;
}
for (const e of b.errors) console.log(`head error: ${e}`);
const bad = n + b.errors.length;
console.log(bad ? `${b.model}: ${n} difference(s), ${b.errors.length} error(s)`
                : `${b.model}: identical over ${b.steps.length} steps`);
Deno.exit(bad ? 1 : 0);
