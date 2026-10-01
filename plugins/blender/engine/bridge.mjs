import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildTopology, analyze, IDENTITY3 } from './web/overhangs.js';
import { buildFins, applyTunables } from './web/fins.js';
import { drawnWall } from './web/draw.js';
import { swayAtFace } from './web/sway.js';
import { loadAlignment } from './web/orient.js';
import { orientationCandidates } from './orient.mjs';
import { STEP_PARAMS, stepObjects } from './web/step.js';
const [request, output] = process.argv.slice(2);
const req = JSON.parse(fs.readFileSync(request, 'utf8'));
const clean = (v) => JSON.parse(JSON.stringify(v, (_k,x) => ArrayBuffer.isView(x) ? Array.from(x) : x));
try {
  if (req.action === 'step') {
    const require = createRequire(import.meta.url);
    const factory = require('./web/vendor/occt-import-js-0.0.23/occt-import-js.js');
    const occt = await factory();
    const r = stepObjects(occt.ReadStepFile(new Uint8Array(fs.readFileSync(req.path)), STEP_PARAMS));
    fs.writeFileSync(output, JSON.stringify(clean(r))); process.exit(0);
  }
  const results = [];
  for (const item of req.items) {
    const pos = new Float64Array(item.positions);
    if (!pos.length || pos.length % 9 || !pos.every(Number.isFinite)) throw Error('Invalid triangle data');
    const topo = buildTopology({getAttribute: () => ({array: pos})});
    let a = analyze(topo, req.threshold, IDENTITY3);
    if (req.action === 'orient') {
      results.push({id: item.id, ...orientationCandidates(topo, item.loadDefined ? item.load : null, {threshold:req.threshold})}); continue;
    }
    if (req.action === 'strength') {
      results.push({id: item.id, ...orientationCandidates(topo, item.load, {threshold:req.threshold,strength:true})}); continue;
    }
    const stats = {size:a.size, overArea:a.overArea, bedArea:a.bedArea,
      regions:a.regions.length, overFaceCount:a.overFaceCount, offset:a.offset,
      load:loadAlignment(item.load || [1,0,0]), over:Array.from(a.over)};
    const meshes = [], warnings = [];
    if (req.action !== 'analyze') {
      applyTunables(req.options.tunables);
      const built = buildFins(topo,a,IDENTITY3,req.options);
      stats.unserved=built.unserved; stats.sagRisk=built.sagRisk;
      stats.tines=built.tines; stats.skipped=built.skipped; stats.pad=built.pad;
      const seat = p => [p[0]+a.offset.x,p[1]+a.offset.y,p[2]+a.offset.z];
      const unseat = tris => tris.flatMap(p=>p.map((v,i)=>v-[a.offset.x,a.offset.y,a.offset.z][i]));
      if (req.placement !== 'MANUAL') for (const f of built.fins || []) {
        if ((item.removed || []).includes(String(f.id))) continue;
        const tris=[];
        for(const [start,end] of f.triRanges) { for(let j=start;j<end;j++) tris.push(built.triangles[j]); };
        if(tris.length) meshes.push({key:String(f.id),kind:f.kind,positions:unseat(tris)});
      }
      if(built.padTriangles?.length) meshes.push({key:'pad',kind:'pad',positions:unseat(built.padTriangles)});
      const part=Array.from(pos, (v,i)=>v+[a.offset.x,a.offset.y,a.offset.z][i%3]);
      const avoided = {walls:(built.fins||[]).map(f=>f.line).filter(Boolean),braces:built.sway?.braces||[]};
      for(const m of item.manual || []) {
        let r;
        if(m.kind==='brace') {
          let best=Infinity,face=0;
          for(let f=0;f<topo.nFaces;f++){
            let d=0;
            for(let k=0;k<3;k++){
              const c=(pos[f*9+k]+pos[f*9+3+k]+pos[f*9+6+k])/3;
              d+=(c-m.a[k])**2;
            }
            if(d<best){best=d;face=f;}
          }
          r=swayAtFace(topo,a,IDENTITY3,face,seat(m.a),{...req.options.sway,tines:req.options.tines,layerHeight:req.options.layerHeight},avoided);
        } else r=drawnWall(seat(m.a),seat(m.b),part,0,
          {...req.options,topo,rot:IDENTITY3,offset:a.offset});
        if(r.ok) {
          meshes.push({key:m.id,kind:m.kind,positions:unseat(r.tris),manual:true});
          if(m.kind==='brace') avoided.braces.push(r);
        } else warnings.push(m.id+': '+r.reason);
      }
    }
    results.push({id:item.id,stats,meshes,warnings});
  }
  fs.writeFileSync(output, JSON.stringify(clean({results})));
} catch(e) {
  fs.writeFileSync(output, JSON.stringify({error:String(e.stack||e)})); process.exitCode=1;
}
