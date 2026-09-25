"""SWAY BRACES -- buttress ribs that keep a TALL part from drifting, sagging and
wobbling as it grows. Port of web/sway.js; see that file and docs/FIN-SPEC.md
("Sway braces (tall parts)") in the support-fins repo for the reasoning.

A sway brace is:
  1. the RIB, a vertical plate standing EDGE-ON to an upright face (its stiff
     direction). Its inner edge follows the face at the breakaway gap, and it
     tapers from deep at the bed to a flat top;
  2. the FOOT, a thin flange on the bed under the rib;
  3. the TINES, one-layer horizontal bridges from the rib's inner edge into the
     part, evenly spaced all the way up. They are the only thing touching the part.

Every refusal returns a short human reason. Never fail silently.
"""

import math

from .geometry import Prism, clip, seg_dist

SWAY = {
    # which faces take a brace
    'maxLeanDeg': 30,       # a face leaning further than this is an overhang or a roof
    'minFaceH': 30,         # auto: mm of face height before bracing it
    'minTopFrac': 0.4,      # auto: ...and it must reach this far up the part
    'minPartH': 30,         # auto: a shorter part doesn't sway enough to need this

    # the rib
    'thMin': 1.2,           # thickness = min(thMax, thMin + thPerMm * H)
    'thPerMm': 0.004,
    'thMax': 2.4,
    'reach': 0.15,          # DEFAULT bed depth as a fraction of rib height ("Brace depth")
    'topDepth': 4,          # mm at the top: a flat edge, never a point
    'minDepth': 8,
    'maxDepth': 60,
    'topClear': 1.0,        # the rib stops this far below the top of the face column
    'minRibH': 20,          # a shorter rib isn't bracing anything

    # the foot
    'footH': 0.6,
    'footHalf': 3.0,        # flange past the rib on each side
    'footPad': 3.0,         # ...and past its outer end

    # the tines (gap and bite are overridden per material via opts)
    'gap': 0.2,
    'bite': 0.3,
    'tineW': 0.5,           # one nozzle bead
    'tineOverlap': 0.3,     # how far the tine sinks back into the rib
    'tineSpanMax': 1.5,     # past this much open air a tine is a bridge
    'tineSpacing': 6,       # DEFAULT mm between tines ("Tine spacing")
    'minTines': 3,
    'minGripShare': 0.3,    # tines on at least this share of the rows up the rib
    # ...and AUTO won't stand a rib this far up before its FIRST tine. Below its
    # lowest grip a brace is a lone wall: it prints holding nothing, held by
    # nothing, free to wobble beside a part at its most delicate. A part tilted
    # onto a corner puts every face high off the plate and hits this. A brace the
    # user picks by hand builds anyway and reports `stilt` (see allow_stilt).
    'stiltMax': 40,
    'stiltMaxFrac': 0.4,

    # auto-placement
    'pitch': 100,           # mm of face width per rib
    'maxPerFace': 4,
    'endInset': 10,         # keep candidate columns this far from a face's ends
    'maxFaces': 4,
    'minBearingSep': 60,    # degrees between the faces chosen
    'nudges': [0, 3, -3, 6, -6, 10, -10],
    'clearance': 1.0,       # mm of air two braces must keep between them
    'levelStep': 10,        # mm between the heights a clash check compares
}

# Material profiles: support gap and tine bite, mm.
MATERIALS = {
    'PLA': {'gap': 0.2, 'bite': 0.3},
    'PETG': {'gap': 0.3, 'bite': 0.15},
}

DEFAULTS = {
    'tines': True,
    'layer_height': 0.2,
    'gap': SWAY['gap'],
    'bite': SWAY['bite'],
    'grip_from': 0.0,
    'tine_spacing': SWAY['tineSpacing'],
    'reach': SWAY['reach'],
}


def js_round(x):
    """JavaScript's Math.round: halves go up (Python's round() goes to even)."""
    return math.floor(x + 0.5)


def lean_cut():
    return math.sin(math.radians(SWAY['maxLeanDeg']))


def settings(opts=None):
    """Resolve the caller's options against the defaults, clamped to what prints."""
    opts = opts or {}

    def num(k):
        v = opts.get(k)
        return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else DEFAULTS[k]

    return {
        'tines': opts.get('tines', True) is not False,
        'layerH': max(0.04, num('layer_height')),
        'gap': num('gap'),
        'bite': num('bite'),
        'gripFrom': max(0.0, num('grip_from')),
        'spacing': max(1.0, num('tine_spacing')),
        'reach': max(0.05, min(0.5, num('reach'))),
        # Auto refuses a brace that would stand a long way up before its first
        # tine; one placed BY HAND builds anyway and reports the stilt instead.
        # The tool suggests, the person decides -- as everywhere else here.
        'allowStilt': opts.get('allow_stilt') is True,
    }


class Rib:
    """The result of building one brace. `ok` False means refused, with `reason`."""

    def __init__(self, ok, reason=None, **kw):
        self.ok = ok
        self.reason = reason
        self.prisms = kw.get('prisms', [])
        self.tines = kw.get('tines', 0)
        self.height = kw.get('height', 0.0)
        self.depth = kw.get('depth', 0.0)
        self.th = kw.get('th', 0.0)
        self.foot = kw.get('foot')          # [(x, y, z), (x, y, z)]: inner -> outer at z = 0
        self.half_w = kw.get('half_w', 0.0)
        self.levels = kw.get('levels', [])  # [{'z', 'a', 'b'}]: inner/outer points up the rib
        self.stilt = kw.get('stilt', 0.0)   # mm standing holding nothing below its first tine

    @staticmethod
    def refuse(reason):
        return Rib(False, reason)

    def volume(self):
        """Solid volume in mm^3, pieces summed (their small overlaps counted twice)."""
        return sum(p.volume() for p in self.prisms)


def _lowest_hit(part, nh, ud, u_lo, u_hi, outline):
    """The lowest z at which any part triangle crosses the volume the rib would
    occupy, or inf. Clip each triangle to the rib's slab across the face, then
    against its (s, z) outline."""
    best = math.inf
    for tri in part.tris:
        v = [(x * nh[0] + y * nh[1], x * ud[0] + y * ud[1], z) for x, y, z in tri]
        umin = min(q[1] for q in v)
        umax = max(q[1] for q in v)
        if umax < u_lo or umin > u_hi:
            continue
        poly = clip(v, lambda q: q[1] - u_lo)
        poly = clip(poly, lambda q: u_hi - q[1])
        for f in outline:
            if len(poly) < 2:
                break
            poly = clip(poly, f)
        if len(poly) < 2:
            continue
        for q in poly:
            if q[2] < best:
                best = q[2]
    return best


def build_rib(p, uc, part, opts=None, inside=None):
    """Build one sway brace against patch `p`, centred across the face at `uc`.

    `part` is the part's Mesh in print space. `inside(x, y, z)` answers "is this
    point in the part?" (defaults to the mesh's ray-parity test; the Fusion layer
    passes the body's exact containment test). Returns a Rib.
    """
    S = settings(opts)
    inside = inside or part.inside
    T = SWAY
    if abs(p.n[2]) > lean_cut():
        return Rib.refuse('that face leans too far to stand a brace against — pick an upright side')

    nh = (p.n[0] / p.h, p.n[1] / p.h)
    ud = p.u

    def to_world(s, uu, z):
        return (nh[0] * s + ud[0] * uu, nh[1] * s + ud[1] * uu, z)

    def s_of(q):
        return q[0] * nh[0] + q[1] * nh[1]

    # How much of the face this column actually crosses, 1 mm at a time.
    fz0, fz1 = math.inf, -math.inf
    z = max(0.0, p.z0)
    while z <= p.z1 + 1e-6:
        if p.probe(uc, p.t_at_z(0, z)) is not None:
            fz0 = min(fz0, z)
            fz1 = max(fz1, z)
        z += 1
    if fz1 == -math.inf:
        return Rib.refuse('there is no face under that spot to brace')

    H = fz1 - T['topClear']
    if H < T['minRibH']:
        return Rib.refuse('that face only reaches %.0f mm up — too short to need a brace' % fz1)

    def th_for(h):
        return min(T['thMax'], T['thMin'] + T['thPerMm'] * h)

    # Seat the inner edge on the outermost point of the face inside the rib's own
    # slab: the patch plane touches the face's global high point, which may be
    # elsewhere, and the gap has to be a floor HERE.
    def shift_in(half):
        m = -math.inf
        for tri in p.tris:
            poly = clip(list(tri), lambda q: q[0] - (uc - half))
            poly = clip(poly, lambda q: (uc + half) - q[0])
            for q in poly:
                m = max(m, q[2])
        return 0.0 if m == -math.inf else m

    st = {}

    def shape():
        th = th_for(H)
        w_in = shift_in(th / 2 + T['tineW']) + S['gap']
        a = s_of(p.point(w_in, uc, p.t_at_z(w_in, 0)))
        b = s_of(p.point(w_in, uc, p.t_at_z(w_in, 1)))
        st.update(th=th, sIn0=a, sInSlope=b - a,
                  D0=max(T['minDepth'], min(T['maxDepth'], S['reach'] * H)))

    def s_in(z):
        return st['sIn0'] + st['sInSlope'] * z

    def depth_at(z):
        D0 = st['D0']
        return D0 + (T['topDepth'] - D0) * min(1.0, max(0.0, z / H))

    # Shrink the rib until nothing on the part crosses it: a ledge or shoulder
    # above the face caps it below that feature.
    hit = math.inf
    for _ in range(6):
        shape()
        th = st['th']
        outline = [
            lambda q: q[2] + 0.1,
            lambda q, H=H: (H + 0.3) - q[2],
            lambda q: q[0] - (s_in(q[2]) - 0.05),
            lambda q: (s_in(q[2]) + depth_at(q[2]) + 0.1) - q[0],
        ]
        hit = _lowest_hit(part, nh, ud, uc - th / 2 - 0.3, uc + th / 2 + 0.3, outline)
        if hit == math.inf:
            break
        H = hit - 1.0
        if H < T['minRibH']:
            break
    if hit != math.inf:
        return Rib.refuse('the part sticks out over that spot, so a brace standing on the bed '
                          'can’t reach up the face')

    th, D0 = st['th'], st['D0']

    # The foot has its own, wider footprint on the bed.
    s_foot_out = s_in(0) + D0 + T['footPad']
    foot_half_w = th / 2 + T['footHalf']
    foot_hit = _lowest_hit(part, nh, ud, uc - foot_half_w - 0.2, uc + foot_half_w + 0.2, [
        lambda q: q[2] + 0.1,
        lambda q: (T['footH'] + 0.2) - q[2],
        lambda q: q[0] - (s_in(0) - 0.05),
        lambda q: (s_foot_out + 0.1) - q[0],
    ])
    if foot_hit != math.inf:
        return Rib.refuse('the part’s base spreads out under this face, so there is no room on '
                          'the bed for the brace’s foot')

    zhat = (0.0, 0.0, 1.0)
    nh3 = (nh[0], nh[1], 0.0)
    u3 = (ud[0], ud[1], 0.0)
    prisms = [
        # the rib: outline in (s, z), extruded across the face
        Prism('rib', [(s_in(0), 0), (s_in(0) + D0, 0),
                      (s_in(H) + T['topDepth'], H), (s_in(H), H)],
              uc - th / 2, uc + th / 2, nh3, zhat, u3),
        # the foot: footprint in (s, u), extruded up
        Prism('foot', [(s_in(0), uc - foot_half_w), (s_foot_out, uc - foot_half_w),
                       (s_foot_out, uc + foot_half_w), (s_in(0), uc + foot_half_w)],
              0.0, T['footH'], nh3, u3, zhat),
    ]

    # Tines: evenly spaced up the face, each snapped into exactly one layer cell.
    tines = 0
    first_grip = math.inf
    stilt = 0.0
    if S['tines']:
        lh = S['layerH']
        z_start = max(fz0 + 0.5, S['gripFrom'], T['footH'] + 0.5)
        z_end = min(fz1, H) - 0.5
        k = 0
        while True:
            z = z_start + k * S['spacing']
            k += 1
            if z > z_end + 1e-6:
                break
            bot = js_round(z / lh) * lh
            top = bot + lh
            if top > H:
                break
            z_mid = bot + lh / 2
            dev = p.probe(uc, p.t_at_z(0, z_mid))
            if dev is None:
                continue
            refined = p.probe(uc, p.t_at_z(dev, z_mid))
            if refined is not None:
                dev = refined
            s_part = s_of(p.point(dev, uc, p.t_at_z(dev, z_mid)))
            s_wall = s_in(z_mid)
            if s_wall - s_part > T['tineSpanMax']:
                continue                                # a bridge, not a tine
            bx = to_world(s_part - S['bite'] / 2, uc, z_mid)
            if not inside(*bx):
                continue                                # grips nothing
            prisms.append(Prism('tine', [(s_part - S['bite'], bot), (s_wall + T['tineOverlap'], bot),
                                         (s_wall + T['tineOverlap'], top), (s_part - S['bite'], top)],
                                uc - T['tineW'] / 2, uc + T['tineW'] / 2, nh3, zhat, u3))
            tines += 1
            first_grip = min(first_grip, bot)
        # A tall rib tied on at a handful of points still lets the part wave
        # about between them, so the grip has to cover a real share of the height.
        wanted = max(T['minTines'], math.floor(T['minGripShare'] * (z_end - z_start) / S['spacing']))
        if tines < wanted:
            return Rib.refuse('too little of this face lines up with the brace for its tines to '
                              'grip — try a flatter part of the side')
        # Everything below the lowest tine holds nothing and is held by nothing.
        # Measured from the plate, or from "Brace grip from" when that is higher:
        # a user who asks to grip only above 80mm has chosen that stilt, so what
        # this catches is the stilt the GEOMETRY imposes.
        stilt = max(0.0, first_grip - max(T['footH'], S['gripFrom']))
        max_stilt = min(T['stiltMax'], T['stiltMaxFrac'] * H)
        if not S['allowStilt'] and stilt > max_stilt:
            return Rib.refuse(
                f'this side only starts {first_grip:.0f}mm up, so the brace would stand '
                f'{stilt:.0f}mm holding nothing before it grips (max {max_stilt:.0f}mm) '
                '— rotate so this side reaches the plate')

    foot = [to_world(s_in(0), uc, 0), to_world(s_foot_out, uc, 0)]
    # The rib's footprint at a ladder of heights, so a clash check can compare
    # two ribs at the SAME z.
    levels = []
    z = 0.0
    while True:
        levels.append({'z': z, 'a': to_world(s_in(z), uc, z), 'b': to_world(s_in(z) + depth_at(z), uc, z)})
        if z >= H:
            break
        z = min(H, z + T['levelStep'])
    return Rib(True, prisms=prisms, tines=tines, height=H, depth=D0, th=th,
               foot=foot, half_w=foot_half_w, levels=levels, stilt=stilt)


def _level_at(levels, z):
    """A rib's footprint at height z, interpolated between its sampled levels."""
    k = 0
    while k < len(levels) - 2 and levels[k + 1]['z'] < z:
        k += 1
    A = levels[k]
    B = levels[min(k + 1, len(levels) - 1)]
    f = max(0.0, min(1.0, (z - A['z']) / (B['z'] - A['z']))) if B['z'] > A['z'] else 0.0

    def mix(p, q):
        return (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)

    return mix(A['a'], B['a']), mix(A['b'], B['b'])


def clashes(rib, ribs):
    """Would `rib` run into any of `ribs`? Compares the FEET on the bed, then the
    RIBS level by level up to the shorter one's top: ribs on facing walls of a
    channel reach toward each other and would fuse into a bar that won't snap off."""
    for r in ribs:
        if not r or not r.foot:
            continue
        if seg_dist(rib.foot[0], rib.foot[1], r.foot[0], r.foot[1]) < rib.half_w + r.half_w + SWAY['clearance']:
            return True
        need = (rib.th + r.th) / 2 + SWAY['clearance']
        top = min(rib.height, r.height)
        for L in rib.levels:
            if L['z'] > top:
                break
            a, b = _level_at(r.levels, L['z'])
            if seg_dist(L['a'], L['b'], a, b) < need:
                return True
    return False


def _column_top(p, u):
    """How high the face reaches at `u`."""
    top = -math.inf
    z = max(0.0, p.z0)
    while z <= p.z1 + 1e-6:
        if p.probe(u, p.t_at_z(0, z)) is not None:
            top = z
        z += 2
    return top


def _columns_for(p):
    """Where along a face to stand its ribs: at the TALLEST columns, kept apart.
    Ties go to the ends (edges hide the tine marks)."""
    W = p.u1 - p.u0
    n = max(1, min(SWAY['maxPerFace'], js_round(W / SWAY['pitch'])))
    inset = min(SWAY['endInset'], W / 4)
    a, b = p.u0 + inset, p.u1 - inset
    steps = max(1, min(24, js_round((b - a) / 5)))
    mid = (a + b) / 2
    samples = []
    for k in range(steps + 1):
        u = a + (b - a) * k / steps
        samples.append((u, _column_top(p, u), abs(u - mid)))
    samples.sort(key=lambda s: (-s[1], -s[2]))
    apart = max(SWAY['pitch'] / 2, W / (n + 1))
    cols = []
    for u, top, _ in samples:
        if len(cols) >= n or top == -math.inf:
            break
        if any(abs(c - u) < apart for c in cols):
            continue
        cols.append(u)
    return cols or [mid]


class AutoResult:
    def __init__(self, ribs, skipped, reason):
        self.ribs = ribs
        self.count = len(ribs)
        self.tines = sum(r.tines for r in ribs)
        self.skipped = skipped
        self.reason = reason


def build_sway_braces(part, patches, opts=None, inside=None, avoid=()):
    """AUTO: brace the tallest upright sides of the part, a few faces facing
    different ways so it is held in both directions.

    `patches` are the part's flat faces (Patch objects). `avoid` are braces
    already standing. Returns an AutoResult; `reason` is set when nothing was placed.
    """
    part_top = part.top
    if part_top < SWAY['minPartH']:
        return AutoResult([], 0, 'the part is only %.0f mm tall, too short to sway' % part_top)

    cut = lean_cut()
    cands = []
    for p in patches:
        if (abs(p.n[2]) <= cut
                and p.z1 - max(0.0, p.z0) >= SWAY['minFaceH']
                and p.z1 >= SWAY['minTopFrac'] * part_top):
            score = (p.z1 - max(0.0, p.z0)) * (p.u1 - p.u0)
            cands.append((score, math.atan2(p.n[1], p.n[0]), p))
    cands.sort(key=lambda c: -c[0])
    if not cands:
        return AutoResult([], 0, 'no upright side is tall and flat enough to brace in this orientation')

    sep = math.radians(SWAY['minBearingSep'])

    def ang_gap(a, b):
        d = abs(a - b) % (2 * math.pi)
        return min(d, 2 * math.pi - d)

    faces = []
    for c in cands:
        if len(faces) >= SWAY['maxFaces']:
            break
        if any(ang_gap(f[1], c[1]) < sep for f in faces):
            continue
        faces.append(c)

    ribs = []
    skipped = 0
    for _, _, p in faces:
        for u in _columns_for(p):
            placed = None
            for du in SWAY['nudges']:
                uc = u + du
                if uc < p.u0 or uc > p.u1:
                    continue
                r = build_rib(p, uc, part, opts, inside)
                if r.ok and not clashes(r, ribs) and not clashes(r, avoid):
                    placed = r
                    break
            if placed is None:
                skipped += 1
                continue
            ribs.append(placed)
    reason = None if ribs else 'the upright sides are blocked by other parts of the model in this orientation'
    return AutoResult(ribs, skipped, reason)


def sway_at_face(part, patch, point, opts=None, avoid=(), inside=None):
    """A brace on the face the user clicked, at the spot they clicked.

    `patch` is the clicked face's Patch (None if it couldn't be fitted), `point`
    the click in print space, `avoid` the braces already standing. The brace may
    shift a few mm to clear them, and is refused -- with that reason -- if it can't.
    """
    if patch is None:
        return Rib.refuse('that face is too small or curved to stand a brace against')
    # A brace you clicked is a brace you meant, so auto's stilt limit is advisory
    # here: it builds and reports `stilt` for the command's readout to mention.
    opts = dict(opts or {})
    opts.setdefault('allow_stilt', True)
    u = point[0] * patch.u[0] + point[1] * patch.u[1]
    last = None
    clashed = False
    for du in (0, 2, -2, 4, -4):
        uc = max(patch.u0, min(patch.u1, u + du))
        r = build_rib(patch, uc, part, opts, inside)
        if r.ok and clashes(r, avoid):
            clashed = True
            continue
        if r.ok:
            return r
        last = r
    if clashed:
        return Rib.refuse('it would run into another brace (on the facing wall, or right beside it) '
                          '— click a spot staggered from it')
    return last
