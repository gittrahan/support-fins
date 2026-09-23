// Bridge between the Orca plugin (Python) and the printfins.com engine (web/*.js),
// bundled together by build.py and evaluated inside an embedded V8 (mini-racer).
//
// Two halves: stand-ins for the browser APIs the engine touches, which must be
// defined BEFORE the bundle runs (zip.js builds a TextEncoder at module load),
// and sfFinPart(), the one entry point Python calls after it.

// ---- prelude: browser APIs a bare V8 doesn't have ----------------------------
// zip.js is the only consumer: TextEncoder/TextDecoder for names + XML, Blob as
// zipStore's return value. Everything else in the engine is plain mesh math.
if (typeof TextEncoder === 'undefined') {
  globalThis.TextEncoder = class {
    encode(s) {
      const b = unescape(encodeURIComponent(s));
      const out = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
      return out;
    }
  };
}
if (typeof TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    decode(u8) {
      let b = '';
      for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
      return decodeURIComponent(escape(b));
    }
  };
}
if (typeof Blob === 'undefined') {
  // zipStore hands back `new Blob([buf])` (buf an ArrayBuffer); keep it to read out.
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
}

//@@ENGINE@@

// ---- entry point -------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(u8) {
  const out = [];
  let i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out.push(B64[n >> 18], B64[(n >> 12) & 63], B64[(n >> 6) & 63], B64[n & 63]);
  }
  if (i < u8.length) {
    const n = (u8[i] << 16) | ((i + 1 < u8.length ? u8[i + 1] : 0) << 8);
    out.push(B64[n >> 18], B64[(n >> 12) & 63],
             i + 1 < u8.length ? B64[(n >> 6) & 63] : '=', '=');
  }
  return out.join('');
}

/**
 * Fin one part, exactly as the site's Auto mode + 3MF export would.
 *
 * @param pos   flat triangle soup (9 floats per face), PLATE space -- already
 *              posed by the user in Orca, so the engine gets an identity rotation
 * @param name  written as the 3MF title
 * @param opts  buildFins options (the site's finOpts() shape)
 * @returns JSON string: counts for the report + the finned .3mf as base64
 *          (null when the part needs nothing)
 */
function sfFinPart(pos, name, opts) {
  const P = new Float32Array(pos);
  const topo = SF.buildTopology({ getAttribute: (k) => (k === 'position' ? { array: P } : null) });
  const rot = SF.IDENTITY3;
  const res = SF.analyze(topo, SF.DEFAULT_THRESHOLD, rot);
  const built = SF.buildFins(topo, res, rot, opts);

  // Part + additions in print space, the same transform app.js's
  // buildExportGeometry applies (rotation is identity here, so just the offset).
  const { x: dx, y: dy, z: dz } = res.offset;
  const partTris = new Array(topo.nFaces * 3);
  for (let v = 0; v < topo.nFaces * 3; v++) {
    partTris[v] = [P[v * 3] + dx, P[v * 3 + 1] + dy, P[v * 3 + 2] + dz];
  }
  const added = [...built.triangles, ...built.padTriangles];

  return JSON.stringify({
    regions: res.regions.length,
    fins: built.fins.length,
    tines: built.tines,
    pad: built.padTriangles.length > 0,
    unserved: built.unserved,
    seating: built.seating ? built.seating.kind : null,
    threemf: added.length ? base64(new Uint8Array(SF.writeThreeMF(partTris, added, name).parts[0])) : null,
  });
}

/**
 * Fin one part for slice-time injection: same build as sfFinPart, but hands
 * back the added solids (fins + pad) as a flat triangle soup in the CALLER's
 * frame -- the engine's seating offset undone -- so Python can cut them at
 * each layer height of Orca's own slice.
 *
 * @returns JSON string: counts + `tris` (9 floats per face; [] when nothing)
 */
function sfFinTris(pos, opts) {
  const P = new Float32Array(pos);
  const topo = SF.buildTopology({ getAttribute: (k) => (k === 'position' ? { array: P } : null) });
  const res = SF.analyze(topo, SF.DEFAULT_THRESHOLD, SF.IDENTITY3);
  const built = SF.buildFins(topo, res, SF.IDENTITY3, opts);
  const { x: dx, y: dy, z: dz } = res.offset;
  const tris = [];
  for (const list of [built.triangles, built.padTriangles]) {
    for (const p of list) tris.push(p[0] - dx, p[1] - dy, p[2] - dz);
  }
  return JSON.stringify({
    regions: res.regions.length, fins: built.fins.length, tines: built.tines,
    pad: built.padTriangles.length > 0, unserved: built.unserved, tris,
  });
}
