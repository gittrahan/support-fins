/**
 * A small tube against the patch path, for one region.
 *
 * A SMALL tube (under tubeMinArea, see tubeLine) is a new claim on a region the
 * patch path used to own. It does WORSE on some regions the patch path served
 * (bore_bracket flat: 98 -> 52%, its weld check rejects the only wall;
 * voron_drive_frame x45y30: 36 -> 32%, one band's patches held two long walls
 * where its tube line sat off to one side), and better on others (drive frame
 * x60: 22 -> 34%). So the tube is built first, taken back out, the region's
 * split patches are built from the same starting point, and whichever holds more
 * overhang area stays. A tie keeps the patches.
 *
 * buildProps drives it from its patch loop:
 *
 *   const mark = rivalry.begin(patch);        // top of every patch
 *   ...build the patch's walls...
 *   if (patch.smallTube) rivalry.tubeDone(patch, mark, patches);
 *   rivalry.finish();                         // after the loop
 *
 * `acc` is everything the loop accumulates -- { out, props, skipped, served,
 * tally: { tines, sagRisk } } -- so a route can be snapshotted and undone.
 */
import { MIN_REGION_AREA } from '../overhangs.js';
import { PROP } from './config.js';

export function tubeRivalry(acc, topo, result, partTris) {
  const { out, props, skipped, served, tally } = acc;

  const snapshot = () => ({ out: out.length, props: props.length, tines: tally.tines,
                            skipped: { ...skipped }, sagRisk: tally.sagRisk, served: new Set(served) });
  const restore = (m) => {
    out.length = m.out; props.length = m.props; tally.tines = m.tines; tally.sagRisk = m.sagRisk;
    Object.assign(skipped, m.skipped);
    served.clear(); for (const r of m.served) served.add(r);
  };
  // Undo the region's patches and put its tube's walls back instead, moved to
  // the end of `out` (so every triRange shifts by the same amount).
  const keepTube = (r) => {
    const t = r.tube;
    if (r.start) restore(r.start);
    const shift = out.length - t.mark.out;
    for (const tri of t.tris) out.push(tri);
    for (const q of t.props) props.push({ ...q, triRanges: q.triRanges.map(([a, b]) => [a + shift, b + shift]) });
    tally.tines += t.end.tines - t.mark.tines;
    for (const k in skipped) skipped[k] += t.end.skipped[k] - t.mark.skipped[k];
    tally.sagRisk ||= t.end.sagRisk;
    if (t.props.length) served.add(r.region);
    else skipped.sliver += r.slivers;    // nothing either way: dropped, as before
  };
  // Overhang area held by support triangles out[from..], judged over EVERY
  // overhang face within reach of the region, not just the region's own: a wall
  // under one band holds its neighbours too, and the sweep's coverage counts
  // them all. Same rule as that coverage (a support vertex within
  // maxUnsupportedSpan in plan and 0-3 mm below the face), so the pick agrees
  // with the gate that judges it.
  let overFaces = null;               // [cx, cy, cz, area] of every overhang face
  const heldArea = (r, tris, from) => {
    const span = PROP.maxUnsupportedSpan;
    if (!overFaces) {
      overFaces = [];
      for (const g of result.regions) {
        for (const f of g.faces) {
          const t = f * 9;
          overFaces.push([(partTris[t] + partTris[t + 3] + partTris[t + 6]) / 3,
                          (partTris[t + 1] + partTris[t + 4] + partTris[t + 7]) / 3,
                          (partTris[t + 2] + partTris[t + 5] + partTris[t + 8]) / 3, topo.area[f]]);
        }
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < r.tris.length; k += 3) {
      x0 = Math.min(x0, r.tris[k]); x1 = Math.max(x1, r.tris[k]);
      y0 = Math.min(y0, r.tris[k + 1]); y1 = Math.max(y1, r.tris[k + 1]);
    }
    const reach = 2 * span;             // a wall under the region, then its span
    let held = 0;
    for (const [cx, cy, cz, a] of overFaces) {
      if (cx < x0 - reach || cx > x1 + reach || cy < y0 - reach || cy > y1 + reach) continue;
      for (let i = from; i < tris.length; i++) {
        const v = tris[i];
        if (v[2] > cz - 3 && v[2] < cz + 0.5 && Math.hypot(v[0] - cx, v[1] - cy) <= span) {
          held += a;
          break;
        }
      }
    }
    return held;
  };

  // A small tube's region is settled once its last patch is done, however that
  // patch exits (most of its skips `continue`); its patches' output is then the
  // tail of `out`, since they were queued together and ran back to back.
  let lastPatch = null;
  const settle = (p) => {
    const r = p?.rival;
    if (!r || p !== r.last) return;
    if (r.tube.held > heldArea(r, out, r.start.out) + 1e-6) keepTube(r);
    else skipped.sliver += r.slivers;
  };

  return {
    /** Top of every patch: settle the previous one; the mark a small tube undoes to. */
    begin(patch) {
      settle(lastPatch);
      lastPatch = patch;
      if (patch.rival && !patch.rival.start) patch.rival.start = snapshot();
      return patch.smallTube ? snapshot() : null;
    },
    /**
     * A small tube's walls are built (a tube patch always gets here: its lines
     * are never empty). Take them back out and queue the region's patches on
     * `patches` to have a go; with none big enough, the tube keeps the region.
     */
    tubeDone(patch, mark, patches) {
      const tube = { mark, end: snapshot(), tris: out.slice(mark.out), props: props.slice(mark.props),
                     held: heldArea(patch, out, mark.out) };
      restore(mark);
      const rivals = patch.smallTube.filter((p) => p.area >= MIN_REGION_AREA);
      // slivers count only if the patch path keeps the region, as they did before
      const rival = { last: rivals[rivals.length - 1], tube, faces: patch.faces, tris: patch.tris,
                      slivers: patch.smallTube.length - rivals.length, region: patch.region, start: null };
      if (!rivals.length) keepTube(rival);
      for (const p of rivals) {
        p.region = patch.region;
        p.tris = patch.tris;
        p.rival = rival;
        patches.push(p);                 // for...of reaches patches pushed mid-loop
      }
    },
    /** After the patch loop: settle the last region. */
    finish() { settle(lastPatch); },
  };
}
