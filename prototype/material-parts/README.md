# Support material parts: native-slicer control

Generate three small, procedural files in an existing temporary directory:

```sh
deno run -A prototype/material-parts/generate.js --out /existing/temporary/directory
```

The model is a tilted cube united with a flat pedestal and a horizontal ledge,
providing a printable first layer and both sloping and level contacts.
Supports are built at 0.4 mm nozzle / 0.20 mm layers,
with the existing Everywhere interface and optional independent tines. The
unsplit control and separated variants contain the same combined support shape.

1. Open `material-parts-components.3mf` in Bambu Studio or OrcaSlicer, or
   `material-parts-prusa2.3mf` in PrusaSlicer 2. Keep the imported arrangement.
2. Confirm two objects: the model and its supports. Expand the supports: expect
   **support bodies**, **tines** and **top interfaces** as parts of that object.
3. Set a 0.4 mm nozzle, 0.20 mm first/subsequent layers, print by layer, and turn
   native supports off. Use a suitable printer profile and record its settings.
4. Assign different filament slots to the three parts. With two slots, first put
   tines on slot 2; then put only top interfaces on slot 2. Keep the body on slot 1.
5. Slice with normal checks enabled. Inspect the actual filament toolpaths,
   including tines and wall-top contacts. Compare against
   `material-parts-control.3mf`, assigning all parts to one slot for that comparison.
6. Save, reopen and reslice. Confirm part names, placement and assignments persist.

Inspect every assigned role in the per-filament preview. A thin sloping interface
can disappear during slicing even though its mesh is present; separating material
parts does not thicken the existing geometry. The horizontal ledge tests printable
top interfaces independently of that limitation.

Keep generated projects, toolpaths, logs and screenshots outside tracked source.
Record slicer versions and warnings. Software checks establish format and toolpath
behavior; adhesion between materials, stability and removal need a print test.
