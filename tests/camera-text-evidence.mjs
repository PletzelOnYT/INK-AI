import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../src/camera_text_evidence.js",import.meta.url),"utf8");
const window={};
vm.runInNewContext(source,{window,Math,Number,Uint8Array,Uint8ClampedArray,
 Float32Array,Uint32Array});
const Q=window.InkTextEvidence;
assert.ok(Q?.evidence&&Q?.plausibleWord);
const width=320,height=100;
function fixture(color,paint){
 const pixels=new Uint8ClampedArray(width*height*4);
 const set=(x,y,r,g,b)=>{
  const k=(y*width+x)*4;
  pixels[k]=r;pixels[k+1]=g;pixels[k+2]=b;pixels[k+3]=255;
 };
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const rgb=typeof color==="function"?color(x,y):color;
  set(x,y,...rgb);
 }
 if(paint)paint(set);
 return {getImageData(x0,y0,w,h){
  const out=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const from=((y0+y)*width+x0+x)*4,to=(y*w+x)*4;
   for(let i=0;i<4;i++)out[to+i]=pixels[from+i];
  }
  return {data:out};
 }};
}
const box={x0:37,y0:20,x1:222,y1:64};
const print=fixture([245,238,228],set=>{
 for(let char=0;char<8;char++){
  const cx=40+char*22;
  for(let y=24;y<59;y++)for(let x=cx;x<cx+13;x++)
   if(x<cx+3||x>=cx+10||y<27||y>=56)set(x,y,18,18,18);
 }
});
const whiteOnDark=fixture([16,16,22],set=>{
 for(let char=0;char<8;char++){
  const cx=40+char*22;
  for(let y=24;y<59;y++)for(let x=cx;x<cx+13;x++)
   if(x<cx+3||x>=cx+10||y<27||y>=56)set(x,y,250,250,250);
 }
});
const skin=fixture((x,y)=>[176+x*.23,123+x*.18,96+x*.15]);
const wall=fixture((x,y)=>[182+x*.07,181+x*.07,173+x*.07]);
const seam=fixture([240,240,240],set=>{
 for(let y=20;y<80;y++)for(let x=135;x<139;x++)set(x,y,20,20,20);
});
for(const [name,ctx] of [["dark letters",print],["light letters",whiteOnDark]]){
 const found=Q.evidence(ctx,box,width,height);
 assert.equal(found.ok,true,name+" must be preserved");
 assert.ok(found.score>.70,name+" must have clear stroke support");
}
for(const [name,ctx] of [["smooth skin",skin],["painted wall",wall],["straight seam",seam]]){
 const result=Q.evidence(ctx,box,width,height);
 assert.equal(result.ok,false,name+" must not be accepted as readable print");
}
assert.equal(Q.plausibleWord({text:"NY",box},2,width,height),true);
assert.equal(Q.plausibleWord({text:"THREADS",box},2,width,height),true);
assert.equal(Q.plausibleWord({text:"I",box:{x0:42,y0:20,x1:61,y1:64}},1,width,height),false,
 "An isolated one-character OCR guess is a common false positive");
assert.equal(Q.plausibleWord({text:"I",box:{x0:42,y0:20,x1:61,y1:64}},4,width,height),true,
 "A one-character word inside a real sentence is still valid");
console.log("PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected");
