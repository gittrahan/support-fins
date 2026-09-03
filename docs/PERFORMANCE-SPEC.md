# Spec: speed up support generation on large / badly-posed parts

Self-contained task for a fresh session. The tool is now non-blocking (generation
runs in a Web Worker), but a single build can still take **~2–4s** on a large or
badly-oriented part, which is slow. Goal: make the build itself materially faster
**without changing the geometry it produces or degrading print quality.**

## Where

Repo: `~/projects/support-fins` (product **Support Fins**). The generation engine
is pure mesh math (no DOM/three.js), so it profiles and runs headless with Deno.

- `web/fins.js` — `buildFins()` entry; auto mode recurses to `mode:'prop'`, then
  adds wedges (`buildPerpFins`) and the bed pad (`buildPad`).
- `web/prop.js` — `buildProps()` and the per-wall pipeline: `splitRegion`,
  `patchTracks`, `sweep`, `settleTop`/`contourTop`/`lowerSag`, `stationIsClear`,
  `stationCertified`, `emitTines`, `surfaceZAt` (already grid-accelerated).
- `web/inside.js` — `insidePart`, `nearestPart` (both grid-accelerated, 64² YZ grid).

Run headless: `deno run --allow-read <script.js>` (see profiling harness below).

## The problem (reproduction)

The user's `flat_bracket.stl` (~311×120×192mm, only **2,048 triangles**) laid
**flat** builds in ~2.4s and produces 16 support walls / 576 tines. The same part
at a good orientation (e.g. 45°) builds in **~60–100ms** with 9 fins. So it is not
triangle count — it is that a bad orientation stands up ~16 tall walls, and the
per-wall work scales with wall height.

Note the tool already *nudges* the user to a better orientation (Suggest
orientation, the strength/verdict card), and the Web Worker keeps the UI live with
a spinner. This task is about the raw compute for the cases that are still slow.

## Profiling already done (start here, then go deeper)

Measured on `flat_bracket.stl` flat, `buildFins(mode:'auto', bedPad:true,
tines:true, tineDensity:0, coverage:0)`, total ~2.4–2.5s:

- **Geometry primitives ≈ 20%**: `insidePart` ~240ms / **1.28M calls**,
  `nearestPart` ~240ms / ~280k calls, `surfaceZAt` ~32ms / ~110k calls.
- **Named per-station functions ≈ 19%**: `stationCertified` ~230ms,
  `stationIsClear` ~200ms, `settleTop`/`contourTop`/`lowerSag` ~15ms combined.
- **Remaining ≈ 60% is unattributed** — it is spread across the rest of the wall
  pipeline (`sweep`, `patchTracks`/`splitRegion`, the `buildProps` loop body,
  `emitTines`, `buildPad`, `buildPerpFins`) and the per-iteration JS overhead of
  the probing loops (loop control, `profileHalf`, array allocation) rather than
  the primitive calls themselves. **Attributing this 60% precisely is step 1** —
  do not optimize before you know which function owns it.

Isolation checks: turning the bed pad off saved ~200ms; turning tines off saved
~250ms. So pad and tines are ~450ms combined; the bulk is core wall building.

### Profiling technique (reliable across early returns)

Wrap by rename: turn `export function foo(` into `function _foo(`, then append an
exported timing wrapper. Example:

```js
globalThis.__T = globalThis.__T || {};
const _tw = (name, fn) => (...a) => { const t = performance.now(); const r = fn(...a); globalThis.__T[name] = (globalThis.__T[name]||0) + (performance.now()-t); return r; };
export const sweep = _tw('sweep', _sweep);
```

Harness (`deno run --allow-read prof.js`):

```js
const WEB='/Users/matthewtrahan/projects/support-fins/web';
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { buildFins } = await import(`${WEB}/fins.js`);
function readSTL(b){const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);const n=dv.getUint32(80,true);
  const p=new Float32Array(n*9);for(let f=0;f<n;f++){const o=84+f*50+12;for(let i=0;i<9;i++)p[f*9+i]=dv.getFloat32(o+i*4,true);}return p;}
const pos=readSTL(Deno.readFileSync('/tmp/fb.stl'));       // copy flat_bracket.stl to /tmp/fb.stl
const topo=buildTopology({getAttribute:k=>k==='position'?{array:pos}:null});
const rot=[1,0,0,0,1,0,0,0,1];                              // flat; the slow pose
const res=analyze(topo,45,rot);
globalThis.__T={};
const t=performance.now();
buildFins(topo,res,rot,{mode:'auto',bedPad:true,tines:true,tineDensity:0,coverage:0});
console.log('total',(performance.now()-t).toFixed(0),'ms', globalThis.__T);
```

(`flat_bracket.stl` lives in the user's `~/Downloads`; ask for it, or use any
large part laid flat. `web/dev-models/` is gitignored — fine to drop a test STL in
and load via `?stl=dev-models/x.stl` in the browser.)

## Candidate strategies (ranked by safety × impact — validate each, don't stack blind)

1. **Attribute the unaccounted ~60% first** (above). Optimize the function that
   actually owns it, measured — not by guess.
2. **Coarse per-wall early-out (likely the biggest safe win).** Before probing a
   wall station-by-station up its full height, do ONE cheap query of the wall's
   swept corridor bbox against the `inside.js` grid: if it contains no part
   triangle other than the overhang it supports, the whole `stationIsClear` /
   `stationCertified` full-height walk is provably trivial and can be skipped.
   For a flat part with a big open overhang, most walls are in open air, so this
   removes whole stations' worth of iterations. Must be exact (output identical).
3. **Merge the two full-height passes.** `stationIsClear` (path-to-plate) and
   `stationCertified` (weld check) each walk every station's full height
   separately (~2,900 calls each here). If they can share one traversal, that is
   ~2× on that portion. They measure different things — do this carefully.
4. **Parallelize across a small worker pool.** Split the walls/regions across N
   workers and merge the triangle output. Near-linear speedup on multicore, and
   it touches no geometry math (lowest correctness risk) — but it is the most
   plumbing. The existing single worker (`web/finworker.js`) is the starting point.
5. **Micro-optimize the inner loops.** Hoist `profileHalf`, avoid per-iteration
   array allocations, use typed arrays / flat number loops in `sweep`/`settleTop`/
   the probing fans. ~1.3–1.5× at best; do only where profiling points.
6. **Adaptive station / z-probe density for very tall walls** — LAST resort. The
   1.0mm station step and ~1.5mm z-probe step have a documented weld-regression
   history (see comments in `stationIsClear`/`stationCertified`/`PROP.stationStep`);
   loosening them risks welded supports. Only with strong guardrail evidence.

## Hard constraints

- **Output must be identical (or provably equivalent).** Fin/tine counts and
  watertightness must not change on the test set. This is a speed task, not a
  behavior change. See `project_support_fin_quality_first` — never degrade print
  quality to save time.
- Respect the weld-regression history in the station probing (strategy 6).

## Guardrails / how to verify

- **Unit tests:** `deno test --allow-read tests/` — must stay **30 passed / 0 failed**.
- **Stress harness:** `deno run --allow-read prototype/stress/run.js` — must stay
  **146 OK / 0 WARN / 1 FAIL** (the 1 FAIL is the pre-existing torus-flat baseline).
- **Output-identical check:** before/after, run `buildFins` on a spread of parts
  (`web/dev-models/*` + flat_bracket flat) and assert fin count, tine count, and
  triangle count are unchanged, and supports stay watertight.
- **Benchmark:** time the harness above before/after; report the speedup on the
  flat pose specifically.

## Acceptance criteria

- The flat `flat_bracket.stl` build is materially faster — target **at least 2×**
  (ideally under ~800ms), measured with the harness.
- Fin/tine/triangle counts and watertightness unchanged on the test set.
- Unit tests 30/30, stress 146 OK / 1 FAIL (baseline), no console errors in the app.

## Already landed (context, don't redo)

- `surfaceZAt` is grid-accelerated (XY buckets cached per tris array).
- Generation runs in a Web Worker; sliders are debounced; in-flight builds are
  superseded on a new pose. A `nearestPart` short-circuit in `stationIsClear` was
  tried and **reverted** — it cut `insidePart` calls but `nearestPart` cost the
  same, so it was a wash (the loop *iteration* overhead, not the primitive, is the
  cost — which is why strategies 2–5 target iteration count, not the primitive).
