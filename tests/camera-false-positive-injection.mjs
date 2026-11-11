import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const evidenceSource=fs.readFileSync(new URL("../src/camera_text_evidence.js",import.meta.url),"utf8");
const cameraSource=fs.readFileSync(new URL("../src/camera_offline_bridge.js",import.meta.url),"utf8");
const W=300,H=120;
let pixels=new Uint8ClampedArray(W*H*4);
const fill=(fn)=>{
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const c=fn(x,y),k=(y*W+x)*4;
  for(let j=0;j<3;j++)pixels[k+j]=c[j];
  pixels[k+3]=255;
 }
};
const ctx={
 drawImage(){},
 getImageData(left,top,w,h){
  const out=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const src=((top+y)*W+left+x)*4,dst=(y*w+x)*4;
   out.set(pixels.subarray(src,src+4),dst);
  }
  return {data:out};
 },
 setTransform(){},clearRect(){},beginPath(){},rect(){},roundRect(){},
 fill(){},stroke(){}
};
const env={window:{devicePixelRatio:1},document:{
 createElement:()=>({width:W,height:H,getContext:()=>ctx})
},Math,Date,Number,Uint8Array,Uint8ClampedArray,Float32Array,Uint32Array};
vm.runInNewContext(evidenceSource,env);
const hallucination={
 width:W,height:H,engine:"bundled-tesseract-wasm",
 lines:[{text:"HELLO",confidence:.99,box:{x0:40,y0:28,x1:215,y1:72},
  words:[{text:"HELLO",confidence:.99,box:{x0:40,y0:28,x1:215,y1:72}}]}]
};
vm.runInNewContext(cameraSource,env);
const pipeline=env.window.InkOfflineCamera;
// Simulate a very confident false positive on an empty wall or a smooth
// shoulder. A recognizer may be confidently wrong; pixels are the arbiter.
for(const [name,color] of [
 ["painted-wall",(x,y)=>[207+x*.04,206+x*.03,195+x*.03]],
 ["smooth-shoulder",(x,y)=>[177+x*.17,125+x*.13,94+x*.09]]
]){
 fill(color);
 const bad=pipeline.checkedPayload(hallucination,W,H);
 assert.equal(bad.lines.length,0,name+" must reject an invented HELLO");
 assert.equal(bad.words.length,0,name+" must not draw a white highlight");
}
// Actual letter-stroke pixels should pass with the very same OCR words.
fill(()=>[242,238,226]);
for(let character=0;character<7;character++){
 const x0=47+character*21;
 for(let y=32;y<67;y++)for(let x=x0;x<x0+12;x++){
  if(x<x0+3||x>x0+8||y<35||y>63){
   const k=(y*W+x)*4;
   pixels[k]=pixels[k+1]=pixels[k+2]=17;
  }
 }
}
const found=pipeline.checkedPayload(hallucination,W,H);
assert.equal(found.lines.length,1,"Genuine printed strokes must be retained");
assert.equal(found.words.length,1);
assert.ok(found.lines[0].visualQuality>.75);
console.log("PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved");
