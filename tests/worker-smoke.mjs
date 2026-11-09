import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const html=fs.readFileSync("index.html","utf8");
const match=html.match(/const source=String\.raw\x60([\s\S]*?)\x60;/);
assert.ok(match,"Embedded worker source not found");
fs.writeFileSync("/tmp/ink-worker-check.js",match[1]);
const output=[];
const ctx={atob:s=>Buffer.from(s,"base64").toString("binary"),
 postMessage:msg=>output.push(msg),Float32Array,Int8Array,Math,Array,Error};
vm.createContext(ctx);vm.runInContext(match[1],ctx);
const labels="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
function layer(shape){
 return {shape,scale:1/127,weights:Buffer.alloc(shape.reduce((a,b)=>a*b,1)).toString("base64"),
 bias:new Array(shape[0]).fill(0)};
}
function call(id,cmd,extra={}){
 output.length=0;ctx.onmessage({data:{id,cmd,...extra}});
 const match=output.find(v=>v.id===id);
 assert.ok(match);if(match.error)throw Error(match.error);return match.result;
}
const model={format:"ink-cnn-int8-v1",labels,layers:[
 layer([12,1,5,5]),layer([24,12,3,3]),layer([32,24,3,3]),
 layer([96,512]),layer([labels.length,96])
]};
assert.equal(call(1,"init",{model}).classes,labels.length);
const result=call(2,"read",{images:[Array(1024).fill(0),Array(1024).fill(0)]});
assert.equal(result.predictions.length,2);
assert.equal(result.predictions[0].top.length,5);
assert.ok(!html.includes("fineTune"));
assert.ok(!html.includes("modelLoading"));
console.log("PASS: minimal INK AI worker loads and reads symbols without training UI");
