# Native Orca fin test pack

Procedural reproductions for [#434](https://github.com/gittrahan/support-fins/issues/434),
using the native implementation in
[OrcaSlicer #17234](https://github.com/OrcaSlicer/OrcaSlicer/pull/17234).
This is developer validation tooling. It neither invokes Support Fins generation
nor changes application defaults.

The reference is `lewis252310/OrcaSlicer` commit
`d4da6e4d0efd6dc490e02147741a756a2ed98143` (`fin-support-v0.1.0`).
The macOS reference includes exactly one recorded compilation-only patch,
`patches/clang-fin-vector.patch` (SHA-256
`4adda02650d5f5f1f3c1da95546f706f9a0639ac9ac5ef60e5de06c2b0babad6`).
Apple Clang 21 with pinned Eigen 5.0.1 rejects the conditional expression in
`FinSupport.cpp:3971`: its two branches have different Eigen storage-option types.
The patch uses explicit assignments with the same condition and calculations.
Reports identify the reference as the pinned source **plus this patch**; they do
not describe it as an unmodified preview binary. Full native validation remains
required after applying it.

Do not substitute an installed stable Orca release, another patch or a newer branch head.

## Cases and interpretation

| Case | Geometry and paint | Inspect |
| --- | --- | --- |
| flat | 10 × 20 × 60 mm column; 3 mm wide +X strip at Z 40–56 | Positive control: side contacts and plate attachment |
| convex | Column with X displacement `40 Z/60 − 20 (Z/60)²` | Contacts and clearance along outward curve |
| concave | Column with X displacement `20 (Z/60)²` | Inward curve and recessed-side clearance |
| leaning | Column sheared by `tan(30°) Z` | Bed reachability below a leaning side |
| crease | 1.5 × 20 × 60 mm wall; adjacent 1.5 mm strips around its corner | Connected 3 mm paint strip crossing the 90° crease |
| opposing | Column painted on ±X; unpainted 4 × 20 × 30 mm obstacle centred at X 10 | Nearby model clearance, competing feet and fin assembly |

All columns have 2 mm height subdivisions and closed end caps. Placement is
(150,150,0) mm. Six unpainted controls use identical geometry. A seventh control
rotates the convex case 90° around Z and translates it to (175,125,0), without
changing its mesh or paint-face identities. There are **13 projects** in total.

Paint uses whole-triangle support-enforcer state `4`, not colour painting.
Fixtures are indexed and consistently wound; invalid inputs are rejected, never
repaired. `*.model.3mf` omits paint; `*.painted.3mf` carries paint and placement.
Neither initial file claims to contain fully resolved printer settings. The
native runner produces `native.3mf` with resolved settings.

The native Painted Shape contract permits later contacts on unpainted walls and
merged intersecting fins. It does not provide underside support, top interfaces
or rafts. Contacts are based on generated perimeter extrusions, not just nominal
mesh surfaces. Do not require a particular fin count or equality with Support
Fins output. Successful slicing is **not** a finding that the supports attach,
release cleanly or print reliably.

## Generate and test without Orca

From the Support Fins checkout, choose an ignored directory under its `tmp/`:

```sh
deno run --allow-write prototype/native-orca/pack.js --out tmp/native-orca-inputs
deno test -A tests/native_orca.test.js tests/native_orca_reference.test.js
```

The manifest records geometry, transforms, painted faces, inputs and SHA-256
checksums. Archives are deterministic. Normal Deno CI runs the focused tests;
it does not download or build Orca.

## Build the pinned macOS Intel reference

Requirements: existing Xcode, CMake, Ninja, Python 3.9+, GNU make (`gmake`), GNU m4
(`gm4`), `pkg-config`, and the native dependency build's existing
autoconf/automake tools.
Nothing is installed globally. The build fails rather than bypassing confinement.
The recipe applies only the recorded compatibility patch; compiler optimization
settings remain unchanged. Optional
CMake package-registry writes outside the workspace are denied by the sandbox.
All paths below must resolve inside your repository's ignored `tmp/` directory.
The application bundle stays there; do not copy it into `/Applications`.

```sh
workspace="$PWD/tmp/native-orca-validation"
prototype/native-orca/build-macos.sh "$workspace"
```

The recipe builds dependencies, the x86_64 Release application and only the
required `fff_print_tests` binary, using the pinned source's macOS script and
`ORCA_TESTS_BUILD_ONLY=1`. It verifies the exact base revision, patch checksum,
original and patched file hashes, and absence of other tracked changes before
and after building. Local build-tool wrappers serialize dependency recipes
and cap nested compilation at two workers, including the upstream unbounded
`make -j` command. A local discovery toolchain excludes MacPorts/Homebrew
library prefixes; `pkg-config` searches only the local dependency installation.
This avoids the pinned script’s colon-separated CMake ignore-list bug, which
otherwise mixes unprefixed system PNG headers with its prefixed PNG library.
The existing compiler, SDK and explicitly selected build tools remain available.
Do not increase concurrency on a busy host.

`confined.py` directs caches and temporary files into the workspace and applies
a macOS filesystem-write sandbox. Downloads are allowed only during the build;
validation commands deny network access. There is no unconfined fallback.
Existing user configuration and the installed Orca application are not modified.
The build fetches the exact pinned wxWidgets commit explicitly when its shallow
clone lacks that commit; dependency versions and native source remain unchanged.

`evidence/build-inputs.txt` records source revision, submodules, tool versions and
the native build script checksum. Stage logs and metrics record failures as well
as elapsed time and peak child-process resident memory. The latter is the OS
child high-water mark, **not the sum of memory across concurrent processes**.
Keep failed attempts when retrying after changing the build environment.

## Run native validation

Use a new output directory for each run. On macOS this may require allowing your
terminal/agent to launch `sandbox-exec`; never remove the confinement to get a pass.

```sh
prototype/native-orca/validate-macos.sh "$workspace" "$workspace/out/run-1"
```

The launcher confines Deno writes to the workspace and grants subprocess access
only to Git (read-only source checks) and Python (the native sandbox wrapper).
Each native process receives one mandatory offline OS sandbox. Do not wrap the
launcher in another `sandbox-exec`: macOS can reject nested profiles. This does
not disable or bypass the native sandbox. Generated caches remain in the
workspace. The runner refuses existing output directories, symlink escapes,
wrong source revisions, unrecorded or staged native source changes, and an executable
whose checksum or source identity differs from `evidence/runtime.json`, the build
receipt. An old receipt for the unpatched source is rejected.

The native preset resolver loads the pinned H2C 0.4 mm machine, Bambu PETG Basic
filament and 0.20 mm Standard process. Overrides select Painted Shape, enable Fin
supports, disable rafts, use print-by-layer and set both first/subsequent layer
heights to 0.20 mm. Other native defaults remain unchanged. Only one filament
slot is loaded. Each case saves the complete resolved settings and their hash.

For each case, the runner:

1. Exports a native project using the pinned profiles and the saved side paint.
2. Compares native `--inspect-mesh` and `--inspect-paint` results before/after save;
   only the source filename is excluded from these comparisons.
3. Reopens the project and verifies settings persistence.
4. Slices twice, serially, keeping G-code, sliced projects, logs and metrics.
5. Compares G-code, excluding **only** the known generation-date comment. It
   counts support extrusion moves as a diagnostic, not a geometry acceptance test.

Each native command has a 30-minute timeout. Missing/failed/timed-out stages
remain failed or blocked. A nonzero exit is not automatically an algorithm bug:
first distinguish fixture import, profile resolution, export, slicing and
comparison failures. No Linux-only `result.json` is required.

Run `fff_print_tests --input-file <checkout>/prototype/native-orca/fin-tests.txt`
under the same offline wrapper. The file lists all 67 Fin-related tests in the
pinned source, including nine whose names do not contain “fin” or “Painted shape”.
Record the selected test count and result; do not run unrelated native suites.

From the Support Fins checkout:

```sh
pack_dir="$PWD/prototype/native-orca"
(
  cd "$workspace"
  python3 -B "$pack_dir/confined.py" --workspace "$workspace" \
    --log "$workspace/logs/fin-tests.log" \
    --metrics "$workspace/logs/fin-tests.metrics.json" --timeout 1800 -- \
    "$workspace/orca-source/build/x86_64/tests/fff_print/Release/fff_print_tests" \
    --input-file "$pack_dir/fin-tests.txt" --rng-seed 434
)
```

## Preview review and reports

Open each `native.3mf` in the **same pinned bundle**, using `--datadir` under the
workspace and the offline wrapper. Review all six painted cases and their
unpainted controls in preview. Inspect:

- contact bands against the owning perimeter extrusion and configured penetration;
- continuous fin connection to a first-layer foot;
- clearance from unintended model surfaces and the obstacle;
- merged feet, disconnected extrusion and printable-area clipping.

Save to a new workspace filename, reload and reslice. Record painting, placement
and settings persistence. Screenshots should show the relevant layers and
expected/actual behavior. An unavailable GUI check remains pending; native CLI
round-trips do not replace this check.

Use `report.json`/`report.md` as the automated evidence index. Add a reviewed
observation for each case: confirmed behavior, reproducible native finding,
known limitation, or unavailable check. Retain the smallest failing project and
exact runtime/settings identity. The positive control must work before treating
the test pack as validated. Native defects do not require algorithm fixes in
this contribution. Physical printing is a separate task.

Publish only procedural projects, reviewed evidence and text summaries. Keep
build trees, binaries, caches, user settings and private models out of commits
and attachments. The fixture generators are covered by this repository's MIT
license; the separate Orca source and bundled profiles retain their own notices.

## Required checks

- Tier 1: `deno test -A tests/native_orca.test.js tests/native_orca_reference.test.js`, Python syntax and shell syntax.
- Tier 2: relevant native Fin tests; all 13 cases, repeated slices and preview
  save/reload checks. Failures and unavailable checks must remain visible.
- Tier 3: root `deno test -A` and `git diff --check`.

Repeat affected checks after fixture, paint, settings, runtime, runner or
comparison changes. Prototype/tests/docs-only changes require no Blender,
plugin build, browser smoke or Support Fins geometry sweep. If shared production
code changes, reassess scope and run its required broader gates.
