import { readSTL, MODELS, analyze, fins, rotY } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
const OPTS = { mode: 'auto', bedPad: true, tines: true, tineDensity: 0, coverage: 0.5, layerHeight: 0.2 };
const T = p => buildTopology({ getAttribute: k => k==='position'?{array:p}:null });
const raw = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`));
function bake(pos,m,d=[0,0,0]){const o=new Float64Array(pos.length);for(let i=0;i<pos.length;i+=3){const x=pos[i],y=pos[i+1],z=pos[i+2];o[i]=m[0]*x+m[3]*y+m[6]*z+d[0];o[i+1]=m[1]*x+m[4]*y+m[7]*z+d[1];o[i+2]=m[2]*x+m[5]*y+m[8]*z+d[2];}return o;}
function cen(p){let a=[1e9,-1e9,1e9,-1e9,1e9];for(let i=0;i<p.length;i+=3){a[0]=Math.min(a[0],p[i]);a[1]=Math.max(a[1],p[i]);a[2]=Math.min(a[2],p[i+1]);a[3]=Math.max(a[3],p[i+1]);a[4]=Math.min(a[4],p[i+2]);}const o=new Float64Array(p.length);for(let i=0;i<p.length;i+=3){o[i]=p[i]-(a[0]+a[1])/2;o[i+1]=p[i+1]-(a[2]+a[3])/2;o[i+2]=p[i+2]-a[4];}return o;}
const run = p => { const t=T(p), r=analyze(t,45,IDENTITY3), b=fins.buildFins(t,r,IDENTITY3,OPTS); return `${b.braceCount} braces ${b.tines} tines ${b.triangles.length/3} tris`; };
for (const deg of [20,35,50]) {
  const base = cen(bake(raw, rotY(deg)));
  const out = [run(base)];
  for (const eps of [1e-13, 1e-10, 1e-7]) { const q = base.map((v,i)=> v + (i%7===0? eps : -eps)); out.push(`eps ${eps}: ${run(q)}`); }
  out.push('plate: '+run(cen(bake(raw, rotY(deg), [137.25,88.5,3]))));
  console.log('Y'+deg+'\n  '+out.join('\n  '));
}
