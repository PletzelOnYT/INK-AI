// Diagnostic only: measure which actual neural samples are being offered.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const worker=fs.readFileSync("src/stroke_worker.js","utf8");
const model=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
function ctxFor(model){
 const messages=[];
 const context={Float32Array,Math,Array,Number,Error,
  atob:s=>Buffer.from(s,"base64").toString("binary"),
  self:{postMessage:x=>messages.push(x)}};
 vm.createContext(context);vm.runInContext(worker,context);
 context.self.onmessage({data:{cmd:"init",model}});
 assert.ok(messages.find(x=>x.type==="ready"));
 return {context,messages};
}
function prefix(strokes,box){
 const [x0,y0,size]=box;
 const tokens=[];let old=[x0,y0];
 for(const pts of strokes){
  for(let i=0;i<pts.length;i++){
   const [x,y]=pts[i];
   tokens.push([(x-old[0])/size,(y-old[1])/size,i?1:0]);old=[x,y];
  }
 }
 return tokens;
}
const h=prefix([
 [[464,367],[464,392],[464,418],[463,446],[463,474],[463,503],[462,532],[462,559],[462,590]],
 [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
],[400,319,317]);
const c=prefix([[[420,352],[397,337],[370,338],[352,360],[350,388]]],[320,300,150]);
const x=prefix([[[480,355],[493,372],[505,391],[518,412]]],[440,305,150]);
for(const [name,tokens,char] of [["h",h,"h"],["c",c,"c"],["x",x,"x"]]){
 const {context,messages}=ctxFor(model);
 const t0=performance.now();
 context.self.onmessage({data:{cmd:"generate",serial:6,epoch:9,seed:16,
  prefix:tokens,live:false,maxSteps:52,options:[{char,confidence:.95}],preferred:char}});
 const ms=Math.round(performance.now()-t0);
 const done=messages.find(x=>x.type==="completion");
 assert.ok(done);
 const alts=done.alternatives||[];
 const metrics=alts.map(a=>{
  const pts=a.paths.flat(),end=pts.at(-1)||[0,0];
  return {steps:pts.length,paths:a.paths.length,quality:a.quality,
   score:a.score,penUps:a.penUps,variant:a.variant,
   end:end.map(n=>+n.toFixed(3))};
 });
 console.log("ROLLOUT_DIAGNOSTIC",JSON.stringify({name,count:alts.length,
  ms,metrics}));
}
console.log("PASS: neural rollout diagnostics captured from real model weights");
