# Pinned macOS preview: recorded results

Reference: `d4da6e4d0efd6dc490e02147741a756a2ed98143` plus the compilation-only
application patch described in [README.md](README.md). The native test binary
also uses the separately recorded test API patch; no assertions were changed.
Build identity, patch checksums, per-case settings/project hashes, slice times,
memory measurements and G-code hashes are in [validation-macos.json](validation-macos.json).

These are software results recorded on 2026-11-05. **All 13 projects have been
reviewed in the pinned GUI, saved, reloaded and resliced.** The flat positive
control works; all six painted cases have classified results, including the
obstacle collision described below. This completes the test-pack acceptance
checks, not certification of the native algorithm. Physical printing was not
performed; software evidence does not establish adhesion, removability or
physical stability. GUI project/screenshot hashes and observations are indexed
in [gui-validation-macos.json](gui-validation-macos.json); paths in that index
refer to the separate artifact pack.

## Serial repeated slices

H2C, Bambu PETG Basic, 0.4 mm, 0.20 mm first/subsequent layers, Painted Shape,
print-by-layer, one filament slot and no rafts. Engineering Plate was selected
explicitly because the preview's Cool Plate default rejects PETG. Both bed
temperatures come from the pinned PETG profile (70°C).

| Case | Two-run observation | Classification |
| --- | --- | --- |
| flat | 1,075 support extrusion moves; Z 0.2–48.4 mm | Positive control: repeated side contacts, intervening clearance and continuous fin to a filled first-layer foot |
| convex | 1,057 moves; Z 0.2–48.4 mm | Fin follows the outward curve with contact bands, clearance and plate connection |
| concave | 1,063 moves; Z 0.2–48.6 mm | Fin follows the inward curve with recessed-side clearance and plate connection |
| leaning | 1,051 moves; Z 0.2–48.4 mm | Continuous plate connection below the changing side position |
| crease | 1,095 moves; Z 0.2–48.0 mm | Continuous fin; top view shows a diagonal contact path at the 90-degree corner |
| opposing | Native exit 155 in both runs; conflict between `obstacle` and `opposing` | GUI confirms fin toolpath crossing the obstacle wall and entering its interior |
| six unpainted controls | All slice twice, with zero support extrusion moves | No fins in GUI before or after save/reload; no obstacle collision |
| transformed convex | 1,177 moves; Z 0.2–48.4 mm | Placement and painting persist; continuous fin follows the transformed side to the plate |

All 12 successful projects produce matching G-code after excluding **only**
the generation-date comment. Counts are diagnostic; they are not fin counts or
a requirement for rotationally identical toolpaths. All 13 projects preserve
the native mesh/paint inspection results and complete resolved settings through
CLI export/reload. The 24 successful slices took 1.63–3.26 seconds each; maximum
recorded child-process RSS was 202,076,160 bytes. Timings are observations on a
shared host, not benchmarks.

## GUI persistence and contact evidence

Native mesh and paint inspection data remain equal after GUI save/reload for
all 13 projects. All 12 successful GUI-saved projects reproduce **every
executable G-code line exactly**. The opposing case still exits 155 in the CLI
and displays a serious collision warning in the GUI.

The GUI fills equipment/filament metadata, expands the standard nozzle type
to both H2C extruders, drops empty host/compatibility fields and assigns new
object-label comments. These changes are listed explicitly in the GUI evidence
index and per-case comparisons. Full G-code files are consequently not identical
after date-only normalization. Complete files, settings and diffs are retained;
no geometry or toolpath differences are discarded.

For the flat control at Z 40.0 mm, the support centerline at X 155.210 mm with
0.42 mm width reaches X 155.000 mm, the generated outer-wall edge. This matches
the configured 0% contact penetration. At Z 40.2 mm the centerline is X 155.560 mm,
leaving the configured 0.35 mm clearance. Separate screenshots record these
layers, the filled Z 0.2 mm foot and the continuous fin. No unexpected disconnected
support or printable-area clipping was observed in the reviewed successful
cases. These observations do not imply physical attachment or easy removal.

## Reduced collision reproduction

`obstacleReproduction()` in [fixtures.js](fixtures.js) reduces the failing case
to two closed bodies, 96 triangles and one +X painted island (two triangles).
The bodies have a 3 mm nominal gap. Both reduced painted runs exit 155 and log
`gcode path conflicts found between obstacle and painted-body`. The otherwise
identical unpainted control slices successfully twice. Keep collision checks
enabled. The result isolates a paint-dependent failure; it does not yet locate
the root cause inside the native algorithm.

The GUI now locates the offending extrusion: the +X fin crosses the obstacle's
wall and enters its interior at layer 112, Z 22.40 mm, in both the original
case and reduced reproduction. The original case's reload warning names layer
37, Z 7.40 mm instead. These are reported affected layers, not a claim that the
collision starts there. The captured layer-112 top views show the crossing;
the same models without painting have no fins or conflict. Collision checks
were never disabled. No native algorithm fix is included in this contribution.

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

## Native unit tests and limitations

All 67 selected native Fin tests completed: **32 passed, 35 failed**; 76 of
80,767 assertions failed. Runtime was 1,742.16 seconds and peak child RSS was
102,707,200 bytes. Failures include contact positions, upper-body paths,
painted-height behavior, crease progression and foot/contour expectations.
These are failures in the pinned native test run, not passes or changes to
Support Fins. The native PR itself describes automated execution as pending.

The native failures remain findings for review with the native author. They
were not suppressed, changed into passing assertions or fixed in this PR.
GUI validation closes the test pack's previous evidence gaps. Physical printing
and native algorithm fixes remain separate work.
