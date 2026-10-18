#! python3
# venv: support-fins
# r: numpy
# r: mini-racer==0.14.1
"""Smoke test in the real Rhino 8 (local only; CI can't run Rhino). After build.py,
with Rhino open (run StartScriptServer once in it):

    "/Applications/Rhino 8.app/Contents/Resources/bin/rhinocode" script plugins/rhino/tests/rhino_smoke.py

Works in a new, empty document it opens itself. Results go to
plugins/rhino/build/smoke.json; its last entry says PASS or FAIL. Checks:
  - a tilted box (Brep) gets fins: one object per engine piece, on the Support Fins
    layer, standing on its lowest point (the XY bed), and the same triangles the
    engine gives for the plugin's own soup of it;
  - STL parity: tests/fixtures/bowl.stl imported into Rhino gives the fins the engine
    gives for the file's own triangles (Rhino's mesh path adds nothing);
  - units: the same box in an inch document gives the same fins, in inches;
  - running again replaces the fins (not adds); the overhangs layer is locked;
  - settings saved in the document reach the engine (no tines -> no tines);
  - a drawn wall under the box's overhang; a wall drawn in mid-air says why not;
  - an open surface and a curve are refused with a message, not a traceback.
"""
import json
import os
import sys
import traceback

import Rhino
import scriptcontext as sc

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LIB = os.path.join(HERE, "..", "build", "SupportFins", "lib")
OUT = os.path.join(HERE, "..", "build", "smoke.json")
sys.path.insert(0, LIB)

results, failed = [], []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
    if not ok:
        failed.append(name)
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    json.dump(results, open(OUT, "w"), indent=1)


def tilted_box(doc, deg=50, lift=30.0):
    box = Rhino.Geometry.Box(Rhino.Geometry.Plane.WorldXY, Rhino.Geometry.Interval(0, 40),
                             Rhino.Geometry.Interval(0, 20), Rhino.Geometry.Interval(0, 20)).ToBrep()
    box.Transform(Rhino.Geometry.Transform.Rotation(deg * 3.141592653589793 / 180,
                                                    Rhino.Geometry.Vector3d.XAxis, Rhino.Geometry.Point3d.Origin))
    box.Transform(Rhino.Geometry.Transform.Translation(0, 0, lift))
    return doc.Objects.FindId(doc.Objects.AddBrep(box))


def sorted_tris(t):
    import numpy as np
    t = np.round(np.asarray(t, dtype=np.float64), 6)
    t = np.sort(t.reshape(-1, 3, 3), axis=1).reshape(-1, 9)       # vertex order within a triangle
    return t[np.lexsort(t.T[::-1])]


def mesh_tris(obj, doc):
    import supportfins_rhino as sf
    return sf.mesh_soup(obj.Geometry, 1.0)


def objs_tris(objs, doc):
    import numpy as np
    return np.concatenate([mesh_tris(o, doc) for o in objs]) if objs else np.empty((0, 3, 3))


def read_stl(path):
    import numpy as np
    raw = open(path, "rb").read()
    n = int.from_bytes(raw[80:84], "little")
    rec = np.frombuffer(raw[84:84 + 50 * n], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    return rec["v"].astype(np.float64)


try:
    import numpy as np
    import supportfins_host as host
    import supportfins_rhino as sf

    Rhino.RhinoApp.RunScript("_-New _None", False)
    doc = sc.doc = Rhino.RhinoDoc.ActiveDoc
    doc.AdjustModelUnitSystem(Rhino.UnitSystem.Millimeters, False)

    # ---- a tilted box ----
    box = tilted_box(doc)
    report = sf.generate(doc, box)
    fins = sf.fins_of(doc, box, {"fin"})
    check("box gets fins", len(fins) > 0 and "wall" in report, report)
    check("fins are on the Support Fins layer",
          all(doc.Layers[o.Attributes.LayerIndex].FullPath == sf.LAYER for o in fins))
    soup = sf.part_soup(box, doc)
    want, stats = host.host_compute(sf.ctx(), soup, sf.engine_options(doc))
    got = objs_tris(fins, doc)
    check("fin triangles are the engine's", got.shape == want.shape
          and np.allclose(sorted_tris(got), sorted_tris(want), atol=1e-6), f"{got.shape} vs {want.shape}")
    zmin = soup[..., 2].min()
    check("fins stand on the part's lowest point", abs(got[..., 2].min() - zmin) < 0.05,
          f"fins {got[..., 2].min():.3f}, part {zmin:.3f}")
    over = sf.fins_of(doc, box, {"overhangs"})
    check("overhangs shown on a locked layer", over and doc.Layers[over[0].Attributes.LayerIndex].IsLocked)

    n = len(fins)
    sf.generate(doc, box)
    check("running again replaces the fins", len(sf.fins_of(doc, box, {"fin"})) == n
          and len(sf.fins_of(doc, box, {"overhangs"})) == len(over))

    # ---- settings ----
    values = sf.controls(doc)
    values["tines"] = False
    sf.save_controls(doc, values)
    check("settings saved in the document", sf.controls(doc)["tines"] is False)
    report = sf.generate(doc, box)
    check("settings reach the engine (no tines)", "0 tines" in report, report)
    sf.save_controls(doc, sf.core.defaults(sf.SCHEMA))

    # ---- Draw mode ----
    # across the box's bottom face (z=0 before the tilt), 10 mm in from its low edge
    import math
    c, s_ = math.cos(math.radians(50)), math.sin(math.radians(50))
    under = Rhino.Geometry.Point3d
    a, b = under(5, 10 * c, 30 + 10 * s_), under(35, 10 * c, 30 + 10 * s_)
    wall, info = sf.draw_wall(doc, box, a, b)
    check("a drawn wall under the box", wall is not None, info)
    wall2, why = sf.draw_wall(doc, box, under(100, 100, 50), under(120, 100, 50))
    check("a wall in mid-air says why not", wall2 is None and isinstance(why, str) and why, why)
    sf.generate(doc, box)
    check("SupportFins leaves drawn walls alone", len(sf.fins_of(doc, box, {"drawn"})) == 1)

    # ---- STL parity ----
    stl = os.path.join(REPO, "tests", "fixtures", "bowl.stl")
    before = {o.Id for o in doc.Objects}
    doc.Import(stl)
    imported = [o for o in doc.Objects if o.Id not in before and isinstance(o.Geometry, Rhino.Geometry.Mesh)]
    check("STL imports as one mesh", len(imported) == 1, len(imported))
    part = imported[0]
    sf.generate(doc, part)
    want, _ = host.host_compute(sf.ctx(), read_stl(stl), sf.engine_options(doc))
    got = objs_tris(sf.fins_of(doc, part, {"fin"}), doc)
    check("STL in Rhino gives the file's fins", got.shape == want.shape
          and np.allclose(sorted_tris(got), sorted_tris(want), atol=1e-5), f"{got.shape} vs {want.shape}")

    # ---- units ----
    mm = objs_tris(sf.fins_of(doc, box, {"fin"}), doc)
    doc.AdjustModelUnitSystem(Rhino.UnitSystem.Inches, True)       # scales the box to inches
    sf.generate(doc, box)
    inch = objs_tris(sf.fins_of(doc, box, {"fin"}), doc)
    check("an inch document gives the same fins, in inches", inch.shape == mm.shape
          and np.allclose(sorted_tris(inch * 25.4), sorted_tris(mm), atol=1e-4), f"{inch.shape} vs {mm.shape}")
    doc.AdjustModelUnitSystem(Rhino.UnitSystem.Millimeters, True)

    # ---- refusals ----
    srf = doc.Objects.FindId(doc.Objects.AddSurface(Rhino.Geometry.PlaneSurface(
        Rhino.Geometry.Plane.WorldXY, Rhino.Geometry.Interval(0, 10), Rhino.Geometry.Interval(0, 10))))
    try:
        sf.generate(doc, srf)
        check("an open surface still runs (flat, on the bed: nothing to hold)", True)
    except ValueError as e:
        check("an open surface is refused with a message", str(e), e)
    crv = doc.Objects.FindId(doc.Objects.AddLine(Rhino.Geometry.Point3d(0, 0, 0), Rhino.Geometry.Point3d(1, 1, 1)))
    try:
        sf.generate(doc, crv)
        check("a curve is refused", False)
    except ValueError as e:
        check("a curve is refused with a message", "pick a solid" in str(e), e)
except Exception:          # noqa: BLE001
    check("no crash", False, traceback.format_exc())

results.append({"check": "PASS" if not failed else "FAIL", "ok": not failed, "detail": ", ".join(failed)})
json.dump(results, open(OUT, "w"), indent=1)
print("PASS" if not failed else "FAIL: " + ", ".join(failed))
