import bpy, json, math, uuid, time, os
from mathutils import Vector, Matrix
from bpy.props import StringProperty, EnumProperty, IntProperty, BoolProperty
from bpy_extras.io_utils import ImportHelper, ExportHelper
from bpy_extras import view3d_utils
from . import core, formats
from .ui import enum_items

def fail(op,e):
    core.LAST_ERROR=str(e)
    op.report({"ERROR"},str(e).splitlines()[0][:220])
    return {"CANCELLED"}

class PF_OT_target(bpy.types.Operator):
    bl_idname="printfins.target"; bl_label="Use selected model"; bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        if not core.model(c.active_object): return fail(self,"Select a mesh model")
        c.scene.pf.target=c.active_object; core.sid(c.active_object)
        return {"FINISHED"}

class PF_OT_import(bpy.types.Operator,ImportHelper):
    bl_idname="printfins.import_file"; bl_label="Import STL / 3MF / STEP"; bl_options={"REGISTER","UNDO"}
    filename_ext=""
    filter_glob:StringProperty(default="*.stl;*.3mf;*.step;*.stp",options={"HIDDEN"})
    def execute(self,c):
        try:
            ext=os.path.splitext(self.filepath)[1].lower()
            if ext==".3mf": meshes=formats.read_3mf(self.filepath)
            elif ext==".stl": meshes=formats.read_stl(self.filepath)
            else:
                r=core.run({"action":"step","path":self.filepath})
                meshes=[]
                for x in r["objects"]:
                    p=x["positions"]
                    meshes.append((x["name"],[p[i:i+3] for i in range(0,len(p),3)],[(i,i+1,i+2) for i in range(0,len(p)//3,3)]))
            core.import_meshes(c,meshes)
            self.report({"INFO"},f"Imported {len(meshes)} mesh(es), dimensions in mm")
            return {"FINISHED"}
        except Exception as e: return fail(self,e)

class PF_OT_export(bpy.types.Operator,ExportHelper):
    bl_idname="printfins.export_file"; bl_label="Export print geometry"
    filename_ext=".3mf"
    filter_glob:StringProperty(default="*.3mf;*.stl",options={"HIDDEN"})
    format:EnumProperty(name="Format",items=enum_items("export_format",[("3MF","3MF assembly",""),("STL","STL combined",""),("SEPARATE","STL separate files","")]),default=0)
    scope:EnumProperty(name="Include",items=enum_items("export_scope",[("BOTH","Model and supports",""),("MODEL","Model only",""),("SUPPORTS","Supports only","")]))
    def draw(self,c):
        from .ui import tr
        self.layout.prop(self,"format",text=tr(c.scene.pf,"Format"))
        self.layout.prop(self,"scope",text=tr(c.scene.pf,"Include"))
    def check(self,c):
        wanted=".3mf" if self.format=="3MF" else ".stl"
        path=os.path.splitext(self.filepath)[0]+wanted
        changed=path!=self.filepath; self.filepath=path
        return changed
    def execute(self,c):
        try:
            meshes=core.printable(c,self.scope)
            path=os.path.splitext(self.filepath)[0]
            if self.format=="3MF": formats.write_3mf(path+".3mf",meshes)
            elif self.format=="STL": formats.write_stl(path+".stl",meshes)
            else:
                import re
                folder=path+"_parts"
                # Unique directory prevents overwriting a previous multi-file export.
                original=folder; i=2
                while os.path.exists(folder): folder=original+"_"+str(i); i+=1
                os.makedirs(folder)
                for i,m in enumerate(meshes,1):
                    name=re.sub(r"[^\w.-]+","_",m[0])[:90]
                    formats.write_stl(os.path.join(folder,f"{i:03d}_{name}.stl"),[m])
                with open(os.path.join(folder,"IMPORT.txt"),"w",encoding="utf8") as f:
                    f.write("Import all STL files together as parts of ONE object. Keep original coordinates; do not auto-centre each part.\nImportare tutti gli STL insieme come parti dello stesso oggetto, conservando le coordinate.\n")
            self.report({"INFO"},"Export completed")
            return {"FINISHED"}
        except Exception as e: return fail(self,e)

class PF_OT_calculate(bpy.types.Operator):
    bl_idname="printfins.calculate"; bl_label="PrintFins calculation"; bl_options={"UNDO"}
    action:EnumProperty(items=[(s,s.title(),"") for s in ("generate","analyze","orient","strength")],default="generate",options={"HIDDEN","SKIP_SAVE"})
    def apply_result(self,c):
        from .ui import tr
        if self.action=="strength":
            apply_pose(c,0)
        if self.action in {"analyze","strength"}:
            o=core.target(c)
            stats=json.loads(o.get("pf_stats","{}"))
            message="No overhangs found in this orientation." if stats.get("regions")==0 else "Overhang analysis completed."
            c.scene.pf.status=message
            self.report({"INFO"},tr(None,message))
        elif self.action=="orient":
            o=core.target(c)
            if not json.loads(o.get("pf_candidates","{}")).get("candidates"):
                self.report({"WARNING"},tr(None,"No suitable flat orientation found."))
        return {"FINISHED"}
    _job=None; _timer=None; _hashes=None; _key=None; _scene=None
    @classmethod
    def poll(cls,c): return not core.BUSY and c.mode=="OBJECT"
    def execute(self,c):
        if core.BUSY: return fail(self,"Calculation already in progress")
        obs=core.models(c,c.scene.pf.batch if self.action in {"generate","analyze"} else False)
        if not obs: return fail(self,"Choose a target model")
        c.scene.pf.target=obs[0]
        try:
            request=core.prepare(c,self.action,obs)
            self._hashes={core.sid(o):core.fingerprint(o,c) for o in obs}
            self._key=core.settings_key(c.scene.pf); self._scene=c.scene
            self._load=tuple(c.scene.pf.load)
            if bpy.app.background:
                core.receive(c,core.run(request),self.action); return self.apply_result(c)
            self._job=core.start(request); core.JOB=self._job; core.BUSY=True
            c.scene.pf.status="Calculating… Esc to cancel"
            self._timer=c.window_manager.event_timer_add(.2,window=c.window)
            c.window_manager.modal_handler_add(self)
            if c.area:c.area.tag_redraw()
            return {"RUNNING_MODAL"}
        except Exception as e: return fail(self,e)
    def cleanup(self,c):
        if self._timer: c.window_manager.event_timer_remove(self._timer)
        self._timer=None; self._job=None; core.JOB=None; core.BUSY=False
        if self._scene: self._scene.pf.status="Ready"
    def modal(self,c,event):
        if event.type=="ESC":
            core.cancel(self._job); self.cleanup(c); return {"CANCELLED"}
        if event.type!="TIMER": return {"PASS_THROUGH"}
        if time.monotonic()-self._job["started"]>240:
            core.cancel(self._job); self.cleanup(c); return fail(self,"Calculation exceeded four minutes; reduce mesh complexity.")
        if self._job["process"].poll() is None: return {"PASS_THROUGH"}
        try:
            r=core.finish(self._job)
            if c.scene!=self._scene or self._key!=core.settings_key(c.scene.pf): raise ValueError("Settings changed during calculation. Update again.")
            for id,h in self._hashes.items():
                o=next((o for o in c.scene.objects if o.get("pf_id")==id),None)
                if not o or core.fingerprint(o,c)!=h: raise ValueError("Model changed during calculation. Update again.")
            if self.action=="strength" and tuple(c.scene.pf.load)!=self._load:raise ValueError("Load changed during calculation. Update again.")
            core.receive(c,r,self.action)
            self.cleanup(c); self.apply_result(c)
            for area in c.screen.areas:
                if area.type=="VIEW_3D":area.tag_redraw()
            return {"FINISHED"}
        except Exception as e: self.cleanup(c); return fail(self,e)
    def cancel(self,c):
        if self._job: core.cancel(self._job)
        self.cleanup(c)

class PF_OT_place(bpy.types.Operator):
    bl_idname="printfins.place"; bl_label="Place on bed"; bl_options={"REGISTER","UNDO"}
    center:BoolProperty(default=False)
    def execute(self,c):
        obs=core.models(c,c.scene.pf.batch)
        if not obs: return fail(self,"Choose a model")
        for o in obs: core.drop(o,c,self.center)
        return {"FINISHED"}

class PF_OT_rotate(bpy.types.Operator):
    bl_idname="printfins.rotate"; bl_label="Rotate model"; bl_options={"REGISTER","UNDO"}
    axis:EnumProperty(items=[(k,k,"") for k in "XYZ"]); angle:IntProperty(default=90)
    def execute(self,c):
        for o in core.models(c,c.scene.pf.batch):
            pivot=o.matrix_world.translation.copy()
            r=Matrix.Rotation(math.radians(self.angle),4,self.axis)
            o.matrix_world=Matrix.Translation(pivot) @ r @ Matrix.Translation(-pivot) @ o.matrix_world
            core.drop(o,c)
        return {"FINISHED"}

def apply_pose(c,index):
    from . import workflow
    o=core.target(c)
    if not o or o.get("pf_candidate_hash")!=core.fingerprint(o,c):
        raise ValueError("Model changed. Suggest orientations again.")
    if o.get("pf_candidate_load")!=json.dumps(list(c.scene.pf.load)):
        raise ValueError("Load changed. Suggest orientations again.")
    candidates=json.loads(o["pf_candidates"])["candidates"]
    if not 0<=index<len(candidates):raise ValueError("No suitable flat orientation found.")
    r=candidates[index]["rot"]
    matrix=Matrix([r[i::3] for i in range(3)]).to_4x4()
    core.MUTATING=True
    try:
        o.matrix_world=matrix @ Matrix(json.loads(o["pf_candidate_matrix"]))
        core.drop(o,c,True)
        core.clear_generated(c.scene,core.sid(o),{"support","overlay"})
        o["pf_removed"]="[]";o["pf_oriented"]=True;o["pf_selected_pose"]=index
        o["pf_analysis_valid"]=False
        # Preserve the original candidate frame so all three buttons remain reusable.
        o["pf_candidate_hash"]=core.fingerprint(o,c)
        core.receive(c,core.run(core.prepare(c,"analyze",[o])),"analyze")
        o["pf_candidate_hash"]=core.fingerprint(o,c)
    finally:core.MUTATING=False

class PF_OT_pose(bpy.types.Operator):
    bl_idname="printfins.pose";bl_label="Apply suggested orientation";bl_options={"UNDO"}
    index:IntProperty(default=0,options={"HIDDEN","SKIP_SAVE"})
    @classmethod
    def poll(cls,c):return not core.BUSY and c.mode=="OBJECT"
    def execute(self,c):
        try:apply_pose(c,self.index);return {"FINISHED"}
        except Exception as e:return fail(self,e)


def ray(c,event,o):
    region=next(r for r in c.area.regions if r.type=="WINDOW")
    xy=(event.mouse_x-region.x,event.mouse_y-region.y)
    if not (0<=xy[0]<region.width and 0<=xy[1]<region.height): return False,None,None,-1
    rv=c.space_data.region_3d
    d=view3d_utils.region_2d_to_vector_3d(region,rv,xy)
    p=view3d_utils.region_2d_to_origin_3d(region,rv,xy)
    ev=o.evaluated_get(c.evaluated_depsgraph_get()); inv=ev.matrix_world.inverted()
    hit,co,n,index=ev.ray_cast(inv @ p,(inv.to_3x3() @ d).normalized())
    return hit,co,n,index

class PF_OT_draw(bpy.types.Operator):
    bl_idname="printfins.draw"; bl_label="Lay a face flat / Draw support"; bl_options={"UNDO"}
    kind:EnumProperty(items=[("wall","Wall",""),("brace","Sway brace",""),("face","Lay face on bed","")])
    _a=None; _obj=None; _area=None; _handle=None; _hover=None
    def invoke(self,c,event):
        if core.BUSY or c.area.type!="VIEW_3D": return {"CANCELLED"}
        self._obj=core.target(c)
        if not self._obj: return fail(self,"Choose a target model")
        self._a=None; self._area=c.area; self._hover=None
        self._handle=bpy.types.SpaceView3D.draw_handler_add(self.preview,(), "WINDOW","POST_VIEW")
        c.area.header_text_set("PrintFins: click "+("two points on an overhang" if self.kind=="wall" else "a face")+" · Esc / right click cancels")
        c.window_manager.modal_handler_add(self)
        return {"RUNNING_MODAL"}
    def preview(self):
        if self.kind!="wall" or self._a is None or self._hover is None or not self._obj: return
        import gpu
        from gpu_extras.batch import batch_for_shader
        shader=gpu.shader.from_builtin("UNIFORM_COLOR")
        coords=[self._obj.matrix_world @ Vector(self._a),self._obj.matrix_world @ Vector(self._hover)]
        batch=batch_for_shader(shader,"LINES",{"pos":coords})
        gpu.state.depth_test_set("NONE"); gpu.state.line_width_set(3)
        shader.bind();shader.uniform_float("color",(1,.5,.04,1));batch.draw(shader)
        gpu.state.line_width_set(1);gpu.state.depth_test_set("LESS_EQUAL")
    def finish(self):
        if self._handle:
            bpy.types.SpaceView3D.draw_handler_remove(self._handle,"WINDOW");self._handle=None
        if self._area: self._area.header_text_set(None); self._area.tag_redraw()
    def modal(self,c,event):
        if event.type=="MOUSEMOVE":
            try:
                hit,p,n,index=ray(c,event,self._obj)
                self._hover=list(p) if hit else None
                if self._area:self._area.tag_redraw()
            except ReferenceError:
                self.finish(); return {"CANCELLED"}
        if event.type in {"ESC","RIGHTMOUSE"}:
            self.finish(); return {"CANCELLED"}
        if event.type=="LEFTMOUSE" and event.value=="PRESS":
            try:
                hit,p,n,index=ray(c,event,self._obj)
                if not hit: return {"RUNNING_MODAL"}
                if self.kind=="face":
                    normal=(self._obj.matrix_world.to_3x3().inverted().transposed() @ n).normalized()
                    rot=normal.rotation_difference(Vector((0,0,-1))).to_matrix().to_4x4()
                    self._obj.matrix_world=rot @ self._obj.matrix_world
                    core.drop(self._obj,c,True); self._obj["pf_oriented"]=True
                    self.finish()
                    core.receive(c,core.run(core.prepare(c,"analyze",[self._obj])),"analyze")
                    return {"FINISHED"}
                if self.kind=="wall" and self._a is None:
                    self._a=list(p); self._area.header_text_set("PrintFins: click the second endpoint · Esc cancels")
                    return {"RUNNING_MODAL"}
                records=json.loads(self._obj.get("pf_manual","[]"))
                rec={"id":"manual_"+uuid.uuid4().hex[:8],"kind":self.kind,"a":self._a if self.kind=="wall" else list(p)}
                if self.kind=="wall": rec["b"]=list(p)
                records.append(rec); self._obj["pf_manual"]=json.dumps(records)
                self.finish()
                bpy.ops.printfins.calculate(action="generate")
                return {"FINISHED"}
            except Exception as e: self.finish(); return fail(self,e)
        return {"PASS_THROUGH"}

class PF_OT_remove(bpy.types.Operator):
    bl_idname="printfins.remove"; bl_label="Remove selected supports"; bl_options={"REGISTER","UNDO"}
    restore:BoolProperty(default=False)
    clear_manual:BoolProperty(default=False)
    def execute(self,c):
        if self.restore or self.clear_manual:
            o=core.target(c)
            if not o: return fail(self,"Choose a target model")
            if self.restore: o["pf_removed"]="[]"
            if self.clear_manual: o["pf_manual"]="[]"
            return bpy.ops.printfins.calculate(action="generate")
        for q in list(c.selected_objects):
            if q.get("pf_role")!="support": continue
            o=next((x for x in c.scene.objects if x.get("pf_id")==q.get("pf_owner")),None)
            if o:
                key=q.get("pf_key")
                if q.get("pf_manual_support"): o["pf_manual"]=json.dumps([m for m in json.loads(o.get("pf_manual","[]")) if m["id"]!=key])
                else:
                    removed=json.loads(o.get("pf_removed","[]")); removed.append(key); o["pf_removed"]=json.dumps(removed)
            core.remove_object(q,c.scene)
        return {"FINISHED"}

class PF_OT_clean(bpy.types.Operator):
    bl_idname="printfins.clean"; bl_label="Clean scene"; bl_options={"REGISTER","UNDO"}
    all_objects:BoolProperty(default=False)
    @classmethod
    def poll(cls,c): return not core.BUSY and c.mode=="OBJECT"
    def invoke(self,c,event): return c.window_manager.invoke_confirm(self,event) if self.all_objects else self.execute(c)
    def draw(self,c):
        self.layout.label(text="Delete ALL objects in this scene?",icon="ERROR")
        self.layout.label(text="You can undo this operation.")
    def execute(self,c):
        if self.all_objects:
            for o in list(c.scene.objects): core.remove_object(o,c.scene)
        else: core.clear_generated(c.scene)
        for o in c.scene.objects:
            if o.get("pf_id"):
                for k in ("pf_hash","pf_stats","pf_settings"): 
                    if k in o: del o[k]
        return {"FINISHED"}

class PF_OT_plate(bpy.types.Operator):
    bl_idname="printfins.plate"; bl_label="Create / update build plate"; bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        s=c.scene.pf; f=core.factor(c.scene)
        core.clear_generated(c.scene,roles={"plate","layers"})
        x,y,z=s.bed_x/2/f,s.bed_y/2/f,s.bed_z/f
        vs=[(-x,-y,0),(x,-y,0),(x,y,0),(-x,y,0),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        edges=[(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]
        step=max(10,s.bed_x/50,s.bed_y/50)/f
        for i in range(1,int(2*x/step)+1):
            xx=-x+i*step
            vs.extend([(xx,-y,0),(xx,y,0)]); edges.append((len(vs)-2,len(vs)-1))
        for i in range(1,int(2*y/step)+1):
            yy=-y+i*step
            vs.extend([(-x,yy,0),(x,yy,0)]); edges.append((len(vs)-2,len(vs)-1))
        if s.show_layers:
            step=max(s.layer_height,s.bed_z/100)/f
            for k in range(1,min(100,int(z/step))):
                h=k*step; i=len(vs)
                vs.extend([(-x,-y,h),(x,-y,h),(x,y,h),(-x,y,h)])
                edges.extend([(i,i+1),(i+1,i+2),(i+2,i+3),(i+3,i)])
        me=bpy.data.meshes.new("PrintFins build volume"); me.from_pydata(vs,edges,[])
        o=bpy.data.objects.new(f"PrintFins {s.bed_x:g} × {s.bed_y:g} × {s.bed_z:g} mm",me)
        core.collection(c.scene).objects.link(o); o["pf_role"]="plate"
        o.hide_select=True; o.hide_render=True; o.display_type="WIRE"; o.color=(.18,.3,.4,1)
        return {"FINISHED"}

class PF_OT_units(bpy.types.Operator):
    bl_idname="printfins.units"; bl_label="Use millimetres"; bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        if any(core.model(o) for o in c.scene.objects): return fail(self,"Set units before importing models, or use Scene Properties.")
        c.scene.unit_settings.system="METRIC"; c.scene.unit_settings.scale_length=.001; c.scene.unit_settings.length_unit="MILLIMETERS"
        return {"FINISHED"}

class PF_OT_info(bpy.types.Operator):
    bl_idname="printfins.info"; bl_label="Analysis details"
    def invoke(self,c,event): return c.window_manager.invoke_props_dialog(self,width=560)
    def draw(self,c):
        o=core.target(c); l=self.layout
        if o:
            s=json.loads(o.get("pf_stats","{}"))
            for k,v in s.get("skipped",{}).items(): l.label(text=f"{k}: {v}")
            for w in s.get("warnings",[]): 
                for i in range(0,len(w),85): l.label(text=w[i:i+85])
            l.label(text="Strength scores are qualitative, not a structural simulation.")
            l.label(text="Inspect the slicer preview before printing.")
        if core.LAST_ERROR:
            for line in core.LAST_ERROR.splitlines()[:10]: l.label(text=line[:90])
    def execute(self,c): return {"FINISHED"}


class PF_OT_reset(bpy.types.Operator):
    bl_idname="printfins.reset"; bl_label="Reset orientation"; bl_options={"REGISTER","UNDO"}
    def execute(self,c):
        for o in core.models(c,c.scene.pf.batch):
            original=o.get("pf_original_matrix")
            if original:
                o.matrix_world=Matrix(json.loads(original))
                core.drop(o,c)
            o["pf_removed"]="[]"
        return {"FINISHED"}

CLASSES=[PF_OT_reset,PF_OT_target,PF_OT_import,PF_OT_export,PF_OT_calculate,PF_OT_place,PF_OT_rotate,
 PF_OT_pose,PF_OT_draw,PF_OT_remove,PF_OT_clean,PF_OT_plate,PF_OT_units,PF_OT_info]
