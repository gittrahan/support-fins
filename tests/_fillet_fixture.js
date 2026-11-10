// A rounded-rectangle prism: vertical corners AND the top and bottom edges filleted with radius r.
// Test fixture only (generated on purpose: the reporter's part is not attached).
export function filletedPrism(W, D, H, r, arc = 8, zSteps = 12) {
  const rings = [];
  const ring = (z, d) => {
    const a = W / 2 - d, b = D / 2 - d, rc = Math.max(r - d, 0.02);
    const pts = [];
    const cs = [[a - rc, b - rc, 0], [-(a - rc), b - rc, 90], [-(a - rc), -(b - rc), 180], [a - rc, -(b - rc), 270]];
    for (const [cx, cy, a0] of cs) {
      for (let k = 0; k <= arc; k++) {
        const t = ((a0 + (90 * k) / arc) * Math.PI) / 180;
        const p = [cx + rc * Math.cos(t), cy + rc * Math.sin(t), z];
        pts.push(p);
      }
    }
    return pts;
  };
  const inset = (z) => r - Math.sqrt(Math.max(0, r * r - (r - z) * (r - z)));
  const zs = [];
  for (let i = 0; i <= zSteps; i++) zs.push((r * i) / zSteps);
  for (let i = 1; i < 6; i++) zs.push(r + ((H - 2 * r) * i) / 6);
  for (let i = 0; i <= zSteps; i++) zs.push(H - r + (r * i) / zSteps);
  const uniq = zs.filter((z, i) => i === 0 || z > zs[i - 1] + 1e-9);
  for (const z of uniq) {
    const d = z < r ? inset(z) : z > H - r ? inset(H - z) : 0;
    rings.push(ring(z, d));
  }
  const n = rings[0].length;
  for (const R of rings) if (R.length !== n) throw new Error('ring size varies ' + R.length + ' vs ' + n);
  const T = [];
  const tri = (a, b, c) => T.push(a, b, c);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = rings[i][k], b = rings[i][k2], c = rings[i + 1][k2], d = rings[i + 1][k];
      tri(a, b, c); tri(a, c, d);
    }
  }
  const cap = (R, up) => {
    const z = R[0][2], c = [0, 0, z];
    for (let k = 0; k < n; k++) { const a = R[k], b = R[(k + 1) % n]; up ? tri(c, a, b) : tri(c, b, a); }
  };
  cap(rings[0], false); cap(rings[rings.length - 1], true);
  const arr = new Float32Array(T.length * 3);
  T.forEach((p, i) => arr.set(p, i * 3));
  return arr;
}
