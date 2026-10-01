"""Viewport-only HUD and a projected 2D load arrow; nothing is exported."""
import bpy,json,math
from mathutils import Vector
from . import core
_HANDLE=None
def rows(c):
    from .workflow import analyzed
    o=core.target(c)
    if not o or not analyzed(o,c.scene.pf):return None
    stats=json.loads(o.get("pf_stats","{}"))
    supports=[q for q in c.scene.objects if q.get("pf_role")=="support" and q.get("pf_owner")==o.get("pf_id")]
    pads=sum(q.get("pf_key")=="pad" for q in supports)
    return [("Overhangs",str(stats.get("regions",0))),("Area",f'{stats.get("overArea",0):.2f} mm²'),
      ("Bed contact",f'{stats.get("bedArea",0):.2f} mm²'),("Fins",str(len(supports)-pads)),
      ("—",""),("Bed pad",str(pads))]
def draw():
    import blf,gpu
    from gpu_extras.batch import batch_for_shader
    from bpy_extras import view3d_utils
    from .ui import tr
    c=bpy.context
    if not c.region or not c.region_data or not hasattr(c.scene,"pf"):return
    s=c.scene.pf;o=core.target(c)
    if not o or not s.show_hud:return
    font=0;scale=c.preferences.system.ui_scale
    blf.size(font,int(14*scale));blf.color(font,.95,.97,1,1)
    blf.enable(font,blf.SHADOW);blf.shadow(font,5,0,0,0,.9)
    data=rows(c)
    if data:
        x=24*scale;y=c.region.height-140*scale
        for label,value in data:
            blf.position(font,x,y,0);blf.draw(font,tr(None,label))
            blf.position(font,x+130*scale,y,0);blf.draw(font,value);y-=23*scale
    elif o.get("pf_stats"):
        blf.position(font,24*scale,c.region.height-140*scale,0)
        blf.draw(font,tr(None,"Analysis out of date — update overhangs"))
    if s.load_defined and o.get("pf_load_anchor") is not None:
        anchor=o.matrix_world @ Vector(o["pf_load_anchor"])
        direction=(o.matrix_world.to_3x3() @ Vector(s.load)).normalized()
        point=view3d_utils.location_3d_to_region_2d(c.region,c.region_data,anchor)
        if point:
            view=c.region_data.view_matrix.to_3x3() @ direction
            xy=Vector((view.x,view.y))
            shader=gpu.shader.from_builtin("UNIFORM_COLOR")
            gpu.state.blend_set("ALPHA");gpu.state.line_width_set(3*scale)
            if xy.length>.01:
                xy.normalize();end=point+xy*85*scale;side=Vector((-xy.y,xy.x))
                coords=[point,end,end,end-xy*16*scale+side*8*scale,end,end-xy*16*scale-side*8*scale]
            else:
                coords=[]
                for i in range(32):
                    a=i*math.tau/32;b=(i+1)*math.tau/32
                    coords.extend([point+Vector((math.cos(a),math.sin(a)))*10*scale,point+Vector((math.cos(b),math.sin(b)))*10*scale])
                if view.z<0:coords +=[point+Vector((-6,-6))*scale,point+Vector((6,6))*scale,point+Vector((-6,6))*scale,point+Vector((6,-6))*scale]
                else:coords +=[point-Vector((2,0))*scale,point+Vector((2,0))*scale]
            shader.bind();shader.uniform_float("color",(1,.62,.08,1))
            batch_for_shader(shader,"LINES",{"pos":coords}).draw(shader)
            blf.position(font,point.x+12*scale,point.y-22*scale,0);blf.draw(font,tr(None,"Load direction"))
            gpu.state.line_width_set(1);gpu.state.blend_set("NONE")
    blf.disable(font,blf.SHADOW)
def register():
    global _HANDLE
    if _HANDLE is None:_HANDLE=bpy.types.SpaceView3D.draw_handler_add(draw,(),"WINDOW","POST_PIXEL")
def unregister():
    global _HANDLE
    if _HANDLE is not None:
        bpy.types.SpaceView3D.draw_handler_remove(_HANDLE,"WINDOW");_HANDLE=None
