# Pinned macOS preview: recorded results

Reference: `d4da6e4d0efd6dc490e02147741a756a2ed98143` plus the compilation-only
application patch described in [README.md](README.md). The native test binary
also uses the separately recorded test API patch; no assertions were changed.
Build identity, patch checksums, per-case settings/project hashes, slice times,
memory measurements and G-code hashes are in [validation-macos.json](validation-macos.json).

These are software results recorded on 2026-11-05. **GUI review, GUI save/reload
and physical printing remain incomplete.** The pack is not fully validated.
Successful CLI slicing does not establish contact quality, plate connectivity,
clearance, adhesion or removability. Native CLI save/reload checks are complete.

## Serial repeated slices

H2C, Bambu PETG Basic, 0.4 mm, 0.20 mm first/subsequent layers, Painted Shape,
print-by-layer, one filament slot and no rafts. Engineering Plate was selected
explicitly because the preview's Cool Plate default rejects PETG. Both bed
temperatures come from the pinned PETG profile (70°C).

| Case | Two-run observation | Classification |
| --- | --- | --- |
| flat | 1,075 support extrusion moves; Z 0.2–48.4 mm | Repeatable support output; visual acceptance pending |
| convex | 1,057 moves; Z 0.2–48.4 mm | Repeatable support output; visual acceptance pending |
| concave | 1,063 moves; Z 0.2–48.6 mm | Repeatable support output; visual acceptance pending |
| leaning | 1,051 moves; Z 0.2–48.4 mm | Repeatable support output; visual acceptance pending |
| crease | 1,095 moves; Z 0.2–48.0 mm | Repeatable support output; visual acceptance pending |
| opposing | Native exit 155 in both runs; conflict between `obstacle` and `opposing` | Reproducible native collision finding |
| six unpainted controls | All slice twice, with zero support extrusion moves | Painting requirement controls pass |
| transformed convex | 1,177 moves; Z 0.2–48.4 mm | Placement/paint round-trip and repeated slicing pass; visual acceptance pending |

All 12 successful projects produce matching G-code after excluding **only**
the generation-date comment. Counts are diagnostic; they are not fin counts or
a requirement for rotationally identical toolpaths. All 13 projects preserve
the native mesh/paint inspection results and complete resolved settings through
CLI export/reload. The 24 successful slices took 1.63–3.26 seconds each; maximum
recorded child-process RSS was 202,076,160 bytes. Timings are observations on a
shared host, not benchmarks.

## Reduced collision reproduction

`obstacleReproduction()` in [fixtures.js](fixtures.js) reduces the failing case
to two closed bodies, 96 triangles and one +X painted island (two triangles).
The bodies have a 3 mm nominal gap. Both reduced painted runs exit 155 and log
`gcode path conflicts found between obstacle and painted-body`. The otherwise
identical unpainted control slices successfully twice. Keep collision checks
enabled. The result isolates a paint-dependent failure; it does not yet locate
the offending extrusions or replace native preview screenshots.

After the normal runner has resolved the pinned settings, generate the reduction
from the repository root (choose an ignored output directory):

```sh
deno eval '
import { obstacleReproduction } from "./prototype/native-orca/fixtures.js";
import { archive } from "./prototype/native-orca/pack.js";
const [settingsFile, out] = Deno.args;
const settings = JSON.parse(await Deno.readTextFile(settingsFile));
await Deno.mkdir(out, { recursive: true });
for (const unpainted of [false, true]) {
  const f = obstacleReproduction({ unpainted });
  await Deno.writeFile(`${out}/${f.id}.3mf`, await archive(f, { settings }));
}
' "$workspace/out/run-1/settings/resolved.json" "$workspace/out/obstacle-reduction"
```

Use the same offline sandbox wrapper and native executable for each reduced
input, passing `--arrange 0 --orient 0 --slice 0 --outputdir <new-directory>
--export-3mf sliced.3mf <input>`. Run twice into separate directories. With
`--outputdir`, the preview expects a relative export filename.

## Native unit tests and remaining evidence

All 67 selected native Fin tests completed: **32 passed, 35 failed**; 76 of
80,767 assertions failed. Runtime was 1,742.16 seconds and peak child RSS was
102,707,200 bytes. Failures include contact positions, upper-body paths,
painted-height behavior, crease progression and foot/contour expectations.
These are failures in the pinned native test run, not passes or changes to
Support Fins. The native PR itself describes automated execution as pending.

Before treating this pack as fully validated, inspect every case in the pinned
native preview, save/reload/reslice, verify the flat positive control's contacts
and plate connection, and capture the reduced collision. Review the native unit
failures with the native author. No native algorithm fix is included here.
