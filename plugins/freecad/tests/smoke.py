"""Smoke test in the real FreeCAD (local only; CI can't run FreeCAD). After build.py:

    /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd plugins/freecad/tests/smoke.py

freecadcmd swallows stdout, so results go to plugins/freecad/build/smoke.json; the
last line of that file says PASS or FAIL. Checks:
  - a tilted part gets fins, under it, on its lowest point (the XY bed);
  - the fins follow the part: a length change, a tilt, a PartDesign feature inside a Body;
  - Auto update off keeps the last fins and says they're out of date; Update recomputes;
  - STEP parity: tests/fixtures/bracket.step at X35 gives the site's result exactly
    (site_step.js asks the site's own STEP path; needs deno on the PATH);
  - Mesh and App::Part (placed) sources; settings reach the engine and hide what it ignores;
  - File > Export writes part + fins together (.stl, .3mf);
  - a saved file reopens with working fins; no Source is an error, not a crash.
"""
import json
import os
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON = os.path.join(HERE, "..", "build", "SupportFins")
OUT = os.path.join(HERE, "..", "build", "smoke.json")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ADDON)

import FreeCAD as App  # noqa: E402
import Part  # noqa: E402

results, failed = [], []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": str(detail)})
    if not ok:
        failed.append(name)
    json.dump(results, open(OUT, "w"), indent=1)


def rot_x(deg, at=(0, 0, 0)):
    return App.Placement(App.Vector(*at), App.Rotation(App.Vector(1, 0, 0), deg))


try:
    import supportfins_freecad as sf

    doc = App.newDocument("smoke")
    box = doc.addObject("Part::Box", "Box")
    box.Length, box.Width, box.Height = 40, 20, 20
    box.Placement = rot_x(50, (0, 0, 30))
    fins = sf.make(box)
    doc.recompute()
    first = fins.Report
    bb, pb = fins.Mesh.BoundBox, box.Shape.BoundBox
    check("tilted box gets fins", fins.Mesh.CountFacets > 0 and not first.startswith("0 walls"), first)
    check("fins stand on the part's lowest point (XY bed)", abs(bb.ZMin - pb.ZMin) < 1e-3, (bb.ZMin, pb.ZMin))
    check("fins are under the part", pb.XMin - 20 < (bb.XMin + bb.XMax) / 2 < pb.XMax + 20
          and pb.YMin - 20 < (bb.YMin + bb.YMax) / 2 < pb.YMax + 20, (bb, pb))
    check("report says walls and tines", "wall" in first and "tine" in first, first)

    facets = fins.Mesh.CountFacets
    box.Length = 80
    doc.recompute()
    check("fins follow a length change", fins.Mesh.CountFacets != facets and fins.Mesh.BoundBox.XMax > bb.XMax + 20,
          (facets, fins.Mesh.CountFacets, fins.Report))
    box.Placement = rot_x(30, (0, 0, 30))
    doc.recompute()
    check("fins follow a tilt", fins.Report != "" and fins.Mesh.CountFacets > 0, fins.Report)

    # Auto update off: keeps the last fins, says so; Update recomputes
    fins.AutoUpdate = False
    doc.recompute()
    kept = fins.Mesh.CountFacets
    box.Length = 40
    doc.recompute()
    check("auto update off keeps the last fins", fins.Mesh.CountFacets == kept, (kept, fins.Mesh.CountFacets))
    check("auto update off says out of date", fins.Report.startswith(sf.OUT_OF_DATE), fins.Report)
    sf.update([fins])
    check("Update recomputes with auto update off",
          fins.Mesh.CountFacets != kept and not fins.Report.startswith(sf.OUT_OF_DATE), fins.Report)
    fins.AutoUpdate = True

    # settings reach the engine; the ones it ignores are hidden
    fins.Tines = False
    doc.recompute()
    check("Tines off: plain walls, no tines", ", 0 tines" in fins.Report and not fins.Report.startswith("0 walls"),
          fins.Report)
    check("Tines off hides Tine grip", "Hidden" in fins.getEditorMode("TineGrip"), fins.getEditorMode("TineGrip"))
    check("Sway braces off hides Brace depth", "Hidden" in fins.getEditorMode("BraceDepth"),
          fins.getEditorMode("BraceDepth"))
    fins.Tines = True
    fins.BedPad = "Off"
    doc.recompute()
    with_pad = fins.Mesh.CountFacets
    fins.BedPad = "Sure hold"
    doc.recompute()
    check("Bed pad setting reaches the engine", fins.Mesh.CountFacets > with_pad, (with_pad, fins.Mesh.CountFacets))
    fins.BedPad = "Auto"
    doc.recompute()

    # STEP parity with the site (web/step.js path: 2 walls, 8 tines, 1 not reached)
    step = doc.addObject("Part::Feature", "Bracket")
    step.Shape = Part.read(os.path.join(REPO, "tests", "fixtures", "bracket.step"))
    step.Placement = rot_x(35, (200, 0, 0))
    sfin = sf.make(step)
    doc.recompute()
    import shutil
    import subprocess
    deno = shutil.which("deno") or os.path.expanduser("~/.deno/bin/deno")
    if os.path.exists(deno):
        want = subprocess.run([deno, "run", "-A", os.path.join(HERE, "site_step.js"),
                               os.path.join(REPO, "tests", "fixtures", "bracket.step"), "35"],
                              capture_output=True, text=True, check=True).stdout.strip()
        check("bracket.step @X35 = the site's result", sfin.Report == want, (sfin.Report, want))
    else:
        check("bracket.step @X35 = the site's result (SKIPPED: no deno)", True)

    # PartDesign: picking a feature means its Body, and the fins follow the feature
    body = doc.addObject("PartDesign::Body", "Body")
    abox = doc.addObject("PartDesign::AdditiveBox", "AdditiveBox")
    body.addObject(abox)
    abox.Length, abox.Width, abox.Height = 40, 20, 20
    body.Placement = rot_x(50, (0, 200, 30))
    doc.recompute()
    check("a PartDesign feature selects its Body", sf.source_for(abox) is body, sf.source_for(abox))
    bfin = sf.make(sf.source_for(abox))
    doc.recompute()
    b1 = bfin.Mesh.BoundBox.XMax
    abox.Length = 80
    doc.recompute()
    check("Body fins follow a feature edit", bfin.Mesh.BoundBox.XMax > b1 + 20, (b1, bfin.Mesh.BoundBox.XMax))
    check("Body fins report walls", "wall" in bfin.Report, bfin.Report)

    # a Mesh source gives the same result as the solid it came from
    import Mesh
    import MeshPart
    msrc = doc.addObject("Mesh::Feature", "BoxMesh")
    shp = box.Shape.copy()
    msrc.Mesh = MeshPart.meshFromShape(Shape=shp, LinearDeflection=0.01, AngularDeflection=0.1, Relative=False)
    mfin = sf.make(msrc)
    doc.recompute()
    check("Mesh source = the solid's result", mfin.Report == fins.Report, (mfin.Report, fins.Report))

    # inside a placed App::Part: fins land under the part where it really is
    container = doc.addObject("App::Part", "Assembly")
    inner = doc.addObject("Part::Box", "InnerBox")
    inner.Length, inner.Width, inner.Height = 40, 20, 20
    inner.Placement = rot_x(50, (0, 0, 30))
    container.addObject(inner)
    container.Placement = App.Placement(App.Vector(400, 0, 0), App.Rotation())
    ifin = sf.make(inner)
    doc.recompute()
    ib = ifin.Mesh.BoundBox
    check("App::Part placement is applied", 380 < (ib.XMin + ib.XMax) / 2 < 460, ib)
    check("placed part = same fins as unplaced", ifin.Report == mfin.Report, (ifin.Report, mfin.Report))

    # no Source: an error on the object, not a crash
    orphan = doc.addObject("Mesh::FeaturePython", "Orphan")
    sf.SupportFins(orphan)
    doc.recompute()
    check("no Source is an error state", "Invalid" in orphan.State or "Error" in str(orphan.State), orphan.State)
    doc.removeObject("Orphan")

    # File > Export of the part and its fins together (FreeCAD's own mesh export)
    for ext in ("stl", "3mf"):
        tmp = os.path.join(tempfile.mkdtemp(), "both." + ext)
        Mesh.export([box, fins], tmp)
        back = Mesh.Mesh(tmp)
        check(f"export part + fins as .{ext}", back.CountFacets > fins.Mesh.CountFacets,
              (back.CountFacets, fins.Mesh.CountFacets))

    # save and reopen
    path = os.path.join(tempfile.mkdtemp(), "smoke.FCStd")
    name = fins.Name
    doc.saveAs(path)
    App.closeDocument(doc.Name)
    doc2 = App.openDocument(path)
    f2 = doc2.getObject(name)
    f2.Source.Length = 60
    doc2.recompute()
    check("reopened file: fins are a SupportFins", sf.is_fins(f2), getattr(f2, "Proxy", None))
    check("reopened file: fins still recompute", f2.Mesh.CountFacets > 0 and "wall" in f2.Report, f2.Report)
except Exception:
    check("no exception", False, traceback.format_exc())

results.append("FAIL: " + ", ".join(failed) if failed else "PASS")
json.dump(results, open(OUT, "w"), indent=1)
os._exit(1 if failed else 0)
