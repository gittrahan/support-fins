# Support Fins for FreeCAD: two commands, in a "Support Fins" toolbar and the Tools
# menu of every workbench (no workbench of our own to switch into).
import FreeCAD as App
import FreeCADGui as Gui


class _AddFins:
    def GetResources(self):
        import os
        import supportfins_freecad as sf
        return {"Pixmap": os.path.join(sf.HERE, "Resources", "icons", "SupportFins.svg"),
                "MenuText": "Add Support Fins",
                "ToolTip": "Breakaway support fins for the selected part, from printfins.com's "
                           "engine. They recompute when the part changes."}

    def _sources(self):
        import supportfins_freecad as sf
        out = []
        for o in Gui.Selection.getSelection():
            s = sf.source_for(o)
            if s is not None and s not in out:
                out.append(s)
        return out

    def IsActive(self):
        return App.ActiveDocument is not None and bool(self._sources())

    def Activated(self):
        import supportfins_freecad as sf
        doc = App.ActiveDocument
        doc.openTransaction("Add Support Fins")
        try:
            made = [sf.make(s, doc) for s in self._sources()]
            doc.recompute()
        finally:
            doc.commitTransaction()
        Gui.Selection.clearSelection()
        for m in made:
            Gui.Selection.addSelection(m)


class _UpdateFins:
    def GetResources(self):
        import os
        import supportfins_freecad as sf
        return {"Pixmap": os.path.join(sf.HERE, "Resources", "icons", "SupportFinsUpdate.svg"),
                "MenuText": "Update Support Fins",
                "ToolTip": "Recompute the selected fins now (all fins in the document if none "
                           "are selected), even with Auto update off."}

    def _targets(self):
        import supportfins_freecad as sf
        doc = App.ActiveDocument
        if doc is None:
            return []
        picked = [o for o in Gui.Selection.getSelection() if sf.is_fins(o)]
        return picked or [o for o in doc.Objects if sf.is_fins(o)]

    def IsActive(self):
        return bool(self._targets())

    def Activated(self):
        import supportfins_freecad as sf
        sf.update(self._targets())


Gui.addCommand("SupportFins_Add", _AddFins())
Gui.addCommand("SupportFins_Update", _UpdateFins())


class _Manipulator:
    def modifyMenuBar(self):
        # Tools menu, after Edit parameters
        return [{"append": "SupportFins_Add", "menuItem": "Std_DlgParameter"},
                {"append": "SupportFins_Update", "menuItem": "Std_DlgParameter"}]


Gui.addWorkbenchManipulator(_Manipulator())


def _global_toolbar():
    """A "Support Fins" toolbar in every workbench: a Global custom toolbar, the kind
    Tools > Customize makes (a manipulator can only add to toolbars that exist).
    Made once: if the user deletes it, it stays deleted."""
    mine = App.ParamGet("User parameter:BaseApp/Preferences/Mod/SupportFins")
    if mine.GetBool("ToolbarMade", False):
        return
    bar = App.ParamGet("User parameter:BaseApp/Workbench/Global/Toolbar/SupportFins")
    bar.SetString("Name", "Support Fins")
    bar.SetBool("Active", True)
    bar.SetString("SupportFins_Add", "FreeCAD")
    bar.SetString("SupportFins_Update", "FreeCAD")
    mine.SetBool("ToolbarMade", True)


_global_toolbar()
