import assert from "node:assert/strict";
import {
 estimateTextAngle,rotationQueue,rotatedSize,transformPoint,unrotateLines
} from "../src/camera_orientation_core.mjs";
const W=960,H=540;
function strokesAt(degrees,polarity="dark"){
 const pixels=new Uint8ClampedArray(W*H*4),base=polarity==="dark"?246:18;
 for(let i=0;i<pixels.length;i+=4){
  pixels[i]=pixels[i+1]=pixels[i+2]=base;pixels[i+3]=255;
 }
 const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const dark=polarity==="dark"?16:246;
 function dot(x,y){
  const xx=Math.round(W/2+c*x-s*y),yy=Math.round(H/2+s*x+c*y);
  if(xx<3||yy<3||xx>=W-3||yy>=H-3)return;
  for(let v=-2;v<=2;v++)for(let u=-2;u<=2;u++){
   const z=((yy+v)*W+xx+u)*4;
   pixels[z]=pixels[z+1]=pixels[z+2]=dark;
  }
 }
 for(let n=0;n<8;n++){
  const x=-190+n*50;
  for(let y=-26;y<=26;y++){dot(x,y);dot(x+28,y)}
  for(let xx=x;xx<=x+28;xx++){dot(xx,-26);dot(xx,26)}
 }
 return pixels;
}
for(const polarity of ["dark","light"]){
 for(const degree of [-90,-75,-55,-35,-20,-10,0,10,20,35,55,75,90,125,180]){
  const estimate=estimateTextAngle(strokesAt(degree,polarity),W,H);
  assert.ok(Number.isFinite(estimate.angle),
   "Could not find high-contrast foreground for "+degree+" "+polarity);
  const expected=((degree+90)%180+180)%180-90;
  assert.ok(Math.abs(estimate.angle-expected)<=5 ||
     Math.abs(Math.abs(estimate.angle-expected)-180)<=5,
     "Estimated "+estimate.angle+" instead of "+expected+" "+polarity);
  if(Math.abs(expected)>=10){
   const options=rotationQueue(estimate.angle);
   assert.ok(options.some(a=>Math.abs(a+expected)<=5 ||
       Math.abs(Math.abs(a+expected)-360)<=5),
      "No OCR candidate that deskews "+degree+"; got "+options);
  }
 }
}
for(const angle of [-160,-90,-45,-17,0,17,45,90,160,180]){
 const {width:rw,height:rh}=rotatedSize(angle,W,H);
 const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const px=456,py=201;
 const dx=px-W/2,dy=py-H/2;
 const x=rw/2+c*dx-s*dy;
 const y=rh/2+s*dx+c*dy;
 const restored=transformPoint(x,y,angle,W,H,rw,rh);
 assert.ok(Math.hypot(restored.x-px,restored.y-py)<.0001);
 const original={text:"THREADS",
   box:{x0:x-30,y0:y-10,x1:x+30,y1:y+10},
   words:[{text:"THREADS",box:{x0:x-30,y0:y-10,x1:x+30,y1:y+10}}]};
 const [line]=unrotateLines([original],angle,W,H,rw,rh);
 assert.equal(line.words[0].points.length,4);
 assert.ok(line.box.x0<=line.box.x1);
 assert.ok(line.box.y0<=line.box.y1);
}
console.log("PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection");
