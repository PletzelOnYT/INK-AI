import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source=fs.readFileSync("src/stroke_worker.js","utf8");
const main=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
const backup=JSON.parse(fs.readFileSync("models/ink-stroke-sequence-v1.json","utf8"));
const messages=[],context={
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 Float32Array,Math,Number,Array,Error,
 self:{postMessage:m=>messages.push(m)}
};
vm.createContext(context);
vm.runInContext(source,context);
const support=vm.runInContext("trajectorySupport",context);
const straight=[[.5,.45],[.52,.52],[.54,.59],[.56,.66],[.58,.73],[.60,.80]];
for(const label of ["c","o","a","e","g","q","s","x"]){
 const result=support([], [straight],label,0);
 assert.equal(result.ok,false,label+" must reject the bad straight-ray neural sample");
}
const circle=[...Array(9)].map((_,i)=>{
 const a=-1.3+(i/8)*2.25;
 return [.5+Math.cos(a)*.23,.5+Math.sin(a)*.23];
});
assert.equal(support([], [circle],"o",0).ok,true,
 "The critic must not reject a natural curved neural trajectory");
assert.equal(support([], [straight],"h",0).ok,true,
 "A correct descending leg of lowercase h can be straight");
context.self.onmessage({data:{cmd:"init",model:main}});
context.self.onmessage({data:{cmd:"fallback",model:backup}});
assert.ok(messages.some(x=>x.type==="ready"));
assert.ok(messages.some(x=>x.type==="fallback-ready"));
function encode(strokes){
 const pts=strokes.flat(),minx=Math.min(...pts.map(p=>p[0])),
  maxx=Math.max(...pts.map(p=>p[0])),
  miny=Math.min(...pts.map(p=>p[1])),
  maxy=Math.max(...pts.map(p=>p[1]));
 const size=Math.max(105,Math.min(290,Math.max(maxx-minx,maxy-miny)/.68));
 const previous=[(minx+maxx-size)/2,(miny+maxy-size)/2],out=[];
 for(const stroke of strokes)for(let i=0;i<stroke.length;i++){
  const p=stroke[i];
  out.push([(p[0]-previous[0])/size,(p[1]-previous[1])/size,i?1:0]);
  previous[0]=p[0];previous[1]=p[1];
 }
 return out;
}
const cases=[
 ["h",[
  [[464,367],[464,392],[464,418],[463,446],[463,474],
    [463,503],[462,532],[462,559],[462,590]],
  [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
 ]],
 ["o",[[[420,352],[397,337],[370,338],[352,360],[350,388],[371,415]]]],
 ["x",[[[480,355],[493,372],[505,391],[518,412]]]]
];
for(const [label,strokes] of cases){
 messages.length=0;
 context.self.onmessage({data:{cmd:"generate",serial:10,epoch:1,seed:100,
  prefix:encode(strokes),live:true,maxSteps:24,
  preferred:label,options:[{char:label,confidence:.96}]}});
 const result=messages.find(m=>m.type==="completion");
 assert.ok(result&&result.neural&&!messages.some(m=>m.type==="error"),
   label+" worker failed to respond");
 for(const candidate of result.alternatives){
  assert.ok(candidate.support?.ok,label+" escaped geometry gate");
  assert.ok(candidate.quality>-.91);
  assert.equal(candidate.label,label);
  if(label==="o"){
   assert.ok(candidate.support.turn>=.65);
   assert.ok(candidate.support.straightness<.945);
  }
 }
 for(const preview of messages.filter(m=>m.type==="preview"))
  assert.ok(preview.alternatives?.every(c=>c.support?.ok),
   "No unscreened straight-line previews, including during drawing");
 if(label==="h")assert.ok(result.alternatives.length,
  "Unfinished h must retain a legitimate neural continuation");
 if(label==="o")assert.ok(result.alternatives.some(c=>
    c.source==="validated-older-neural-generator"),
    "Automatically use the genuinely curved older trained network for o");
 if(label==="x")assert.equal(result.alternatives.length,0,
  "Untrained crossing pen lifts must not be fabricated as a straight tail");
 console.log(label,"real model alternatives",result.alternatives.length,
   result.alternatives.map(c=>({curvature:c.support.turn,
    straightness:c.support.straightness,
    source:c.source||"primary"})));
}
console.log("PASS: neural completer rejects straight-ray c/o/x, preserves h, and recovers curved o from real backup model");
