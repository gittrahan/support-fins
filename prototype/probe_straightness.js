// Why the straightness gate is RMS-deviation/chord and not arc-length/chord.
// Arc length grows without bound as you sample a curve more finely, so the old
// `tortuosity` measured the SAMPLING; this shows both, side by side, over the
// same region at 8/14/24/48/96 stations. Kept as the evidence for PROP.maxWander.
const WEB='/Users/matthewtrahan/projects/support-fins/web';
const {buildTopology,analyze}=await import(`${WEB}/overhangs.js`);
const {contactLine,straightness:shipped,PROP}=await import(`${WEB}/prop.js`);
// the retired gate, kept here only so the two can be printed together
function arcOverChord(line){let arc=0;
  for(let i=0;i<line.length-1;i++)arc+=Math.hypot(line[i+1][0]-line[i][0],line[i+1][1]-line[i][1]);
  const c=Math.hypot(line.at(-1)[0]-line[0][0],line.at(-1)[1]-line[0][1]);
  return c<1e-9?Infinity:arc/c;}
function readBinarySTL(b){const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);const n=dv.getUint32(80,true);
 const pos=new Float32Array(n*9);for(let f=0;f<n;f++){const o=84+f*50+12;for(let i=0;i<9;i++)pos[f*9+i]=dv.getFloat32(o+i*4,true);}return pos;}
function rotX(d){const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [1,0,0,0,c,s,0,-s,c];}
// density-independent straightness: RMS distance from the best-fit line / chord
function straightness(line){
  const n=line.length;let cx=0,cy=0;for(const p of line){cx+=p[0];cy+=p[1];}cx/=n;cy/=n;
  let sxx=0,sxy=0,syy=0;
  for(const p of line){const dx=p[0]-cx,dy=p[1]-cy;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}
  const tr=sxx+syy,det=sxx*syy-sxy*sxy;
  const lam=tr/2+Math.sqrt(Math.max(0,tr*tr/4-det));
  let ax=sxy,ay=lam-sxx;if(Math.hypot(ax,ay)<1e-9){ax=1;ay=0;}
  const an=Math.hypot(ax,ay);ax/=an;ay/=an;
  let ss=0,lo=Infinity,hi=-Infinity;
  for(const p of line){const dx=p[0]-cx,dy=p[1]-cy;
    const t=dx*ax+dy*ay;const perp=dx*(-ay)+dy*ax;ss+=perp*perp;
    lo=Math.min(lo,t);hi=Math.max(hi,t);}
  const rms=Math.sqrt(ss/n);
  return {rms, ratio: rms/Math.max(1e-9,hi-lo)};
}
const path=Deno.args[0],tilt=Number(Deno.args[1]);
const pos=readBinarySTL(Deno.readFileSync(path));
const topo=buildTopology({getAttribute:()=>({array:pos})});
const rot=rotX(tilt),res=analyze(topo,45,rot),off=res.offset;
const v=[0,0,0];const seat=(i)=>{const x=pos[i],y=pos[i+1],z=pos[i+2];
 v[0]=rot[0]*x+rot[3]*y+rot[6]*z+off.x;v[1]=rot[1]*x+rot[4]*y+rot[7]*z+off.y;v[2]=rot[2]*x+rot[5]*y+rot[8]*z+off.z;return v;};
console.log(`\n${path.split('/').pop()} @${tilt}`);
for(const [ri,region] of res.regions.entries()){
  if(region.area<200)continue;
  const pts=[];const tris=new Float64Array(region.faces.length*9);
  for(let k=0;k<region.faces.length;k++){const f=region.faces[k];let gx=0,gy=0,gz=0;
   for(let i=0;i<3;i++){seat(f*9+i*3);const p=[v[0],v[1],v[2]];pts.push(p);
    tris[k*9+i*3]=v[0];tris[k*9+i*3+1]=v[1];tris[k*9+i*3+2]=v[2];gx+=p[0];gy+=p[1];gz+=p[2];}
   pts.push([gx/3,gy/3,gz/3]);}
  const out=[];
  for(const n of [8,14,24,48,96]){
    const line=contactLine(pts,tris,n);
    if(!line){out.push(`${n}:none`);continue;}
    const s=straightness(line);
    out.push(`${String(n).padStart(3)}: arc/chord ${arcOverChord(line).toFixed(2)}  rms ${s.rms.toFixed(2)}mm  ratio ${s.ratio.toFixed(3)}  shipped ${shipped(line).toFixed(3)}`);
  }
  console.log(`  R${ri} area ${region.area.toFixed(0)}mm2`);
  for(const o of out) console.log(`      ${o}`);
}
