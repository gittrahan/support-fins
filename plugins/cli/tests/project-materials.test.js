import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { materialFixture, materialCLI } from './_material-fixture.js';
import { computeFins } from '../../shared/engine/fins_entry.js';
import { projectMaterialParts } from '../project-materials.js';
import { parseArgs, helpText, run } from '../cli.js';
import { ProjectZip } from '../project-zip.js';
import { readThreeMF, readThreeMFParts } from '../../../web/threemf.js';
import { unzip } from '../../../web/zip.js';
import { xmlTree, children, child, metadata } from '../project-xml.js';
import { openProjectCache } from '../project-cache.js';
import { readSTL, MODELS, isClosed, isOriented } from '../../../tests/_util.js';

const SUPPORTS='3D/SupportFins/supports.model', ROOT='3D/3dmodel.model', CONFIG='Metadata/model_settings.config';
const output = (r) => r.files.get('part-fins-project.3mf');
const flags=['--tine-extruder','2','--interface-extruder','3','--interface-mode','all'];

Deno.test('project materials: flags are project-only, checked and listed in help', async()=>{
  assertEquals(parseArgs(['x.3mf',...flags]).interfaceExtruder,3);
  for (const flag of ['--tine-extruder','--interface-extruder','--interface-mode']) assertStringIncludes(helpText(),flag);
  for (const args of [['--tine-extruder','0'],['--interface-extruder','1.5'],['--interface-mode','off'],
    ['--interface-mode','all'],['--tine-extruder','2','--tine-dir','vertical']]) {
    const r=await materialCLI(await materialFixture(),args);
    assertEquals(r.code,2,args.join(' ')); assertEquals(r.files.size,1);
  }
  const messages=[];
  assertEquals(await run(['x.stl','--tine-extruder','2'],{out:()=>{},err:(s)=>messages.push(s)}),2);
  assertStringIncludes(messages.join(' '),'require --preserve-project');
});

Deno.test('project materials: semantic adapter opt-in and subsequent reset preserve legacy geometry', async()=>{
  const source=await materialFixture();
  const positions=readThreeMFParts(await unzip(source),{buildIndex:0,doublePrecision:true,outwardWinding:true}).objects[0].positions;
  const ordinary=computeFins(positions), tagged=computeFins(positions,{}, {supportMaterials:true});
  assert(!ordinary.supportSolids);
  assertEquals(tagged.triangles,ordinary.triangles); assertEquals(tagged.stats,ordinary.stats);
  const split=await projectMaterialParts(tagged,{body:1,tine:2,interface:3});
  assert(split.materialParts.some((p)=>p.role==='body') && split.materialParts.some((p)=>p.role==='tine'));
  assert(!split.supportSolids);
  const iface=computeFins(positions,{}, {supportMaterials:true,interfaceMode:'all'});
  assert(iface.supportSolids.some((v)=>v[4]?.role==='interface'));
  assertEquals(computeFins(positions),ordinary,'material state leaked into next ordinary generation');
  await assertRejects(()=>projectMaterialParts({...tagged,supportSolids:null},{body:1,tine:2,interface:3}),Error,'provenance');
});

for (const sequence of ['by layer','by object']) for (const mirror of [false,true]) Deno.test(`project materials: ${sequence}, mirror=${mirror}; assignments and originals retained`,async()=>{
  const source=await materialFixture({sequence,mirror,second:true}), original=new ProjectZip(source);
  const r=await materialCLI(source,[...flags,'--object','1']);
  assertEquals(r.code,0,r.err.join('\n'));
  const zip=new ProjectZip(output(r)), cfg=xmlTree(await zip.text(CONFIG));
  const roots=children(child(xmlTree(await zip.text(ROOT)),'build'),'item');
  assertEquals(roots.length,sequence==='by layer'?3:2);
  const parts=children(cfg,'object').flatMap((o)=>children(o,'part')).filter((p)=>metadata(p).name?.includes('supports'));
  assertEquals(parts.map((p)=>+metadata(p).extruder),[1,2,3]);
  for (const key of ['wall_filament', 'sparse_infill_filament', 'solid_infill_filament']) {
    assertEquals(parts.map((p)=>+metadata(p)[key]),[1,2,3], 'saved feature assignments must not override the selected support material');
  }
  assertEquals(r.result.objects[0].materials.map((m)=>[m.role,m.filament]),[['body',1],['tine',2],['interface',3]]);
  assertStringIncludes(r.result.report,'3 support parts added');
  for(const path of ['3D/Objects/body.model','Metadata/project_settings.config']) {
    const a=original.entries.get(path),b=zip.entries.get(path);
    assert(a.size > 0 && b.size > 0);
    assertEquals(zip.bytes.slice(b.offset,b.end),original.bytes.slice(a.offset,a.end));
    assertEquals(await zip.read(path),await original.read(path));
  }
  const unselected=children(cfg,'object').find((o)=>o.attrs.id==='200');
  const originalCfg=await original.text(CONFIG), old=children(xmlTree(originalCfg),'object').find((o)=>o.attrs.id==='200');
  assertEquals((await zip.text(CONFIG)).slice(unselected.start,unselected.end),originalCfg.slice(old.start,old.end));
  const decoded=await readThreeMF(output(r),{withComponents:true,outwardWinding:true,doublePrecision:true});
  assert(decoded.positions.every(Number.isFinite));
  const supports=decoded.objects.flatMap((o)=>o.components).filter((c)=>c.path===SUPPORTS);
  assertEquals(supports.length,3);
  for(const c of supports) {
    const triples=Array.from({length:c.positions.length/3},(_,i)=>Array.from(c.positions.slice(i*3,i*3+3)));
    assert(isClosed(triples) && isOriented(triples),'exported support material part is not a closed outward solid');
  }
  assertStringIncludes(r.result.objectResults[0].warnings.join(' '),'reduce tine grip');
  if(sequence==='by object')assertStringIncludes(r.result.objectResults[0].warnings.join(' '),'weld');
});

Deno.test('project materials: default interface is flat; zero-fin objects and checks write no material geometry',async()=>{
  const source=await materialFixture();
  const automatic=await materialCLI(source,['--interface-extruder','3']);
  const flat=await materialCLI(source,['--interface-extruder','3','--interface-mode','flat']);
  const normalized=async(r)=>(await new ProjectZip(output(r)).text(SUPPORTS)).replace(/p:UUID="[^"]*"/g,'');
  assertEquals(await normalized(automatic),await normalized(flat));
  const check=await materialCLI(source,[...flags,'--check']);
  assertEquals(check.code,0); assertEquals(check.files.size,1);
  const empty=await materialCLI(await materialFixture({upright:true}),flags);
  assertEquals(empty.code,0,empty.err.join('\n')); assertEquals(empty.result.objectResults[0].status,'no_supports');
  assertEquals(empty.result.objects[0].materials,[]);
  const bad=await materialCLI(source,['--tine-extruder','9','--object','1']);
  assertEquals(bad.code,1); assertEquals(bad.files.size,1);
});

Deno.test('project materials: flat ledge has independent interface; negative print-by-layer preserves cutters',async()=>{
  const ledge=await materialFixture({positions:readSTL(Deno.readFileSync(`${MODELS}lowledge.stl`)),upright:true});
  const result=await materialCLI(ledge,['--interface-extruder','3']);
  assertEquals(result.code,0,result.err.join('\n'));
  assert(result.result.objects[0].materials.some((m)=>m.role==='interface'));
  const source=await materialFixture({negative:true}),r=await materialCLI(source,flags);
  assertEquals(r.code,0,r.err.join('\n'));
  const a=new ProjectZip(source),b=new ProjectZip(output(r));
  assertEquals(await b.read('3D/Objects/cut.model'),await a.read('3D/Objects/cut.model'));
  assertStringIncludes(await b.text(CONFIG),'negative_part');
});

Deno.test('project materials: failed final write resumes complete role geometry and warnings',async()=>{
  const folder=await Deno.makeTempDir({prefix:'support-fins-materials-'});
  try {
    const source=await materialFixture(); let saved=0,loaded=0;
    const io={openProjectCache:async(request)=>{
      const c=await openProjectCache({...request,cacheDir:folder},async()=>'material-test');
      return {...c,save:async(...a)=>{saved++;return c.save(...a);},load:async(...a)=>{const r=await c.load(...a);if(r)loaded++;return r;}};
    }};
    const failed=await materialCLI(source,[...flags,'--resume'],{...io,writeProject:async()=>{throw new Error('test final write');}});
    assertEquals(failed.code,1); assertEquals(saved,1);
    const resumed=await materialCLI(source,[...flags,'--resume'],io),fresh=await materialCLI(source,flags);
    assertEquals(resumed.code,0,resumed.err.join('\n'));assertEquals(loaded,1);assertEquals(saved,1);
    const normalize=async(r)=>(await new ProjectZip(output(r)).text(SUPPORTS)).replace(/p:UUID="[^"]*"/g,'');
    assertEquals(await normalize(resumed),await normalize(fresh));
    assertEquals(resumed.result.objectResults,fresh.result.objectResults);
  } finally {await Deno.remove(folder,{recursive:true});}
});

Deno.test('project materials: negative sequential objects retain baked materials and append all support roles',async()=>{
  const source=await materialFixture({negative:true,sequence:'by object'}),r=await materialCLI(source,flags);
  assertEquals(r.code,0,r.err.join('\n'));
  const zip=new ProjectZip(output(r)),config=await zip.text(CONFIG);
  assert(!config.includes('negative_part'),'active cutter could cut away material support parts');
  assertEquals(r.result.objects[0].materials.map((m)=>m.filament),[1,2,3]);
  assertStringIncludes(r.result.objectResults[0].warnings.join(' '),'baked cuts');
  assertEquals((await new ProjectZip(source).text('3D/Objects/body.model')),(await zip.text('3D/Objects/body.model')));
});
