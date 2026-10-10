// Public synthetic cantilever; no private model is used.
function block(x0,x1,y0,y1,z0,z1) {
 const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
 const q=(a,b,c,d)=>[v[a],v[b],v[c],v[a],v[c],v[d]];
 return new Float32Array([...q(0,3,2,1),...q(4,5,6,7),...q(0,1,5,4),...q(2,3,7,6),...q(1,2,6,5),...q(0,4,7,3)].flat());
}
export function densePlate(n) {
  const coarse = block(-60, 60, -60, 60, 100, 120), out = [];
  const p = (a, b, c, u, v) => a.map((x, k) => x + (b[k] - x) * u / n + (c[k] - x) * v / n);
  for (let f = 0; f < coarse.length; f += 9) {
    const a = Array.from(coarse.slice(f, f + 3)), b = Array.from(coarse.slice(f + 3, f + 6)), c = Array.from(coarse.slice(f + 6, f + 9));
    for (let u = 0; u < n; u++) for (let v = 0; v < n - u; v++) {
      out.push(...p(a, b, c, u, v), ...p(a, b, c, u + 1, v), ...p(a, b, c, u, v + 1));
      if (u + v + 1 < n) out.push(...p(a, b, c, u + 1, v), ...p(a, b, c, u + 1, v + 1), ...p(a, b, c, u, v + 1));
    }
  }
  out.push(...block(50, 60, 50, 60, 0, 100));
  return new Float32Array(out);
}
