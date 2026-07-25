"""
SPIKE part 4: the LOAD ARROW. Does "point at the load" actually pick the orientation,
and do the fins make the strong orientation printable?

Layer adhesion is the weak axis: a tensile stress running ALONG the build Z pulls
layers apart (~half the in-plane strength). So the rule is:

    keep the CRITICAL TENSILE DIRECTION out of the build Z.

The subtlety this spike is here to test: the critical tensile direction is NOT always
the direction the user points.
  PULL mode  - direct tension/pull-apart. Critical direction == the applied force L.
  BEND mode  - a cantilever (hook, bracket arm, peg). The force is downward, but the
               tensile stress at the root runs along the BEAM AXIS, perpendicular to
               the force. Pointing at gravity gives the wrong answer here.
Most functional prints that snap are bending failures, so this distinction decides
whether a naive arrow UI is safe.

  python3 spike_arrow.py models/gen_wall_hook.stl 0,0,-1
"""
import sys
import numpy as np
import trimesh

PAD = True

from spike_orient import metrics, candidates, elongation


def report(src, L):
    mesh = trimesh.load(src, force='mesh')
    L = np.array(L, dtype=float)
    L /= np.linalg.norm(L)
    elong, axis = elongation(mesh)

    # BEND mode critical direction: the beam axis. Use the part's long axis, but take
    # the component perpendicular to the applied force (a cantilever bends about that).
    beam = axis - np.dot(axis, L) * L
    beam = beam / np.linalg.norm(beam) if np.linalg.norm(beam) > 1e-6 else axis

    print(f"\n{'='*98}\n{src.split('/')[-1]}  bbox {np.round(mesh.extents,1)}  "
          f"elongation {elong:.2f}")
    print(f"  arrow (applied force) {np.round(L,2)}   ->  PULL-critical {np.round(L,2)}"
          f"   BEND-critical (beam axis) {np.round(beam,2)}")

    rows = []
    for name, tilt, prob, m in candidates(mesh):
        R = np.eye(3)
        # recover the rotation this candidate applied, via the vertex fit
        A = np.asarray(mesh.vertices) - np.asarray(mesh.vertices).mean(axis=0)
        B = np.asarray(m.vertices) - np.asarray(m.vertices).mean(axis=0)
        if A.shape == B.shape:
            U_, _, Vt = np.linalg.svd(A.T @ B)
            R = (U_ @ Vt).T
        d = metrics(m)
        pull = 1.0 - abs(float((R @ L)[2]))     # 1 = load lies in the layer plane
        bend = 1.0 - abs(float((R @ beam)[2]))
        rows.append((name, d, pull, bend))

    print(f"  {'orientation':16} {'PULL':>6} {'BEND':>6} {'height':>7} {'bed':>7} "
          f"{'overhang':>9} {'fins':>6} {'short':>6}")
    for name, d, pull, bend in rows:
        short = d['regions'] - d['real_fins']
        print(f"  {name:16} {pull:6.2f} {bend:6.2f} {d['height']:7.1f} {d['bed']:7.0f} "
              f"{d['over']:9.0f} {d['real_fins']:6d} {short:6d}")

    def best(key):
        # strongest orientation that is actually printable: every overhang either
        # absent or finnable, and it still sits on the bed
        # a tilted part rests on an edge -> bed contact ~0. That is NOT a
        # disqualifier: breakaway.py already has bed_pad() for exactly this.
        # PAD=True treats "add a bed pad" as available, which is what a real
        # tool would do, and lets strong-but-tilted orientations compete.
        ok = [r for r in rows if (PAD or r[1]['bed'] > 20) and (r[1]['regions'] == 0 or
              r[1]['real_fins'] >= 0.5 * r[1]['regions'])]
        pool = ok or rows
        return max(pool, key=key)

    bp = best(lambda r: r[2])
    bb = best(lambda r: r[3])
    flat = min(rows, key=lambda r: r[1]['height'])
    print(f"  => PULL mode picks {bp[0]:14} (score {bp[2]:.2f}, {bp[1]['real_fins']} fins)")
    print(f"  => BEND mode picks {bb[0]:14} (score {bb[3]:.2f}, {bb[1]['real_fins']} fins)")
    print(f"  => flattest/default {flat[0]:13} (PULL {flat[2]:.2f} BEND {flat[3]:.2f}, "
          f"{flat[1]['real_fins']} fins)")
    if bp[0] != bb[0]:
        print(f"  ** PULL and BEND DISAGREE -> a naive 'point at the force' UI would "
              f"pick {bp[0]} for a part that actually fails in bending **")


if __name__ == '__main__':
    src = sys.argv[1]
    L = [float(x) for x in sys.argv[2].split(',')]
    report(src, L)
