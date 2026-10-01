import bpy,sys,pathlib,math,json,types
import argparse, tempfile
parser=argparse.ArgumentParser()
parser.add_argument('--package',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
temporary=tempfile.TemporaryDirectory(prefix='printfins-test-')
ROOT=pathlib.Path(temporary.name)
repo_path=ROOT/"extensions"
repo_path.mkdir(exist_ok=True)
bpy.ops.preferences.extension_repo_add(name="PrintFins Isolated Test",type="LOCAL",use_custom_directory=True,custom_directory=str(repo_path))
repo=bpy.context.preferences.extensions.repos[-1]
print("REPO",repo.module,flush=True)
bpy.ops.extensions.package_install_files(filepath=str(pathlib.Path(args.package).resolve()),repo=repo.module,enable_on_install=True,overwrite=True)
module="bl_ext."+repo.module+".printfins"
addon=sys.modules[module]
assert hasattr(bpy.types.Scene,"pf"),"Extension not enabled"
c=bpy.context
original_scene=c.scene
original_objects=set(original_scene.objects)
assert bpy.ops.printfins.prepare_scene()=={'FINISHED'}
assert c.scene != original_scene
assert set(original_scene.objects)==original_objects
bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
c.scene.unit_settings.scale_length=.001
bpy.ops.mesh.primitive_cube_add(size=40)
o=c.active_object;o.rotation_euler.y=math.radians(35);c.scene.pf.target=o
bpy.ops.printfins.calculate(action="generate")
assert any(q.get("pf_role")=="support" for q in c.scene.objects)
print("INSTALLED_RUNTIME_WORKS",flush=True)
# Exercise all panel draw methods, both languages and conditional controls.
class Layout:
 def __init__(self): self.enabled=True
 def prop(self,*a,**kw):pass
 def label(self,*a,**kw):pass
 def operator(self,*a,**kw):return types.SimpleNamespace()
 def row(self,*a,**kw):return self
 def column(self,*a,**kw):return self
 def box(self,*a,**kw):return self
for lang in ("EN","IT"):
 c.preferences.view.language="it_IT" if lang=="IT" else "en_US"
 c.preferences.view.use_translate_interface=True
 for pad in ("auto","custom"):
  c.scene.pf.pad=pad;c.scene.pf.sway=True
  for cls in addon.ui.CLASSES[1:]:
   cls.draw(types.SimpleNamespace(layout=Layout()),c)
print("PANELS_EN_IT_PASS",flush=True)
# Generate a 3MF using the installed package, proving there is no source-tree dependency.
c.scene.pf.sway=False;c.scene.pf.pad="auto"
bpy.ops.printfins.calculate(action="generate")
bpy.ops.printfins.export_file(filepath=str(ROOT/"installed_export.3mf"),format="3MF",scope="BOTH")
assert addon.preferences.get(c).bl_rna is not None
assert bpy.ops.printfins.check_mesh()=={"FINISHED"}
assert bpy.ops.printfins.load_axis(axis="UP")=={"FINISHED"}
assert bpy.ops.printfins.calculate(action="strength")=={"FINISHED"}
assert addon.workflow.analyzed(addon.core.target(c),c.scene.pf)
assert bpy.ops.printfins.calculate(action="orient")=={"FINISHED"}
o=addon.core.target(c)
assert len(json.loads(o["pf_candidates"])["candidates"])==3
for i in (0,1,2,0):
 assert bpy.ops.printfins.pose(index=i)=={"FINISHED"}
 addon.ui.validate_target(c)
assert "REGISTER" not in addon.operators.PF_OT_calculate.bl_options
assert "apply_strength" not in bpy.ops.printfins.calculate.get_rna_type().properties
# The flat cube has no unsupported regions; exports remain valid without fins.
o.rotation_euler=(0,0,0)
assert bpy.ops.printfins.calculate(action="analyze")=={"FINISHED"}
assert addon.workflow.analyzed(o,c.scene.pf)
print("PACKAGED_INSTALLATION_PASS",flush=True)
