/**
 * Feet over air: support bottoms that start printing in mid-air (local issue 032).
 *
 * A wall standing on the part has its bottom footGap (0.2) over the floor under its
 * footprint. A foot vertex more than `--tol` (default 0.6 mm) BELOW that floor and
 * as far over whatever is straight under it reaches past a ledge edge into the air:
 * the slicer starts that corner mid-air. Reported per case as the number of such
 * vertices and the deepest one under the wall's floor. Plate walls aren't looked at.
 *
 *   deno run -A prototype/footcheck.js [--web <web dir>] [--poses up,X30,...] [model ...]
 *
 * Models: prototype/examples/real/ + prototype/stress/models/ + web/dev-models/
 * (a model argument filters by substring). `--web` runs another checkout's engine
 * (e.g. a worktree of origin/main) on the same models, for a before/after. A
 * corner tilted down a steep slope can read as hanging too (the floor is read at
 * the nearest station, not under the corner) -- compare two builds, don't read
 * the counts as absolutes. 032's fix: 4576 -> 1878 vertices over 456 cases.
 */
const opt = (k) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : null; };
const ROOT = new URL('../', import.meta.url).pathname;
const WEB = new URL(opt('--web') ?? `${ROOT}web`, `file://${Deno.cwd()}/`).pathname.replace(/\/$/, '');
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { buildFins } = await import(`${WEB}/fins.js`);
const { readSTL } = await import(`${WEB}/stl.js`);
const { seat, surfaceZsAt } = await import(`${WEB}/prop/surface.js`);

const TOL = +(opt('--tol') ?? 0.6);
const rotX = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const POSES = (opt('--poses') ?? 'up,X30,X-30,Y30,Y-30,X90,X-90,Y90').split(',');
const valued = new Set(['--web', '--poses', '--tol'].map(opt).filter(Boolean));
const filters = Deno.args.filter((a) => !a.startsWith('--') && !valued.has(a));
const DIRS = [`${ROOT}prototype/examples/real/`, `${ROOT}prototype/stress/models/`, `${ROOT}web/dev-models/`];

const { PROP } = await import(`${WEB}/prop.js`);

// highest part surface at (x, y) strictly under `ceil`, else the plate
function floorAt(tris, x, y, ceil) {
  let f = 0;
  for (const zz of surfaceZsAt(tris, x, y)) if (zz < ceil && zz > f) f = zz;
  return f;
}

/**
 * Foot vertices of `b`'s part-standing walls that hang into the air: more than TOL
 * below the floor the wall stands on (the highest part surface across its footprint,
 * th + footGap each side, at the nearest station -- what floorLine reads) AND more
 * than TOL over whatever is straight under them. Only vertices below that floor are
 * looked at, so tops, tines and a level foot whose edge just passes a ledge never
 * count.
 */
export function hangingFeet(b, partTris) {
  let n = 0, worst = 0;
  const tri = b.triangles;                     // one [x, y, z] per vertex; triRanges index it
  const half = PROP.th / 2 + PROP.footGap;
  for (const q of b.props ?? []) {
    if (!q.partAttached || !q.line?.length) continue;
    const L = q.line, seen = new Set();
    for (const [s0, e] of q.triRanges ?? []) for (let t = s0; t < e; t++) {
      const v = tri[t], key = v.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      let i = 0, best = Infinity;                // nearest station
      L.forEach((p, k) => { const d = Math.hypot(p[0] - v[0], p[1] - v[1]); if (d < best) { best = d; i = k; } });
      const a = L[Math.max(0, i - 1)], c = L[Math.min(L.length - 1, i + 1)];
      const rn = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const sx = (c[1] - a[1]) / rn, sy = -(c[0] - a[0]) / rn;
      let floor = 0;
      for (const o of [-half, 0, half]) floor = Math.max(floor, floorAt(partTris, L[i][0] + sx * o, L[i][1] + sy * o, L[i][2] - 1));
      const drop = floor - v[2];
      if (drop <= TOL) continue;                 // not below its own floor
      if (v[2] - floorAt(partTris, v[0], v[1], v[2] + 1e-6) <= TOL) continue;  // rests on something
      n++; worst = Math.max(worst, drop);
    }
  }
  return { n, worst };
}

if (import.meta.main) {
  for (const d of DIRS) {
    let names = [];
    try { names = [...Deno.readDirSync(d)].map((e) => e.name).filter((f) => /\.stl$/i.test(f)).sort(); } catch { continue; }
    for (const f of names) {
      if (filters.length && !filters.some((s) => f.includes(s))) continue;
      const pos = readSTL(Deno.readFileSync(d + f));
      const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
      for (const pose of POSES) {
        const rot = pose === 'up' ? rotX(0) : pose[0] === 'X' ? rotX(+pose.slice(1)) : rotY(+pose.slice(1));
        const res = analyze(topo, 45, rot);
        const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
        const part = new Float32Array(pos.length), v = [0, 0, 0];
        for (let i = 0; i < pos.length; i += 3) part.set(seat(pos, i, rot, res.offset, v), i);
        const h = hangingFeet(b, part);
        console.log(f.replace(/\.stl$/i, '').slice(0, 40).padEnd(41) + pose.padEnd(6)
          + `hanging ${String(h.n).padStart(5)}  deepest ${h.worst.toFixed(2)} mm under its floor`);
      }
    }
  }
}
