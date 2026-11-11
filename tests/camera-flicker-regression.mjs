import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../src/camera_offline_bridge.js",import.meta.url),"utf8");
const window={};
const document={createElement(){return {
 width:0,height:0,getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray(0)}}}}
}}};
vm.runInNewContext(source,{window,document,Map,Set,Math,Number,Date,Uint8ClampedArray});
const reader=window.InkOfflineCamera.createTracker();
function line(tokens,y=120,x=160,confidence=.95){
 const words=[],height=23;
 let offset=x;
 for(const word of tokens.split(" ")){
  const width=Math.max(18,word.length*12);
  words.push({text:word,confidence,box:{x0:offset,y0:y,
   x1:offset+width,y1:y+height}});
  offset+=width+6;
 }
 return {text:tokens,words,confidence,visualQuality:.91,
  box:{x0:x,y0:y,x1:offset-6,y1:y+height}};
}
const empty={width:1920,height:1080,lines:[]};
const push=(lines,t)=>reader.update({width:1920,height:1080,lines},t);
let a=push([line("Notre Dame Academy")],1000);
assert.equal(a.text,"Notre Dame Academy");
assert.equal(a.words.length,3);
a=push([line("Dame Academy",120,233)],1300);
assert.equal(a.text,"Notre Dame Academy","Shorter OCR fragments must not erase a known headline");
assert.equal(a.words.length,3,"Keep all verified headline boxes between partial reads");
a=push([line("Academy",120,307)],1500);
assert.equal(a.text,"Notre Dame Academy");
a=push([],4100);
assert.equal(a.text,"Notre Dame Academy","A missing crop must not make text flash away");
a=push([line("Open House",210,178)],4200);
assert.ok(a.text.includes("Notre Dame Academy")&&a.text.includes("Open House"),
 "Independent rows must remain distinct");
a=push([line("Open",210,178)],4600);
assert.ok(a.text.includes("Open House"),"Partial second-row read cannot erase complete label");
a=push([line("Dame Academy",123,245)],4800);
assert.ok(a.words.some(x=>x.text==="Notre"),
 "Recovered full line survives translated matching");
a=push([line("Notre Dame Academv",123,164)],5000);
assert.ok(a.text.includes("Notre Dame Academy"),
 "A single same-length OCR typo must not replace a verified phrase");
a=push([line("Notre Dame Academv",123,164)],5250);
assert.ok(a.text.includes("Notre Dame Academv"),
 "Real stable updates are accepted after repeated evidence");
a=push([],13000);
assert.equal(a.text,"","OCR history must expire after a bounded period");
console.log("PASS: independent flyer rows, partial words, single-frame mistakes and crop omissions no longer make OCR text or boxes flash");
