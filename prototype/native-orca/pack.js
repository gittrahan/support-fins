import { zipStore } from "../../web/zip.js";
import {
  CASES,
  fixture,
  OVERRIDES,
  PROFILE_NAMES,
  REFERENCE,
  validateMesh,
} from "./fixtures.js";

export async function sha256(data) {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const xml = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll(
    "<",
    "&lt;",
  ).replaceAll(">", "&gt;");
export function modelXML(f, paint = true) {
  const resources = f.objects.map((o, i) => {
    validateMesh(o);
    const selected = new Set(paint ? o.painted : []),
      mesh = 2 * i + 1,
      root = mesh + 1;
    return `<object id="${mesh}" type="model"><mesh><vertices>${
      o.vertices.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`)
        .join("")
    }</vertices><triangles>${
      o.faces.map((v, j) =>
        `<triangle v1="${v[0]}" v2="${v[1]}" v3="${v[2]}"${
          selected.has(j) ? ' paint_supports="4"' : ""
        }/>`
      ).join("")
    }</triangles></mesh></object><object id="${root}" type="model" name="${
      xml(o.name)
    }"><components><component objectid="${mesh}"/></components></object>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"><metadata name="Application">Support Fins native Orca test pack</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="OrcaSlicer">2.5.0-dev</metadata><metadata name="Title">${
    xml(f.id)
  }</metadata><resources>${resources}</resources><build>${
    f.objects.map((o, i) =>
      `<item objectid="${2 * i + 2}" transform="${
        o.transform.join(" ")
      }" printable="1"/>`
    ).join("")
  }</build></model>`;
}
export function modelSettings(f) {
  return `<?xml version="1.0" encoding="UTF-8"?><config>${
    f.objects.map((o, i) =>
      `<object id="${2 * i + 2}"><metadata key="name" value="${
        xml(o.name)
      }"/><metadata key="extruder" value="1"/><part id="${
        2 * i + 1
      }" subtype="normal_part"><metadata key="name" value="${
        xml(o.name)
      }"/><metadata key="extruder" value="1"/></part></object>`
    ).join("")
  }<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="${
    xml(f.id)
  }"/><metadata key="locked" value="false"/>${
    f.objects.map((_, i) =>
      `<model_instance><metadata key="object_id" value="${
        2 * i + 2
      }"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${
        i + 1
      }"/></model_instance>`
    ).join("")
  }</plate></config>`;
}
export async function archive(f, { paint = true, settings = null } = {}) {
  const files = [
    {
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>',
    },
    {
      name: "_rels/.rels",
      data:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    },
    { name: "3D/3dmodel.model", data: modelXML(f, paint) },
    { name: "Metadata/model_settings.config", data: modelSettings(f) },
  ];
  if (settings) {
    files.push({
      name: "Metadata/project_settings.config",
      data: JSON.stringify(settings, null, 2),
    });
  }
  return new Uint8Array(await zipStore(files).arrayBuffer());
}
export function allFixtures() {
  return [
    ...CASES.map((c) => fixture(c.id)),
    ...CASES.map((c) => fixture(c.id, { unpainted: true })),
    fixture("convex", { transformed: true }),
  ];
}
export async function generatePack(out) {
  await Deno.mkdir(out, { recursive: true });
  const manifest = {
    format: 1,
    reference: REFERENCE,
    profiles: PROFILE_NAMES,
    overrides: OVERRIDES,
    status: "generated; native runtime and resolved settings not yet validated",
    cases: [],
  };
  for (const f of allFixtures()) {
    const inputs = {};
    for (const [kind, paint] of [["model", false], ["painted", true]]) {
      const name = `${f.id}.${kind}.3mf`, bytes = await archive(f, { paint });
      await Deno.writeFile(`${out}/${name}`, bytes);
      inputs[kind] = { file: name, sha256: await sha256(bytes) };
    }
    manifest.cases.push({
      id: f.id,
      description: f.description,
      expectation: f.expectation,
      objects: f.objects.map((o) => ({
        name: o.name,
        ...validateMesh(o),
        paintedFaces: o.painted,
        transform: o.transform,
      })),
      inputs,
    });
  }
  await Deno.writeTextFile(
    `${out}/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (import.meta.main) {
  if (Deno.args.length !== 2 || Deno.args[0] !== "--out") {
    throw new Error(
      "usage: deno run --allow-write prototype/native-orca/pack.js --out <ignored-output-directory>",
    );
  }
  await generatePack(Deno.args[1]);
}
