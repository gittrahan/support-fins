import bpy
import os, sys, json, uuid, math, platform, subprocess, tempfile, time, hashlib
from pathlib import Path
from mathutils import Matrix, Vector
from . import formats

ROOT=Path(__file__).parent
BUSY=False
MUTATING=False
LAST_ERROR=""
JOB=None
def factor(scene): return scene.unit_settings.scale_length * 1000.0
def sid(obj):
    if not obj.get("pf_id"):
        obj["pf_id"]=uuid.uuid4().hex
        obj["pf_original_matrix"]=json.dumps([list(row) for row in obj.matrix_world])
    return obj["pf_id"]
def model(obj): return obj and obj.type=="MESH" and not obj.get("pf_role")
def target(context):
    o=context.scene.pf.target
    return o if model(o) and o.name in context.scene.objects else None
def models(context, batch=False):
    obs=[o for o in context.selected_objects if model(o)] if batch else []
    if not obs:
        o=target(context) or context.active_object
        obs=[o] if model(o) else []
    ids=set()
    for o in obs:
        if sid(o) in ids: o["pf_id"]=uuid.uuid4().hex
        ids.add(sid(o))
    return obs
def runtime():
    system={"Windows":"windows","Darwin":"macos","Linux":"linux"}.get(platform.system())
    arch={"AMD64":"x64","x86_64":"x64","arm64":"arm64","aarch64":"arm64"}.get(platform.machine())
    p=ROOT/"runtime"/f"{system}-{arch}"/("node.exe" if system=="windows" else "node")
    if not p.is_file(): raise RuntimeError(f"Runtime missing for {system}-{arch}. Install the matching PrintFins package.")
    if os.name!="nt" and not os.access(p,os.X_OK): p.chmod(p.stat().st_mode|0o111)
    return str(p)
def start(request):
    folder=tempfile.TemporaryDirectory(prefix="printfins_")
    a=Path(folder.name)/"request.json"; b=Path(folder.name)/"result.json"
    a.write_text(json.dumps(request,allow_nan=False),encoding="utf8")
    err=open(Path(folder.name)/"stderr.txt","w",encoding="utf8")
    try:
        proc=subprocess.Popen([runtime(),str(ROOT/"engine"/"bridge.mjs"),str(a),str(b)],
            stdout=subprocess.DEVNULL,stderr=err,
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),cwd=str(ROOT/"engine"))
    except Exception:
        err.close(); folder.cleanup(); raise
    return {"folder":folder,"result":b,"process":proc,"stderr":err,"started":time.monotonic()}
def finish(job):
    job["stderr"].close()
    try:
        if not job["result"].exists():
            raise RuntimeError((Path(job["folder"].name)/"stderr.txt").read_text(encoding="utf8")[-1500:] or "Geometry worker stopped.")
        result=json.loads(job["result"].read_text(encoding="utf8"))
        if result.get("error"): raise RuntimeError(result["error"])
        return result
    finally: job["folder"].cleanup()
def cancel(job):
    if job["process"].poll() is None: job["process"].kill()
    job["process"].wait(); job["stderr"].close(); job["folder"].cleanup()
def run(request, timeout=240):
    job=start(request)
    try: job["process"].wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        cancel(job); raise RuntimeError("Geometry calculation timed out.")
    return finish(job)

def mesh_mm(obj,context):
    ev=obj.evaluated_get(context.evaluated_depsgraph_get()); me=ev.to_mesh()
    try:
        me.calc_loop_triangles()
        mat=ev.matrix_world; f=factor(context.scene)
        vs=[tuple((mat @ v.co)*f) for v in me.vertices]
        faces=[tuple(t.vertices) for t in me.loop_triangles]
        if mat.to_3x3().determinant()<0: faces=[(a,c,b) for a,b,c in faces]
        if not faces: raise ValueError(obj.name+": empty mesh")
        if not all(math.isfinite(x) for v in vs for x in v): raise ValueError("Non-finite vertex")
        return obj.name,vs,faces
    finally: ev.to_mesh_clear()
def soup(mesh):
    _,vs,faces=mesh
    return [v for face in faces for i in face for v in vs[i]]
def fingerprint(obj,context):
    import array
    return hashlib.sha256(array.array("d",soup(mesh_mm(obj,context))).tobytes()).hexdigest()
def drop(obj,context,center=False):
    _,vs,_=mesh_mm(obj,context); f=factor(context.scene)
    shift=Vector((0,0,-min(v[2] for v in vs)/f))
    if center:
        shift.x=-(min(v[0] for v in vs)+max(v[0] for v in vs))/(2*f)
        shift.y=-(min(v[1] for v in vs)+max(v[1] for v in vs))/(2*f)
    obj.matrix_world.translation+=shift
    context.view_layer.update()
def options(s):
    petg=s.material=="PETG"
    return {"mode":"auto","bedPad":s.pad!="off","tines":s.tines,
        "layerHeight":s.layer_height,"tineDensity":s.density,"coverage":s.coverage,
        "tunables":{"propGap":s.gap,"tineBite":s.bite,"padStyle":s.pad if s.pad!="off" else "auto",
            "padH":.3 if petg else .5,"padGrab":-.1 if petg else .05,"cutout":s.cutout,
            "padCustom":{"h":s.pad_height,"gap":s.pad_gap,"grip":s.pad_grip,"margin":s.pad_margin}},
        "sway":{"on":s.sway,"gripFrom":s.brace_from,"tineSpacing":s.brace_spacing,
            "reach":s.brace_depth/100,"gap":s.gap,"bite":s.bite}}
def settings_key(s): return json.dumps([s.threshold,s.placement,options(s)],sort_keys=True)
def prepare(context, action, obs):
    global MUTATING
    MUTATING=True
    try:
        items=[]
        for o in obs:
            if action in {"generate","analyze"}:
                drop(o,context)
                if o.get("pf_hash") and (o["pf_hash"]!=fingerprint(o,context) or o.get("pf_settings")!=settings_key(context.scene.pf)):
                    o["pf_removed"]="[]"
            pos=soup(mesh_mm(o,context))
            f=factor(context.scene)
            manual=json.loads(o.get("pf_manual","[]"))
            for m in manual:
                for k in ("a","b"):
                    if k in m: m[k]=list((o.matrix_world @ Vector(m[k]))*f)
            load=list((o.matrix_world.to_3x3() @ Vector(context.scene.pf.load)).normalized())
            items.append({"id":sid(o),"positions":pos,"manual":manual,
                          "removed":json.loads(o.get("pf_removed","[]")),"load":load,"loadDefined":context.scene.pf.load_defined})
        return {"action":action,"threshold":context.scene.pf.threshold,
            "placement":context.scene.pf.placement,"options":options(context.scene.pf),"items":items}
    finally: MUTATING=False
def collection(scene):
    c=next((c for c in scene.collection.children if c.get("pf_collection")),None)
    if not c:
        c=bpy.data.collections.new("PrintFins"); c["pf_collection"]=True; scene.collection.children.link(c)
    return c
def remove_object(o,scene):
    # Deleting from this scene must not destroy an object used by another scene.
    if len(o.users_scene)<=1:
        data=o.data; generated=bool(o.get("pf_role"))
        bpy.data.objects.remove(o,do_unlink=True)
        if generated and isinstance(data,bpy.types.Mesh) and data.users==0: bpy.data.meshes.remove(data)
    else:
        def unlink(c):
            if o.name in c.objects: c.objects.unlink(o)
            for ch in c.children: unlink(ch)
        unlink(scene.collection)
def clear_generated(scene, owner=None, roles=None):
    for o in list(scene.objects):
        if o.get("pf_role") and (owner is None or o.get("pf_owner")==owner) and (roles is None or o.get("pf_role") in roles):
            remove_object(o,scene)
def material(name,color):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color=color
    return m
def make_mesh(name,vs,faces,scene,role="",owner=None,color=(.1,.65,.8,1)):
    me=bpy.data.meshes.new(name); me.from_pydata(vs,[],faces); me.update()
    o=bpy.data.objects.new(name,me); collection(scene).objects.link(o)
    if role: o["pf_role"]=role
    if owner: o["pf_owner"]=owner
    o.color=color; me.materials.append(material("PF "+role,color))
    return o
def from_soup(name,pos,context,role,owner):
    if not pos or len(pos)%9: raise ValueError("Malformed geometry from worker")
    # Weld only identical coordinates: no tolerance that could erase a print gap.
    vs=[]; faces=[]; lookup={}
    for i in range(0,len(pos),9):
        face=[]
        for j in (0,3,6):
            p=tuple(pos[i+j:i+j+3])
            if not all(math.isfinite(x) for x in p): raise ValueError("Invalid support coordinate")
            if p not in lookup: lookup[p]=len(vs); vs.append(tuple(x/factor(context.scene) for x in p))
            face.append(lookup[p])
        if len(set(face))==3: faces.append(tuple(face))
    if not faces: raise ValueError("Empty support")
    o=make_mesh(name,vs,faces,context.scene,role,owner)
    if role in {"pending","support"}:
        # Upstream brim patches may contain reversed side strips. Correct winding
        # per connected closed shell without moving any vertex or changing gaps.
        import bmesh
        bm=bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        if any(e.is_boundary for e in bm.edges):
            bm.free(); remove_object(o,context.scene)
            raise ValueError("Generated support has open boundaries; geometry was not accepted.")
        bm.to_mesh(o.data); bm.free(); o.data.update()
    return o
def receive(context,result,action):
    global MUTATING
    MUTATING=True
    try:
        for r in result["results"]:
            o=next((x for x in context.scene.objects if x.get("pf_id")==r["id"]),None)
            if not o: continue
            if action in {"orient","strength"}:
                o["pf_candidates"]=json.dumps(r); o["pf_candidate_matrix"]=json.dumps([list(row) for row in o.matrix_world])
                o["pf_candidate_hash"]=fingerprint(o,context)
                o["pf_candidate_load"]=json.dumps(list(context.scene.pf.load))
                continue
            from . import workflow
            o["pf_analysis_valid"]=True
            o["pf_analysis_threshold"]=context.scene.pf.threshold
            o["pf_analysis_matrix"]=json.dumps([list(row) for row in o.matrix_world])
            stats=r["stats"]
            stats["warnings"]=r.get("warnings",[])
            o["pf_stats"]=json.dumps(stats)
            clear_generated(context.scene,sid(o),{"overlay"})
            if True:
                positions=soup(mesh_mm(o,context)); over=stats.get("over",[])
                red=[v for i,flag in enumerate(over) if flag for v in positions[i*9:i*9+9]]
                if red:
                    overlay=from_soup("PF Overhangs",red,context,"overlay",sid(o))
                    overlay.data.materials.clear(); overlay.data.materials.append(material("PF Overhangs",(.9,.035,.02,.8)))
                    overlay.color=(.9,.035,.02,.8); overlay.hide_select=True; overlay.hide_render=True; overlay.show_in_front=True
                    overlay.parent=o; overlay.matrix_world=Matrix.Identity(4)
                    overlay.hide_viewport=not context.scene.pf.show_overhangs
            if action=="generate":
                # Construct replacements first. Failed generation leaves previous geometry intact.
                new=[]
                try:
                    for m in r["meshes"]:
                        q=from_soup(o.name+" | "+m["kind"]+" "+m["key"],m["positions"],context,"pending",sid(o))
                        q["pf_key"]=m["key"]; q["pf_manual_support"]=m.get("manual",False)
                        q.parent=o; q.matrix_world=Matrix.Identity(4); new.append(q)
                except Exception:
                    for q in new: remove_object(q,context.scene)
                    raise
                clear_generated(context.scene,sid(o),{"support"})
                for q in new: q["pf_role"]="support"
                o["pf_hash"]=fingerprint(o,context)
                o["pf_settings"]=settings_key(context.scene.pf)
                stats["supports"]=len(new)
                volume=0.0
                for q in new:
                    q.data.calc_loop_triangles()
                    coords=[v.co for v in q.data.vertices]
                    origin=coords[0]
                    volume+=abs(sum((coords[t.vertices[0]]-origin).dot((coords[t.vertices[1]]-origin).cross(coords[t.vertices[2]]-origin)) for t in q.data.loop_triangles)/6)
                stats["estimated_grams"]=volume*factor(context.scene)**3/1000*(1.27 if context.scene.pf.material=="PETG" else 1.24)
                o["pf_stats"]=json.dumps(stats)
        context.scene.pf.status="Ready"
    finally: MUTATING=False
def import_meshes(context, meshes):
    f=factor(context.scene); result=[]
    for name,vs,faces in meshes:
        o=make_mesh(name,[tuple(x/f for x in p) for p in vs],faces,context.scene)
        sid(o); result.append(o)
    for o in context.selected_objects: o.select_set(False)
    for o in result: o.select_set(True)
    if result:
        context.view_layer.objects.active=result[0]; context.scene.pf.target=result[0]
    return result
def stale(obj,context):
    return obj.get("pf_hash") != fingerprint(obj,context) or obj.get("pf_settings") != settings_key(context.scene.pf)
def printable(context,scope):
    targets=models(context,context.scene.pf.batch)
    owners={sid(o) for o in targets}
    if not owners: raise ValueError("Choose a target model")
    supports=[o for o in context.scene.objects if o.get("pf_role")=="support" and o.get("pf_owner") in owners]
    if scope!="MODEL":
        for o in targets:
            if any(q.get("pf_owner")==sid(o) for q in supports) and stale(o,context):
                raise ValueError("Supports are out of date. Update supports before exporting.")
    objects=(targets if scope!="SUPPORTS" else [])+(supports if scope!="MODEL" else [])
    if not objects: raise ValueError("Nothing to export")
    return [mesh_mm(o,context) for o in objects]
