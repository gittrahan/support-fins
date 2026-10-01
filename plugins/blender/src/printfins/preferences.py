"""User defaults live in Blender Preferences, never in the workflow panel."""
import bpy
from types import SimpleNamespace
from bpy.props import BoolProperty, FloatProperty, FloatVectorProperty, IntProperty

DEFAULTS=dict(bed_x=256.0,bed_y=256.0,bed_z=256.0,show_plate=True,show_volume=True,
 plate_wireframe=False,plate_color=(.12,.18,.24,1),plate_thickness=2.0,corner_radius=5.0,
 repair_merge=.0001,repair_hole_sides=6,repair_fill=True,repair_loose=True,
 repair_normals=True,repair_degenerate=True)
def get(context=None):
    c=context or bpy.context
    addon=c.preferences.addons.get(__package__)
    return addon.preferences if addon else SimpleNamespace(**DEFAULTS)
def repair_key(p):
    return tuple(getattr(p,k) for k in ("repair_merge","repair_hole_sides","repair_fill","repair_loose","repair_normals","repair_degenerate"))
class PF_Preferences(bpy.types.AddonPreferences):
    bl_idname=__package__
    bed_x:FloatProperty(name="Width (mm)",default=256,min=20,max=2000)
    bed_y:FloatProperty(name="Depth (mm)",default=256,min=20,max=2000)
    bed_z:FloatProperty(name="Height (mm)",default=256,min=20,max=2000)
    show_plate:BoolProperty(name="Show build plate",default=True)
    show_volume:BoolProperty(name="Show build volume",default=True)
    plate_wireframe:BoolProperty(name="Wireframe plate",default=False)
    plate_color:FloatVectorProperty(name="Plate color",subtype="COLOR",size=4,min=0,max=1,default=(.12,.18,.24,1))
    plate_thickness:FloatProperty(name="Plate thickness (mm)",default=2,min=.1,max=20)
    corner_radius:FloatProperty(name="Corner radius (mm)",default=5,min=0,max=50)
    repair_merge:FloatProperty(name="Merge distance (mm)",description="Maximum physical distance for merging duplicate vertices",default=.0001,min=.000001,max=1,precision=6)
    repair_hole_sides:IntProperty(name="Max hole sides",description="Maximum boundary loop edges to fill; zero means all holes",default=6,min=0,max=1000)
    repair_fill:BoolProperty(name="Fill holes",default=True)
    repair_loose:BoolProperty(name="Remove loose geometry",default=True)
    repair_normals:BoolProperty(name="Recalculate outward normals",default=True)
    repair_degenerate:BoolProperty(name="Remove degenerate geometry",default=True)
    def draw(self,c):
        from .ui import tr
        l=self.layout
        for title,fields in (
            ("Build plate and volume",("bed_x","bed_y","bed_z","show_plate","show_volume","plate_wireframe","plate_color","plate_thickness","corner_radius")),
            ("Model repair",("repair_merge","repair_hole_sides","repair_fill","repair_loose","repair_normals","repair_degenerate"))):
            box=l.box();box.label(text=tr(None,title))
            for field in fields:box.prop(self,field,text=tr(None,self.bl_rna.properties[field].name))
        l.operator("printfins.update_plate",text=tr(None,"Apply plate settings"))
        l.label(text=tr(None,"Repair keeps an untouched backup."))
        l.label(text=tr(None,"0 hole sides fills every boundary: check functional openings."))
CLASSES=[PF_Preferences]
