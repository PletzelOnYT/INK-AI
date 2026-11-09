import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/<script id="sketchWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/);
assert.ok(match,"Real neural sketch worker is missing");
const source=match[1];
fs.writeFileSync("/tmp/ink-sketch-worker.js",source);
assert.ok(!html.includes("function projectedPath("),"Geometric mock completion must be removed");
assert.ok(html.includes("raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-sketch-gru-v1.json"));

const model=JSON.parse(fs.readFileSync("models/ink-sketch-gru-v1.json","utf8"));
assert.equal(model.format,"ink-generative-gru-v1");
assert.equal(model.training.trained_from_scratch,true);
assert.ok(model.training.training_drawings>10000);

const messages=[];
const ctx={
  atob:s=>Buffer.from(s,"base64").toString("binary"),
  self:{postMessage:message=>messages.push(message)},
  Math,Float32Array,Array,Error
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
ctx.self.onmessage({data:{cmd:"init",model}});
const ready=messages.find(x=>x.type==="ready");
assert.ok(ready,"Actual model must initialize");

const prefix=[
 [.5,.2,0],[.7,.1,0],[.7,.15,0],[.4,.5,0],
 [.1,.6,0],[-.2,.4,0],[-.6,.2,0],[-.5,-.2,0],
 [-.3,-.4,0],[-.1,-.6,0],[.1,-.7,0],[.3,-.5,0]
];
ctx.self.onmessage({data:{
 cmd:"predict",prefix,anchor:[650,280],screenScale:16,serial:21,epoch:4
}});
const out=messages.find(x=>x.type==="prediction"&&x.serial===21);
assert.ok(out,"Neural generator must return predictions");
assert.equal(out.neural,true);
assert.equal(out.epoch,4);
assert.ok(out.paths?.some(p=>p.length>=2),"Generative model must propose at least one stroke");
for(const path of out.paths)for(const point of path){
 assert.ok(Number.isFinite(point[0])&&Number.isFinite(point[1]));
 assert.ok(point[0]>=0&&point[0]<=1200&&point[1]>=0&&point[1]<=550);
}
console.log("PASS: real trained generative GRU initializes and samples",out.paths.length,"future strokes");
