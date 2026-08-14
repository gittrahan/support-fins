/**
 * Stress the combined-support engine across a pool of shapes x orientations.
 * For each case: run buildFins('auto', tines) and report what it placed, whether
 * the added geometry is closed, and flag the pathologies (spray, spindly stilt,
 * missed support, unsupportable point-seat, crash).
 *
 *   deno run --allow-read prototype/stress/run.js [--verbose]
 */
const WEB = '/Users/matthewtrahan/projects/support-fins/web';
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { buildFins } = await import(`${WEB}/fins.js`);
const { insidePart } = await import(`${WEB}/inside.js`);

function readSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}
const d2r = (d) => (d * Math.PI) / 180;
function mul(a, b) {           // 3x3 col-major
  const m = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) m[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return m;
}
const rotX = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const rotZ = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, s, 0, -s, c, 0, 0, 0, 1]; };

const ORIENTS = [
  ['flat', [1, 0, 0, 0, 1, 0, 0, 0, 1]],
  ['X30', rotX(30)], ['X45', rotX(45)], ['X60', rotX(60)],
  ['Y45', rotY(45)],
  ['X45Y30', mul(rotY(30), rotX(45))],
  ['X60Z30', mul(rotZ(30), rotX(60))],
];

/** Are the added support triangles a closed surface (every edge shared evenly)? */
function isClosed(tris) {
  if (!tris.length) return true;
  const key = (p) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(tris[i + e]), b = key(tris[i + (e + 1) % 3]);
      const k = a < b ? a + '|' + b : b + '|' + a;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c % 2 !== 0) return false;
  return true;
}
function volMM3(tris) {
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(v) / 6;
}

const dir = `${WEB.replace('/web', '')}/prototype/stress/models`;
const files = [...Deno.readDirSync(dir)].filter((f) => f.name.endsWith('.stl')).map((f) => f.name).sort();
const verbose = Deno.args.includes('--verbose');

const rows = [];
for (const file of files) {
  const name = file.replace('.stl', '');
  const pos = readSTL(Deno.readFileSync(`${dir}/${file}`));
  const geometry = { getAttribute: (k) => (k === 'position' ? { array: pos } : null) };
  const topo = buildTopology(geometry);
  for (const [oname, rot] of ORIENTS) {
    let res, built, err = null;
    try {
      res = analyze(topo, 45, rot);
      built = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
    } catch (e) { err = String(e).split('\n')[0]; }
    if (err) { rows.push({ name, oname, flag: 'FAIL', note: 'crash: ' + err }); continue; }

    const fins = built.braceCount ?? 0, props = built.propCount ?? 0;
    const total = fins + props;
    const maxStilt = built.fins.reduce((m, f) => Math.max(m, f.stilt ?? 0), 0);
    const grams = (volMM3(built.triangles) + volMM3(built.padTriangles)) * 1.24 / 1000;
    const closed = isClosed(built.triangles) && isClosed(built.padTriangles);
    const overh = res.regions.length;
    const seat = built.seating?.kind ?? '?';

    let flag = 'OK', note = '';
    if (!closed) { flag = 'FAIL'; note = 'added geometry not closed'; }
    else if (overh > 0 && total === 0 && seat !== 'point' && !built.pad) {
      flag = 'FAIL'; note = `${overh} overhang region(s) but 0 support`;
    } else if (total > 10) { flag = 'WARN'; note = `spray: ${total} supports`; }
    else if (maxStilt > 18) { flag = 'WARN'; note = `spindly: stilt ${maxStilt.toFixed(0)}mm`; }
    else if (seat === 'point' && !built.pad) { flag = 'WARN'; note = 'point-seated, no pad'; }
    else if (grams > 40) { flag = 'WARN'; note = `heavy: ${grams.toFixed(0)}g`; }
    else if (overh === 0 && total === 0) { note = 'no overhangs'; }

    rows.push({ name, oname, flag, fins, props, tines: built.tines, overh,
                seat, stilt: maxStilt, grams, note });
  }
}

// report
const w = (s, n) => String(s).padEnd(n);
console.log(w('shape', 12) + w('pose', 8) + w('flag', 6) + w('fins', 5) + w('props', 6) +
            w('tines', 6) + w('ovh', 4) + w('seat', 7) + w('stilt', 7) + w('g', 6) + 'note');
for (const r of rows) {
  if (!verbose && r.flag === 'OK') continue;
  console.log(w(r.name, 12) + w(r.oname, 8) + w(r.flag, 6) + w(r.fins ?? '-', 5) +
    w(r.props ?? '-', 6) + w(r.tines ?? '-', 6) + w(r.overh ?? '-', 4) + w(r.seat ?? '-', 7) +
    w((r.stilt ?? 0).toFixed(0), 7) + w((r.grams ?? 0).toFixed(1), 6) + (r.note ?? ''));
}
const by = (f) => rows.filter((r) => r.flag === f).length;
const finCases = rows.filter((r) => (r.fins ?? 0) > 0).length;
console.log(`\n${rows.length} cases: ${by('OK')} OK, ${by('WARN')} WARN, ${by('FAIL')} FAIL` +
            `  |  ${finCases} cases placed >=1 tined combined fin`);
