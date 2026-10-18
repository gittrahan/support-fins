#! python3
# venv: support-fins
# r: numpy
# r: mini-racer==0.14.1
"""SupportFinsDraw: one wall by hand, as on the site's Draw mode. Pick the part, then
the wall's two ends on its underside; the wall stands from the bed up to that line.
Repeats until Enter / Esc. SupportFins leaves drawn walls alone; delete one like any
object.
"""
import Rhino
import scriptcontext as sc

# @bootstrap


def _pick_end(prompt, mesh, start=None):
    gp = Rhino.Input.Custom.GetPoint()
    gp.SetCommandPrompt(prompt)
    gp.Constrain(mesh, False)          # on the part, where the wall meets it
    if start is not None:
        gp.SetBasePoint(start, True)
        gp.DrawLineFromPoint(start, True)
    gp.AcceptNothing(True)
    gp.Get()
    return gp.Point() if gp.CommandResult() == Rhino.Commands.Result.Success and gp.Result() == Rhino.Input.GetResult.Point else None


def RunCommand():
    _lib()
    import supportfins_rhino as sf

    doc = sc.doc
    go = Rhino.Input.Custom.GetObject()
    go.SetCommandPrompt("Select the part to draw a wall under")
    go.GeometryFilter = (Rhino.DocObjects.ObjectType.Brep | Rhino.DocObjects.ObjectType.Extrusion
                         | Rhino.DocObjects.ObjectType.Mesh | Rhino.DocObjects.ObjectType.SubD)
    go.Get()
    if go.CommandResult() != Rhino.Commands.Result.Success:
        return go.CommandResult()
    part = sf.part_for(doc, go.Object(0).Object())
    if part is None:
        Rhino.RhinoApp.WriteLine("Support Fins: that fin's part is gone")
        return Rhino.Commands.Result.Failure
    doc.Objects.UnselectAll()
    try:
        mesh = sf.part_mesh(part, doc)
    except Exception as e:     # noqa: BLE001
        Rhino.RhinoApp.WriteLine(f"Support Fins: {e}")
        return Rhino.Commands.Result.Failure
    drawn = 0
    while True:
        a = _pick_end("First end of the wall (on the part's underside; Enter to finish)", mesh)
        if a is None:
            break
        b = _pick_end("Other end of the wall", mesh, a)
        if b is None:
            break
        try:
            wall, info = sf.draw_wall(doc, part, a, b)
        except Exception as e:     # noqa: BLE001
            Rhino.RhinoApp.WriteLine(f"Support Fins: {e}")
            return Rhino.Commands.Result.Failure
        Rhino.RhinoApp.WriteLine(f"Support Fins: {info}" if wall else f"Support Fins: no wall there: {info}")
        drawn += wall is not None
        doc.Views.Redraw()
    return Rhino.Commands.Result.Success if drawn else Rhino.Commands.Result.Nothing


if __name__ == "__main__":
    RunCommand()
