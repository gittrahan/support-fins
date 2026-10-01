import bpy, json, time
from bpy.props import BoolProperty, FloatProperty, EnumProperty, PointerProperty, StringProperty, FloatVectorProperty, IntProperty
from . import core
DIRTY=0.0
LAST_TRANSFORM=None
def threshold_changed(self,context):
    if context:
        from .workflow import invalidate
        invalidate(core.target(context))
    changed(self,context)
def load_changed(self,context):
    if context:
        o=core.target(context)
        if o and "pf_candidates" in o:del o["pf_candidates"]
    changed(self,context)
def changed(self,context):
    global DIRTY
    if not core.MUTATING: DIRTY=time.monotonic()
def profile(self,context):
    self.gap=.3 if self.material=="PETG" else .2
    self.bite=.15 if self.material=="PETG" else .3
    changed(self,context)
def target_changed(self,context):
    o=self.target
    self.load_defined=bool(o and o.get("pf_load_direction") is not None)
    if self.load_defined:self.load=o["pf_load_direction"]
    changed(self,context)

def target_poll(self,obj): return core.model(obj)
def overlay_changed(self,context):
    if context:
        for o in context.scene.objects:
            if o.get("pf_role")=="overlay":o.hide_viewport=not self.show_overhangs


ENUM_CACHE={}
def enum_items(name,items):
    def get(self,context):
        lang=language(context)
        key=(name,lang)
        if key not in ENUM_CACHE:
            ENUM_CACHE[key]=[(ident,IT.get(label,label) if lang=="IT" else label,desc,i) for i,(ident,label,desc) in enumerate(items)]
        return ENUM_CACHE[key]
    return get

class PF_Settings(bpy.types.PropertyGroup):
    target:PointerProperty(name="Target model",type=bpy.types.Object,poll=target_poll,update=target_changed)
    show_all_steps:BoolProperty(name="Show all steps at once",default=False)
    show_hud:BoolProperty(name="Viewport statistics",default=True)
    load_defined:BoolProperty(default=False)
    repair_details:BoolProperty(name="Repair settings",default=False)
    batch:BoolProperty(name="Process selected models",default=False,update=changed)
    placement:EnumProperty(name="Placement",items=enum_items("placement",[("AUTO","Automatic + manual",""),("MANUAL","Manual only","")]),default=0,update=changed)
    auto_update:BoolProperty(name="Automatic update",description="Rebuild after edits settle; Esc cancels a running calculation",default=False,update=changed)
    show_overhangs:BoolProperty(name="Highlight overhangs",default=True,update=overlay_changed)
    threshold:FloatProperty(name="Overhang angle",default=45,min=30,max=70,update=threshold_changed)
    material:EnumProperty(name="Material",items=[("PLA","PLA",""),("PETG","PETG","")],update=profile)
    layer_height:FloatProperty(name="Layer height (mm)",default=.2,min=.08,max=.4,precision=3,update=changed)
    gap:FloatProperty(name="Support gap (mm)",default=.2,min=.1,max=.4,precision=3,update=changed)
    bite:FloatProperty(name="Tine bite (mm)",default=.3,min=.05,max=.6,precision=3,update=changed)
    tines:BoolProperty(name="Connecting tines",default=True,update=changed)
    density:FloatProperty(name="Tine grip",default=0,min=0,max=1,update=changed)
    coverage:FloatProperty(name="Wide-face coverage",default=.5,min=0,max=1,update=changed)
    cutout:EnumProperty(name="Wall cutouts",items=enum_items("cutout",[(v,n,"") for v,n in [("none","Solid"),("diamond","Diamond"),("triangle","Triangle"),("arch","Arch"),("lattice","Lattice")]]),update=changed)
    pad:EnumProperty(name="Bed pad",items=enum_items("pad",[("off","Off",""),("auto","Auto",""),("light","Light",""),("sure","Sure hold",""),("custom","Custom","")]),default=1,update=changed)
    pad_height:FloatProperty(name="Pad height (mm)",default=.2,min=.08,max=1,update=changed)
    pad_gap:FloatProperty(name="Pad gap (mm)",default=.12,min=0,max=.5,precision=3,update=changed)
    pad_grip:FloatProperty(name="Pad grip (mm)",default=0,min=-.2,max=.3,precision=3,update=changed)
    pad_margin:FloatProperty(name="Pad spread (mm)",default=4,min=1,max=12,update=changed)
    sway:BoolProperty(name="Sway braces",default=False,update=changed)
    brace_from:FloatProperty(name="Brace grip from (mm)",default=0,min=0,max=2000,update=changed)
    brace_spacing:FloatProperty(name="Brace tine spacing (mm)",default=6,min=2,max=30,update=changed)
    brace_depth:FloatProperty(name="Brace depth (%)",default=15,min=5,max=50,update=changed)
    load:FloatVectorProperty(name="Load direction (model axes)",size=3,default=(1,0,0),min=-1,max=1,update=load_changed)
    bed_x:FloatProperty(name="Width (mm)",default=256,min=20,max=2000)
    bed_y:FloatProperty(name="Depth (mm)",default=256,min=20,max=2000)
    bed_z:FloatProperty(name="Height (mm)",default=256,min=20,max=2000)
    show_layers:BoolProperty(name="Layer direction guides",default=False)
    status:StringProperty(default="Ready")

IT={
"Target model":"Modello da supportare","Use selected model":"Usa modello selezionato",
"Import STL / 3MF / STEP":"Importa STL / 3MF / STEP","Export print geometry":"Esporta geometria di stampa",
"Process selected models":"Elabora modelli selezionati","Placement":"Posizionamento","Automatic + manual":"Automatico + manuale","Manual only":"Solo manuale",
"Automatic update":"Aggiornamento automatico","Highlight overhangs":"Evidenzia sbalzi","Overhang angle":"Angolo sbalzi",
"Material":"Materiale","Layer height (mm)":"Altezza layer (mm)","Support gap (mm)":"Distanza supporto (mm)",
"Tine bite (mm)":"Penetrazione dentini (mm)","Connecting tines":"Dentini di collegamento","Tine grip":"Presa dei dentini",
"Wide-face coverage":"Copertura superfici ampie","Wall cutouts":"Alleggerimenti","Solid":"Pieno","Diamond":"Rombo","Triangle":"Triangolo","Arch":"Arco","Lattice":"Reticolo",
"Bed pad":"Base di adesione","Off":"Disattivata","Auto":"Automatica","Light":"Leggera","Sure hold":"Presa forte","Custom":"Personalizzata",
"Pad height (mm)":"Spessore base (mm)","Pad gap (mm)":"Distanza base (mm)","Pad grip (mm)":"Presa base (mm)","Pad spread (mm)":"Estensione base (mm)",
"Sway braces":"Rinforzi anti-oscillazione","Brace grip from (mm)":"Inizio presa rinforzo (mm)","Brace tine spacing (mm)":"Passo dentini rinforzo (mm)",
"Brace depth (%)":"Profondità rinforzo (%)","Load direction (model axes)":"Direzione carico (assi modello)",
"Width (mm)":"Larghezza (mm)","Depth (mm)":"Profondità (mm)","Height (mm)":"Altezza (mm)","Layer direction guides":"Guide direzione layer",
"Update supports":"Aggiorna supporti","Analyze":"Analizza","Draw wall: two clicks":"Disegna parete: due clic",
"Place sway brace":"Posiziona rinforzo","Remove selected supports":"Rimuovi supporti selezionati",
"Restore automatic supports":"Ripristina supporti automatici","Clear manual placements":"Cancella posizionamenti manuali",
"Place on bed":"Appoggia al piatto","Centre on bed":"Centra sul piatto","Lay face on bed":"Appoggia una faccia",
"Suggest orientations":"Suggerisci orientamenti","Suggest for load direction":"Suggerisci per direzione del carico",
"Apply suggestion":"Applica proposta","Create / update build plate":"Crea / aggiorna piatto virtuale",
"Use millimetres":"Usa millimetri","Clear generated objects":"Elimina oggetti generati","Clear entire scene…":"Svuota tutta la scena…",
"Analysis details":"Dettagli analisi","Ready":"Pronto","Calculating… Esc to cancel":"Calcolo… Esc per annullare",
"Preparation":"Preparazione","Supports":"Supporti","Orientation":"Orientamento","Build plate and cleanup":"Piatto e pulizia",
"Model and supports":"Modello e supporti","Model only":"Solo modello","Supports only":"Solo supporti","Include":"Includi",
"Format":"Formato","STL separate files":"STL separati","STL combined":"STL unico","3MF assembly":"Assieme 3MF",
"Strength scores are qualitative, not a structural simulation.":"Valutazione qualitativa, non una simulazione strutturale.",
"Inspect the slicer preview before printing.":"Verifica l’anteprima dello slicer prima di stampare.",
"Delete ALL objects in this scene?":"Eliminare TUTTI gli oggetti di questa scena?",
"You can undo this operation.":"Questa operazione è annullabile.",
"Reset orientation":"Ripristina orientamento","Choose a target model":"Scegli un modello","Show layers":"Mostra layer"
}
IT.update({'Prepare Scene': 'Prepara scena', 'Reset Scene': 'Reimposta scena', 'Create a dedicated PrintFins scene.': 'Crea una scena dedicata a PrintFins.', 'Set units to millimeters.': 'Imposta le unità in millimetri.', 'Set up the viewport and build plate.': 'Prepara vista e piatto di stampa.', 'Other scenes are preserved.': 'Conserva le altre scene.', 'Show all steps at once': 'Mostra tutti i passaggi', 'Viewport statistics': 'Statistiche nella vista', 'Repair settings': 'Impostazioni riparazione', 'Recommended order:': 'Ordine consigliato:', '1. Prepare Scene': '1. Prepara scena', '2. Import model': '2. Importa modello', '3. Check and repair the model': '3. Verifica e ripara il modello', '4. Set overhang angle and analyze': '4. Imposta angolo sbalzi e analizza', '5. Set load direction and orient': '5. Imposta sforzo e orienta', '6. Generate and inspect fins': '6. Genera e controlla le pinne', '7. Export separate parts': '7. Esporta parti separate', 'Add-on preferences': 'Preferenze add-on', '1 · Import model': '1 · Importa modello', '2 · Check and repair': '2 · Verifica e ripara', '3 · Overhangs': '3 · Sbalzi', '4 · Load and orientation': '4 · Sforzo e orientamento', '5 · Fins': '5 · Pinne', '6 · Export': '6 · Esporta', 'Import model': 'Importa modello', 'Check model': 'Verifica modello', 'Repair model': 'Ripara modello', 'Topology check passed': 'Controllo topologico superato', 'Repair or inspection needed': 'Occorre riparare o verificare', 'Open boundary edges': 'Bordi aperti', 'Edges with more than two faces': 'Spigoli con più di due facce', 'Duplicate vertices': 'Vertici duplicati', 'Loose edges': 'Spigoli isolati', 'Loose vertices': 'Vertici isolati', 'Degenerate faces': 'Facce degeneri', 'Inconsistent normals': 'Normali incoerenti', 'Inward shells': 'Gusci con normali interne', 'Self-intersections are not checked.': 'Le auto-intersezioni non sono verificate.', 'Repair keeps an untouched backup.': 'La riparazione conserva una copia originale.', 'Restore pre-repair model': 'Ripristina modello originale', 'Analyze overhangs': 'Analizza sbalzi', 'Statistics appear in the viewport.': 'Le statistiche appaiono nella vista.', 'Load direction': 'Direzione dello sforzo', 'Arrows follow the current view.': 'Le frecce seguono la vista corrente.', 'Load': 'Sforzo', 'Toward view': 'Verso la vista', 'Away from view': 'Opposto alla vista', 'Orient for load': 'Orienta per lo sforzo', 'Qualitative layer alignment, not stress simulation.': 'Stima qualitativa, non simulazione strutturale.', 'Overhangs': 'Sbalzi', 'Area': 'Area', 'Bed contact': 'Contatto piatto', 'Fins': 'Pinne', 'Bed pad': 'Pad sul piatto', 'Analysis out of date — update overhangs': 'Analisi da aggiornare: ricalcola gli sbalzi', 'Build plate and volume': 'Piatto e volume di stampa', 'Model repair': 'Riparazione modello', 'Show build plate': 'Mostra piatto', 'Show build volume': 'Mostra volume', 'Wireframe plate': 'Piatto a reticolo', 'Plate color': 'Colore piatto', 'Plate thickness (mm)': 'Spessore piatto (mm)', 'Corner radius (mm)': 'Raggio angoli (mm)', 'Merge distance (mm)': 'Distanza unione (mm)', 'Max hole sides': 'Numero massimo lati foro', 'Fill holes': 'Chiudi fori', 'Remove loose geometry': 'Rimuovi geometria isolata', 'Recalculate outward normals': "Ricalcola normali verso l'esterno", 'Remove degenerate geometry': 'Rimuovi geometria degenere', 'Apply plate settings': 'Applica impostazioni piatto', '0 hole sides fills every boundary: check functional openings.': '0 chiude tutti i bordi: controlla le aperture funzionali.', 'Reset the PrintFins scene?': 'Reimpostare la scena PrintFins?', 'Models and supports in this scene will be removed.': 'Modelli e supporti in questa scena saranno eliminati.', 'Other scenes are preserved. Undo is available.': 'Le altre scene restano intatte. Puoi annullare.', 'Set load direction': 'Imposta direzione dello sforzo'})

def language(context=None):
    c=context or bpy.context
    view=c.preferences.view
    if not view.use_translate_interface:return "EN"
    locale=view.language
    if locale=="DEFAULT":locale=bpy.app.translations.locale
    return "IT" if locale.startswith("it") else "EN"
def tr(s,text):return IT.get(text,text) if language()=="IT" else text
def prop(layout,s,name,**kwargs):
    text=s.bl_rna.properties[name].name
    layout.prop(s,name,text=tr(s,text),**kwargs)
def button(layout,s,id,text,**kwargs): return layout.operator(id,text=tr(s,text),**kwargs)
def label(l,s,text,**kwargs):l.label(text=tr(s,text),**kwargs)
def stage(c,number):
    from . import workflow
    s=c.scene.pf;o=core.target(c)
    if number==1:return True
    if s.show_all_steps:return True
    if number==2:return workflow.prepared(c.scene)
    if number==3:return o is not None and workflow.prepared(c.scene)
    if number==4:return workflow.checked(o)
    if number==5:return bool(o and o.get("pf_stats"))
    if number==6:return bool(o and o.get("pf_stats"))
    if number==7:return workflow.checked(o)
    return False

class PF_PT_main(bpy.types.Panel):
    bl_label="PrintFins";bl_idname="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins"
    def draw(self,c):
        from .workflow import prepared
        s=c.scene.pf;l=self.layout;l.enabled=not core.BUSY
        button(l,s,"printfins.prepare_scene","Reset Scene" if prepared(c.scene) else "Prepare Scene",icon="SCENE_DATA")
        box=l.box();col=box.column(align=True);col.scale_y=.85
        for text in ("Create a dedicated PrintFins scene.","Set units to millimeters.","Set up the viewport and build plate.","Other scenes are preserved."):
            label(col,s,text)
        if core.BUSY:label(l,s,s.status,icon="TIME")

class PF_PT_workflow(bpy.types.Panel):
    bl_label="Workflow";bl_idname="PF_PT_workflow";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=1;bl_options={"DEFAULT_CLOSED"}
    def draw(self,c):
        l=self.layout;s=c.scene.pf
        prop(l,s,"show_all_steps")
        box=l.box();label(box,s,"Recommended order:",icon="SORTTIME")
        for text in ("1. Prepare Scene","2. Import model","3. Check and repair the model","4. Set overhang angle and analyze","5. Set load direction and orient","6. Optional: generate and inspect fins","7. Export separate parts"):
            label(box,s,text)
        button(l,s,"printfins.preferences","Add-on preferences",icon="PREFERENCES")

class PF_PT_import(bpy.types.Panel):
    bl_label="1 · Import model";bl_idname="PF_PT_import";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=2
    @classmethod
    def poll(cls,c):return stage(c,2)
    def draw(self,c):
        from .workflow import prepared
        l=self.layout;s=c.scene.pf;l.enabled=prepared(c.scene) and not core.BUSY
        button(l,s,"printfins.import_file","Import model",icon="IMPORT")
        label(l,s,"STL · 3MF · STEP")
        if core.target(c) or core.model(c.active_object):
            prop(l,s,"target");button(l,s,"printfins.target","Use selected model")
            prop(l,s,"batch")

class PF_PT_repair(bpy.types.Panel):
    bl_label="2 · Check and repair";bl_idname="PF_PT_repair";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=3
    @classmethod
    def poll(cls,c):return stage(c,3)
    def draw(self,c):
        from . import preferences
        l=self.layout;s=c.scene.pf;o=core.target(c);l.enabled=o is not None and not core.BUSY
        button(l,s,"printfins.check_mesh","Check model",icon="VIEWZOOM")
        if o and o.get("pf_mesh_report"):
            r=json.loads(o["pf_mesh_report"]);box=l.box()
            label(box,s,"Topology check passed" if o.get("pf_mesh_ready") else "Repair or inspection needed",icon="CHECKMARK" if o.get("pf_mesh_ready") else "ERROR")
            for key,name in (("boundary_edges","Open boundary edges"),("multi_face_edges","Edges with more than two faces"),("duplicate_vertices","Duplicate vertices"),("wire_edges","Loose edges"),("loose_vertices","Loose vertices"),("degenerate_faces","Degenerate faces"),("winding_edges","Inconsistent normals"),("inward_shells","Inward shells")):
                if r.get(key):box.label(text=tr(s,name)+": "+str(r[key]))
            label(box,s,"Self-intersections are not checked.")
        if o and o.get("pf_mesh_report") and not o.get("pf_mesh_ready"):
            button(l,s,"printfins.repair_mesh","Repair model",icon="MOD_BUILD")
            label(l,s,"Repair keeps an untouched backup.")
            prop(l,s,"repair_details")
            if s.repair_details:
                prefs=preferences.get(c)
                if hasattr(prefs,"bl_rna"):
                    box=l.box()
                    for field in ("repair_merge","repair_hole_sides","repair_fill","repair_loose","repair_normals","repair_degenerate"):
                        box.prop(prefs,field,text=tr(s,prefs.bl_rna.properties[field].name))
                button(l,s,"printfins.preferences","Add-on preferences")
        if o and any(q.get("pf_backup_owner")==o.get("pf_id") for q in c.scene.objects):
            button(l,s,"printfins.restore_mesh","Restore pre-repair model")

class PF_PT_analysis(bpy.types.Panel):
    bl_label="3 · Overhangs";bl_idname="PF_PT_analysis";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=4
    @classmethod
    def poll(cls,c):return stage(c,4)
    def draw(self,c):
        from .workflow import checked
        l=self.layout;s=c.scene.pf;l.enabled=checked(core.target(c)) and not core.BUSY
        prop(l,s,"threshold");prop(l,s,"show_overhangs");prop(l,s,"show_hud")
        button(l,s,"printfins.calculate","Analyze overhangs",icon="VIEWZOOM").action="analyze"
        label(l,s,"Statistics appear in the viewport.")
        o=core.target(c)
        from .workflow import analyzed
        if analyzed(o,s):
            stats=json.loads(o.get("pf_stats","{}"))
            if stats.get("regions")==0:label(l,s,"No overhangs found.",icon="CHECKMARK")
            else:l.label(text=tr(s,"Overhangs")+": "+str(stats.get("regions",0)))


def load_quality(c):
    from mathutils import Vector
    o=core.target(c)
    if not o or not c.scene.pf.load_defined:return None
    direction=o.matrix_world.to_3x3() @ Vector(c.scene.pf.load)
    cross=abs(direction.normalized().z)
    return "good" if cross<=.5 else "mixed" if cross<=.866 else "poor"

class PF_PT_orient(bpy.types.Panel):
    bl_label="4 · Load and orientation";bl_idname="PF_PT_orient";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=5
    @classmethod
    def poll(cls,c):return stage(c,5)
    def draw(self,c):
        l=self.layout;s=c.scene.pf;o=core.target(c);l.enabled=o is not None and not core.BUSY
        button(l,s,"printfins.draw","Lay a face flat",icon="SNAP_FACE").kind="face"
        label(l,s,"Load direction",icon="EMPTY_SINGLE_ARROW")
        label(l,s,"Arrows follow the current view.")
        row=l.row(align=True);row.label(text="");row.operator("printfins.load_axis",text="",icon="TRIA_UP").axis="UP";row.label(text="")
        row=l.row(align=True)
        row.operator("printfins.load_axis",text="",icon="TRIA_LEFT").axis="LEFT"
        label(row,s,"Load")
        row.operator("printfins.load_axis",text="",icon="TRIA_RIGHT").axis="RIGHT"
        row=l.row(align=True);row.label(text="");row.operator("printfins.load_axis",text="",icon="TRIA_DOWN").axis="DOWN";row.label(text="")
        row=l.row(align=True)
        button(row,s,"printfins.load_axis","Toward view").axis="TOWARD"
        button(row,s,"printfins.load_axis","Away from view").axis="AWAY"
        if not s.load_defined:label(l,s,"Set the load to include strength.")
        button(l,s,"printfins.calculate","Suggest orientation",icon="ORIENTATION_GIMBAL").action="orient"
        candidates=json.loads(o.get("pf_candidates","{}")).get("candidates",[]) if o else []
        for i,candidate in enumerate(candidates):
            box=l.box()
            title=tr(s,"Orientation")+" "+str(i+1)
            button(box,s,"printfins.pose",title,icon="CHECKMARK" if o.get("pf_selected_pose")==i else "OBJECT_ORIGIN").index=i
            box.label(text=tr(s,"Height")+f': {candidate.get("height",0):.1f} mm')
            box.label(text=tr(s,"Overhangs")+": "+str(candidate.get("regions",0)))
            box.label(text=tr(s,"Bed contact")+f': {candidate.get("bedArea",0):.1f} mm²')
            if candidate.get("load"):
                label(box,s,{"good":"Layers aligned with load","mixed":"Load partly crosses layers","poor":"Load crosses layers"}[candidate["load"]["quality"]])
        quality=load_quality(c)
        if quality in {"mixed","poor"}:
            box=l.box();label(box,s,"Load crosses the print layers.",icon="ERROR")
            label(box,s,"Reorient to improve layer strength.")
            button(box,s,"printfins.calculate","Reorient for strength",icon="ORIENTATION_GIMBAL").action="strength"
        elif quality=="good":label(l,s,"Layers aligned with load",icon="CHECKMARK")
        label(l,s,"Qualitative layer alignment, not stress simulation.")
        button(l,s,"printfins.reset","Reset orientation")

class PF_PT_supports(bpy.types.Panel):
    bl_label="5 · Fins";bl_idname="PF_PT_supports";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=6;bl_options={"DEFAULT_CLOSED"}
    @classmethod
    def poll(cls,c):return stage(c,6)
    def draw(self,c):
        l=self.layout;s=c.scene.pf;l.enabled=core.target(c) is not None and not core.BUSY
        for p in ("placement","auto_update","material","layer_height","gap","tines"):prop(l,s,p)
        if s.tines:prop(l,s,"bite");prop(l,s,"density",slider=True)
        prop(l,s,"coverage",slider=True);prop(l,s,"cutout");prop(l,s,"pad")
        if s.pad=="custom":
            for p in ("pad_height","pad_gap","pad_grip","pad_margin"):prop(l,s,p)
        prop(l,s,"sway")
        if s.sway:
            for p in ("brace_from","brace_spacing","brace_depth"):prop(l,s,p)
        button(l,s,"printfins.calculate","Update supports",icon="MOD_BUILD").action="generate"
        button(l,s,"printfins.draw","Draw wall: two clicks").kind="wall"
        button(l,s,"printfins.draw","Place sway brace").kind="brace"
        button(l,s,"printfins.remove","Remove selected supports")
        button(l,s,"printfins.remove","Restore automatic supports").restore=True
        button(l,s,"printfins.remove","Clear manual placements").clear_manual=True

class PF_PT_export(bpy.types.Panel):
    bl_label="6 · Export";bl_idname="PF_PT_export";bl_parent_id="PF_PT_main";bl_space_type="VIEW_3D";bl_region_type="UI";bl_category="PrintFins";bl_order=7
    @classmethod
    def poll(cls,c):return stage(c,7)
    def draw(self,c):
        l=self.layout;s=c.scene.pf;l.enabled=core.target(c) is not None and not core.BUSY
        button(l,s,"printfins.export_file","Export print geometry",icon="EXPORT")
        button(l,s,"printfins.info","Analysis details")

PENDING=set()
def validate_target(c):
    from . import workflow
    o=core.target(c)
    if not o or core.BUSY or core.MUTATING or c.mode!="OBJECT":return
    pointer=o.as_pointer()
    if pointer not in PENDING:return
    PENDING.discard(pointer)
    if o.get("pf_mesh_stamp") and workflow.stamp(o)!=o["pf_mesh_stamp"]:
        workflow.invalidate(o,geometry=True)
    if o.get("pf_analysis_matrix") and json.dumps([list(row) for row in o.matrix_world])!=o["pf_analysis_matrix"]:
        workflow.invalidate(o)
    if o.get("pf_candidate_hash") and o["pf_candidate_hash"]!=core.fingerprint(o,c):
        workflow.invalidate(o)

def watch():
    global DIRTY,LAST_TRANSFORM
    if not hasattr(bpy.types.Scene,"pf"):return None
    c=bpy.context
    if not c.scene:return .5
    s=c.scene.pf;o=core.target(c)
    if core.BUSY or core.MUTATING or c.mode!="OBJECT":return .5
    validate_target(c)
    if not o or not s.auto_update:return .5
    current=(o.as_pointer(),tuple(x for row in o.matrix_world for x in row),core.settings_key(s))
    if current!=LAST_TRANSFORM:LAST_TRANSFORM=current;DIRTY=time.monotonic()
    if DIRTY and time.monotonic()-DIRTY>1:
        DIRTY=0
        try:
            # Auto-update only regenerates fins after the user explicitly enabled them.
            if o.get("pf_hash") and core.stale(o,c):bpy.ops.printfins.calculate(action="generate")
        except Exception as e:core.LAST_ERROR=str(e)
    return .5

@bpy.app.handlers.persistent
def depsgraph_changed(scene,depsgraph):
    global DIRTY
    if core.MUTATING or not hasattr(scene,"pf"):return
    o=scene.pf.target
    if o and any(u.id.original==o or u.id.original==o.data for u in depsgraph.updates):
        # Never evaluate or mutate meshes from inside a depsgraph update.
        PENDING.add(o.as_pointer())
        if scene.pf.auto_update:DIRTY=time.monotonic()

CLASSES=[PF_Settings,PF_PT_main,PF_PT_workflow,PF_PT_import,PF_PT_repair,PF_PT_analysis,PF_PT_orient,PF_PT_supports,PF_PT_export]

IT.update({'No overhangs found.': 'Nessuno sbalzo rilevato.', 'No overhangs found in this orientation.': 'Nessuno sbalzo rilevato in questo orientamento.', 'Overhang analysis completed.': 'Analisi degli sbalzi completata.', 'Lay a face flat': 'Appoggia una faccia sul piatto', 'Suggest orientation': 'Suggerisci orientamento', 'Set the load to include strength.': 'Imposta lo sforzo per valutare la resistenza.', 'Height': 'Altezza', 'Layers aligned with load': 'Layer allineati allo sforzo', 'Load partly crosses layers': 'Lo sforzo attraversa in parte i layer', 'Load crosses layers': 'Lo sforzo attraversa i layer', 'Load crosses the print layers.': 'Lo sforzo attraversa i layer di stampa.', 'Reorient to improve layer strength.': 'Riorienta per migliorare la resistenza.', 'Reorient for strength': 'Riorienta per la resistenza', 'No suitable flat orientation found.': 'Nessun orientamento piano adatto trovato.'})

IT.update({"6. Optional: generate and inspect fins":"6. Se servono, genera e verifica le pinne"})
