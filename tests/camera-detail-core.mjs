import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {centerDetailCrop,detailSize,remapDetailLines,enhanceInkRGBA,
 isCompactNumericRead,perspectiveQuad,quadMapper,rectifyPerspectiveRGBA,findDarkDisplayRGBA,findAnalogClockRGBA,findDialGlyphRegionsRGBA,documentFocusCrop} from "../src/camera_detail_core.mjs";

assert.deepEqual(detailSize(1920,1080),{width:1920,height:1080});
assert.deepEqual(detailSize(3840,2160),{width:1920,height:1080});
const crop=centerDetailCrop(1920,1080,.6);
assert.deepEqual(crop,{x:384,y:216,width:1152,height:648});
const offCenter=documentFocusCrop(1920,1080,"lower-right");
assert.deepEqual(offCenter,{x:672,y:378,width:1248,height:702});
const upperLeft=documentFocusCrop(1920,1080,"upper-left");
assert.deepEqual(upperLeft,{x:0,y:0,width:1248,height:702});
const upperRight=documentFocusCrop(1920,1080,"upper-right");
const lowerLeft=documentFocusCrop(1920,1080,"lower-left");
assert.equal(upperRight.x,672);
assert.equal(lowerLeft.y,378);
assert.ok(offCenter.x<1920*.5&&offCenter.y<1080*.5,
 "Document zones must overlap, rather than leave central blind strips");
assert.throws(()=>documentFocusCrop(1920,1080,"wrong"));
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

const pw=160,ph=90,preview=new Uint8ClampedArray(pw*ph*4);
for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
 const dark=x>=59&&x<=100&&y>=27&&y<=42;
 const k=(y*pw+x)*4,v=dark?35:227;
 preview[k]=preview[k+1]=preview[k+2]=v;
 preview[k+3]=255;
}
const clockFace=findDarkDisplayRGBA(preview,pw,ph);
assert.ok(clockFace,"Dark clock display must be located in room");
assert.ok(clockFace.x>=54&&clockFace.x<=60&&clockFace.y>=23&&clockFace.y<=28);
assert.ok(clockFace.width>=42&&clockFace.height>=16);
const blank=new Uint8ClampedArray(pw*ph*4).fill(230);
assert.equal(findDarkDisplayRGBA(blank,pw,ph),null,"Blank wall cannot contain a clock");
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


// A distant room clock is not an ordinary horizontal text line. Regression:
// localize the circular rim, then localize real separated numeral ink; a
// blank wall must not produce a clock or invented numbers.
const aw=320,ah=180,analog=new Uint8ClampedArray(aw*ah*4);
const acx=149,acy=82,ar=26;
for(let y=0;y<ah;y++)for(let x=0;x<aw;x++){
 const d=Math.hypot(x-acx,y-acy);
 let shade=d<24?219:(d>=24&&d<=27?67:213);
 for(let hour=1;hour<=12;hour++){
  const theta=(hour*30-90)*Math.PI/180;
  const px=Math.round(acx+Math.cos(theta)*ar*.62);
  const py=Math.round(acy+Math.sin(theta)*ar*.62);
  if(Math.abs(x-px)<=1&&Math.abs(y-py)<=2)shade=40;
 }
 const p=(y*aw+x)*4;
 analog[p]=analog[p+1]=analog[p+2]=shade;
 analog[p+3]=255;
}
const analogFace=findAnalogClockRGBA(analog,aw,ah);
assert.ok(analogFace,"The clock-face detector must find a small real annular dial");
assert.ok(Math.hypot(analogFace.cx-acx,analogFace.cy-acy)<7);
assert.ok(analogFace.radius>=22&&analogFace.radius<=32);
const glyphRegions=findDialGlyphRegionsRGBA(analog,aw,ah,analogFace);
assert.ok(glyphRegions.length>=8,"The detector must isolate ink around the dial");
assert.ok(glyphRegions.every(region=>region.hour>=1&&region.hour<=12));
const emptyRoom=new Uint8ClampedArray(aw*ah*4);
for(let i=0;i<emptyRoom.length;i+=4){
 emptyRoom[i]=emptyRoom[i+1]=emptyRoom[i+2]=213;
 emptyRoom[i+3]=255;
}
assert.equal(findAnalogClockRGBA(emptyRoom,aw,ah),null);
assert.ok(evidence.plausibleWord({text:"7",clockDial:true,confidence:.76,
 box:{x0:20,y0:5,x1:30,y1:24}},1,W,H));
assert.ok(!evidence.plausibleWord({text:"7",clockDial:true,confidence:.20,
 box:{x0:20,y0:5,x1:30,y1:24}},1,W,H));
console.log("PASS: pixel-grounded analog clock ring and isolated numerals, without guessing blank walls");
