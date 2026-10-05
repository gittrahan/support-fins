# Support Fins — SolidWorks add-in

A SolidWorks add-in that puts printfins.com supports **in the part** instead of the slicer:
breakaway walls under the overhangs, gripped by one-layer tines, and a bed pad where the part
barely touches the plate, each inserted as its own solid body.

The geometry comes from **the website's engine itself** (`web/*.js`, unmodified, bundled
through [`plugins/shared/`](../shared/README.md) like every other plugin), run by **Microsoft
Edge WebView2**, so at the site's speed (V8 with its JIT), in its own process: SolidWorks never
waits on it. A fix on the site reaches SolidWorks with the next build. Started from
@Haititei's add-in in #183 (ribbon command, reading the part's tessellation, the Y-up frame).

> **Status: experimental, not yet run in SolidWorks.** It builds, its page is tested against
> the engine and in a browser, and nothing it ships is SolidWorks-version specific, but the
> SolidWorks side (registration, ribbon, reading the part, importing the bodies) has not been
> run on a SolidWorks install. Reports welcome.

## Install

Needs SolidWorks on 64-bit Windows, .NET Framework 4.8 (standard on Windows 10/11) and the
[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (part of
Windows 11 and current Windows 10; the add-in says so if it's missing).

1. Download `support-fins-solidworks.zip` from the
   [`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
   release and unzip it somewhere it can stay (SolidWorks loads the add-in from that folder).
2. Right-click `SupportFins\install.bat` › **Run as administrator** (COM registration writes to
   HKEY_LOCAL_MACHINE).
3. Restart SolidWorks. Support Fins is under **Tools › Add-Ins** (loaded at startup) and has
   its own **Support Fins** tab in parts.

`uninstall.bat` (as administrator) removes it; fins already inserted stay in your parts.

## Use

1. Open a part, pose it the way it will print, and click **Support Fins**. A small window
   opens beside SolidWorks and reads the part: every visible solid body.
2. **Print bed** (*Stands on*): *Top Plane (Y up)*, SolidWorks' default, for a part modelled
   standing on the Top Plane; *Front Plane (Z up)* for one modelled Z up; or *Selected face*:
   select the flat face the part stands on, then press **Read part**. Whichever side of the
   face the part is on is up.
3. **Settings**: the website's (material, overhang angle, tines, tine grip, layer height,
   bed pad, sway braces, cutouts, wide-face coverage), built from the same
   [`options.json`](../shared/engine/options.json) every plugin uses. **Layer height must
   match your slicer**: the tines are one layer tall. Settings are remembered.
4. The readout gives the walls and tines, and what to check: overhangs too shallow for a fin
   this way up, pieces that start in mid-air. Click **Insert**.

Each piece goes in as its own imported solid body: *Support Fins wall 1*, *Support Fins sway
brace 1*, *Support Fins bed pad*. Delete any you don't want. The next run skips (and counts)
bodies named *Support Fins…*, so fins never get fins. Export the part and the fin bodies
together (STL/3MF); the tines overlap the part by 0.01 mm and the slicer merges them.

Edited the part? Press **Read part** before **Insert**: the fins are for the part as it was
last read.

## How it runs

```
SupportFins/
  Addin.cs              ISwAddin: COM registration, the ribbon command, the window
  FinsWindow.cs         the window: WebView2 showing page/, answering its messages
  PartReader.cs         visible solid bodies -> triangles (part frame, mm); the selected face
  FinImporter.cs        one STL per piece -> InsertImportedFeature, named; import settings
                        (solid body, mm, no diagnostics) set for the import and put back
  page/index.html, dialog.js, style.css   the dialog: settings, readout, Insert
  page/host.js          bed -> pose -> engine -> back to the part frame -> STL per piece
  page/fins_engine.js   the engine bundle (built, not committed)
  icons/                ribbon icons
tests/host.test.js      host.js against the real engine (deno test)
```

Page and add-in talk in JSON messages (spelled out at the top of `page/dialog.js`): the add-in
sends the part as base64 float64 triangles, the page answers **Insert** with one base64 STL
per piece. The page is served from the add-in folder under a virtual host, so nothing loads
from the network.

SolidWorks' interop assemblies are a compile-time NuGet reference with their types
**embedded** in the DLL: no Dassault DLL ships, and the add-in isn't tied to one SolidWorks
release's interop. (The NuGet packages are third-party repackagings of the interop; they are
used only to compile.)

## Develop

```sh
python3 plugins/solidworks/build.py          # engine bundle into SupportFins/page/
python3 plugins/solidworks/build.py --zip    # + dotnet build -> build/support-fins-solidworks.zip
deno test --allow-read plugins/solidworks/tests/
```

`--dll`/`--zip` need the .NET SDK (8 or later; any OS, the add-in targets .NET Framework 4.8
through reference assemblies). To debug the page, press **F12** in the window for DevTools,
or open `page/index.html` in a browser (without SolidWorks it says so).

Bump `<Version>` in the `.csproj` with each add-in change: the dialog shows it, so you can tell
which build SolidWorks loaded.

## Hand test (SolidWorks)

- [ ] `install.bat` as administrator succeeds; SolidWorks lists Support Fins under Tools › Add-Ins
- [ ] first: Insert one piece (a part with one wall) goes in as a solid body; if every piece fails, InsertImportedFeature doesn't take STLs on this release
- [ ] the Support Fins tab shows in a part, with its icon; the button is greyed out in an assembly
- [ ] the window opens beside SolidWorks; readout gives walls and tines for a part with overhangs
- [ ] Top Plane / Front Plane / Selected face each put the fins under the part as posed
- [ ] Insert adds one *Support Fins…* solid body per piece, in the right place and size (mm and inch parts)
- [ ] a wall with tines is one body (the tines unioned into it), not one body per tine
- [ ] close the window and click Support Fins again: it reopens
- [ ] a curved part at the document's coarse and fine image quality: fins land under the overhangs either way (the mesh is SolidWorks' display tessellation)
- [ ] a second run says the earlier bodies were left alone and doesn't fin them
- [ ] your own STL import settings are as they were afterwards
- [ ] exported with the part, it slices like the website's download
- [ ] `uninstall.bat` removes it
