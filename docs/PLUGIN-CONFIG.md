# Plugin settings

Every plugin takes the settings printfins.com has, with the same names, values and
defaults. They all come from one file,
[`plugins/shared/engine/options.json`](../plugins/shared/engine/options.json). The
tables at the bottom of this page are generated from it.

## Where the settings go

| Plugin | How you set them |
|---|---|
| Cura, Fusion, FreeCAD, Blender, Rhino, SolidWorks | the plugin's dialog, built from the same list (no file to edit) |
| OrcaSlicer | the plugin config: a JSON object, see [Orca](#orcaslicer) |
| Command line | flags, e.g. `--mode full --gap 0.3`; `support-fins --help` lists them all |
| MCP server | the `settings` object, named as the CLI's flags without `--` (`"tine-density": 40`) |
| Onshape | its own dialog: a port, not the shared engine, so not every setting below exists there |
| PrusaSlicer | hand-placed fins only (Add a Fin); for Auto or Full coverage use the site or the command line |

## Units: percent settings

Wide-face coverage, Tine grip and Brace depth are percent sliders on the site (0-100).
In a **JSON config** (Orca) they are that value / 100, so the site's 70 % coverage is
`"coverage": 0.7`. On the **command line** and in **MCP** settings they are typed as the
site shows them: `--coverage 70`.

Everything else is in the same units everywhere: millimetres, degrees, `true`/`false`.
Leave a setting out to get the site's default.

## OrcaSlicer

The plugin config is one JSON object. It holds two keys of the plugin's own, and any
setting from the tables below by its **JSON key**:

- `enabled`: `true` / `false`. Off = the plugin does nothing.
- `apply_to`: `"no-supports"` (default) fins only the parts with Orca's own Enable
  support off; `"all"` fins every part.

Layer height and nozzle always come from Orca's own settings, so `layerHeight` and
`nozzle` are refused there. A key the engine doesn't know, or a value out of range,
fails the slice with a message that names it (`unknown dialog option sway`), rather
than printing default fins. Older configs' `tine_density` and `bed_pad: false` still
work.

Full coverage, every part:

```json
{"enabled": true, "apply_to": "all", "mode": "full"}
```

Auto with denser wide faces, firmer tines, a sure-hold bed pad and sway braces:

```json
{
  "enabled": true,
  "apply_to": "all",
  "mode": "auto",
  "coverage": 1,
  "tineDensity": 0.5,
  "padStyle": "sure",
  "sway.on": true,
  "cutout": "diamond"
}
```

PETG (a wider gap), plate-only walls, no tines:

```json
{"enabled": true, "gap": 0.3, "plateOnly": true, "tines": false}
```

A few things that look right but aren't:

| Written | Use instead |
|---|---|
| `"sway": true` | `"sway.on": true` (the key has the dot in it) |
| `"cutout": {"label": "Diamond", "value": "diamond"}` | `"cutout": "diamond"` (choices are the plain value) |
| `"tineDensity": 5` | `"tineDensity": 0.05` (percent settings are / 100) |
| `"mode": "Full coverage"` | `"mode": "full"` (the value, not the label) |

## All settings

<!-- BEGIN options.json (plugins/shared/options_doc.js writes this block) -->

### Placement

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Placement mode | `mode` | `auto`, `full` | `auto` | `--mode` |

- **Placement mode** (`mode`): Auto: a tined wall under each overhang steep and flat enough to grip, a plain breakaway wall under the shallow ones. Full coverage: Auto, then walls under every overhang Auto left bare -- more walls and plastic, every reachable overhang held. Wide roofs and flat shelves usually need Full coverage.

### Setup

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Overhang | `threshold` | 30 to 70 | `45` | `--threshold` |
| Nozzle | `nozzle` | `0.2`, `0.25`, `0.4`, `0.6`, `0.8`, `1.0`, `1.2`, `1.4`, `1.6`, `1.8`, `2.0` | `0.4` | `--nozzle` |

- **Overhang** (`threshold`): Surface angle from the plate below which a face needs support.
- **Nozzle** (`nozzle`): Your printer's nozzle diameter. Sizes support walls, contact tips and tines using the website's nozzle scaling. Set it to the nozzle used to print the fins; layer height and support gap are separate settings. Default 0.4mm. Slicer plugins take this from the slicer's own settings; leave it out of their config.

### Tines

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Tines | `tines` | `true` / `false` | `true` | `--no-tines` |
| Tine grip | `tineDensity` | 0 to 1 | `0` | `--tine-density` |
| Direction | `tineDir` | `horizontal`, `vertical` | `horizontal` | `--tine-dir` |
| Pin depth | `pinDepth` | 0.05 to 1 | `0.1` | `--pin-depth` |
| Layer height | `layerHeight` | 0.08 to 0.6 | `0.2` | `--layer-height` |

- **Tines** (`tines`): Tines fuse the support to the part so it grips instead of just propping. Off = plain breakaway wall.
- **Tine grip** (`tineDensity`): How tightly to space the grip tines. Light = fewest marks (default), a per-wall floor keeps grip; Firm = dense comb / max grip for a tippy or tall part. A percent: the site and the CLI show 0-100, a JSON config holds that / 100. Only used when Tines is on.
- **Direction** (`tineDir`): Horizontal: one-layer tines that grip the part and snap off clean (FDM). Vertical: pins that stand up from each wall into the part, like a resin slicer's contact tips, for resin printers, where every support has to be attached. Only used when Tines is on.
- **Pin depth** (`pinDepth`): How far each pin sinks into the part, like a resin slicer's contact depth. Resin slicers sink a tip 0-0.2 mm; deeper leaves a bigger mark and is harder to snap off. Default 0.1 mm. Only used when Tines is on and Direction is Vertical (resin).
- **Layer height** (`layerHeight`): Set this to the layer height you slice at. The grip tines are one layer tall so they snap off clean; if this doesn't match your slicer, the tines tear and leave marks. Default 0.2mm. Only used when Tines is on, or Bed pad is Light or Auto. Slicer plugins take this from the slicer's own settings; leave it out of their config.

### Clearances

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Support gap | `gap` | 0.1 to 0.4 | `0.2` | `--gap` |
| Bed pad | `padStyle` | `off`, `auto`, `light`, `sure` | `auto` | `--pad-style` |

- **Support gap** (`gap`): Clearance between a support top and the part. Bigger = cleaner surface / easier removal; too big stops holding the overhang. Default 0.2mm.
- **Bed pad** (`padStyle`): A tilted part rests on an edge and peels off the plate without a pad. Auto: Light, or Sure hold when the part meets the plate on a point or a small round foot. Light: one layer, 0.12mm off the part, peels off like a brim. Sure hold: thicker and tacked into the part, holds harder but is harder to remove.

### Sway braces

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Sway braces | `sway.on` | `true` / `false` | `false` | `--sway` |
| Brace grip from | `sway.gripFrom` | 0 to 2000 | `0` | `--sway-grip-from` |
| Brace tine spacing | `sway.tineSpacing` | 2 to 30 | `6` | `--sway-tine-spacing` |
| Brace depth | `sway.reach` | 0.05 to 0.5 | `0.15` | `--sway-reach` |

- **Sway braces** (`sway.on`): Stand tapered buttress ribs against the upright sides of a tall part, tied on with tines all the way up, so it doesn't drift or wobble as it grows.
- **Brace grip from** (`sway.gripFrom`): Height the brace tines start at. 0 = grip the whole height; raise it to tie on only above where the part starts to move. Only used when Sway braces is on and Tines is on.
- **Brace tine spacing** (`sway.tineSpacing`): Vertical distance between brace tines. Smaller = held tighter, more marks on the side. Default 6mm. Only used when Sway braces is on and Tines is on.
- **Brace depth** (`sway.reach`): How far the brace reaches out at the bed, as a share of its height. Deeper = stiffer, more plastic. Default 15%. A percent: the site and the CLI show 5-50, a JSON config holds that / 100. Only used when Sway braces is on.

### Walls

| Setting | JSON key | Values (JSON) | Default | CLI flag |
|---|---|---|---|---|
| Cutouts | `cutout` | `none`, `diamond`, `triangle`, `arch`, `lattice`, `honeycomb` | `none` | `--cutout` |
| Wide-face coverage | `coverage` | 0 to 1 | `0.5` | `--coverage` |
| Plate only | `plateOnly` | `true` / `false` | `false` | `--plate-only` |
| Separate walls | `separateWalls` | `auto`, `on`, `off` | `auto` | `--separate-walls` |
| Long walls | `longWalls` | `true` / `false` | `true` | `--no-long-walls` |

- **Cutouts** (`cutout`): Cut holes through tall breakaway walls to save filament. The top edge that holds the part, the foot, and the wall's ends stay solid, and every hole has a pointed roof so it prints without bridging. Short walls stay solid.
- **Wide-face coverage** (`coverage`): How densely to line a WIDE overhang face with fins. The middle is the anti-sag default; drag LEFT for fewer fins (a small part can go down to one — the readout warns if a broad face then risks sagging), RIGHT for more support. Narrow parts are unaffected. A percent: the site and the CLI show 0-100, a JSON config holds that / 100. Only used when Placement mode is Auto.
- **Plate only** (`plateOnly`): Stand every support on the build plate, never on the part itself. An overhang with part under it is left unsupported, and the readout says how many.
- **Separate walls** (`separateWalls`): Keep Full coverage fill walls from crossing other walls or sharing their bases: a resin print cures joined walls into one block that won't break away. Auto turns it on for Vertical (resin) tines and off for Horizontal (FDM), as the site does. Can leave more overhang unsupported; thin ties between tall walls stay, since they snap. Only used when Placement mode is Full coverage.
- **Long walls** (`longWalls`): Full coverage lays rows of long walls along the part's length first, the way you'd draw them by hand, then fills what they miss. Holds more of the overhang and uses more plastic. Untick for short walls under each overhang patch. Only used when Placement mode is Full coverage.

<!-- END options.json -->
