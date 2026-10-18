#! python3
# venv: support-fins
# r: numpy
# r: mini-racer==0.12.4
"""SupportFins: breakaway support fins for the selected part, as it sits on the XY bed.

Runs again on the same part to replace its fins (drawn walls stay). Settings:
SupportFinsSettings. One wall by hand: SupportFinsDraw.
"""
import Rhino
import scriptcontext as sc

# @bootstrap


def RunCommand():
    _lib()
    import supportfins_rhino as sf

    doc = sc.doc
    go = Rhino.Input.Custom.GetObject()
    go.SetCommandPrompt("Select the part to hold up")
    go.GeometryFilter = (Rhino.DocObjects.ObjectType.Brep | Rhino.DocObjects.ObjectType.Extrusion
                         | Rhino.DocObjects.ObjectType.Mesh | Rhino.DocObjects.ObjectType.SubD)
    go.SubObjectSelect = False
    go.Get()
    if go.CommandResult() != Rhino.Commands.Result.Success:
        return go.CommandResult()
    part = sf.part_for(doc, go.Object(0).Object())
    if part is None:
        Rhino.RhinoApp.WriteLine("Support Fins: that fin's part is gone")
        return Rhino.Commands.Result.Failure
    Rhino.RhinoApp.WriteLine("Support Fins: computing...")
    Rhino.RhinoApp.Wait()
    try:
        report = sf.generate(doc, part)
    except Exception as e:     # noqa: BLE001 -- the user's message, not a traceback
        Rhino.RhinoApp.WriteLine(f"Support Fins: {e}")
        return Rhino.Commands.Result.Failure
    doc.Objects.UnselectAll()
    doc.Views.Redraw()
    Rhino.RhinoApp.WriteLine(f"Support Fins: {report}")
    return Rhino.Commands.Result.Success


if __name__ == "__main__":
    RunCommand()
