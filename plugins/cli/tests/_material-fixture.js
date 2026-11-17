import { meshXML } from '../../../web/threemf.js';
import { zipDeflate } from '../../../web/zip.js';
import { block } from '../../../tests/_util.js';
import { run } from '../cli.js';

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const triples = (p) => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
export async function materialFixture({ sequence = 'by layer', mirror = false, positions = block(0,20,0,20,0,20),
  upright = false, second = false, negative = false, palette = ['#FFFFFF','#FFFFFF','#123456'] } = {}) {
  const q = upright ? 1 : Math.cos(35*Math.PI/180), s = upright ? 0 : Math.sin(35*Math.PI/180);
  const resource = (id) => `<object id="${id}"><components><component objectid="1" p:path="/3D/Objects/body.model"/>`
    + (negative ? '<component objectid="2" p:path="/3D/Objects/cut.model"/>' : '') + '</components></object>';
  const config = (id) => `<object id="${id}"><metadata key="name" value="painted cube ${id}"/><metadata key="extruder" value="1"/><metadata key="enable_support" value="1"/>`
    + '<part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part>'
    + (negative ? '<part id="2" subtype="negative_part"/>' : '') + '</object>';
  const build = (id, x) => `<item objectid="${id}" transform="${mirror ? -1 : 1} 0 0 0 ${q} ${s} 0 ${-s} ${q} ${x} 60 0"/>`;
  const instance = (id) => `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${id}"/></model_instance>`;
  const files = [
    { name:'3D/3dmodel.model', data:`<model xmlns="${CORE}" xmlns:p="${PROD}" unit="millimeter"><resources>${resource(100)}${second ? resource(200) : ''}</resources><build>${build(100,60)}${second ? build(200,120) : ''}</build></model>` },
    { name:'3D/Objects/body.model', data:`<model xmlns="${CORE}" unit="millimeter"><resources><object id="1">${meshXML(triples(positions), (i)=>i%2 ? ' paint_color="8"' : '')}</object></resources></model>` },
    { name:'Metadata/model_settings.config', data:`<config>${config(100)}${second ? config(200) : ''}<plate><metadata key="plater_id" value="1"/>${instance(100)}${second ? instance(200) : ''}</plate></config>` },
    { name:'Metadata/project_settings.config', data:JSON.stringify({ layer_height:'0.2',initial_layer_print_height:'0.2',nozzle_diameter:['0.4'],filament_colour:palette,
      filament_type:palette.map(()=>'PETG'),print_sequence:sequence,enable_support:'1',wall_filament:'0',sparse_infill_filament:'0',solid_infill_filament:'0' }) },
    { name:'[Content_Types].xml', data:'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name:'_rels/.rels', data:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
  ];
  if (negative) files.push({ name:'3D/Objects/cut.model',data:`<model xmlns="${CORE}" unit="millimeter"><resources><object id="2">${meshXML(triples(block(8,12,8,12,-1,21)))}</object></resources></model>` });
  return new Uint8Array(await (await zipDeflate(files)).arrayBuffer());
}

export async function materialCLI(source, flags = [], overrides = {}) {
  const files = new Map([['part.3mf',source]]), out=[],err=[];
  const io = { read:async(p)=>files.get(p),out:(s)=>out.push(s),err:(s)=>err.push(s),
    checkProjectOutput:async()=>{},writeProject:async(_input,p,b)=>files.set(p,b),...overrides };
  const code=await run(['part.3mf','--preserve-project','--json',...flags],io);
  return { code,files,err,out,result:out.length ? JSON.parse(out[0]) : null };
}
