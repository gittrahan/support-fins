"""Offline STL/3MF geometry IO. Coordinates in millimetres, assemblies preserved."""
import math
import os
import re
import struct
import zipfile
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath
from mathutils import Matrix, Vector

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
def local(tag): return tag.rsplit("}", 1)[-1]
def transform(text):
    if not text: return Matrix.Identity(4)
    a = [float(x) for x in text.split()]
    if len(a) != 12 or not all(math.isfinite(x) for x in a):
        raise ValueError("Invalid 3MF transform")
    return Matrix(((a[0],a[3],a[6],a[9]),(a[1],a[4],a[7],a[10]),
                   (a[2],a[5],a[8],a[11]),(0,0,0,1)))

def read_3mf(path):
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > 1024**3:
            raise ValueError("3MF exceeds 1 GB uncompressed")
        names = set(z.namelist())
        models = {}; out=[]
        def resolve(base, target):
            import posixpath
            p = posixpath.normpath(posixpath.join(posixpath.dirname(base), target)) if not target.startswith("/") else target[1:]
            if p.startswith("../") or p not in names: raise ValueError("Missing 3MF component: "+p)
            return p
        def load(p):
            if p in models: return models[p]
            root=ET.fromstring(z.read(p))
            unit={"micron":.001,"millimeter":1,"centimeter":10,"inch":25.4,"foot":304.8,"meter":1000}.get(root.get("unit","millimeter"))
            if unit is None: raise ValueError("Unsupported 3MF unit")
            objs={e.get("id"):e for e in root.iter() if local(e.tag)=="object"}
            models[p]=(root,unit,objs)
            return models[p]
        def walk(p, oid, matrix, stack, label=""):
            key=(p,oid)
            if key in stack or len(stack)>64: raise ValueError("Cyclic 3MF assembly")
            root,unit,objects=load(p)
            obj=objects.get(oid)
            if obj is None: raise ValueError("Missing 3MF object "+oid)
            label=label or obj.get("name") or "Model_"+oid
            for child in obj:
                if local(child.tag)=="mesh":
                    vertices=[]; faces=[]
                    for e in child.iter():
                        if local(e.tag)=="vertex": vertices.append(tuple(matrix @ Vector(tuple(float(e.get(k)) for k in "xyz"))))
                        elif local(e.tag)=="triangle": faces.append(tuple(int(e.get(k)) for k in ("v1","v2","v3")))
                    if vertices and faces:
                        if any(min(f)<0 or max(f)>=len(vertices) for f in faces): raise ValueError("Invalid 3MF triangle index")
                        if matrix.to_3x3().determinant()<0: faces=[(f[0],f[2],f[1]) for f in faces]
                        out.append((label,vertices,faces))
                elif local(child.tag)=="components":
                    for c in child:
                        cp=next((v for k,v in c.attrib.items() if local(k)=="path"),None)
                        dest=resolve(p,cp) if cp else p
                        # 3MF transforms use the unit of their containing model.
                        du=load(dest)[1]
                        scale=Matrix.Diagonal((du/unit,du/unit,du/unit,1))
                        walk(dest,c.get("objectid"),matrix @ transform(c.get("transform")) @ scale,stack+[key],label)
        main=None
        if "_rels/.rels" in names:
            for r in ET.fromstring(z.read("_rels/.rels")):
                if r.get("Type","").endswith("/3dmodel"):
                    main=resolve("",r.get("Target")); break
        main=main or next((n for n in names if n.lower()=="3d/3dmodel.model"),None)
        if not main: raise ValueError("3MF has no root model")
        root,u,_=load(main); scale=Matrix.Diagonal((u,u,u,1))
        for b in root:
            if local(b.tag)=="build":
                for i in b:
                    if i.get("printable","1")=="0": continue
                    cp=next((v for k,v in i.attrib.items() if local(k)=="path"),None)
                    dest=resolve(main,cp) if cp else main
                    du=load(dest)[1]
                    walk(dest,i.get("objectid"),scale @ transform(i.get("transform")) @ Matrix.Diagonal((du/u,du/u,du/u,1)),[])
        if not out: raise ValueError("3MF contains no printable mesh")
        return out

def read_stl(path):
    data=open(path,"rb").read(); pts=[]
    if len(data)>=84 and 84+struct.unpack_from("<I",data,80)[0]*50==len(data):
        n=struct.unpack_from("<I",data,80)[0]
        for i in range(n):
            a=struct.unpack_from("<12fH",data,84+i*50)
            pts.extend((a[3:6],a[6:9],a[9:12]))
    else:
        for m in re.finditer(rb"vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)",data,re.I):
            pts.append(tuple(float(x) for x in m.groups()))
    if not pts or len(pts)%3 or not all(math.isfinite(x) for p in pts for x in p):
        raise ValueError("Invalid or empty STL")
    return [(os.path.splitext(os.path.basename(path))[0],pts,[(i,i+1,i+2) for i in range(0,len(pts),3)])]

def write_stl(path, meshes):
    triangles=[(vs[a],vs[b],vs[c]) for _,vs,fs in meshes for a,b,c in fs]
    with open(path,"wb") as f:
        f.write(b"PrintFins - millimetres".ljust(80,b"\0")); f.write(struct.pack("<I",len(triangles)))
        for tri in triangles:
            a,b,c=map(Vector,tri); n=(b-a).cross(c-a).normalized()
            f.write(struct.pack("<12fH",*n,*a,*b,*c,0))

def write_3mf(path, meshes):
    ET.register_namespace("",CORE)
    root=ET.Element("{%s}model"%CORE,{"unit":"millimeter","{http://www.w3.org/XML/1998/namespace}lang":"en-US"})
    ET.SubElement(root,"{%s}metadata"%CORE,{"name":"Application"}).text="PrintFins for Blender"
    res=ET.SubElement(root,"{%s}resources"%CORE)
    for i,(name,vs,fs) in enumerate(meshes,1):
        ob=ET.SubElement(res,"{%s}object"%CORE,{"id":str(i),"type":"model","name":name})
        mesh=ET.SubElement(ob,"{%s}mesh"%CORE); verts=ET.SubElement(mesh,"{%s}vertices"%CORE)
        for v in vs: ET.SubElement(verts,"{%s}vertex"%CORE,{k:format(float(x),".9g") for k,x in zip("xyz",v)})
        ts=ET.SubElement(mesh,"{%s}triangles"%CORE)
        for f in fs: ET.SubElement(ts,"{%s}triangle"%CORE,{k:str(x) for k,x in zip(("v1","v2","v3"),f)})
    # One build assembly keeps the original positions when opened in a slicer.
    aid=len(meshes)+1
    assembly=ET.SubElement(res,"{%s}object"%CORE,{"id":str(aid),"type":"model","name":"PrintFins Assembly"})
    components=ET.SubElement(assembly,"{%s}components"%CORE)
    for i in range(1,aid): ET.SubElement(components,"{%s}component"%CORE,{"objectid":str(i)})
    build=ET.SubElement(root,"{%s}build"%CORE)
    ET.SubElement(build,"{%s}item"%CORE,{"objectid":str(aid)})
    with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels",'<Relationships xmlns="'+REL+'"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr("3D/3dmodel.model",ET.tostring(root,encoding="utf-8",xml_declaration=True))
