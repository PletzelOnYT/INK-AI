import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const src=fs.readFileSync("src/stroke_worker.js","utf8");
const html=fs.readFileSync("index.html","utf8");
const embedded=html.match(/<script id="strokeWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
assert.ok(embedded&&embedded.trim()===src.trim(),"Offline HTML must use tested neural worker");
assert.ok(!html.includes("drawCorrectionGlyph")&&!html.includes('id="acceptCorrection"'));
const model=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
const messages=[];
const c={Float32Array,Math,Array,Number,Error,
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 self:{postMessage:m=>messages.push(m)}};
vm.createContext(c);vm.runInContext(src,c);
c.self.onmessage({data:{cmd:"init",model}});
assert.ok(messages.find(m=>m.type==="ready"));
function tokens(strokes,x0,y0,size){
 let old=[x0,y0],res=[];
 for(const stroke of strokes){
  stroke.forEach(([x,y],i)=>{
   res.push([(x-old[0])/size,(y-old[1])/size,i?1:0]);old=[x,y];
  });
 }
 return res;
}
function run(name,prefix,label){
 messages.length=0;
 c.self.onmessage({data:{cmd:"generate",serial:42,epoch:7,
  seed:16,prefix,live:false,maxSteps:52,
  preferred:label,options:[{char:label,confidence:.99}]}});
 const finished=messages.find(m=>m.type==="completion");
 assert.ok(finished,name+": no response");
 const choices=finished.alternatives||[];
 for(const option of choices){
  assert.equal(option.label,label);
  assert.ok(option.quality>-.91,"Bad geometric tails must be rejected");
  assert.ok(Number.isFinite(option.rolloutLogLikelihood),
   "Ranking must use likelihood of ACTUAL GENERATED vectors, not prefix alone");
  assert.ok(Number.isFinite(option.score));
  assert.ok(option.paths.every(p=>p.length>=2));
 }
 return choices;
}
const h=tokens([
 [[464,367],[464,392],[464,418],[463,446],[463,474],[463,503],[462,532],[462,559],[462,590]],
 [[464,493],[481,486],[504,479],[520,482],[540,499],[550,517]]
],400,319,317);
const hOptions=run("unfinished h",h,"h");
assert.ok(hOptions.length>=1,"h should offer a learned descending leg");
let x=0,y=0,maxX=-Infinity,maxY=-Infinity;
for(const p of h){x+=p[0];y+=p[1];maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
for(const opt of hOptions){
 const all=opt.paths.flat();
 const right=Math.max(...all.map(p=>p[0]));
 const end=all.at(-1);
 assert.ok(right<=maxX+.29,"h suggestion extends too far right: "+right+" vs "+maxX);
 assert.ok(Math.abs(end[1]-maxY)<.14,
  "h extension must approach the existing stem baseline: "+end[1]+" vs "+maxY);
 assert.ok(all.length<=20,"Long uncontrolled speculative h tail must be cut off");
 assert.ok(opt.truncated===true,
  "The model must preserve the best neural early stopping point instead of overrun");
}
const xStroke=tokens([[[480,355],[493,372],[505,391],[518,412]]],440,305,150);
const xOptions=run("partial x",xStroke,"x");
assert.ok(xOptions.length>=2,"Need more than one authentic neural alternative for Tab");
assert.ok(new Set(xOptions.map(x=>x.score.toFixed(3))).size>1,
 "Different sampled trajectories must have DIFFERENT model-consistency scores");
const cStroke=tokens([[[420,352],[397,337],[370,338],[352,360],[350,388]]],320,300,150);
const cOptions=run("partial c",cStroke,"c");
console.log("ROLLOUT_QUALITY",{h:hOptions.map(o=>({
 quality:o.quality,score:o.score,steps:o.paths.flat().length,truncated:o.truncated
})),x:xOptions.map(o=>o.score),c_count:cOptions.length});
console.log("PASS: short on-shape neural h, candidate-specific probability ranking, no procedural glyphs");
