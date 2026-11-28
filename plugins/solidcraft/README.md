# Support Fins — SolidCraft plugin

printfins.com's breakaway support fins as an export in [SolidCraft](https://solidcraft.io):
**File ▸ Export ▸ Support Fins 3MF** (or **STL**) writes the part with its fins baked in,
posed and seated on the plate the way the site exports it, ready for any slicer.

Same engine as the site and every plugin: `computeFins` from `plugins/shared/engine`, with
the website's `web/*.js` untouched, and the site's own 3MF and STL writers. For the same
mesh, pose and settings the file is the command line's (`plugins/cli`), byte for byte:
`tests/export.test.js` holds it to that.

## Use

- **File ▸ Export ▸ Support Fins 3MF (.3mf)…** or **Support Fins STL (.stl)…**, or the Model
  tab's **Support Fins** button (Plugins group), which drops down to `export-3mf` and
  `export-stl`: SolidCraft names a plugin's entries as their manifest does, in lowercase. The
  form comes first, then where to save.
- **Bodies**: pick them in the view, or leave it empty for every visible body. They are
  finned as one part. Bodies in placed components (an inserted STL is one) are taken where
  the design shows them, every copy of a component placed twice.
- **Rotate X / Y / Z**: the pose the part prints in, as printfins.com's X · Y · Z readout
  (X first, then Y, then Z), so a pose found on the site carries over. The design is not
  changed: the file is written in that pose, centred over the plate origin and on z = 0.
- **Fins only** (STL): the fins alone, lined up with the part where it is in the design, to
  load as a second part beside a part you export yourself (the command line's
  `--fins-only`). It takes no rotation.
- **Every setting the site has** follows, in the site's sections, with the site's defaults
  and ranges (written from `plugins/shared/engine/options.json`, named as the command
  line's flags, percent sliders 0–100). A setting the site hides is hidden here too.
- What was placed ("5 walls, 25 tines") goes to the export's log; anything left
  unsupported is reported, not an error.

The export never changes the design: SolidCraft runs it on a copy and writes the file only
when the whole export succeeded.

## Install

Download `support-fins-solidcraft.zip` (the `plugins-latest` release), then in SolidCraft
**Preferences ▸ Plugins ▸ Install plugin…** and pick it. The install screen shows what the
plugin asks for: no files, no folders, no network, no command that changes a design (it
reads the design with `document.inspect`, `model.mesh` and `component.list`), and more
memory and fuel than SolidCraft's defaults (below). **Install** allows them.

From a checkout: `python3 plugins/solidcraft/build.py`, then install
`plugins/solidcraft/build/support-fins-solidcraft.zip`.

## Limits

- **Time.** SolidCraft gives plugins no JIT: the engine runs in QuickJS inside the
  sandbox, about twice as slow as without a JIT in V8 and several times slower than in a
  browser. On SolidCraft 0.50 (x86-64): the stress models' `lbracket` at Y 40° in 1.6 s,
  `staircase` at X 40° (46,000 fin triangles) in about 5 s, and a 10,444-triangle duct
  with about 120 walls in about three minutes (25 s in the browser). Exporters may run for
  10 minutes.
- **The first export after installing** (or updating) runs on Wasmtime's baseline
  compiler, about half as fast, while SolidCraft compiles the optimized code in the
  background; it keeps that code for later exports and sessions.
- **Fuel and memory.** The manifest asks for 10¹³ fuel and 512 MiB, over SolidCraft's
  default ceilings (10¹¹ and 128 MiB), so the install asks to allow them. 10¹³ is the most
  Install can allow: the 10-minute deadline is the real limit (the duct needs about
  3·10¹²).
- **Same fins as the site.** QuickJS's own `Math.hypot` rounds differently from V8's in the
  last bit, and the engine turns a last bit into another tine
  (`plugins/shared/ENGINE-SENSITIVITY.md`). The component puts V8's algorithm in its place
  (`component/src/lib.rs`), so its fins are the ones Chrome, the command line and the
  other plugins (all V8) make.
- **Mesh density.** `model.mesh` hands a plugin at most 16,384 triangles per body (1 MiB of
  JSON). A denser body is read again at a coarser chord (0.05 mm, then 0.1, 0.2, … 2 mm) and
  the log says which. The part in the file is that mesh too; for a dense part at full
  quality, export it with SolidCraft's own STL and add **Fins only**.

## Why an export, not fins in the model

The other CAD plugins add the fins to the model. A SolidCraft command plugin can't do that
in one step: its file writes are staged until the run ends, and `file.insert_mesh` reads the
file where it will be, so a mesh written and inserted in one run is not there yet (checked
on SolidCraft 0.50). An export slot needs nothing of that: no folder, no permission, one
step, and the file is what goes to the slicer anyway.

## Build

```
python3 plugins/solidcraft/build.py           # build/support-fins/ (the package) + build/support-fins-solidcraft.zip
python3 plugins/solidcraft/build.py --test    # + solidcraft-cli plugin check and plugin test
```

Needs Node 20.10+ (npx fetches the pinned esbuild, as for every plugin), Rust with the
`wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`), clang and
llvm-ar (QuickJS is C), and `wasm-tools` (`cargo install wasm-tools`). `--test` runs
SolidCraft's own checks and the package's cases (`tests/cases`) on the real host, with its
real limits: `solidcraft-cli` comes with SolidCraft.

```
deno test -A plugins/solidcraft/tests/        # the export path against the command line, and the manifest
cargo run --release --manifest-path plugins/solidcraft/component/Cargo.toml --bin harness -- MESH.json
```

The harness runs the component's code natively with a stand-in for SolidCraft (a
`model.mesh` reply as MESH.json), to time the engine path without the app.

## Code

- `src/export.js` — what an export does: read the bodies (`model.mesh`, placed by
  `component.list`), pose them, `computeFins`, write the 3MF or STL. SolidCraft is reached
  only through a `host` object, so the tests run it with a stand-in.
- `src/manifest.js` — plugin.json, with both export forms written from options.json
  (shared `$defs`, `x-solidcraft-visible-when` from `showIf`).
- `src/fields.js` — the forms' field names: the command line's flags.
- `src/quickjs.js` — the bundle's entry: export.js with a host made of the component's
  functions; `src/polyfills.js` — TextEncoder, TextDecoder and Blob for a bare engine.
- `component/` — the Rust crate: QuickJS (rquickjs) runs the bundle behind SolidCraft's
  `exporter-plugin` world; deflate for the 3MF from miniz_oxide.
- `wit/plugin.wit` — SolidCraft's plugin interface (`craft:plugin@0.2.0`), copied unchanged
  from SolidCraft 0.50's `crates/craft-plugin/wit/plugin.wit` as its plugin guide asks
  (SolidCraft is Apache-2.0; 0.51's interface is the same).
- `icons/support-fins.svg` — the button's and the forms' icon: `plugins/onshape/supportFins-icon.svg`
  redrawn in SolidCraft's icon SVG subset (64 × 64, absolute paths, `currentColor`).
- `tests/cases/` — `solidcraft-cli plugin test` cases and their designs.
