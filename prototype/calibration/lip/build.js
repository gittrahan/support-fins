/**
 * Lip coupon, step 2: stand one part-attached wall under each ledge of gen.py's
 * coupon with the engine's own buildPartAttached, its outer face `lip` mm in from
 * the ledge's free edge, and write the 3MF to print.
 *
 *   deno run -A prototype/calibration/lip/build.js     # -> out/lip-coupon.3mf + .stl
 */
const WEB = new URL('../../../web/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { PROP } = await import(`${WEB}prop.js`);
const { buildPartAttached } = await import(`${WEB}prop/attached.js`);
const { writeThreeMF } = await import(`${WEB}threemf.js`);
const { writeBinarySTL } = await import(`${WEB}stl.js`);

function readSTL(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
  return pos;
}
const pos = readSTL(Deno.readFileSync(`${OUT}coupon_part.stl`));
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const off = analyze(topo, 45, rot).offset;
const partTris = new Float64Array(pos.length);
for (let i = 0; i < pos.length; i += 3) {
  partTris[i] = pos[i] + off.x; partTris[i + 1] = pos[i + 1] + off.y; partTris[i + 2] = pos[i + 2] + off.z;
}

const out = [];
console.log('ledge  lip   span  height');
for (const l of JSON.parse(Deno.readTextFileSync(`${OUT}ledges.json`))) {
  const line = [];
  const n = Math.max(PROP.minStations, Math.round((l.x1 - l.x0) / PROP.stationStep) + 1);
  for (let k = 0; k < n; k++) line.push([l.x0 + (l.x1 - l.x0) * k / (n - 1) + off.x, l.y + off.y, l.z + off.z]);
  const pa = buildPartAttached(line, partTris, topo, rot, off, out);
  if (!pa.ok) { console.log(`${l.id}  REFUSED ${pa.floored ?? 'declined'}`); continue; }
  console.log(`${l.id}      ${String(l.lip).padEnd(4)}  ${pa.prop.span.toFixed(1)}  ${pa.prop.height.toFixed(1)}`);
}
const part = [];
for (let i = 0; i < partTris.length; i += 3) part.push([partTris[i], partTris[i + 1], partTris[i + 2]]);
Deno.writeFileSync(`${OUT}lip-coupon.3mf`, new Uint8Array(await writeThreeMF(part, out, 'Lip coupon').arrayBuffer()));
Deno.writeFileSync(`${OUT}lip-coupon.stl`, new Uint8Array(await writeBinarySTL([...part, ...out], 'Lip coupon').arrayBuffer()));
Deno.writeFileSync(`${OUT}lip-fins.stl`, new Uint8Array(await writeBinarySTL(out, 'Lip coupon fins').arrayBuffer()));
console.log(`wrote ${OUT}lip-coupon.3mf (+ .stl, fins-only .stl)`);
