import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const candidate="models/ink-stroke-prefix-domain-v6.json";
if(!fs.existsSync(candidate)){
 if(process.argv.includes("--require"))throw Error("Expected trained V6 weights");
 console.log("SKIP: V6 candidate has not been trained or was rejected");
 process.exit(0);
}
const data=JSON.parse(fs.readFileSync(candidate,"utf8"));
assert.equal(data.format,"ink-online-stroke-mdn-v1");
assert.equal(data.training?.prefix_domain_v6,true);
assert.ok(data.parameter_count>300000);
const source=fs.readFileSync("src/stroke_worker.js","utf8");
const messages=[],context={
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 Float32Array,Math,Array,Number,Error,
 self:{postMessage:m=>messages.push(m)}
};
vm.createContext(context);
vm.runInContext(source,context);
context.self.onmessage({data:{cmd:"init",model:data}});
assert.ok(messages.some(x=>x.type==="ready"),"V6 must load into the actual published browser worker");
// User-supplied unfinished lowercase h screenshot coordinates.
const strokes=[
 [[464,367],[464,392],[464,418],[463,446],[463,474],
  [463,503],[462,532],[462,559],[462,590]],
 [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
];
const pts=strokes.flat(),bounds={
 l:Math.min(...pts.map(p=>p[0])),r:Math.max(...pts.map(p=>p[0])),
 t:Math.min(...pts.map(p=>p[1])),b:Math.max(...pts.map(p=>p[1]))};
const size=Math.max(105,Math.min(290,
 Math.max(bounds.r-bounds.l,bounds.b-bounds.t)/.68));
const origin=[(bounds.l+bounds.r-size)/2,(bounds.t+bounds.b-size)/2];
const prefix=[],old=origin.slice();
for(const stroke of strokes)for(let j=0;j<stroke.length;j++){
 const p=stroke[j];
 prefix.push([(p[0]-old[0])/size,(p[1]-old[1])/size,j?1:0]);
 old[0]=p[0];old[1]=p[1];
}
messages.length=0;
context.self.onmessage({data:{cmd:"generate",serial:33,epoch:2,seed:16,
 prefix,live:false,maxSteps:48,preferred:"h",
 options:[{char:"h",confidence:.95}]}});
const done=messages.find(x=>x.type==="completion");
assert.ok(done?.neural&&!messages.some(x=>x.type==="error"));
const paths=done.alternatives||[];
assert.ok(paths.some(x=>x.label==="h"&&x.quality>-.91),
 "V6 must actually complete unfinished h before publication");
for(const option of paths){
 assert.ok(Number.isFinite(option.rolloutLogLikelihood));
 assert.ok(option.paths.every(path=>path.length>=2));
}
console.log("PASS: trained first-party V6 neural generator offers coherent unfinished-h vectors in actual Worker");
