"use strict";
/* Offline camera orientation geometry. Pure functions, no OCR dependencies.
 * All rotations map source pixels back to the actual camera image, including
 * expanded (non-clipped) frames for arbitrary diagonal text.
 */
export function transformPoint(x,y,degrees,width,height,outWidth,outHeight){
 const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 const dx=x-outWidth/2,dy=y-outHeight/2;
 return {x:width/2+c*dx+s*dy,y:height/2-s*dx+c*dy};
}
export function rotatedSize(degrees,width,height){
 const a=degrees*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
 return {width:Math.ceil(c*width+s*height),height:Math.ceil(s*width+c*height)};
}
export function unrotateLines(lines,degrees,width,height,outWidth,outHeight){
 function project(box){
  const points=[
   transformPoint(box.x0,box.y0,degrees,width,height,outWidth,outHeight),
   transformPoint(box.x1,box.y0,degrees,width,height,outWidth,outHeight),
   transformPoint(box.x1,box.y1,degrees,width,height,outWidth,outHeight),
   transformPoint(box.x0,box.y1,degrees,width,height,outWidth,outHeight)
  ];
  return {points,box:{
   x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),
   y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))
  }};
 }
 return lines.map(line=>{
  const p=project(line.box);
  return {...line,box:p.box,points:p.points,
   words:line.words.map(word=>({...word,...project(word.box)}))};
 });
}
/* Dark-or-light foreground pixel detection and an angle-only Radon projection.
 * The OCR model checks the characters; this estimates how to deskew the frame
 * without 10+ expensive OCR calls. Returns angle modulo 180, because a line of
 * text and its upside-down mirror project onto the same horizontal rows.
 */
export function estimateTextAngle(rgba,width,height,options={}){
 const stride=Math.max(1,Math.ceil(Math.max(width/260,height/170)));
 const w=Math.ceil(width/stride),h=Math.ceil(height/stride);
 const intensities=new Uint8Array(w*h);
 const hist=new Uint32Array(256);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const ix=Math.min(width-1,x*stride),iy=Math.min(height-1,y*stride);
  const i=(iy*width+ix)*4;
  const v=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);
  intensities[y*w+x]=v;hist[v]++;
 }
 const n=w*h;
 const quantile=p=>{const stop=Math.ceil(n*p);let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=stop)return i}return 255};
 const low=quantile(.002),high=quantile(.998);
 if(high-low<28)return {angle:null,confidence:0,reason:"low-contrast"};
 let totalSum=0,backgroundSum=0,backgroundCount=0,best=-1,bestT=127;
 for(let i=0;i<256;i++)totalSum+=i*hist[i];
 for(let t=0;t<255;t++){
  backgroundCount+=hist[t];
  backgroundSum+=t*hist[t];
  if(backgroundCount<1||backgroundCount>=n)continue;
  const otherCount=n-backgroundCount;
  const diff=backgroundSum/backgroundCount-
      (totalSum-backgroundSum)/otherCount;
  const v=backgroundCount*otherCount*diff*diff;
  if(v>best){best=v;bestT=t}
 }
 // Text is the minority foreground in printed-label imagery.
 let dark=0;
 for(let i=0;i<256;i++)if(i<=bestT)dark+=hist[i];
 const textIsDark=dark<=n/2;
 const pixels=[];
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
  const value=intensities[y*w+x];
  const isInk=textIsDark?value<=bestT:value>bestT;
  if(isInk)pixels.push([x-w/2,y-h/2]);
 }
 const ratio=pixels.length/n;
 if(pixels.length<38||ratio>.43)return {angle:null,confidence:0,reason:"no-foreground"};
 const size=Math.ceil(Math.hypot(w,h))+4;
 function energy(deg){
  const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const bins=new Float32Array(size*2);
  for(const [x,y] of pixels){
   const q=Math.round(-s*x+c*y+size);
   if(q>=0&&q<bins.length)bins[q]++;
  }
  let total=0;
  for(const v of bins)total+=v*v;
  return total;
 }
 let bestAngle=0,bestScore=-Infinity,second=-Infinity;
 for(let a=-90;a<90;a+=5){
  const e=energy(a);
  if(e>bestScore){second=bestScore;bestScore=e;bestAngle=a}
  else if(e>second)second=e;
 }
 let refinedAngle=bestAngle;
 for(let a=bestAngle-4;a<=bestAngle+4;a+=1){
  const e=energy(a);
  if(e>bestScore){bestScore=e;refinedAngle=a}
 }
 const horizontal=energy(0);
 const normalized=((refinedAngle+90)%180+180)%180-90;
 const gain=bestScore/Math.max(1,horizontal);
 return {angle:normalized,confidence:Math.min(1,Math.max(0,(gain-1)*.65)),
  projectionGain:gain,foregroundRatio:ratio,reason:"ink-projection"};
}
/* Returns rotation attempts in preference order. The angle detector cannot
 * distinguish upright from upside down, so include both orientations.
 */
export function rotationQueue(hint,previousAngle=null){
 const out=[],add=a=>{
  a=Math.round(a/5)*5;
  a=((a+180)%360+360)%360-180;
  if(Math.abs(a)<4)return;
  if(!out.some(v=>Math.abs(v-a)<3))out.push(a);
 };
 if(Number.isFinite(previousAngle)&&Math.abs(previousAngle)>4)add(previousAngle);
 if(Number.isFinite(hint)&&Math.abs(hint)>7){
  add(-hint);add(-hint+180);
 }
 for(const a of [-90,90,180,-25,25,-45,45,-65,65,-135,135])add(a);
 return out;
}
