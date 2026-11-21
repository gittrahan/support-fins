import { buildTopology, analyze } from '../../web/overhangs.js';
import { buildFins } from '../../web/fins.js';
import { readSTL } from '../../web/stl.js';
import { partitionSupportMaterials } from '../../web/support-materials.js';
import { partitionSupportExport } from '../../web/material-worker-client.js';
import { VARIANTS, rotation } from './cases.js';

export async function checkMaterialCase(bytes, spec, workerParity = false) {
  const pos=readSTL(bytes), topo=buildTopology({getAttribute:()=>({array:pos})}), rot=rotation(spec.pose);
  const settings={mode:spec.mode,bedPad:true,tines:true,tallRibs:true,
    tunables:{nozzle:.4,wallLines:2,tallRibsHeight:20,tineDir:'horizontal',cutout:spec.cutout,
      ...VARIANTS[spec.variant]}};
  const before=performance.now();
  const built=buildFins(topo,analyze(topo,45,rot),rot,settings);
  const source=[...built.triangles,...built.padTriangles];
  const generationMs=performance.now()-before, start=performance.now();
  const result=await partitionSupportMaterials(source);
  // The partitioner checks closed positive solids, union preservation and no
  // material overlap using the kernel's fixed numerical bounds. Repeat through
  // the real worker interface to also exercise serialization and role identity.
  if(workerParity){
    const worker=await partitionSupportExport(source);
    if(JSON.stringify(result)!==JSON.stringify(worker))throw Error('worker/inline partition mismatch');
  }
  return {settings,generationMs,partitionMs:performance.now()-start,
    sourceTriangles:source.length/3,tallRibs:built.tallRibs??0,padTriangles:built.padTriangles.length/3,roles:result.parts.map(p=>({role:p.role,triangles:p.triangles.length/3})),
    volume:result.volume,residual:result.residual??null,workerParity};
}
