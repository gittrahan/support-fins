/** Opt-in, serial stress runner. --out is required; generated evidence is private. */
import { materialCases } from './cases.js';
import { fullSetModels } from '../sweep/full-set.js';
const args=Object.fromEntries(Deno.args.reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
if(!args.out)throw Error('Pass --out <ignored evidence directory>');
const root=new URL('../../',import.meta.url), stock=new URL('prototype/stress/models/',root);
const models=[...Deno.readDirSync(stock)].filter(e=>e.name.endsWith('.stl')).map(e=>[e.name.slice(0,-4),new URL(e.name,stock)]).sort((a,b)=>a[0].localeCompare(b[0]));
const optional=fullSetModels(args['optional-root']??root.pathname);
for(const [name,path] of optional.found)if(!models.some(([n])=>n===name))models.push([name,path]);
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const sources=new Map();
for(const [name,path] of models){const bytes=await Deno.readFile(path);sources.set(name,{bytes,sha256:await hash(bytes)});}
await Deno.mkdir(args.out,{recursive:true});
try { await Deno.stat(`${args.out}/results.jsonl`); throw Error('Use a fresh output directory; results already exist'); }
catch(error) { if(!(error instanceof Deno.errors.NotFound))throw error; }
const specs=materialCases(models.map(([name])=>name));
const chosen=args.only?specs.filter(s=>`${s.model}/${s.pose}/${s.mode}/${s.variant}`===args.only):specs;
if(!chosen.length)throw Error('No matching cases');
const git=new Deno.Command('git',{args:['rev-parse','HEAD'],cwd:root,stdout:'piped'}).outputSync();
const tracked=new Deno.Command('git',{args:['ls-files','web','prototype/material-stress'],cwd:root,stdout:'piped'}).outputSync();
const paths=new TextDecoder().decode(tracked.stdout).trim().split('\n').filter(p=>/\.(js|wasm|json)$/.test(p));
// New tooling can be validated before committing: include it explicitly too.
for(const file of ['cases.js','check.js','worker.js','run.js'])paths.push('prototype/material-stress/'+file);
const codeHashes={};
for(const file of new Set(paths))codeHashes[file]=await hash(await Deno.readFile(new URL(file,root)));
const manifest={codeHashes,revision:new TextDecoder().decode(git.stdout).trim(),runtime:Deno.version,
  missingOptional:optional.missing,sourceHashes:Object.fromEntries([...sources].map(([n,s])=>[n,s.sha256])),cases:chosen};
await Deno.writeTextFile(`${args.out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
let failed=0;
for(const spec of chosen){
 const start=performance.now(),name=`${spec.model}/${spec.pose}/${spec.mode}/${spec.variant}`;
 const result=await new Promise(resolve=>{
  const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  const done=r=>{clearTimeout(timer);worker.terminate();resolve(r);};
  const timer=setTimeout(()=>done({error:'timeout after 180 seconds (validation gap)'}),180000);
  worker.onmessage=({data})=>done(data);worker.onerror=e=>{e.preventDefault();done({error:e.message});};
  worker.postMessage({spec,bytes:sources.get(spec.model).bytes});
 });
 const row={name,sourceSHA256:sources.get(spec.model).sha256,elapsedMs:performance.now()-start,...result};
 if(result.error)failed++;
 await Deno.writeTextFile(`${args.out}/results.jsonl`,JSON.stringify(row)+'\n',{append:true});
 console.log(`${result.error?'FAIL':'PASS'} ${name} ${(row.elapsedMs/1000).toFixed(2)}s${result.error?' '+result.error.split('\n')[0]:''}`);
}
console.log(`${chosen.length-failed}/${chosen.length} passed; ${optional.missing.length} optional models unavailable`);
if(failed)Deno.exit(1);
