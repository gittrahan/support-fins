import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openProjectCache } from '../project-cache.js';
import { assert } from '../../../tests/_util.js';

const data = { triangles: new Float32Array([0, 1 / 3, -2, 3, 4, 5, 6, 7, 8]),
  offset: { x: -12.25, y: 7, z: 0 }, stats: { fins: 1, nested: { count: 2 } } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function temporary(fn) {
  const dir = await Deno.makeTempDir();
  try { await fn(dir); } finally { await Deno.remove(dir, { recursive: true }); }
}

function request(dir, changes = {}, warnings = []) {
  return { input: path.join(dir, 'part.3mf'), bytes: new Uint8Array([1, 2, 3]),
    selection: { objects: [1, 2], explicit: false }, settings: { dialog: { gap: 0.1 } },
    warn: (s) => warnings.push(s), ...changes };
}
const open = (r, build = 'build-a') => openProjectCache(r, async () => build);
const folders = (root) => fs.readdir(root);
const records = async (root) => (await fs.readdir(root, { recursive: true })).filter((n) => n.endsWith('.cache'));

Deno.test('cache: persist exact geometry, offsets, stats and zero-fin objects; remove only completed run', () => temporary(async (dir) => {
  const r = request(dir), root = `${r.input}.fins-cache`, c = await open(r);
  await c.save(1, data);
  await c.save(2, { ...data, triangles: new Float32Array() });
  const resumed = await open(r);
  const first = await resumed.load(1), second = await resumed.load(2);
  assert(same(first, data), 'checkpoint changed geometry or metadata');
  assert(second && second.triangles.length === 0, 'zero-fin object treated as a miss');
  assert(await resumed.load(3) === null, 'absent object reused');
  await resumed.finish();
  let gone = false;
  try { await fs.stat(root); } catch (e) { gone = e.code === 'ENOENT'; }
  assert(gone, 'completed cache left behind');
}));

Deno.test('cache: invalidate changed source, selection, settings or engine; retain other runs', () => temporary(async (dir) => {
  const r = request(dir), root = `${r.input}.fins-cache`, c = await open(r);
  await c.save(1, data);
  for (const [changes, build] of [
    [{ bytes: new Uint8Array([1, 2, 4]) }, 'build-a'],
    [{ selection: { objects: [1], explicit: true } }, 'build-a'],
    [{ selection: { objects: [1, 2], explicit: true } }, 'build-a'],
    [{ settings: { dialog: { gap: 0.2 } } }, 'build-a'],
    [{}, 'build-b'],
  ]) {
    const warnings = [], other = await open(request(dir, changes, warnings), build);
    assert(await other.load(1) === null, 'stale result accepted');
    assert(warnings.some((s) => s.includes('no compatible')), 'invalidation not explained');
    await other.finish();
    assert((await records(root)).length === 1, 'other run deleted the original checkpoint');
  }
  assert(same(await (await open(r)).load(1), data), 'original cache no longer reusable');
}));

Deno.test('cache: settings key order and input filename do not change content identity', () => temporary(async (dir) => {
  const cacheDir = path.join(dir, 'shared'), r = request(dir, { cacheDir, settings: { dialog: { gap: 0.1, layerHeight: 0.2 } } });
  await (await open(r)).save(1, data);
  const c = await open({ ...r, input: path.join(dir, 'renamed.3mf'), settings: { dialog: { layerHeight: 0.2, gap: 0.1 } } });
  assert(same(await c.load(1), data), 'equivalent settings/content missed the cache');
  await c.finish();
  assert((await fs.stat(cacheDir)).isDirectory() && (await folders(cacheDir)).length === 0,
    'custom cache parent was removed');
}));

Deno.test('cache: corrupt records warn and miss; incomplete writes and unrelated files survive cleanup', () => temporary(async (dir) => {
  const warnings = [], r = request(dir, {}, warnings), root = `${r.input}.fins-cache`;
  await (await open(r)).save(1, data);
  const [record] = await records(root), file = path.join(root, record), bytes = await fs.readFile(file);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(file, bytes);
  const folder = path.dirname(file);
  await fs.writeFile(path.join(folder, 'object-2-interrupted.cache.tmp'), 'incomplete');
  await fs.writeFile(path.join(folder, 'notes.txt'), 'unrelated');
  await fs.writeFile(path.join(root, 'keep.txt'), 'keep');
  const c = await open(r);
  assert(await c.load(1) === null && await c.load(2) === null, 'corrupt or partial record reused');
  assert(warnings.some((s) => s.includes('checksum mismatch')), 'corruption not reported');
  await c.save(1, data);
  await c.finish();
  assert((await records(root)).length === 0, 'completed checkpoints retained');
  assert(await fs.readFile(path.join(root, 'keep.txt'), 'utf8') === 'keep', 'unrelated root file removed');
  assert(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8') === 'unrelated', 'unrelated run file removed');
  assert(await fs.readFile(path.join(folder, 'object-2-interrupted.cache.tmp'), 'utf8') === 'incomplete', 'unknown temporary write removed');
}));

Deno.test('cache: symlinked checkpoint is not read and cleanup cannot delete its target', () => temporary(async (dir) => {
  const r = request(dir), root = `${r.input}.fins-cache`, warnings = [];
  const c = await open(r); await c.save(1, data);
  const [record] = await records(root), file = path.join(root, record), outside = path.join(dir, 'keep.bin');
  await fs.rename(file, outside); await fs.symlink(outside, file);
  const next = await open({ ...r, warn: (s) => warnings.push(s) });
  assert(await next.load(1) === null, 'symlink followed');
  await next.finish();
  assert((await fs.stat(outside)).size > 0, 'symlink target deleted');
  assert(warnings.some((s) => s.includes('not a regular file')), 'symlink not reported');
}));

Deno.test('cache: failed write is fatal and leaves earlier checkpoints intact', () => temporary(async (dir) => {
  const r = request(dir), root = `${r.input}.fins-cache`, c = await open(r);
  await c.save(1, data);
  const [name] = await folders(root), folder = path.join(root, name), moved = path.join(root, 'moved');
  await fs.rename(folder, moved); await fs.writeFile(folder, 'not a directory');
  let error;
  try { await c.save(2, data); } catch (e) { error = e; }
  assert(error?.message.includes('cannot save checkpoint for object 2'), 'write failure was not fatal/actionable');
  await fs.unlink(folder); await fs.rename(moved, folder);
  assert(same(await (await open(r)).load(1), data), 'previous checkpoint lost');
}));

Deno.test('cache: concurrent writers use independent records and cleanup does not remove unseen writes', () => temporary(async (dir) => {
  const r = request(dir), a = await open(r), b = await open(r);
  await Promise.all([a.save(1, data), b.save(2, data)]);
  await a.finish();
  assert(same(await (await open(r)).load(2), data), 'one writer removed another writer\'s checkpoint');
  await b.finish();
}));

Deno.test('cache: source build identity detects uncommitted engine/schema changes without Git', () => temporary(async (dir) => {
  await fs.mkdir(path.join(dir, 'plugins/cli'), { recursive: true });
  await fs.mkdir(path.join(dir, 'plugins/shared/engine'), { recursive: true });
  await fs.mkdir(path.join(dir, 'web'), { recursive: true });
  const module = path.join(dir, 'plugins/cli/project-cache.mjs');
  await fs.copyFile(new URL('../project-cache.js', import.meta.url), module);
  const { runtimeIdentity } = await import(pathToFileURL(module).href);
  const before = await runtimeIdentity();
  await fs.writeFile(path.join(dir, 'web/fins.js'), 'changed engine');
  const engine = await runtimeIdentity();
  await fs.writeFile(path.join(dir, 'plugins/shared/engine/options.json'), '{"changed":true}');
  const schema = await runtimeIdentity();
  assert(before !== engine && engine !== schema, 'unstamped source edits reused a build identity');
  assert(schema === await runtimeIdentity(), 'identity unstable for unchanged files');
}));


const converted = () => ({
  ...data,
  baked: { fingerprint:'a'.repeat(64), sourceSHA256:'b'.repeat(64), settingsSHA256:'c'.repeat(64), runtime:'d'.repeat(64),
    materialPolicy:'base-material-on-cuts', warnings:['Sliced material regions may differ.'],
    compatibility:{buildIndex:0,objectId:'10',negativeOccurrences:1,materials:[{filament:2,roles:{wall_filament:1}}]},
    removed:[{path:'3D/removed.model',objectId:2,route:[1]}],
    parts:[{ positions:Float64Array.of(1/3,0,0,1/3+2**-40,0,0,1/3,1,0),
      vertexIDs:Uint32Array.of(7,8,9),sourceFaces:Int32Array.of(-1),positionOrigin:[37,51,0],
      source:{path:'3D/body.model',objectId:1,partId:1,route:[0,1]}, objectAttributes:{id:'1'},modelAttributes:{},
      properties:[],triangleAttributes:[{paint_color:'8',paint_seam:'4',paint_supports:'8'}],
      settings:{attributes:{id:'1',subtype:'normal_part'},metadata:[['extruder','2'],['wall_filament','1']]},collapsedFaces:0}]
  }
});
Deno.test('cache: complete baked bodies retain float64 boundaries, painting, identities, settings and warnings',()=>temporary(async(dir)=>{
  const r=request(dir),c=await open(r),value=converted(); await c.save(1,value); await c.save(2,data);
  const resumed=await open(r),got=await resumed.load(1),plain=await resumed.load(2);
  assert(got.baked.parts[0].positions instanceof Float64Array && got.baked.parts[0].vertexIDs instanceof Uint32Array
    && got.baked.parts[0].sourceFaces instanceof Int32Array,'geometry types lost');
  assert(got.baked.parts[0].positions[0]!==got.baked.parts[0].positions[3],'paint boundary collapsed to float32');
  const stable=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,data:Array.from(v)}:Array.isArray(v)?v.map(stable)
    :v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  assert(JSON.stringify(stable(got))===JSON.stringify(stable(value)),'conversion checkpoint changed');
  assert(same(plain,data) && !plain.baked,'unaffected record acquired conversion');
  await resumed.finish();
}));
Deno.test('cache: incomplete baked records never become completed checkpoints',()=>temporary(async(dir)=>{
  const r=request(dir),c=await open(r);
  for(const mutate of [v=>v.baked.parts[0].positions[0]=NaN,v=>v.baked.parts[0].vertexIDs=Uint32Array.of(0),
    v=>v.baked.parts[0].sourceFaces=Int32Array.of(-2),v=>v.baked.parts[0].triangleAttributes=[],
    v=>v.baked.warnings=[],v=>v.baked.analysisPositions=new Float64Array(9),v=>v.triangles=new Float32Array()]) {
    const value=converted(); mutate(value); let error;
    try {await c.save(1,value);}catch(e){error=e;}
    assert(error?.message.includes('cannot save checkpoint'),'invalid baked record saved');
    assert(await (await open(r)).load(1)===null,'failed conversion checkpoint reused');
  }
}));
Deno.test('cache: checksum and version reject damaged baked geometry before reuse',()=>temporary(async(dir)=>{
  for(const version of [false,true]) {
    const warnings=[],r=request(dir,{settings:{version}},warnings),c=await open(r); await c.save(1,converted());
    const root=`${r.input}.fins-cache`,record=(await records(root)).find(n=>n.endsWith('.cache'));
    const file=path.join(root,record),bytes=await fs.readFile(file); bytes[version?7:bytes.length-1]^=1; await fs.writeFile(file,bytes);
    assert(await (await open(r)).load(1)===null,'damaged conversion reused');
    assert(warnings.some(w=>w.includes(version?'header':'checksum')),'invalid checkpoint not explained');
    await c.finish();
  }
}));
