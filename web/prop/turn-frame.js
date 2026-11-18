/** Height-dependent frames for the ordinary wall sweep. No slicer/runtime dependency. */
export function turnFrame(
  { center, start, end, degrees, layerHeight, radius, axis = 0, endScale = 1 },
) {
  if (
    !Array.isArray(center) || center.length !== 2 ||
    !center.every(Number.isFinite) ||
    ![start, end, degrees, layerHeight, radius, axis, endScale].every(
      Number.isFinite,
    ) ||
    end <= start || layerHeight <= 0 || radius <= 0 || endScale <= 0 ||
    endScale > 1 || Math.abs(degrees) > 90
  ) {
    throw Error("invalid turning frame");
  }
  const radians = degrees * Math.PI / 180;
  // Maximum horizontal speed of any swept point. Bounding the continuous arc
  // also bounds its chord at every layer, including a different first layer.
  const contract = radius * (1 - endScale), arc = radius * Math.abs(radians);
  const travel = contract + arc;
  if (travel > end - start + 1e-9) {
    throw Error("insufficient height for the 45-degree growth bound");
  }
  const count = Math.ceil((end - start) / layerHeight);
  if (count > 4096) throw Error("turn exceeds the fixed-layer planning bound");
  const levels = Array.from(
    { length: count + 1 },
    (_, i) => start + (end - start) * i / count,
  );
  if (contract && arc) levels.push(start + (end - start) * contract / travel);
  levels.sort((a, b) => a - b);
  for (let i = levels.length - 1; i > 0; i--) {
    if (levels[i] === levels[i - 1]) levels.splice(i, 1);
  }
  return {
    levels,
    start,
    end,
    degrees,
    at(p) {
      if (p[2] <= start || degrees === 0) return p;
      const t = Math.min(1, (p[2] - start) / (end - start));
      const split = travel ? contract / travel : 0;
      const shrinkT = split ? Math.min(1, t / split) : 1;
      const turnT = Math.max(0, (t - split) / (1 - split));
      const a = radians * turnT;
      let x = p[0] - center[0], y = p[1] - center[1];
      const u = axis * Math.PI / 180,
        shrink = (x * Math.cos(u) + y * Math.sin(u)) * (endScale - 1) * shrinkT;
      x += shrink * Math.cos(u);
      y += shrink * Math.sin(u);
      const q = [
        center[0] + x * Math.cos(a) - y * Math.sin(a),
        center[1] + x * Math.sin(a) + y * Math.cos(a),
        p[2],
      ];
      if (p.length > 3) q.push(p[3]);
      return q;
    },
  };
}

/** Refine the ordinary sweep at shared heights before mapping its local frame.
 * Keep exact lower coordinates, winding, separate flange shells and interface
 * tags. Shared edges use the same interpolation in both incident triangles.
 * This is construction tessellation, not input repair or nearest-face snapping. */
export function frameSweep(triangles, frame) {
  if (!frame || frame.degrees === 0) return triangles;
  const cuts = new Map(), mapped = new Map(), out = [];
  const key = (p) => p.slice(0, 3).join(",");
  const intersect = (p, q, z) => {
    if (p[2] === z) return p;
    if (q[2] === z) return q;
    if (key(p) > key(q)) [p, q] = [q, p];
    const id = `${key(p)}|${key(q)}|${z}|${p[3] ?? ""}`;
    let v = cuts.get(id);
    if (!v) {
      const t = (z - p[2]) / (q[2] - p[2]);
      v = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), z];
      if (p.length > 3) v.push(p[3]);
      cuts.set(id, v);
    }
    return v;
  };
  const clip = (poly, z, above) => {
    const result = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const aa = above ? a[2] >= z : a[2] <= z,
        bb = above ? b[2] >= z : b[2] <= z;
      if (aa) result.push(a);
      if (aa !== bb) result.push(intersect(a, b, z));
    }
    return result.filter((p, i) =>
      key(p) !== key(result[(i + result.length - 1) % result.length])
    );
  };
  const map = (p) => {
    const id = `${key(p)}|${p[3] ?? ""}`;
    if (!mapped.has(id)) mapped.set(id, frame.at(p));
    return mapped.get(id);
  };
  for (let i = 0; i < triangles.length; i += 3) {
    const tri = triangles.slice(i, i + 3),
      low = Math.min(...tri.map((p) => p[2])),
      high = Math.max(...tri.map((p) => p[2]));
    const levels = frame.levels.filter((z) => z > low && z < high);
    let rest = tri;
    for (const z of levels) {
      const poly = clip(rest, z, false);
      for (let j = 1; j + 1 < poly.length; j++) {
        out.push(map(poly[0]), map(poly[j]), map(poly[j + 1]));
      }
      rest = clip(rest, z, true);
    }
    for (let j = 1; j + 1 < rest.length; j++) {
      out.push(map(rest[0]), map(rest[j]), map(rest[j + 1]));
    }
  }
  return out;
}
