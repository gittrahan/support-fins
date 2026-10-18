#! python3
# venv: support-fins
# r: numpy
# r: mini-racer==0.14.1
"""SupportFinsSettings: the site's settings, saved in this document. Built from
options.json: the site's labels, defaults and ranges; ones the engine would ignore
are hidden, as on the site. OK keeps them for the next SupportFins / SupportFinsDraw
(existing fins aren't rebuilt until SupportFins runs again).
"""
import Eto.Drawing as drawing
import Eto.Forms as forms
import Rhino
import Rhino.UI
import scriptcontext as sc

# @bootstrap


class SettingsDialog(forms.Dialog[bool]):
    def __init__(self, sf, core, values):
        super().__init__()
        self.sf, self.values = sf, dict(values)
        self.Title = "Support Fins settings"
        self.Padding = drawing.Padding(10)
        self.Resizable = False
        self.rows = {}           # key -> (label, control)
        layout = forms.DynamicLayout()
        layout.Spacing = drawing.Size(6, 4)
        for section, specs in core.sections(sf.SCHEMA):
            head = forms.Label()
            head.Text = section
            head.Font = drawing.Font(head.Font.Family, head.Font.Size, drawing.FontStyle.Bold)
            layout.AddRow(head)
            for s in specs:
                label = forms.Label()
                label.Text = s["label"]
                label.ToolTip = s["tooltip"]
                control = self._control(s)
                control.ToolTip = s["tooltip"]
                self.rows[s["key"]] = (label, control)
                layout.AddRow(label, control)
        ok, cancel = forms.Button(), forms.Button()
        ok.Text, cancel.Text = "OK", "Cancel"
        ok.Click += lambda *_: self.Close(True)
        cancel.Click += lambda *_: self.Close(False)
        self.DefaultButton, self.AbortButton = ok, cancel
        reset = forms.Button()
        reset.Text = "Site defaults"
        reset.Click += self._reset
        layout.AddRow(None)
        layout.AddSeparateRow(reset, None, cancel, ok)
        self.Content = layout
        self._show_relevant()

    def _control(self, s):
        key = s["key"]
        if s["kind"] == "bool":
            c = forms.CheckBox()
            c.Checked = bool(self.values[key])
            c.CheckedChanged += lambda *_: self._set(key, bool(c.Checked))
        elif s["kind"] == "choice":
            c = forms.DropDown()
            for _, text in s["choices"]:
                c.Items.Add(text)
            values = [v for v, _ in s["choices"]]
            c.SelectedIndex = values.index(self.values[key])
            c.SelectedIndexChanged += lambda *_: self._set(key, values[c.SelectedIndex])
        else:
            c = forms.NumericStepper()
            c.MinValue, c.MaxValue = s["min"], s["max"]
            c.Increment, c.DecimalPlaces = s["step"], s["decimals"]
            c.Value = float(self.values[key])
            c.ValueChanged += lambda *_: self._set(key, float(c.Value))
        return c

    def _set(self, key, value):
        self.values[key] = value
        self._show_relevant()

    def _reset(self, *_):
        import supportfins_rhino_core as core
        self.values = core.defaults(self.sf.SCHEMA)
        for s in core.specs(self.sf.SCHEMA):
            c, v = self.rows[s["key"]][1], self.values[s["key"]]
            if s["kind"] == "bool":
                c.Checked = v
            elif s["kind"] == "choice":
                c.SelectedIndex = [x for x, _ in s["choices"]].index(v)
            else:
                c.Value = v
        self._show_relevant()

    def _show_relevant(self):
        for key, (label, control) in self.rows.items():
            shown = self.sf.visible(key, self.values)
            label.Visible = control.Visible = shown


def RunCommand():
    _lib()
    import supportfins_rhino as sf
    import supportfins_rhino_core as core

    doc = sc.doc
    dialog = SettingsDialog(sf, core, sf.controls(doc))
    if not dialog.ShowModal(Rhino.UI.RhinoEtoApp.MainWindow):
        return Rhino.Commands.Result.Cancel
    try:
        sf.engine_options(doc, dialog.values)       # the engine refuses a bad value here
    except ValueError as e:
        Rhino.RhinoApp.WriteLine(f"Support Fins: {e}")
        return Rhino.Commands.Result.Failure
    sf.save_controls(doc, dialog.values)
    Rhino.RhinoApp.WriteLine("Support Fins: settings saved in this document; run SupportFins to rebuild fins")
    return Rhino.Commands.Result.Success


if __name__ == "__main__":
    RunCommand()
