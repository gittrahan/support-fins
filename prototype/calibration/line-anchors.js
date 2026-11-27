/** Controlled lower-contact specimens. Each variant uses the same explicit Draw
 * placement, rather than removing automatically placed walls to match counts.
 * deno run -A prototype/calibration/line-anchors.js <output-directory>
 * Generic geometry only: apply and verify a native printer profile before printing.
 */
import { drawnWall } from '../../web/draw.js';
import { applyTunables } from '../../web/fins.js';
import { PROP } from '../../web/prop.js';
import { writeThreeMF } from '../../web/threemf.js';

/** One closed rectangular tunnel. Both sides support the short, transverse roof
 * bridges; the central fin splits their 8 mm span into two 4 mm spans. */
export function anchorCouponBody() {
  const ys=[-6,-4,4,6],zs=[0,3,13,16],t=[];
  const solid=(y,z)=>y>=0&&y<3&&z>=0&&z<3&&(y!==1||z!==1);
  const q=(a,b,c,d)=>t.push(...a,...b,...c,...a,...c,...d);
  for(let y=0;y<3;y++)for(let z=0;z<3;z++){
    if(!solid(y,z))continue;
    const a=ys[y],b=ys[y+1],lo=zs[z],hi=zs[z+1];
    q([-18,a,lo],[-18,a,hi],[-18,b,hi],[-18,b,lo]);
    q([18,a,lo],[18,b,lo],[18,b,hi],[18,a,hi]);
    if(!solid(y-1,z))q([-18,a,lo],[18,a,lo],[18,a,hi],[-18,a,hi]);
    if(!solid(y+1,z))q([18,b,lo],[-18,b,lo],[-18,b,hi],[18,b,hi]);
    if(!solid(y,z-1))q([-18,b,lo],[18,b,lo],[18,a,lo],[-18,a,lo]);
    if(!solid(y,z+1))q([-18,a,hi],[18,a,hi],[18,b,hi],[-18,b,hi]);
  }
  return Float64Array.from(t);
}
const triples=a=>Array.from({length:a.length/3},(_,i)=>Array.from(a.slice(i*3,i*3+3)));
export function anchorCoupon(nozzle, variant) {
  if(![0.4,0.8].includes(nozzle)||!['gap-only','welded','line-anchors'].includes(variant))throw Error('unknown coupon variant');
  const saved={...PROP},body=anchorCouponBody();
  const settings={nozzle,wallLines:2,tineDir:'horizontal',propGap:0.2,sideClearance:0.35,
    bottomGap:variant==='welded'?0:0.2,bottomAnchors:variant==='line-anchors',iface:false,cutout:'none'};
  try{
    applyTunables(settings);
    const r=drawnWall([-17.5,0,13],[17.5,0,13],body,0,{tines:false,layerHeight:0.2});
    if(!r.ok)throw Error(`${nozzle}/${variant}: ${r.reason}`);
    return {body:triples(body),fins:r.tris,settings,props:1,top:r.top,floors:r.floors};
  }finally{Object.assign(PROP,saved);}
}
if(import.meta.main){
 const out=Deno.args[0];if(!out)throw Error('Pass an output directory');
 await Deno.mkdir(out,{recursive:true});const rows=[];
 for(const nozzle of [.4,.8])for(const variant of ['gap-only','welded','line-anchors']){
  const r=anchorCoupon(nozzle,variant),name=`line-anchors-${nozzle}-${variant}`;
  // Two distinct mesh parts in one intended specimen, without boolean merging.
  // Native print preparation must preserve and check the designed contact heights.
  const blob=await writeThreeMF(r.body,r.fins,name);
  await Deno.writeFile(`${out}/${name}.3mf`,new Uint8Array(await blob.arrayBuffer()));
  rows.push({file:name+'.3mf',settings:r.settings,props:r.props,top:r.top,floors:r.floors});
 }
 await Deno.writeTextFile(`${out}/manifest.json`,JSON.stringify(rows,null,2)+'\n');
}
