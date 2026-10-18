# Support Fins — Rhino 8 plugin (experimental)

printfins.com's breakaway support fins under a part in Rhino 8 (Mac and Windows):
**SupportFins**, pick the part, and each wall, sway brace and the bed pad appears as its
own mesh object on a **Support Fins** layer, ready to export with the part.

Status: **0.1, beta.** Tested in Rhino 8.35 on an Apple-silicon Mac: the smoke test
passes, and the installed `.yak` runs SupportFins. Not yet tried by hand: the
SupportFinsSettings dialog, SupportFinsDraw's clicks, and slicing an export. Windows is
untested. Reports welcome as GitHub issues.

Same engine as the site and every plugin: the part's triangles go to `computeFins` in V8
(mini-racer) through the shared host, `plugins/shared/py/supportfins_host.py`. No fin
geometry lives in the plugin. Rhino 7 isn't supported: its Python (IronPython 2.7)
can't run mini-racer.

## Commands

- **SupportFins** — select a solid, surface, extrusion, SubD or mesh (or one of its
  fins). Fins for the part as it sits: the **bed** is the world XY plane at its lowest
  point, z up. Run it again to replace them (after moving the part or changing a
  setting). The overhangs the fins hold are shown in red, and ones too small to fin in
  amber, on the locked **Support Fins::Overhangs** layer (hide it to get them out of
  the way). The result line (walls, tines, and what wasn't reached) goes to the
  command line.
- **SupportFinsDraw** — one wall by hand, like the site's Draw mode: pick the part,
  then the wall's two ends on its underside. Repeats until Enter. SupportFins leaves
  drawn walls alone.
- **SupportFinsSettings** — the site's settings with the site's defaults and ranges
  (built from `plugins/shared/engine/options.json`; ones the engine would ignore are
  hidden). They're saved in the document, so they travel with the .3dm.

A Brep is meshed the way the site tessellates a STEP (0.01 mm chord, 0.1 rad); a mesh is
used as it is. Any document units work: the part goes to the engine in mm and the fins
come back in the document's units.

Export: select the part and its fins, **File ▸ Export Selected**, .3mf or .stl.

## Install

From a `.yak` file (until it's on the Package Manager): drag it onto Rhino's window, or
`"/Applications/Rhino 8.app/Contents/Resources/bin/yak" install support-fins-rhino-0.1.yak`
(Windows: `"C:\Program Files\Rhino 8\System\Yak.exe" install …`), then restart Rhino.

The first command run takes a minute: Rhino pip-installs numpy and mini-racer into the
plugin's own `support-fins` Python environment (the commands' `# r:` lines). mini-racer
is pinned to 0.12.4, the last release for Rhino 8's Python 3.9 (the other plugins use
0.14.1; the fins are byte-identical on every `tests/fixtures` STL). Later runs
start the engine in under a second.

## Build and test

```
python3 plugins/rhino/build.py                 # stage build/SupportFins/ (+ .yak if Rhino 8 is installed)
python3 -m pytest -q plugins/rhino/tests/      # needs numpy (+ mini-racer==0.12.4 for the engine test)
```

`build.py` stages a Rhino script project (`SupportFins.rhproj`: the three commands, and
`lib/` with the plugin's modules, the shared host, options.json and the engine bundle),
then `rhinocode project build` compiles it into a `.rhp` and a `.yak` (Rhino needn't be
running). CI can't run Rhino, so it tests and stages only.

In Rhino, without installing (run `StartScriptServer` once in Rhino first):

```
RC="/Applications/Rhino 8.app/Contents/Resources/bin/rhinocode"
"$RC" script plugins/rhino/build/SupportFins/commands/SupportFins.py   # one command, from the staged build
"$RC" script plugins/rhino/tests/rhino_smoke.py                       # the smoke test -> build/smoke.json
```

`rhino_smoke.py` opens a new document and checks a tilted box, STL parity with the
engine on the file's own triangles, inch documents, settings, Draw mode and refusals.

## Layout

```
SupportFins/commands/   one script per command (+ `# @bootstrap`, where build.py inlines
                        bootstrap.py: finding lib/ next to the installed plugin)
SupportFins/lib/        supportfins_rhino.py (Rhino calls: mesh the part, add the fins)
                        supportfins_rhino_core.py (no Rhino: settings <-> engine, weld)
tests/                  test_core.py, test_build.py (plain Python); rhino_smoke.py (in Rhino)
```
