import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/const source=String\.raw\x60([\s\S]*?)\x60;/);
assert.ok(match,"Embedded worker source not found");
fs.writeFileSync("/tmp/ink-worker-check.js",match[1]);

const output=[];
const ctx={
  atob:s=>Buffer.from(s,"base64").toString("binary"),
  postMessage:message=>output.push(message),
  Float32Array,Int8Array,Array,Math,Error
};
vm.createContext(ctx);
vm.runInContext(match[1],ctx);
assert.equal(typeof ctx.onmessage,"function");

const labels="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
function fakeLayer(shape){
 const n=shape.reduce((a,b)=>a*b,1);
 return {shape,scale:1/127,weights:Buffer.alloc(n).toString("base64"),bias:new Array(shape[0]).fill(0)};
}
const model={format:"ink-cnn-int8-v1",labels,layers:[
 fakeLayer([12,1,5,5]),fakeLayer([24,12,3,3]),fakeLayer([32,24,3,3]),
 fakeLayer([96,512]),fakeLayer([labels.length,96])]};
function call(id,cmd,payload={}){
 output.length=0;ctx.onmessage({data:{id,cmd,...payload}});
 const messages=output.filter(x=>x.id===id);
 assert.equal(messages.length,1);
 if(messages[0].error)throw Error(messages[0].error);
 return messages[0].result;
}
assert.equal(call(1,"init",{model}).classes,labels.length);
const image=new Array(1024).fill(0);
const read=call(2,"read",{images:[image,image]});
assert.equal(read.predictions.length,2);
assert.equal(read.predictions[0].top.length,5);
const before=call(3,"getTuning");
call(4,"tune",{samples:[{label:"I",image}],steps:2});
const after=call(5,"getTuning");
assert.notDeepEqual(after.bias,before.bias,"Fine tuning must update biases");
assert.equal(after.weights.length,labels.length*96);
console.log("PASS: Worker loads, classifies, fine-tunes and exports learned weights");
