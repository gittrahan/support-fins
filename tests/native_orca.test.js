import {
  CASES,
  fixture,
  obstacleReproduction,
  validateMesh,
} from "../prototype/native-orca/fixtures.js";
import {
  allFixtures,
  archive,
  generatePack,
  modelXML,
  sha256,
} from "../prototype/native-orca/pack.js";
import { ProjectZip } from "../plugins/cli/project-zip.js";
const assert = (v, m = "assertion failed") => {
  if (!v) throw new Error(m);
};
const rejects = (fn, pattern) => {
  try {
    fn();
  } catch (e) {
    assert(pattern.test(e.message), e.message);
    return;
  }
  throw new Error("expected rejection");
};
Deno.test("native Orca: all six fixtures and controls are deterministic closed outward shells", () => {
  assert(CASES.length === 6);
  assert(allFixtures().length === 13);
  for (const c of allFixtures()) {
    for (const o of c.objects) {
      const v = validateMesh(o);
      assert(v.volume > 0);
      assert(v.bounds[2][0] === 0);
      assert(v.bounds[2][1] <= 60);
    }
    assert(
      c.id.includes("unpainted")
        ? c.objects.every((o) => !o.painted.length)
        : c.objects[0].painted.length > 0,
    );
  }
  for (const c of CASES) {
    assert(JSON.stringify(fixture(c.id)) === JSON.stringify(fixture(c.id)));
  }
});
Deno.test("native Orca: malformed geometry and painting fail rather than being repaired", () => {
  let o = fixture("flat").objects[0];
  o.faces.pop();
  rejects(() => validateMesh(o), /open/);
  o = fixture("flat").objects[0];
  o.faces = o.faces.map(([a, b, c]) => [a, c, b]);
  rejects(() => validateMesh(o), /volume/);
  o = fixture("flat").objects[0];
  o.vertices[0][0] = NaN;
  rejects(() => validateMesh(o), /vertices/);
  o = fixture("flat").objects[0];
  o.painted.push(o.faces.length);
  rejects(() => validateMesh(o), /paint/);
  rejects(() => fixture("missing"), /unknown/);
});
Deno.test("native Orca: painted curves bulge outward or recede as labelled", () => {
  for (const [id, sign] of [["convex", 1], ["concave", -1]]) {
    const o = fixture(id).objects[0];
    const sideX = (z) =>
      Math.max(...o.vertices.filter((v) => v[2] === z).map((v) => v[0]));
    for (let z = 40; z <= 54; z += 2) {
      const deviation = sideX(z) - (sideX(z - 2) + sideX(z + 2)) / 2;
      assert(
        sign * deviation > 0,
        `${id}: wrong painted-side curvature at ${z}`,
      );
    }
  }
});
Deno.test("native Orca: project archives preserve paint identity, transforms and object placement", async () => {
  for (const f of allFixtures()) {
    const bytes = await archive(f),
      zip = new ProjectZip(bytes),
      model = await zip.text("3D/3dmodel.model");
    assert(
      (model.match(/paint_supports="4"/g) || []).length ===
        f.objects.reduce((n, o) => n + o.painted.length, 0),
    );
    for (const o of f.objects) {
      assert(model.includes(`transform="${o.transform.join(" ")}"`));
    }
    assert(!model.includes("support_fins"));
    assert(!zip.entries.has("Metadata/project_settings.config"));
    assert(await sha256(bytes) === await sha256(await archive(f)));
    assert(
      !(await new ProjectZip(await archive(f, { paint: false })).text(
        "3D/3dmodel.model",
      )).includes("paint_supports"),
    );
  }
});
Deno.test("native Orca: transformed equivalent changes placement only", () => {
  const a = fixture("convex"), b = fixture("convex", { transformed: true });
  assert(
    JSON.stringify(a.objects[0].vertices) ===
      JSON.stringify(b.objects[0].vertices),
  );
  assert(
    JSON.stringify(a.objects[0].painted) ===
      JSON.stringify(b.objects[0].painted),
  );
  assert(modelXML(a) !== modelXML(b));
});

Deno.test("native Orca: leaning geometry keeps a symmetric native float bounding box", () => {
  const o = fixture("leaning").objects[0];
  const xs = o.vertices.map((v) => Math.fround(v[0]));
  assert(Math.min(...xs) === -Math.max(...xs));
  const base = o.vertices.find((v) => v[2] === 0);
  const top = o.vertices.find((v) => v[2] === 60);
  assert(Math.abs((top[0] - base[0]) / 60 - Math.tan(Math.PI / 6)) < 1e-14);
});

Deno.test("native Orca: reduced obstacle case has two disjoint closed bodies and one paint island", () => {
  const painted = obstacleReproduction(),
    control = obstacleReproduction({ unpainted: true });
  assert(painted.objects.reduce((n, o) => n + o.faces.length, 0) === 96);
  assert(painted.objects[0].painted.length === 2);
  assert(painted.objects[1].painted.length === 0);
  assert(control.objects.every((o) => o.painted.length === 0));
  for (const o of painted.objects) validateMesh(o);
  const [body, obstacle] = painted.objects.map(validateMesh);
  assert(obstacle.bounds[0][0] - body.bounds[0][1] === 3);
  assert(
    JSON.stringify(painted.objects.map((o) => o.vertices)) ===
      JSON.stringify(control.objects.map((o) => o.vertices)),
  );
});

Deno.test("native Orca: resolved settings are embedded exactly and fingerprinted in generated inputs", async () => {
  const temp = await Deno.makeTempDir({ prefix: "native-orca-settings-" });
  try {
    const settings = {
      printable_area: ["0x0", "330x0", "330x320", "0x320"],
      filament_settings_id: ["explicit control"],
      ...OVERRIDES,
    };
    const manifest = await generatePack(temp, { settings });
    assert(
      manifest.resolvedSettingsSha256 ===
        await sha256(JSON.stringify(settings, null, 2)),
    );
    for (const c of manifest.cases) {
      for (const input of Object.values(c.inputs)) {
        const bytes = await Deno.readFile(`${temp}/${input.file}`);
        assert(await sha256(bytes) === input.sha256);
        const zip = new ProjectZip(bytes);
        assert(
          await zip.text("Metadata/project_settings.config") ===
            JSON.stringify(settings, null, 2),
        );
      }
    }
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

import {
  checkedPath,
  contained,
  gcodeSummary,
  inspectJSON,
  normalizedGcode,
  repeatSlices,
  reportMarkdown,
  run,
  verifySettings,
} from "../prototype/native-orca/run.js";
import { OVERRIDES, PROFILE_NAMES } from "../prototype/native-orca/fixtures.js";
Deno.test("native Orca: parser requires complete inspection data", () => {
  assert(
    inspectJSON('log line\n{"objects":[{"name":"quoted \\" brace }"}]}\nend')
      .objects.length === 1,
  );
  rejects(() => inspectJSON('{"objects":['), /malformed/);
  rejects(() => inspectJSON('{"not_objects":[]}'), /malformed/);
});
Deno.test("native Orca: readable reports link available evidence without inventing outputs", () => {
  const text = reportMarkdown({
    status: "incomplete",
    runtime: { sha256: "runtime-hash" },
    cases: [
      {
        id: "flat",
        status: "sliced-review-pending",
        projectSha256: "project-hash",
        resolvedSettingsSha256: "settings-hash",
        runs: [{ file: "native plate.gcode" }],
      },
      { id: "convex", status: "blocked", detail: "runtime unavailable" },
    ],
  });
  assert(text.includes("[project](flat/native.3mf)"));
  assert(text.includes("[settings](flat/resolved.json)"));
  assert(text.includes("flat/slice-1/native%20plate.gcode"));
  assert(text.includes("[input](inputs/convex.painted.3mf)"));
  assert(!text.includes("convex/native.3mf"));
  assert(text.includes("runtime-hash"));
});
Deno.test("native Orca: settings cannot silently fall back to a wrong style, machine or filament", () => {
  const settings = {
    ...OVERRIDES,
    printer_settings_id: PROFILE_NAMES.machine,
    nozzle_diameter: ["0.4", "0.4"],
    filament_settings_id: [PROFILE_NAMES.filament],
  };
  for (
    const k of [
      "fin_support_contact_height",
      "fin_support_contact_width",
      "fin_support_thickness",
      "fin_support_contact_spacing",
      "fin_support_contact_penetration",
      "fin_support_depth",
      "fin_support_expansion_factor",
      "support_object_xy_distance",
      "support_line_width",
    ]
  ) settings[k] = "1";
  verifySettings(settings);
  rejects(
    () => verifySettings({ ...settings, curr_bed_type: "Cool Plate" }),
    /mismatch/,
  );
  rejects(
    () => verifySettings({ ...settings, fin_support_style: "simulated" }),
    /mismatch/,
  );
  rejects(
    () => verifySettings({ ...settings, nozzle_diameter: ["0.8"] }),
    /nozzle/,
  );
  rejects(
    () => verifySettings({ ...settings, filament_settings_id: ["other"] }),
    /filament/,
  );
  rejects(
    () => verifySettings({ ...settings, fin_support_depth: undefined }),
    /missing/,
  );
});
Deno.test("native Orca: G-code comparison retains extrusion, settings and coordinate differences", () => {
  const a =
    "; generated by OrcaSlicer 2.5.0-dev on 2026-11-05 at 12:00:00\nM82\nG92 E0\n; FEATURE: Support\nG1 Z0.2\nG1 X10 Y10 E1\nG1 E0.5\n; FEATURE: Outer wall\nG1 X12 E2\nM83\n; FEATURE: Support\nG1 Z8.2\nG2 X14 Y15 I1 J1 E0.4\n";
  assert(
    normalizedGcode(a) === normalizedGcode(a.replace("12:00:00", "12:01:00")),
  );
  assert(normalizedGcode(a) !== normalizedGcode(a.replace("X10", "X11")));
  const s = gcodeSummary(a);
  assert(s.supportMoves === 2);
  assert(s.modelMoves === 1);
  assert(s.supportZ.join(",") === "0.2,8.2");
});

Deno.test("native Orca: compact decimal extrusion and arc coordinates are counted", () => {
  const text =
    "M83\n; FEATURE: Support\nG1 Z.2\nG3 X162.888 Y151.462 I-3.342 J.39 E.05789\nG1 X155.56 Y152.39 E.17153\nG1 X155.937 E-.11621\nG1 E.4\n; FEATURE: Outer wall\nG1 X155 E+.025\n";
  const summary = gcodeSummary(text);
  assert(summary.supportMoves === 2);
  assert(summary.modelMoves === 1);
  assert(summary.supportZ.join(",") === "0.2");
});

Deno.test("native Orca: native failure is retained while both repeats execute serially", async () => {
  let active = false;
  const seen = [];
  const result = await repeatSlices(async (repeat) => {
    assert(!active, "native repeats overlap");
    active = true;
    await Promise.resolve();
    seen.push(repeat);
    active = false;
    if (repeat === 1) {
      const error = new Error("native slicing conflict");
      error.metrics = { status: "failed", exitCode: 155 };
      throw error;
    }
    return { status: "completed", file: "plate_1.gcode" };
  });
  assert(seen.join(",") === "1,2");
  assert(result.runs.length === 1 && result.runs[0].repeat === 2);
  assert(
    result.failures.length === 1 && result.failures[0].metrics.exitCode === 155,
  );
  const report = reportMarkdown({
    status: "incomplete",
    cases: [{ id: "opposing", status: "failed", ...result }],
  });
  assert(report.includes("opposing/slice-2/plate_1.gcode"));
  assert(report.includes("opposing/slice-1/slice-1.log"));
});
Deno.test("native Orca: resolved paths reject traversal and symlink escapes", async () => {
  const temp = await Deno.makeTempDir({ prefix: "native-orca-path-" });
  try {
    await Deno.mkdir(`${temp}/allowed`);
    await Deno.mkdir(`${temp}/outside`);
    rejects(
      () => contained(`${temp}/allowed`, `${temp}/outside/file`),
      /escapes/,
    );
    if (Deno.build.os !== "windows") {
      await Deno.symlink(`${temp}/outside`, `${temp}/allowed/link`);
      let failed = false;
      try {
        await checkedPath(`${temp}/allowed`, `${temp}/allowed/link/file`);
      } catch (e) {
        failed = /escapes/.test(e.message);
      }
      assert(failed, "symlink escape accepted");
    }
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});
Deno.test("native Orca: missing runtime accounts for every case without claiming a pass", async () => {
  const temp = await Deno.makeTempDir({ prefix: "native-orca-blocked-" });
  try {
    const report = await run({
      workspace: temp,
      source: temp,
      orca: `${temp}/missing-orca`,
      out: `${temp}/results`,
    });
    assert(report.status === "blocked");
    assert(report.cases.length === 13);
    assert(report.cases.every((c) => c.status === "blocked"));
    assert(
      !(await Deno.readTextFile(`${temp}/results/report.json`)).includes(temp),
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

import { readThreeMFParts } from "../web/threemf.js";
import { unzip } from "../web/zip.js";
Deno.test("native Orca: independent project decoder resolves every mesh, paint face and world transform", async () => {
  for (const f of allFixtures()) {
    const parts = await unzip(await archive(f));
    const decoded = readThreeMFParts(parts, {
      withComponents: true,
      doublePrecision: true,
    });
    assert(decoded.objects.length === f.objects.length);
    for (let i = 0; i < f.objects.length; i++) {
      const expected = f.objects[i], actual = decoded.objects[i];
      assert(actual.components.length === 1);
      assert(actual.extras.length === 0);
      assert(actual.tris === expected.faces.length);
      const component = actual.components[0];
      const painted = component.source.triangleAttributes.flatMap((a, j) =>
        a.paint_supports === "4" ? [j] : []
      );
      assert(JSON.stringify(painted) === JSON.stringify(expected.painted));
      for (let t = 0; t < expected.faces.length; t++) {
        for (let k = 0; k < 3; k++) {
          const v = expected.vertices[expected.faces[t][k]],
            m = expected.transform;
          for (let axis = 0; axis < 3; axis++) {
            const world = m[axis] * v[0] + m[axis + 3] * v[1] +
              m[axis + 6] * v[2] + m[axis + 9];
            assert(
              Math.abs(component.positions[9 * t + 3 * k + axis] - world) <
                1e-12,
            );
          }
        }
      }
    }
  }
});

import { canonicalJSON } from "../prototype/native-orca/run.js";
Deno.test("native Orca: setting key order is insignificant but arrays and values remain exact", () => {
  assert(
    canonicalJSON({ a: 1, b: ["1", "2"] }) ===
      canonicalJSON({ b: ["1", "2"], a: 1 }),
  );
  assert(canonicalJSON({ a: ["1", "2"] }) !== canonicalJSON({ a: ["2", "1"] }));
  assert(canonicalJSON({ a: "0.4" }) !== canonicalJSON({ a: "0.8" }));
});
