# SPDX-License-Identifier: GPL-3.0-or-later
"""Write a part and its fins as one 3MF assembly (Blender has no 3MF exporter).

From RemusTL's Blender extension (PR #145). Each mesh is its own object, all in one
build item, so a slicer opens them as one object in their original places -- the
fins stay exactly where the engine put them, under the part. Millimetres. No bpy.
"""
import xml.etree.ElementTree as ET
import zipfile

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
                 '</Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8"?>'
        f'<Relationships xmlns="{REL}">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')


def write_3mf(path, meshes, application="Support Fins for Blender"):
    """meshes: [(name, vertices [(x, y, z) mm], faces [(a, b, c)])], part first."""
    if not meshes:
        raise ValueError("nothing to export")
    ns = "{%s}" % CORE
    ET.register_namespace("", CORE)
    root = ET.Element(ns + "model", {"unit": "millimeter",
                                     "{http://www.w3.org/XML/1998/namespace}lang": "en-US"})
    ET.SubElement(root, ns + "metadata", {"name": "Application"}).text = application
    res = ET.SubElement(root, ns + "resources")
    for i, (name, verts, faces) in enumerate(meshes, 1):
        ob = ET.SubElement(res, ns + "object", {"id": str(i), "type": "model", "name": name})
        mesh = ET.SubElement(ob, ns + "mesh")
        vs = ET.SubElement(mesh, ns + "vertices")
        for v in verts:
            ET.SubElement(vs, ns + "vertex", {k: format(float(x), ".9g") for k, x in zip("xyz", v)})
        ts = ET.SubElement(mesh, ns + "triangles")
        for f in faces:
            ET.SubElement(ts, ns + "triangle", {k: str(int(x)) for k, x in zip(("v1", "v2", "v3"), f)})
    assembly_id = str(len(meshes) + 1)
    assembly = ET.SubElement(res, ns + "object", {"id": assembly_id, "type": "model", "name": meshes[0][0]})
    comps = ET.SubElement(assembly, ns + "components")
    for i in range(1, len(meshes) + 1):
        ET.SubElement(comps, ns + "component", {"objectid": str(i)})
    build = ET.SubElement(root, ns + "build")
    ET.SubElement(build, ns + "item", {"objectid": assembly_id})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("3D/3dmodel.model", ET.tostring(root, encoding="utf-8", xml_declaration=True))
