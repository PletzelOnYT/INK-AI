import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const html=fs.readFileSync("index.html","utf8");
const match=html.match(/<script id="strokeWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/);
assert.ok(match,"The online neural trajectory worker must be embedded in the downloaded HTML");
const source=match[1].trim();
fs.writeFileSync("/tmp/ink-stroke-worker.js",source);
const canonical=fs.readFileSync("src/stroke_worker.js","utf8").trim();
assert.equal(source,canonical,"Embedded model must match the version-controlled source");
for(const forbidden of ["nearestHandwriting(","prototypeSet(","skeletonizeGlyph(","GLYPH_REFERENCES_URL","ink-human-glyph-references.json","maskBitmap("]){
 assert.ok(!html.includes(forbidden),"Prohibited legacy template / raster completion: "+forbidden);
}
assert.ok(html.includes("ink-stroke-sequence-v1.json"));
assert.ok(html.includes("window.__inkAssistModel=\"online-stroke-gru\""));
const file="models/ink-stroke-sequence-v1.json";
if(!fs.existsSync(file)){
 console.log("MODEL PENDING: Genuine sequence weights not yet published; refusing template fallback");
 process.exit(0);
}
const model=JSON.parse(fs.readFileSync(file,"utf8"));
assert.equal(model.format,"ink-online-stroke-mdn-v1");
assert.ok(model.training.trained_from_scratch);
assert.ok(model.training.real_writer_holdout_glyphs>1800);
assert.ok(model.architecture.max_prefix>=80);
assert.ok(model.labels.includes("A")&&model.labels.includes("z")&&model.labels.includes("+")&&model.labels.includes("^"));
const messages=[];
const ctx={
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 self:{postMessage:message=>messages.push(message)},
 Math,Float32Array,Array,Error,Number
};
vm.createContext(ctx);vm.runInContext(source,ctx);
ctx.self.onmessage({data:{cmd:"init",model}});
const ready=messages.find(m=>m.type==="ready");
assert.ok(ready,JSON.stringify(messages.slice(-2)));
assert.equal(ready.engine,"stroke-gru-mdn");
const prefixes=[
 [{x:0.28,y:0.20},{x:0.28,y:0.28},{x:0.28,y:0.42},{x:0.28,y:0.58}],
 [{x:0.15,y:0.68},{x:0.32,y:0.43},{x:0.51,y:0.20},{x:0.72,y:0.42}]
];
for(let p=0;p<prefixes.length;p++){
 let x=0,y=0,seq=[];
 for(let i=0;i<prefixes[p].length;i++){
  const pt=prefixes[p][i];
  seq.push([pt.x-x,pt.y-y,i?1:0]);x=pt.x;y=pt.y;
 }
 ctx.self.onmessage({data:{cmd:"generate",serial:100+p,epoch:2,prefix:seq,
    options:[{char:p?"^":"B",confidence:.7},{char:p?"V":"P",confidence:.2}]}});
 const output=messages.find(m=>m.type==="completion"&&m.serial===100+p);
 assert.ok(output,JSON.stringify(messages.slice(-1)));
 assert.equal(output.neural,true);
 assert.equal(output.engine,"stroke-gru-mdn");
 const all=output.alternatives.flatMap(a=>a.paths.flatMap(path=>path));
 assert.ok(all.length>=2,"Neural model returned no printable vector trajectory");
 for(const [px,py] of all){
  assert.ok(Number.isFinite(px)&&Number.isFinite(py));
  assert.ok(px>=-.08&&px<=1.08&&py>=-.08&&py<=1.08);
 }
 console.log("PASS: trained sequence generator generated",all.length,"ordered vector points",output.alternatives.map(c=>c.label));
}

const symbolTraces=[
 {char:"+",prefix:[[.17,.51,0],[.10,0,1],[.10,0,1],[.10,0,1]]},
 {char:"=",prefix:[[.18,.38,0],[.10,0,1],[.10,0,1],[.10,0,1]]},
 {char:":",prefix:[[.50,.33,0],[.005,.01,1],[.005,.01,1],[.005,.01,1]]},
 {char:"X",prefix:[[.25,.20,0],[.10,.10,1],[.10,.10,1],[.10,.10,1]]},
 {char:"^",prefix:[[.20,.73,0],[.10,-.15,1],[.10,-.15,1],[.10,-.15,1]]}
];
let multi=0;
for(let i=0;i<symbolTraces.length;i++){
 const record=symbolTraces[i];
 ctx.self.onmessage({data:{cmd:"generate",serial:200+i,epoch:3,prefix:record.prefix,
   options:[{char:record.char,confidence:1}]}});
 const result=messages.find(m=>m.type==="completion"&&m.serial===200+i);
 assert.ok(result,"Neural worker must return a response for "+record.char);
 const paths=result.alternatives?.flatMap(o=>o.paths)||[];
 const ups=result.alternatives?.reduce((n,o)=>n+o.penUps,0)||0;
 multi+=result.alternatives?.some(o=>o.penUps>0&&o.paths.length>=2)?1:0;
 console.log("MULTI-STROKE NEURAL",record.char,"pen ups",ups,"separate paths",paths.length);
}
console.log("Genuine neural multi-stroke suggestions with learned pen lifts:",multi,"of 5 tested symbol prefixes");
assert.ok(multi>=1,"Generator fails to produce any true multi-stroke pen-up completion");
