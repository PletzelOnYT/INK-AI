import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the real camera handwriting adapter and its prediction decoder.
// The mocked CNN output is deterministic: this tests routing and confidence,
// not a fabricated claim about held-out handwriting accuracy.
const source=fs.readFileSync(
 new URL("../src/camera_handwriting.js",import.meta.url),"utf8");
const width=240,height=100;
const mask=new Uint8Array(width*height);
const letters=[];
for(let i=0;i<4;i++){
 const x0=28+i*25,y0=29,x1=x0+15,y1=59;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  if(x-x0===2||x-x0===13||y===y0+14)mask[y*width+x]=1;
 }
 letters.push({x0,y0,x1,y1,mask});
}
const detector={detect(){return [{
 letters,score:1.1,medianHeight:30,slope:0
}]}};
const context={
 window:{InkCameraDetector:detector,__inkHandwritingReady:true},
 document:{getElementById(id){return id==="inkEnglishWords"?{textContent:"example letter reader offline"}:null},
 createElement(){return {
  width:0,height:0,
  getContext(){return {
   drawImage(){},
   getImageData(x,y,w,h){
    return {data:new Uint8ClampedArray(w*h*4),width:w,height:h};
   }
  }}
 }}},
 Uint8ClampedArray,Uint8Array,Float32Array,Math,Number,Array,Set,
 console
};
vm.runInNewContext(source,context);
const api=context.window.InkCameraHandwriting;
assert.ok(api,"Camera handwriting adapter must be registered");
assert.equal(api.refineCaseAndConfusions("handWrItIng",[]),"handwriting");
const alternatives="exampIe".split("").map(char=>({top:[
 {char,confidence:.77},{char:"l",confidence:.20}]}));
assert.equal(api.refineCaseAndConfusions("exampIe",alternatives),"example");
assert.equal(api.refineCaseAndConfusions("WELCOME",[]),"WELCOME",
 "Real capitalized words must be preserved");
assert.equal(api.refineCaseAndConfusions("handwrt",[]),"handwrt",
 "Missing characters may not be invented");

const a=api.normalizeGlyph(letters[0],width,height);
assert.equal(a.length,1024);
assert.ok(Math.max(...a)>.8,"Visible ink must survive normalization");
assert.equal(a[0],0,"Background stays blank");
let sent=0;
context.window.__inkCameraRecognizeHandwriting=async images=>{
 sent+=images.length;
 return "HAND".split("").map(char=>({top:[
  {char,confidence:.96},{char:"X",confidence:.02}]}));
};
const imageCanvas={width,height};
const result=await api.recognize(imageCanvas,width,height);
assert.equal(result.attempted,true);
assert.equal(result.glyphs,4);
assert.equal(sent,4,"Exactly one CNN call per real image region");
assert.equal(result.lines.length,1);
assert.equal(result.lines[0].words[0].text,"HAND");
assert.ok(result.lines[0].words[0].confidence>=.9);
assert.equal(result.lines[0].words[0].recognitionEngine,"ink-handwriting-cnn");
assert.ok(result.lines[0].words[0].box.x0>=28);
assert.ok(result.lines[0].words[0].box.x1<=125);
context.window.__inkCameraRecognizeHandwriting=async images=>
 images.map(()=>({top:[{char:"H",confidence:.28},
   {char:"N",confidence:.25}]}));
const weak=await api.recognize(imageCanvas,width,height);
assert.equal(weak.lines.length,0,"Low evidence must never invent handwriting");

context.window.__inkPrintReady=true;
let printCalls=0;
context.window.__inkCameraRecognize=async images=>{
 printCalls++;
 return "WORD".split("").map(char=>({top:[
  {char,confidence:.98},{char:"X",confidence:.01}]}));
};
const assisted=await api.recognize(imageCanvas,width,height);
assert.equal(assisted.lines[0].words[0].text,"WORD");
assert.equal(assisted.lines[0].words[0].recognitionEngine,
 "ink-print-cnn-fallback");
assert.equal(assisted.printAssistedGlyphs,4);
assert.equal(printCalls,1,"Printed CNN is only called after handwriting abstains");

context.window.InkCameraDetector.detect=()=>[];
const blank=await api.recognize(imageCanvas,width,height);
assert.equal(blank.lines.length,0);
assert.equal(blank.glyphs,0);
context.window.__inkHandwritingReady=false;
const pending=await api.recognize(imageCanvas,width,height);
assert.equal(pending.attempted,false);
assert.equal(pending.reason,"model-not-ready");
console.log("PASS: camera routes segmented real glyph inputs to handwriting CNN, preserves coordinates, abstains on weak/blank/not-ready frames");
