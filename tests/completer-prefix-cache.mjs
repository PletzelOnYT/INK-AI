import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync("src/stroke_worker.js","utf8");
const model=JSON.parse(fs.readFileSync("models/ink-stroke-prefix-domain-v2.json","utf8"));
const messages=[];
const c={Float32Array,Math,Array,Number,Error,
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 self:{postMessage:m=>messages.push(m)}};
vm.createContext(c);vm.runInContext(src,c);
c.self.onmessage({data:{cmd:"init",model}});
assert.ok(messages.some(m=>m.type==="ready"));
const prefix=[[.20,.20,0]];
for(let i=0;i<58;i++)prefix.push([.004,.004,1]);
const label="h", seed=310;
const prepared=c.preparePrefix(prefix,label);
for(let i=0;i<3;i++){
 const ordinary=c.completeGlyph(prefix,label,seed+i*997,i>0,24);
 const reused=c.completeGlyph(prefix,label,seed+i*997,i>0,24,prepared);
 assert.deepEqual(JSON.parse(JSON.stringify(reused)),
   JSON.parse(JSON.stringify(ordinary)),
   "Prefix reuse must preserve the EXACT trained neural output");
}
const original=c.preparePrefix;
let calls=0;
c.preparePrefix=(...args)=>{calls++;return original(...args)};
messages.length=0;
c.self.onmessage({data:{cmd:"generate",serial:81,epoch:2,
 seed:seed,prefix,live:true,maxSteps:24,
 preferred:label,options:[{char:label,confidence:.99}]}});
assert.equal(calls,1,"One GRU prefix pass per class, not once per neural rollout");
const result=messages.find(m=>m.type==="completion");
assert.ok(result&&result.neural===true);
for(const alt of result.alternatives)assert.ok(alt.quality>-.91);
console.log("PASS: 58-token handwriting prefix evaluated only once per label; stochastic neural trajectories preserved exactly");
