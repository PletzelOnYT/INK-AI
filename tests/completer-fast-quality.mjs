import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source=fs.readFileSync("src/stroke_worker.js","utf8");
const model=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
assert.ok(source.includes("(hiddenSize>=300?3:5)"),
 "Worker must not regress to 12 costly stationary rollouts per label");
const messages=[],context={
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 Float32Array,Math,Array,Number,Error,
 self:{postMessage:m=>messages.push(m)}
};
vm.createContext(context);
vm.runInContext(source,context);
context.self.onmessage({data:{cmd:"init",model}});
assert.ok(messages.some(x=>x.type==="ready"));
function encode(strokes,frame){
 const out=[],previous=[frame.x,frame.y];
 for(const stroke of strokes)for(let j=0;j<stroke.length;j++){
  const p=stroke[j];
  out.push([(p[0]-previous[0])/frame.size,
    (p[1]-previous[1])/frame.size,j?1:0]);
  previous[0]=p[0];previous[1]=p[1];
 }
 return out;
}
const h=[
 [[464,367],[464,392],[464,418],[463,446],[463,474],
  [463,503],[462,532],[462,559],[462,590]],
 [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
];
function currentPrefixFrame(strokes){
 const points=strokes.flat();
 const l=Math.min(...points.map(p=>p[0])),r=Math.max(...points.map(p=>p[0]));
 const t=Math.min(...points.map(p=>p[1])),b=Math.max(...points.map(p=>p[1]));
 const size=Math.max(105,Math.min(290,Math.max(r-l,b-t)/.68));
 return {x:(l+r-size)/2,y:(t+b-size)/2,size};
}
let elapsed=0,accepted=[];
for(const [label,strokes] of [
 ["h",h],["x",[[[480,355],[493,372],[505,391],[518,412]]]]
]){
 const frameInput=currentPrefixFrame(strokes);
 const prefix=encode(strokes,frameInput);
 messages.length=0;
 const start=performance.now();
 context.self.onmessage({data:{cmd:"generate",serial:6,epoch:3,
  seed:16,prefix,live:false,maxSteps:52,preferred:label,
  options:[{char:label,confidence:.96}]}});
 const ms=performance.now()-start;
 const reply=messages.find(x=>x.type==="completion");
 assert.ok(reply&&!messages.some(x=>x.type==="error"));
 assert.ok(reply.neural&&reply.engine==="stroke-gru-mdn");
 if(label==="h")assert.ok(reply.alternatives.length>=1,
  "Unfinished h must still have a neural downward leg suggestion");
 for(const candidate of reply.alternatives){
  assert.ok(candidate.quality>-.91);
  assert.ok(Number.isFinite(candidate.rolloutLogLikelihood));
  assert.ok(candidate.paths.length>=1);
  for(const path of candidate.paths){
   for(let j=1;j<path.length;j++)
    assert.ok(Math.hypot(path[j][0]-path[j-1][0],
      path[j][1]-path[j-1][1])<=.108,
      "No individual pen-down leap may exceed the critic's physical limit");
  }
 }
 accepted.push({label,ms:Math.round(ms),candidates:reply.alternatives.length});
 elapsed+=ms;
}
console.log("PASS: fast neural rollout keeps plausible h and x suggestions",JSON.stringify(accepted));
