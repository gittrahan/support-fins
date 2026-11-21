import { checkMaterialCase } from './check.js';
self.onmessage=async({data})=>{
 try{self.postMessage({result:await checkMaterialCase(data.bytes,data.spec,true)});}
 catch(error){self.postMessage({error:error.stack??error.message});}
};
