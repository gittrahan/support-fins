/**
 * Walk the placement funnel for one part and print where the candidates die.
 *
 *   deno run --allow-read why_no_fin.js <model.stl> [tiltDeg]
 *
 * "0 fins" is the least useful thing the tool can say. Every stage here throws
 * candidates away for a different reason, and which stage is doing it decides
 * what to change -- a part rejected for flatness needs a different fix from one
 * rejected because every window is obstructed.
 */
const WEB = '/Users/matthewtrahan/projects/support-fins/web';
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { findWallPatches, MAX_LEAN_DEG, FLAT_TOL, MIN_PATCH_H, MIN_PATCH_W,
        MIN_PATCH_AREA } = await import(`${WEB}/planes.js`);
const { buildFins, FIN } = await import(`${WEB}/fins.js`);

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

const path = Deno.args[0];
const tilt = Number(Deno.args[1] ?? 0);
const a = (tilt * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
const rot = [1, 0, 0, 0, c, s, 0, -s, c];

const pos = readSTL(Deno.readFileSync(path));
const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
const res = analyze(topo, 45, rot);

const stats = {};
const patches = findWallPatches(topo, rot, res.offset, stats);

console.log(`${path.split('/').pop()}  tilt ${tilt}deg  ${topo.nFaces} faces`);
console.log(`bed contact ${res.bedArea.toFixed(1)} mm2   overhang regions ${res.regions.length}\n`);

console.log('PATCH FUNNEL');
console.log(`  candidate groups grown        ${stats.grown ?? 0}`);
console.log(`  rejected, area < ${MIN_PATCH_AREA} mm2      ${stats.tooSmall ?? 0}`);
console.log(`  rejected, bows > ${FLAT_TOL} mm        ${stats.notFlat ?? 0}`);
console.log(`  rejected, < ${MIN_PATCH_H} mm up the face  ${stats.tooShort ?? 0}`);
console.log(`  rejected, < ${MIN_PATCH_W} mm across       ${stats.tooNarrow ?? 0}`);
console.log(`  SURVIVING PATCHES             ${patches.length}\n`);

if (patches.length) {
  console.log('TOP PATCHES BY AREA');
  for (const p of patches.slice(0, 8)) {
    const stilt = Math.max(0, p.z0 - FIN.baseH);
    const stiltOk = stilt <= FIN.stiltFrac * p.z1;
    console.log(`  area ${p.area.toFixed(0).padStart(6)} mm2  z ${p.z0.toFixed(1).padStart(6)}..${p.z1.toFixed(1).padStart(6)}` +
                `  len ${(p.u1 - p.u0).toFixed(1).padStart(6)}  lean ${p.lean.toFixed(0).padStart(2)}` +
                `  flat ${p.flatness.toFixed(3)}  stilt ${stilt.toFixed(1).padStart(5)}` +
                `  ${stiltOk ? '' : '<- rejected: stilt too tall'}`);
  }
  console.log();

  console.log('LOWEST PATCHES (the ones a fin could actually stand on)');
  const low = [...patches].sort((a, b) => a.z0 - b.z0).slice(0, 8);
  for (const p of low) {
    const stilt = Math.max(0, p.z0 - FIN.baseH);
    const stiltOk = stilt <= FIN.stiltFrac * p.z1;
    console.log(`  area ${p.area.toFixed(0).padStart(6)} mm2  z ${p.z0.toFixed(1).padStart(6)}..${p.z1.toFixed(1).padStart(6)}` +
                `  len ${(p.u1 - p.u0).toFixed(1).padStart(6)}  lean ${p.lean.toFixed(0).padStart(2)}` +
                `  stilt ${stilt.toFixed(1).padStart(5)}  ${stiltOk ? 'OK' : '<- rejected: stilt too tall'}`);
  }
  console.log();
}

const built = buildFins(topo, res, rot, { mode: 'stabilize', bedPad: true });
console.log('PLACEMENT');
console.log(`  ranked candidate sites         ${built.rejected.sites}`);
console.log(`  actually attempted             ${built.rejected.tried}`);
console.log(`  attempted, no clear window     ${built.rejected.blocked}`);
console.log(`  windows built, then discarded  ${built.rejected.tooFewTines}` +
            `   (wall inside the part, or < ${FIN.minTines} tines)`);
console.log(`  FINS                           ${built.fins.length}` +
            `  (${built.tines} tines)`);
console.log(`\nlimits: lean <= ${MAX_LEAN_DEG}deg, wall <= ${FIN.maxLen}mm long, ` +
            `stilt <= ${100 * FIN.stiltFrac}% of height, sites >= ${FIN.minSiteGap}mm apart`);
