import { assert } from './_util.js';
import { checkMaterialCase } from '../prototype/material-stress/check.js';
import { materialCases } from '../prototype/material-stress/cases.js';
const cases=materialCases(['torus','staircase','tshape','portal']).filter(c=>
 (c.model==='torus'&&c.pose==='x30'&&c.mode==='full'&&c.variant==='all-separate') ||
 (c.model==='staircase'&&c.pose==='x30'&&c.mode==='full'&&c.variant==='flat-separate') ||
 (c.model==='tshape'&&c.pose==='x30'&&c.mode==='auto'&&c.variant==='tines-only') ||
 (c.model==='portal'&&c.pose==='x60y30'&&c.mode==='auto'&&c.variant==='all-separate'));
for(const spec of cases)Deno.test(`material stress: ${spec.model}/${spec.pose}/${spec.mode}/${spec.variant}`,async()=>{
 const bytes=await Deno.readFile(new URL(`../prototype/stress/models/${spec.model}.stl`,import.meta.url));
 const r=await checkMaterialCase(bytes,spec,true);
 assert(r.sourceTriangles>0 && r.roles.length>0,'empty stress fixture');
 assert(r.workerParity,'worker path not checked');
});
