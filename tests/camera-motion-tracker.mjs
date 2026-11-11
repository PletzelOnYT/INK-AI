import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const js=fs.readFileSync(new URL("../src/camera_motion_tracker.js",import.meta.url),"utf8");
const sandbox={window:{},Uint8Array,Uint8ClampedArray,Math,Number,Array,Set};
vm.runInNewContext(js,sandbox);
const api=sandbox.window.InkCameraMotion;
assert.ok(api?.create&&api.matchTranslation&&api.anchorsFor);
const w=400,h=225;
function draw(dx=0,dy=0){
 const a=new Uint8Array(w*h).fill(234);
 const set=(x,y,val)=>{
  if(x>=0&&x<w&&y>=0&&y<h)a[y*w+x]=val;
 };
 // Render actual non-repeating printed-ink-like patterns and narrow strokes.
 for(let i=0;i<13;i++){
  const x=106+i*8+dx,y=73+((i*3)%7)+dy;
  for(let j=0;j<20;j++)set(x,y+j,24);
  for(let j=0;j<6;j++)set(x+j,y+6,24);
 }
 for(let i=0;i<12;i++){
  const x=120+i*7+dx,y=132+((i*5)%6)+dy;
  for(let j=0;j<15;j++)set(x,y+j,15);
 }
 return a;
}
const words=[
 {text:"DISTANT",box:{x0:105,y0:70,x1:215,y1:105}},
 {text:"LETTERS",box:{x0:115,y0:125,x1:213,y1:155}}
];
const anchors=api.anchorsFor(words,w,h,w,h);
assert.ok(anchors.length>=2,"Two independent OCR words produce motion anchors");
const result=api.matchTranslation(draw(),draw(6,-5),w,h,anchors,12);
assert.equal(result.valid,true,"Motion must be measured from photographed ink");
assert.ok(Math.abs(result.dx-6)<=1,JSON.stringify(result));
assert.ok(Math.abs(result.dy+5)<=1,JSON.stringify(result));
const blank=new Uint8Array(w*h).fill(234);
assert.equal(api.matchTranslation(blank,blank,w,h,anchors).valid,false,
 "A flat wall must not produce a fabricated optical-flow translation");
const old=api.matchTranslation(draw(),blank,w,h,anchors);
assert.equal(old.valid,false,"Moving away from a document must hide stale boxes");
const rgba=new Uint8ClampedArray(w*h*4);
const sample=draw();
for(let i=0;i<sample.length;i++){
 rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=sample[i];
 rgba[i*4+3]=255;
}
const gray=api.greyPixels({data:rgba},w,h);
assert.equal(gray[0],234);
assert.equal(gray[73*w+106],24);
console.log("PASS: verified OCR boxes translate with real camera ink and disappear on blank changed scenes");
