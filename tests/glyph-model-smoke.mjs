import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/<script id="glyphWorkerSource" type="text\/plain">([\s\S]*?)<\/script>/);
assert.ok(match,"Real neural glyph completion worker is missing");
const source=match[1];
fs.writeFileSync("/tmp/ink-glyph-worker.js",source);
assert.ok(!html.includes("function projectedPath("),"Geometric fake completion must be gone");
assert.ok(!html.includes("ink-sketch-gru-v1.json"),"Object sketch model must not be used");
assert.ok(html.includes("models/ink-glyph-completion-v1.json"));

const m=JSON.parse(fs.readFileSync("models/ink-glyph-completion-v1.json","utf8"));
assert.equal(m.format,"ink-glyph-completion-mlp-v1");
assert.equal(m.training.trained_from_scratch,true);
assert.ok(m.training.human_emnist_characters>=30000);
assert.ok(m.labels.includes("I") && m.labels.includes("l") && m.labels.includes("1"));
assert.ok(m.labels.includes("?") && m.labels.includes("@"));
const received=[];
const ctx={
 atob:s=>Buffer.from(s,"base64").toString("binary"),
 self:{postMessage:message=>received.push(message)},
 Float32Array,Uint8Array,Array,Math,Error
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
ctx.self.onmessage({data:{cmd:"init",model:m}});
assert.ok(received.find(x=>x.type==="ready"),"Real completion model did not initialize");

const partial=Array(1024).fill(0);
for(let y=7;y<24;y++)partial[y*32+7]=1;
ctx.self.onmessage({data:{cmd:"complete",partial,label:"B",serial:3,epoch:2}});
const response=received.find(x=>x.type==="completion"&&x.serial===3);
assert.ok(response && response.prediction?.length===1024);
assert.equal(response.label,"B");
const strong=Array.from(response.prediction).filter(v=>v>65).length;
assert.ok(strong>5,"Neural model predicted almost no ink ("+strong+" pixels)");
for(const v of response.prediction)assert.ok(v>=0&&v<=255);
console.log("PASS: real trained handwritten glyph neural model predicts missing strokes",strong,"pixels");
