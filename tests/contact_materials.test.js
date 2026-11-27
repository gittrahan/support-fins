import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { block, isClosed, isOriented } from './_util.js';
import { matchContactMaterials } from '../web/contact-materials.js';
import { indexedSupportMesh } from '../web/support-materials.js';
import { manifold } from '../web/cut.js';
const soup = (p, record) =>
  Array.from({ length: p.length / 3 }, (_, i) => [...p.slice(i * 3, i * 3 + 3), 0, record]);
const body = soup(block(-2, -1, -1, 1, 0, 3), { role: 'body' });
const record = {
  role: 'tine',
  contact: { direction: [1, 0, 0], footprint: [[0, -1, 1], [0, 1, 1], [0, 1, 2], [0, -1, 2]] },
};
const tine = soup(block(-1, 0, -1, 1, 1, 2), record);
const patch = (y0, y1, material, x = 0) => [
  { material, triangle: [[x, y0, 1], [x, y1, 1], [x, y1, 2]] },
  { material, triangle: [[x, y0, 1], [x, y1, 2], [x, y0, 2]] },
];
const settings = { bodyMaterial: 'body', fallbackMaterial: 'fallback' };
async function volumes(parts) {
  const w = await manifold(), out = {};
  for (const p of parts) {
    const s = new w.Manifold(indexedSupportMesh(w, p.triangles));
    try {
      out[p.material] = (out[p.material] ?? 0) + s.volume();
      assertEquals(s.status(), 'NoError');
    } finally {
      s.delete();
    }
  }
  return out;
}
Deno.test('contact materials: exact two-region footprint splits closed tines and leaves the body fixed', async () => {
  const tris = [...body, ...tine], before = structuredClone(tris);
  const r = await matchContactMaterials(tris, {
    ...settings,
    regions: [...patch(-1, 0, 'one'), ...patch(0, 1, 'two')],
  });
  assertEquals(r.diagnostics, []);
  assertEquals(tris, before);
  const v = await volumes(r.parts);
  assert(Math.abs(v.one - 1) < 1e-6 && Math.abs(v.two - 1) < 1e-6 && Math.abs(v.body - 6) < 1e-6);
  for (const p of r.parts) assert(isClosed(p.triangles) && isOriented(p.triangles));
  assertEquals(
    await matchContactMaterials(tris, {
      ...settings,
      regions: [...patch(0, 1, 'two'), ...patch(-1, 0, 'one')],
    }),
    r,
  );
});
Deno.test('contact materials: missing, unknown, overlapping and distant ownership uses the explicit fallback', async () => {
  for (
    const regions of [
      [],
      patch(-1, 1, null),
      [...patch(-1, 1, 'one'), ...patch(-1, 1, 'two')],
      patch(-1, 1, 'one', .1),
      [...patch(-1, 1, 'one'), ...patch(-1, 1, null)],
    ]
  ) {
    const r = await matchContactMaterials([...body, ...tine], { ...settings, regions }),
      v = await volumes(r.parts);
    assert(Math.abs(v.fallback - 2) < 1e-6, JSON.stringify(v));
    assertEquals(r.diagnostics.length, 1);
  }
  const partial = await matchContactMaterials([...body, ...tine], {
    ...settings,
    regions: patch(-1, 0, 'one'),
  });
  const v = await volumes(partial.parts);
  assert(Math.abs(v.one - 1) < 1e-6 && Math.abs(v.fallback - 1) < 1e-6);
});
Deno.test('contact materials: equal-colour identities and thin painted regions are never collapsed', async () => {
  const r = await matchContactMaterials([...body, ...tine], {
    ...settings,
    regions: [...patch(-1, -.999, 'slot:1'), ...patch(-.999, 1, 'slot:2')],
  });
  assertEquals(r.diagnostics, []);
  const v = await volumes(r.parts);
  assert(v['slot:1'] > .0009 && v['slot:1'] < .0011);
  assert(v['slot:2'] > 1.9989);
});
Deno.test('contact materials: rotation, translation and mirroring retain footprint/material correspondence', async () => {
  for (const mirror of [false, true]) {
    const point = ([x, y, z]) => [20 - y, 30 + (mirror ? -x : x), z + 10],
      direction = ([x, y, z]) => [-y, mirror ? -x : x, z];
    const records = new Map();
    const tris = [...body, ...tine].map((p) => {
      if (!records.has(p[4])) {
        records.set(p[4], {
          ...p[4],
          ...(p[4].contact
            ? {
              contact: {
                direction: direction(p[4].contact.direction),
                footprint: p[4].contact.footprint.map(point),
              },
            }
            : {}),
        });
      }
      return [...point(p), 0, records.get(p[4])];
    });
    if (mirror) {
      for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
    }
    const regions = [...patch(-1, 0, 'one'), ...patch(0, 1, 'two')].map((r) => ({
      ...r,
      triangle: r.triangle.map(point),
    }));
    const r = await matchContactMaterials(tris, { ...settings, regions }), v = await volumes(r.parts);
    assertEquals(r.diagnostics, []);
    assert(Math.abs(v.one - 1) < 1e-5 && Math.abs(v.two - 1) < 1e-5);
  }
});
Deno.test('contact materials: no-contact and malformed input behavior is explicit', async () => {
  assertEquals(await matchContactMaterials([], { ...settings, regions: [] }), { parts: [], diagnostics: [] });
  const r = await matchContactMaterials(body, { ...settings, regions: [] });
  assertEquals(r.parts.length, 1);
  assertEquals(r.diagnostics, []);
  await assertRejects(
    () => matchContactMaterials(tine, { regions: [], bodyMaterial: 'body' }),
    Error,
    'fallback',
  );
  await assertRejects(
    () =>
      matchContactMaterials(tine, {
        ...settings,
        regions: [{ material: 'a', triangle: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }],
      }),
    Error,
    'invalid source',
  );
});

Deno.test('contact materials: top interfaces and designed tine separation keep source registration', async () => {
  const roof = {
    role: 'interface',
    contact: { direction: [0, 0, 1], footprint: [[0, 0, 1.7], [4, 0, 1.7], [4, 2, 1.7], [0, 2, 1.7]] },
  };
  const patch = (
    x0,
    x1,
    material,
  ) => [{ material, triangle: [[x0, 0, 1.7], [x1, 0, 1.7], [x1, 2, 1.7]] }, {
    material,
    triangle: [[x0, 0, 1.7], [x1, 2, 1.7], [x0, 2, 1.7]],
  }];
  const r = await matchContactMaterials(soup(block(0, 4, 0, 2, 1, 1.4), roof), {
    ...settings,
    regions: [...patch(0, 2, 'one'), ...patch(2, 4, 'two')],
  });
  assertEquals(r.diagnostics, []);
  const v = await volumes(r.parts);
  assert(Math.abs(v.one - 1.6) < 1e-6 && Math.abs(v.two - 1.6) < 1e-6);
  for (const offset of [-.15, .15]) {
    const shifted = structuredClone(record);
    shifted.contact.surfaceOffset = offset;
    shifted.contact.footprint = shifted.contact.footprint.map(([x, y, z]) => [x - offset, y, z]);
    const contacts = soup(block(-1, -offset, -1, 1, 1, 2), shifted);
    const regions = [{ material: 'paint', triangle: [[0, -1, 1], [0, 1, 1], [0, 1, 2]] }, {
      material: 'paint',
      triangle: [[0, -1, 1], [0, 1, 2], [0, -1, 2]],
    }];
    const m = await matchContactMaterials(contacts, { ...settings, regions });
    assertEquals(m.diagnostics, []);
    assertEquals(m.parts.map((p) => p.material), ['paint']);
  }
});
