import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {centerDetailCrop,detailSize,remapDetailLines,enhanceInkRGBA,
 isCompactNumericRead,perspectiveQuad,quadMapper,rectifyPerspectiveRGBA} from "../src/camera_detail_core.mjs";

assert.deepEqual(detailSize(1920,1080),{width:1920,height:1080});
assert.deepEqual(detailSize(3840,2160),{width:1920,height:1080});
const crop=centerDetailCrop(1920,1080,.6);
assert.deepEqual(crop,{x:384,y:216,width:1152,height:648});
const original=[{text:"12:34",box:{x0:200,y0:100,x1:400,y1:150},
 words:[{text:"12:34",confidence:.96,box:{x0:200,y0:100,x1:400,y1:150}}]}];
const mapped=remapDetailLines(original,crop,1152,648);
assert.equal(mapped[0].box.x0,584);
assert.equal(mapped[0].box.y0,316);
assert.equal(mapped[0].words[0].box.x1,784);
assert.equal(mapped[0].words[0].points.length,4);
assert.ok(isCompactNumericRead(mapped));
assert.ok(isCompactNumericRead([{words:[{text:"9",confidence:.93,
 box:{y0:0,y1:24}}]}]));
assert.ok(!isCompactNumericRead([{words:[{text:"7",confidence:.34,
 box:{y0:0,y1:24}}]}]));
assert.ok(!isCompactNumericRead([{words:[{text:"L",confidence:.96,
 box:{y0:0,y1:24}}]}]));

const w=84,h=56,rgba=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const k=(y*w+x)*4;
 let r=180,g=180,b=180;
 // Thin pale-pencil-like strokes on light paper.
 if(x>22&&x<49&&(y===14||y===15||x===25||x===46))r=g=b=155;
 rgba[k]=r;rgba[k+1]=g;rgba[k+2]=b;rgba[k+3]=255;
}
const quad=perspectiveQuad(w,h,"yaw",1);
assert.equal(quad.length,4);
const perspective=quadMapper(quad);
const topLeft=perspective(0,0),bottomRight=perspective(1,1);
assert.ok(Math.abs(topLeft.x-quad[0].x)<1e-5);
assert.ok(Math.abs(topLeft.y-quad[0].y)<1e-5);
assert.ok(Math.abs(bottomRight.x-quad[2].x)<1e-5);
assert.ok(Math.abs(bottomRight.y-quad[2].y)<1e-5);
const warped=rectifyPerspectiveRGBA(rgba,w,h,quad);
assert.equal(warped.length,rgba.length);
const corrected=remapDetailLines(original,crop,1152,648,
 perspectiveQuad(1152,648,"pitch",-1));
assert.equal(corrected[0].words[0].points.length,4);
assert.ok(corrected[0].box.x0>=crop.x && corrected[0].box.x1<=crop.x+crop.width);
const gray=enhanceInkRGBA(rgba,w,h);
assert.equal(gray.data.length,rgba.length);
assert.ok(gray.hasDetail);
assert.ok(gray.data[(14*w+34)*4]<245);
assert.equal(gray.data[(4*w+4)*4],255);

// Similar luminance can hide colored ink from a grayscale-only verifier.
// The RGB evidence model must still detect its real edges.
const ev=fs.readFileSync(new URL("../src/camera_text_evidence.js",import.meta.url),"utf8");
const context={window:{},Math,Number,Uint8Array,Uint16Array,Uint32Array,
 Float32Array,Array};
vm.runInNewContext(ev,context);
const evidence=context.window.InkTextEvidence;
assert.ok(evidence);
const W=100,H=35;
const pixels=new Uint8ClampedArray(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const ink=(x>=8&&x<=84&&(
  (x%14<3&&y>=8&&y<=29)||
  (y>=15&&y<=17&&x%14<=10)));
 const k=(y*W+x)*4;
 // Red/green are chosen close in luminance, far apart in RGB.
 pixels[k]=ink?36:170;
 pixels[k+1]=ink?100:30;
 pixels[k+2]=ink?36:30;
 pixels[k+3]=255;
}
const mockCtx={getImageData(x,y,width,height){
 const out=new Uint8ClampedArray(width*height*4);
 for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
  const a=((yy+y)*W+(xx+x))*4,b=(yy*width+xx)*4;
  for(let k=0;k<4;k++)out[b+k]=pixels[a+k];
 }
 return {data:out};
}};
const visible=evidence.evidence(mockCtx,{x0:0,y0:0,x1:W,y1:H},W,H);
assert.ok(visible.ok,"RGB channel separation must reveal colored strokes");
assert.ok(evidence.plausibleWord({text:"9",confidence:.93,
 box:{x0:20,y0:5,x1:40,y1:22}},1,W,H));
assert.ok(!evidence.plausibleWord({text:"I",confidence:.93,
 box:{x0:20,y0:5,x1:40,y1:22}},1,W,H));
console.log("PASS: 1080p detail, magnified crop geometry, numeric clocks, pencil and RGB text evidence");
