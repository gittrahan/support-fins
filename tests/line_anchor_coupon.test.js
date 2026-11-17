import {assert,isClosed} from './_util.js';
import {anchorCoupon} from '../prototype/calibration/line-anchors.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
Deno.test('line anchor coupons: closed, equal placements and unchanged roof contacts for each nozzle',()=>{
 for(const nozzle of [.4,.8]){
  const rows=['gap-only','welded','line-anchors'].map(v=>anchorCoupon(nozzle,v));
  for(const r of rows){
   assert(r.props===1 && isClosed(r.body) && isClosed(r.fins),'not one closed specimen');
   const volume = t => t.reduce((sum,a,i) => {
     if(i%3)return sum; const b=t[i+1],c=t[i+2];
     return sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
   },0);
   assert(volume(r.body)>0 && volume(r.fins)>0,'inward specimen');
   assert(same(r.body,rows[0].body),'source body changed');
   assert(same(r.top,rows[0].top),'placement or roof changed');
   // The welded contact's bottom taper rises to 1.5 mm above the floor.
   const upper=r.fins.filter((_,i)=>Math.floor(i/3)*3===i).flatMap((_,i)=>{
    const t=r.fins.slice(i*3,i*3+3);return t.every(p=>p[2]>5)?t:[];
   });
   const base=rows[0].fins.filter((_,i)=>i%3===0).flatMap((_,i)=>{
    const t=rows[0].fins.slice(i*3,i*3+3);return t.every(p=>p[2]>5)?t:[];
   });
   assert(same(upper,base),'geometry above lower-contact region changed');
  }
  assert(rows[2].fins.length>rows[0].fins.length,'anchors absent');
  assert(rows[2].fins.some(p=>p[2]===3),'contacts do not reach floor');
 }
});
