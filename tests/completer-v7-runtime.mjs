import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const candidate="models/ink-stroke-prefix-domain-v7.json";
if(!fs.existsSync(candidate)){
 if(process.argv.includes("--require"))throw Error("Expected trained V7 weights");
 console.log("SKIP: V7 candidate has not been trained or was rejected");
 process.exit(0);
}
const data=JSON.parse(fs.readFileSync(candidate,"utf8"));
assert.equal(data.format,"ink-online-stroke-mdn-v1");
assert.equal(data.training?.prefix_domain_v7,true);
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
assert.ok(messages.some(x=>x.type==="ready"),"V7 must load into the actual published browser worker");
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
 "V7 must actually complete unfinished h before publication");
for(const option of paths){
 assert.ok(Number.isFinite(option.rolloutLogLikelihood));
 assert.ok(option.paths.every(path=>path.length>=2));
}

// A training run that has excellent NLL but still cannot generate a second
// crossing stroke is not a useful writing completer. Require an actual
// conditional neural pen lift on a half-written x before publication.
const xStrokes=[[[480,355],[493,372],[505,391],[518,412]]];
const xx=xStrokes[0],width=150,left=440,top=305,xPrefix=[],lastX=[left,top];
for(let j=0;j<xx.length;j++){
 const p=xx[j];
 xPrefix.push([(p[0]-lastX[0])/width,(p[1]-lastX[1])/width,j?1:0]);
 lastX[0]=p[0];lastX[1]=p[1];
}
messages.length=0;
context.self.onmessage({data:{cmd:"generate",serial:34,epoch:2,seed:16,
 prefix:xPrefix,live:false,maxSteps:52,preferred:"x",
 options:[{char:"x",confidence:.98}]}});
const crossing=messages.find(x=>x.type==="completion");
assert.ok(crossing?.neural&&!messages.some(x=>x.type==="error"));
assert.ok(crossing.alternatives?.some(c=>c.label==="x"&&
 c.support?.ok===true&&c.penUps>=1&&c.paths.length>=2),
 "V7 cannot replace the release until the real neural network learns the x cross stroke");
console.log("PASS: independently trained V7 generates h leg AND actual lifted x cross stroke");

