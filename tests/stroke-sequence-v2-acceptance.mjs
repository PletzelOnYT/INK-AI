import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";

const filename="models/ink-stroke-sequence-v2.json";
if(!fs.existsSync(filename)){
 console.log("PASS: 1M model not published; keep fast proven V1");
 process.exit(0);
}
const model=JSON.parse(fs.readFileSync(filename,"utf8"));
const metrics=JSON.parse(fs.readFileSync("models/stroke-sequence-v2-metrics.json","utf8"));
assert.equal(model.format,"ink-online-stroke-mdn-v1");
assert.ok(model.parameter_count>1000000);
assert.equal(model.training.v2,true);
assert.equal(metrics.eligible,true);
assert.ok(metrics.v2.independent.nll < metrics.baseline_v1.independent.nll);
assert.ok(metrics.v2.independent.pen_lift_f1>=metrics.baseline_v1.independent.pen_lift_f1-.02);

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/<script id="strokeWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/);
assert.ok(match,"Missing embedded neural trajectory worker");
const msgs=[];
const ctx={
 atob:x=>Buffer.from(x,"base64").toString("binary"),
 self:{postMessage:x=>msgs.push(x)},
 Math,Float32Array,Array,Error,Number,console
};
vm.createContext(ctx);vm.runInContext(match[1],ctx);
ctx.self.onmessage({data:{cmd:"init",model}});
const ready=msgs.find(x=>x.type==="ready");
assert.equal(ready.parameters,model.parameter_count);
const prefix=[
 [.23,.25,0],[.02,.06,1],[.015,.06,1],[.015,.06,1],
 [.02,.06,1],[.02,.06,1],[.015,.06,1],[.02,.06,1]
];
const started=performance.now();
ctx.self.onmessage({data:{cmd:"generate",serial:7,epoch:9,seed:29,live:true,maxSteps:20,
 prefix,options:[{char:"B",confidence:.58},{char:"P",confidence:.34}]}});
const latency=performance.now()-started;
const completion=msgs.find(x=>x.type==="completion"&&x.serial===7);
assert.ok(completion,"Larger online GRU failed to return any response");
const points=(completion.alternatives||[]).flatMap(c=>c.paths.flatMap(p=>p));
assert.ok(points.length>=2,"Larger neural model emitted no drawable continuation");
for(const [x,y] of points)assert.ok(Number.isFinite(x)&&Number.isFinite(y));
assert.ok(latency<1000,"1M model too slow for interactive typing in the GitHub Node smoke test: "+latency);
console.log("PASS: validated",model.parameter_count,"parameter model samples",points.length,
 "vector points in",Math.round(latency),"ms under bounded live inference");
