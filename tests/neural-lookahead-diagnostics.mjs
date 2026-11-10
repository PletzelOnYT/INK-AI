import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const worker=fs.readFileSync("src/stroke_worker.js","utf8");
const model=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
const msgs=[];
const ctx={Float32Array,Math,Array,Number,Error,
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 self:{postMessage:v=>msgs.push(v)}};
vm.createContext(ctx);vm.runInContext(worker,ctx);
ctx.self.onmessage({data:{cmd:"init",model}});
assert.ok(msgs.some(x=>x.type==="ready"));
const forms={
 "x":[[470,194],[487,213],[501,232],[516,250],[530,266],[545,283]],
 "c":[[348,236],[321,209],[299,213],[277,241],[268,272],[271,298]],
 "h":[[400,180],[400,204],[400,229],[400,252],[400,275],[400,296]]
};
for(const [name,points] of Object.entries(forms)){
 for(let p=3;p<=points.length;p++){
  const selected=points.slice(0,p),maxW=Math.max(...selected.map(x=>x[0]))-Math.min(...selected.map(x=>x[0]));
  const maxH=Math.max(...selected.map(x=>x[1]))-Math.min(...selected.map(x=>x[1]));
  const sz=Math.max(105,Math.min(290,Math.max(maxW,maxH)*1.4));
  const f=[Math.min(...selected.map(x=>x[0]))-sz*.16,Math.min(...selected.map(x=>x[1]))-sz*.16];
  let prev=f,tokens=[];
  selected.forEach((xy,i)=>{
   tokens.push([(xy[0]-prev[0])/sz,(xy[1]-prev[1])/sz,i?1:0]);
   prev=xy;
  });
  for(const label of (name==="x"?["x","X","\\"]:name==="c"?["c","C","("]:["h","L"])){
   const t=performance.now();
   const result=ctx.neuralLookahead(tokens,label,.7);
   console.log("NEURAL_LOOKAHEAD",JSON.stringify({
    name,p,label,accepted:Boolean(result),pts:result?.paths?.[0]?.length||0,
    ms:Math.round(performance.now()-t),
    tail:result?.paths?.[0]?.at(-1)?.map(x=>+x.toFixed(3))
   }));
  }
 }
}
console.log("PASS: measured deterministic model look-ahead on real partial pen vectors");
