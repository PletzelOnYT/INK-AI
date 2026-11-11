import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const src=readFileSync(new URL("../src/camera_line_runtime.js",import.meta.url),"utf8");
assert.doesNotThrow(()=>new vm.Script(src));
const registry={source:""};
class MockBlob{
 constructor(parts){registry.source=parts.join("")}
}
class MockWorker{
 constructor(){
  const local={Float32Array,Uint8Array,Math,Array,Number,Error,Object,onmessage:null,
   atob:value=>Buffer.from(value,"base64").toString("binary")};
  local.postMessage=message=>this.onmessage?.({data:message});
  vm.createContext(local);
  vm.runInContext(registry.source,local);
  this.local=local;
 }
 postMessage(message){this.local.onmessage({data:message})}
 terminate(){this.closed=true}
}
const win={};
vm.runInNewContext(src,{
 window:win,Worker:MockWorker,Blob:MockBlob,URL:{
  createObjectURL:()=>"blob:local-test",revokeObjectURL:()=>{}},
 Math,Array,Error,Promise,Map
});
assert.ok(win.InkLineRuntime?.create);
const pack=(shape)=>{
 const size=shape.reduce((a,b)=>a*b,1);
 return {shape,scale:1/127,weights:Buffer.alloc(size).toString("base64")};
};
const conv=(o,i)=>({weight:pack([o,i,3,3]),bias:new Array(o).fill(0)});
const model={format:"ink-line-ctc-v1",input:[1,32,256],
 labels:["","A","B"],
 convolutions:[conv(12,1),conv(24,12),conv(40,24),conv(64,40)],
 rnn:{
  weight_ih_l0:pack([192,64]),weight_hh_l0:pack([192,64]),
  bias_ih_l0:pack([192]),bias_hh_l0:pack([192]),
  weight_ih_l0_reverse:pack([192,64]),
  weight_hh_l0_reverse:pack([192,64]),
  bias_ih_l0_reverse:pack([192]),
  bias_hh_l0_reverse:pack([192])
 },
 out:{weight:pack([3,128]),bias:[0,0,0]}
};
const runtime=await win.InkLineRuntime.create(model);
const [result]=await runtime.read([new Array(8192).fill(0)]);
assert.equal(result.text,"","Untrained blank model must not invent text");
assert.equal(result.steps,64);
assert.equal(result.characters,0);
assert.equal(result.confidence,0);
runtime.terminate();
console.log("PASS: native CTC inference tensor shapes, blank rejection and worker lifecycle");
