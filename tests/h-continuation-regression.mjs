import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/<script id="strokeWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/);
assert.ok(match);
const checkpoints=[
 "models/ink-stroke-sequence-v1.json",
 "models/ink-stroke-sequence-v2.json",
 "models/ink-stroke-prefix-v1.json"
].filter(fs.existsSync);
assert.ok(checkpoints.length>=1);
for(const checkpoint of checkpoints){
 const model=JSON.parse(fs.readFileSync(checkpoint,"utf8"));
 const received=[];
 const ctx={atob:s=>Buffer.from(s,"base64").toString("binary"),
  self:{postMessage:m=>received.push(m)},Float32Array,Math,Array,Number,Error};
 vm.createContext(ctx);
 vm.runInContext(match[1],ctx);
 ctx.self.onmessage({data:{cmd:"init",model}});
 assert.ok(received.some(m=>m.type==="ready"),"Unable to initialize "+checkpoint);
 // Approximate the exact screenshot: top-to-bottom ascender followed by a
 // second lifted stroke curving right into the unfinished h shoulder.
 const strokes=[
  [[464,367],[464,392],[464,418],[463,446],[463,474],[463,503],[462,532],[462,559],[462,590]],
  [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
 ];
 const frame={x:400,y:319,size:317};
 let prev=[frame.x,frame.y],prefix=[];
 for(const stroke of strokes){
  for(let j=0;j<stroke.length;j++){
   const p=stroke[j];
   prefix.push([(p[0]-prev[0])/frame.size,(p[1]-prev[1])/frame.size,j?1:0]);
   prev=p;
  }
 }
 let passed=false;let best=null;
 for(const live of [false,true]){
  received.length=0;
  ctx.self.onmessage({data:{cmd:"generate",serial:live?401:400,
   epoch:2,seed:16,prefix,live,maxSteps:live?26:52,
   options:[{char:"h",confidence:.99}]}});
  const completion=received.find(m=>m.type==="completion");
  assert.ok(completion,"No generator response: "+JSON.stringify(received));
  const candidates=completion.alternatives||[];
  for(const o of candidates){
   assert.equal(o.label,"h");
   const paths=o.paths;
   let range=0,initial=paths[0]?.[0]||[0,0],last=paths.at(-1)?.at(-1)||initial;
   let min=Infinity,max=-Infinity;
   for(const path of paths)for(const p of path){
    min=Math.min(min,p[1]);max=Math.max(max,p[1]);
   }
   range=max-min;
   const isFlat=Math.abs(last[1]-initial[1])<.075&&
      Math.abs(last[0]-initial[0])>.15&&range<.105;
   assert.ok(!isFlat,"Flat line must never be offered as completing h");
   assert.ok(o.quality>-.91);
   best={...o,range,dy:last[1]-initial[1]};
   if(last[1]>Math.max(initial[1]+.06,.77))passed=true;
  }
  console.log(checkpoint,live?"live":"idle",
    "candidate count",candidates.length, "best",best&&{
      label:best.label,quality:best.quality,dy:best.dy,range:best.range,
      steps:best.paths.reduce((n,p)=>n+p.length,0)
    });
 }
 assert.ok(passed,"A partially written h should yield at least one learned downward tail; not just suppress all suggestions");
}
console.log("PASS: screenshot-specific lowercase h regression — curved/downward neural continuation rather than gray horizontal line");
