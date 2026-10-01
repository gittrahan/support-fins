"""Guided preparation and conservative, measured mesh repair."""
import bpy,bmesh,json,math,hashlib,array
from mathutils import Vector,Matrix
from bpy.props import BoolProperty,EnumProperty
from . import core,preferences

def prepared(scene):return bool(scene.get("pf_prepared"))
def stamp(o):
    ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
    try:
        v=array.array("f",[0])* (len(me.vertices)*3);me.vertices.foreach_get("co",v)
        loops=array.array("i",[0])*len(me.loops);me.loops.foreach_get("vertex_index",loops)
        poly=array.array("i",[0])*len(me.polygons);me.polygons.foreach_get("loop_total",poly)
        h=hashlib.sha256(v.tobytes()+loops.tobytes()+poly.tobytes())
        return h.hexdigest()
    finally:ev.to_mesh_clear()
def checked(o):
    return bool(o and o.get("pf_mesh_ready"))
def analyzed(o,s):
    return bool(o and o.get("pf_analysis_valid") and o.get("pf_analysis_threshold")==s.threshold)
def invalidate(o,geometry=False):
    if not o:return
    o["pf_analysis_valid"]=False
    for k in ("pf_candidates","pf_candidate_hash"):
        if k in o:del o[k]
    if geometry:o["pf_mesh_ready"]=False
def load_key(s):return json.dumps(list(s.load))
def set_load(c,world_direction,anchor=None):
    o=core.target(c)
    if not o:raise ValueError("Choose a target model")
    direction=Vector(world_direction)
    if direction.length<1e-8:raise ValueError("Draw a longer arrow")
    # Use the full inverse linear transform; local directions survive scale/rotation.
    local=(o.matrix_world.to_3x3().inverted() @ direction).normalized()
    c.scene.pf.load=local
    c.scene.pf.load_defined=True
    o["pf_load_direction"]=list(c.scene.pf.load)
    if anchor is None:
        anchor=sum((o.matrix_world @ Vector(v) for v in o.bound_box),Vector())/8
    o["pf_load_anchor"]=list(o.matrix_world.inverted() @ Vector(anchor))
    if "pf_candidates" in o:del o["pf_candidates"]

def update_plate(c):
    p=preferences.get(c);s=c.scene.pf;f=core.factor(c.scene)
    for k in ("bed_x","bed_y","bed_z"):setattr(s,k,getattr(p,k))
    core.clear_generated(c.scene,roles={"plate","layers"})
    if not prepared(c.scene):return
    x,y,z=p.bed_x/2/f,p.bed_y/2/f,p.bed_z/f
    color=tuple(p.plate_color)
    if p.show_plate:
        r=min(p.corner_radius/f,x,y)
        ring=[]
        if r<1e-8:ring=[(-x,-y),(x,-y),(x,y),(-x,y)]
        else:
            for cx,cy,start in ((x-r,y-r,0),(-x+r,y-r,90),(-x+r,-y+r,180),(x-r,-y+r,270)):
                for j in range(13):
                    a=math.radians(start+j*90/12);ring.append((cx+r*math.cos(a),cy+r*math.sin(a)))
        n=len(ring);vs=[(a,b,h) for h in (-p.plate_thickness/f,-.01/f) for a,b in ring]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
        faces +=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        o=core.make_mesh("PrintFins build plate",vs,faces,c.scene,"plate",color=color)
        o.hide_select=True;o.hide_render=True
        o.display_type="WIRE" if p.plate_wireframe else "SOLID"
        o.data.materials[0].diffuse_color=color
    if p.show_volume:
        vs=[(-x,-y,0),(x,-y,0),(x,y,0),(-x,y,0),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        edges=[(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]
        me=bpy.data.meshes.new("PF volume");me.from_pydata(vs,edges,[])
        o=bpy.data.objects.new(f"PrintFins volume {p.bed_x:g} × {p.bed_y:g} × {p.bed_z:g} mm",me)
        core.collection(c.scene).objects.link(o);o["pf_role"]="plate";o.hide_select=True;o.hide_render=True;o.display_type="WIRE"
    c.scene["pf_plate_settings"]=json.dumps([list(p.plate_color) if k=="plate_color" else getattr(p,k) for k in preferences.DEFAULTS if not k.startswith("repair")])

def make_bmesh(o,c):
    ev=o.evaluated_get(c.evaluated_depsgraph_get());me=ev.to_mesh()
    bm=bmesh.new()
    try:bm.from_mesh(me)
    finally:ev.to_mesh_clear()
    mm=Matrix.Diagonal((core.factor(c.scene),)*3+(1,)) @ o.matrix_world
    bm.transform(mm);bm.normal_update()
    return bm,mm
def inspect_mesh(o,c):
    bm,_=make_bmesh(o,c)
    try:
        p=preferences.get(c)
        doubles=bmesh.ops.find_doubles(bm,verts=list(bm.verts),dist=p.repair_merge)["targetmap"]
        r=dict(vertices=len(bm.verts),faces=len(bm.faces),
          boundary_edges=sum(e.is_boundary for e in bm.edges),
          multi_face_edges=sum(len(e.link_faces)>2 for e in bm.edges),
          wire_edges=sum(not e.link_faces for e in bm.edges),
          loose_vertices=sum(not v.link_edges for v in bm.verts),
          duplicate_vertices=len(doubles),
          degenerate_faces=sum(f.calc_area()<1e-12 for f in bm.faces),
          winding_edges=sum(e.is_manifold and not e.is_contiguous for e in bm.edges),
          inward_shells=0)
        # Diagnose inward closed shells separately; opposite shells cannot cancel out.
        unseen=set(bm.faces)
        while unseen:
            start=unseen.pop();group={start};todo=[start]
            while todo:
                face=todo.pop()
                for e in face.edges:
                    for f in e.link_faces:
                        if f in unseen:unseen.remove(f);group.add(f);todo.append(f)
            if all(e.is_manifold for f in group for e in f.edges):
                origin=next(iter(group)).verts[0].co
                vol=0
                for face in group:
                    vs=[v.co-origin for v in face.verts]
                    vol+=sum(vs[0].dot(vs[i].cross(vs[i+1]))/6 for i in range(1,len(vs)-1))
                if vol < -1e-9:r["inward_shells"]+=1
        r["issues"]=sum(v for k,v in r.items() if k not in {"vertices","faces"})
        r["ready"]=r["faces"]>0 and r["issues"]==0
        r["repair_settings"]=list(preferences.repair_key(p))
        o["pf_mesh_report"]=json.dumps(r);o["pf_mesh_ready"]=r["ready"];o["pf_mesh_stamp"]=stamp(o)
        return r
    finally:bm.free()

class PF_OT_prepare_scene(bpy.types.Operator):
    bl_idname="printfins.prepare_scene";bl_label="Prepare Scene";bl_options={"REGISTER","UNDO"}
    @classmethod
    def poll(cls,c):return not core.BUSY and c.window is not None
    def invoke(self,c,event):
        scene=next((s for s in bpy.data.scenes if prepared(s)),None)
        if scene and len(scene.objects):return c.window_manager.invoke_props_dialog(self,width=420)
        return self.execute(c)
    def draw(self,c):
        from .ui import tr
        self.layout.label(text=tr(None,"Reset the PrintFins scene?"),icon="ERROR")
        self.layout.label(text=tr(None,"Models and supports in this scene will be removed."))
        self.layout.label(text=tr(None,"Other scenes are preserved. Undo is available."))
    def execute(self,c):
        if c.mode!="OBJECT" and bpy.ops.object.mode_set.poll():bpy.ops.object.mode_set(mode="OBJECT")
        scene=next((s for s in bpy.data.scenes if prepared(s)),None)
        if scene is None:scene=bpy.data.scenes.new("PrintFins")
        c.window.scene=scene
        for o in list(scene.objects):core.remove_object(o,scene)
        # Remove all old workflow properties, not just the currently visible step.
        if "pf" in scene:del scene["pf"]
        scene["pf_prepared"]=True
        scene.unit_settings.system="METRIC";scene.unit_settings.scale_length=.001;scene.unit_settings.length_unit="MILLIMETERS"
        with c.temp_override(window=c.window,scene=scene,view_layer=scene.view_layers[0]):
            update_plate(bpy.context)
        if c.screen:
            for a in c.screen.areas:
                if a.type=="VIEW_3D":
                    v=a.spaces.active;v.clip_start=.01;v.clip_end=10000;v.shading.color_type="MATERIAL"
                    v.overlay.grid_scale=1;v.region_3d.view_location=(0,0,0)
                    v.region_3d.view_distance=max(scene.pf.bed_x,scene.pf.bed_y)*1.7
        return {"FINISHED"}

class PF_OT_update_plate(bpy.types.Operator):
    bl_idname="printfins.update_plate";bl_label="Apply plate settings";bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        if not prepared(c.scene):
            self.report({"INFO"},"Prepare Scene first");return {"CANCELLED"}
        update_plate(c);return {"FINISHED"}

class PF_OT_preferences(bpy.types.Operator):
    bl_idname="printfins.preferences";bl_label="Add-on preferences"
    def execute(self,c):
        bpy.ops.screen.userpref_show()
        c.preferences.active_section="ADDONS"
        bpy.ops.preferences.addon_show(module=__package__)
        return {"FINISHED"}

class PF_OT_check_mesh(bpy.types.Operator):
    bl_idname="printfins.check_mesh";bl_label="Check model";bl_options={"REGISTER","UNDO"}
    @classmethod
    def poll(cls,c):return not core.BUSY and c.mode=="OBJECT" and core.target(c) is not None
    def execute(self,c):
        for o in core.models(c,c.scene.pf.batch):inspect_mesh(o,c)
        return {"FINISHED"}

class PF_OT_repair_mesh(bpy.types.Operator):
    bl_idname="printfins.repair_mesh";bl_label="Repair model";bl_options={"REGISTER","UNDO"}
    @classmethod
    def poll(cls,c):return PF_OT_check_mesh.poll(c)
    def execute(self,c):
        from .operators import fail
        try:
            p=preferences.get(c)
            for original in core.models(c,c.scene.pf.batch):
                core.MUTATING=True
                bm,mm=make_bmesh(original,c)
                try:
                    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=p.repair_merge)
                    if p.repair_degenerate:
                        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=min(p.repair_merge,.00001))
                    if p.repair_loose:
                        loose=[v for v in bm.verts if not v.link_faces]
                        if loose:bmesh.ops.delete(bm,geom=loose,context="VERTS")
                    if p.repair_fill:
                        boundary=[e for e in bm.edges if e.is_boundary]
                        if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=p.repair_hole_sides)
                    if p.repair_normals:bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
                    if not bm.faces:raise ValueError("Repair would leave an empty model")
                    bm.transform(mm.inverted())
                    mesh=bpy.data.meshes.new(original.data.name+" repaired");bm.to_mesh(mesh);mesh.update()
                finally:bm.free()
                owner=core.sid(original);name=original.name
                original.name=name+" [repair backup]"
                result=bpy.data.objects.new(name,mesh);core.collection(c.scene).objects.link(result)
                result.matrix_world=original.matrix_world.copy()
                for material in original.data.materials:mesh.materials.append(material)
                for key in ("pf_id","pf_original_matrix","pf_load_anchor","pf_load_direction"):
                    if key in original:result[key]=original[key]
                original["pf_role"]="repair_backup";original["pf_backup_owner"]=owner
                if "pf_id" in original:del original["pf_id"]
                original.hide_set(True);original.hide_render=True
                core.clear_generated(c.scene,owner,{"support","overlay"})
                c.scene.pf.target=result;c.view_layer.objects.active=result
                for q in c.selected_objects:q.select_set(False)
                result.select_set(True)
                c.view_layer.update()
                inspect_mesh(result,c)
                invalidate(result)
                core.MUTATING=False
            return {"FINISHED"}
        except Exception as e:return fail(self,e)
        finally:core.MUTATING=False

class PF_OT_restore_mesh(bpy.types.Operator):
    bl_idname="printfins.restore_mesh";bl_label="Restore pre-repair model";bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        o=core.target(c)
        if not o:return {"CANCELLED"}
        owner=core.sid(o)
        backups=[q for q in c.scene.objects if q.get("pf_backup_owner")==owner]
        if not backups:return {"CANCELLED"}
        original=backups[-1];name=o.name
        core.clear_generated(c.scene,owner,{"support","overlay"})
        core.remove_object(o,c.scene)
        del original["pf_role"];del original["pf_backup_owner"]
        original["pf_id"]=owner;original.name=name;original.hide_set(False);original.hide_render=False
        c.scene.pf.target=original;c.view_layer.objects.active=original;original.select_set(True)
        invalidate(original,True);return {"FINISHED"}

class PF_OT_load_axis(bpy.types.Operator):
    bl_idname="printfins.load_axis";bl_label="Set load direction";bl_options={"REGISTER","UNDO"}
    axis:EnumProperty(items=[(a,a,"") for a in ("+X","-X","+Y","-Y","+Z","-Z","UP","DOWN","LEFT","RIGHT","TOWARD","AWAY")])
    def execute(self,c):
        o=core.target(c)
        if not o:return {"CANCELLED"}
        if self.axis.startswith(("+","-")):
            d=Vector((0,0,0));d["XYZ".index(self.axis[1])]=1 if self.axis[0]=="+" else -1
            world=o.matrix_world.to_3x3() @ d
        else:
            d=Vector({"UP":(0,1,0),"DOWN":(0,-1,0),"LEFT":(-1,0,0),"RIGHT":(1,0,0),"TOWARD":(0,0,1),"AWAY":(0,0,-1)}[self.axis])
            rv=c.space_data.region_3d if c.area and c.area.type=="VIEW_3D" else None
            world=rv.view_rotation @ d if rv else d
        set_load(c,world)
        return {"FINISHED"}

CLASSES=[PF_OT_prepare_scene,PF_OT_update_plate,PF_OT_preferences,PF_OT_check_mesh,PF_OT_repair_mesh,PF_OT_restore_mesh,PF_OT_load_axis]
