"use strict";
/* INK AI camera reader: first-party segmentation + INK's own CNN.
   No CDN, external OCR package, API, or third-party inference service. */
(()=>{
const button=document.getElementById("camera");
const board=document.querySelector(".board");
const video=document.getElementById("cameraVideo");
const overlay=document.getElementById("cameraHighlights");
const output=document.getElementById("guess");
if(!button||!board||!video||!overlay||!output)return;
const c=document.createElement("canvas"),g=c.getContext("2d",{willReadFrequently:true});
const hg=overlay.getContext("2d");
let active=false,stream=null,timer=0,reading=false,epoch=0,history=[],empty=0;
window.__inkCameraActive=false;
window.__inkCameraText="";
window.__inkCameraWords=[];
window.__inkCameraEngine="ink-cnn-local";
function show(t,muted=true){if(active){output.textContent=t;output.dataset.muted=String(muted)}}
function clearMarks(){hg.clearRect(0,0,overlay.width,overlay.height)}
function stop(){
 active=false;epoch++;clearTimeout(timer);
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
 video.pause();video.srcObject=null;
 board.classList.remove("camera-active");
 button.setAttribute("aria-pressed","false");
 window.__inkCameraActive=false;window.__inkCameraText="";window.__inkCameraWords=[];
 history=[];empty=0;clearMarks();
 output.textContent=window.__inkLastGuess||"Draw something";
 output.dataset.muted=String(!window.__inkLastGuess);
}
function runs(values,minimum=1,gap=0){
 const spans=[];let start=-1,end=-1;
 for(let i=0;i<=values.length;i++){
  if(i<values.length&&values[i]>=minimum){if(start<0)start=i;end=i}
  else if(start>=0&&(i===values.length||i-end>gap)){
   spans.push([start,end]);start=-1;end=-1;
  }
 }
 return spans;
}
function extract(){
 const w=Math.min(960,video.videoWidth);
 const h=Math.max(1,Math.round(w*video.videoHeight/video.videoWidth));
 c.width=w;c.height=h;g.drawImage(video,0,0,w,h);
 const image=g.getImageData(0,0,w,h),p=image.data;
 const stride=w+1,N=(w+1)*(h+1);
 const red=new Uint32Array(N),green=new Uint32Array(N),blue=new Uint32Array(N);
 for(let y=0;y<h;y++){
  let r=0,g=0,b=0;
  for(let x=0;x<w;x++){
   const j=(y*w+x)*4;
   r+=p[j];g+=p[j+1];b+=p[j+2];
   const i=(y+1)*stride+x+1,prev=y*stride+x+1;
   red[i]=red[prev]+r;green[i]=green[prev]+g;blue[i]=blue[prev]+b;
  }
 }
 function area(t,x0,y0,x1,y1){
  return t[(y1+1)*stride+x1+1]-t[y0*stride+x1+1]-
         t[(y1+1)*stride+x0]+t[y0*stride+x0];
 }
 const dark=new Uint8Array(w*h),light=new Uint8Array(w*h),color=new Uint8Array(w*h);
 const radius=11;
 for(let y=0;y<h;y++){
  const y0=Math.max(0,y-radius),y1=Math.min(h-1,y+radius);
  for(let x=0;x<w;x++){
   const x0=Math.max(0,x-radius),x1=Math.min(w-1,x+radius);
   const size=(x1-x0+1)*(y1-y0+1);
   const pr=area(red,x0,y0,x1,y1)/size;
   const pg=area(green,x0,y0,x1,y1)/size;
   const pb=area(blue,x0,y0,x1,y1)/size;
   const j=(y*w+x)*4,dr=p[j]-pr,dg=p[j+1]-pg,db=p[j+2]-pb;
   const luminance=.299*dr+.587*dg+.114*db;
   const chroma=Math.max(Math.abs(dr),Math.abs(dg),Math.abs(db));
   const index=y*w+x;
   // Dark-on-light, light-on-dark, and colored-on-colored are evaluated
   // separately so opposing text polarities do not cancel each other.
   if(luminance<-24&&chroma>30)dark[index]=1;
   else if(luminance>24&&chroma>30)light[index]=1;
   else if(Math.abs(luminance)<=24&&chroma>49)color[index]=1;
  }
 }
 function findLines(mask){
  const rows=new Uint16Array(h);
  for(let i=0;i<mask.length;i++)if(mask[i])rows[Math.floor(i/w)]++;
  const bands=runs(rows,Math.max(3,Math.round(w*.0025)),2);
  const lines=[];
  for(const [top,bottom] of bands){
   const lh=bottom-top+1;
   if(lh<8||lh>Math.min(h*.16,108))continue;
   const cols=new Uint16Array(w);
   for(let y=top;y<=bottom;y++)for(let x=0;x<w;x++)cols[x]+=mask[y*w+x];
   const spans=runs(cols,Math.max(2,Math.round(lh*.075)),1);
   const letters=[];
   for(const [left,right] of spans){
    let minY=bottom,maxY=top,ink=0;
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
     if(mask[y*w+x]){ink++;minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
    }
    const bw=right-left+1,bh=maxY-minY+1;
    if(bw<2||bh<7||bw>Math.max(30,lh*1.5)||bh>108||
       ink<Math.max(8,bw*bh*.05))continue;
    if(ink/(bw*bh)>.8)continue;
    letters.push({x0:left,y0:minY,x1:right,y1:maxY,mask});
   }
   if(letters.length<2||letters.length>40)continue;
   const heights=letters.map(t=>t.y1-t.y0+1).sort((a,b)=>a-b);
   const median=heights[Math.floor(heights.length/2)];
   const consistent=letters.filter(t=>{
    const size=t.y1-t.y0+1;
    return size>=median*.45&&size<=median*1.9;
   }).length;
   if(consistent<Math.max(2,Math.ceil(letters.length*.66)))continue;
   // Score the alignment and relative letter-size consistency, not whether
   // the object is a particular word/brand.
   const score=consistent/letters.length+Math.min(1,consistent/7);
   lines.push({letters,top,bottom,score});
  }
  return lines;
 }
 const lines=[...findLines(dark),...findLines(light),...findLines(color)]
    .sort((a,b)=>b.score-a.score);
 const picked=[];
 for(const line of lines){
  if(picked.length>=8)break;
  const candidate={x0:Math.min(...line.letters.map(l=>l.x0)),
    x1:Math.max(...line.letters.map(l=>l.x1)),y0:line.top,y1:line.bottom};
  if(picked.some(other=>{
    const a=other.region;
    const dx=Math.max(0,Math.min(candidate.x1,a.x1)-Math.max(candidate.x0,a.x0));
    const dy=Math.max(0,Math.min(candidate.y1,a.y1)-Math.max(candidate.y0,a.y0));
    return dx*dy>Math.min((candidate.x1-candidate.x0)*(candidate.y1-candidate.y0),
      (a.x1-a.x0)*(a.y1-a.y0))*.45;
  }))continue;
  picked.push({...line,region:candidate});
 }
 picked.sort((a,b)=>a.top-b.top);
 return {image,w,h,lines:picked};
}
function characterImage(item,frame){
 const {x0,y0,x1,y1}=item,w=frame.w,h=frame.h,iw=x1-x0+1,ih=y1-y0+1;
 const values=new Array(1024).fill(0);
 const scale=26/Math.max(iw,ih);
 const dw=Math.max(1,Math.round(iw*scale)),dh=Math.max(1,Math.round(ih*scale));
 const ox=Math.floor((32-dw)/2),oy=Math.floor((32-dh)/2);
 for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
  const sx=Math.min(w-1,x0+Math.floor((x+.5)*iw/dw));
  const sy=Math.min(h-1,y0+Math.floor((y+.5)*ih/dh));
  values[(y+oy)*32+x+ox]=(item.mask?item.mask[sy*w+sx]:0);
 }
 return values;
}
function paint(boxes,frame){
 const bw=board.clientWidth,bh=board.clientHeight,dpr=window.devicePixelRatio||1;
 overlay.width=Math.max(1,Math.round(bw*dpr));
 overlay.height=Math.max(1,Math.round(bh*dpr));
 hg.setTransform(dpr,0,0,dpr,0,0);
 clearMarks();
 if(!frame||!boxes.length)return;
 const fit=Math.min(bw/video.videoWidth,bh/video.videoHeight);
 const offsetX=(bw-video.videoWidth*fit)/2,offsetY=(bh-video.videoHeight*fit)/2;
 const sx=video.videoWidth/frame.w*fit,sy=video.videoHeight/frame.h*fit;
 hg.fillStyle="rgba(255,255,255,0.30)";
 hg.strokeStyle="rgba(255,255,255,0.98)";
 hg.lineWidth=1.7;
 for(const item of boxes){
  const b=item.box||item;
  const x=offsetX+b.x0*sx,y=offsetY+b.y0*sy;
  const w=(b.x1-b.x0+1)*sx,h=(b.y1-b.y0+1)*sy;
  hg.beginPath();
  hg.roundRect(x-2,y-2,w+4,h+4,3);
  hg.fill();hg.stroke();
 }
}
function arrange(frame,predictions){
 let index=0,words=[];
 for(const line of frame.lines){
  const accepted=[];
  for(const box of line.letters){
   const result=predictions[index++];
   const top=result?.top?.[0],second=result?.top?.[1];
   if(!top||!/[a-zA-Z0-9]/.test(top.char)||top.char.length!==1)continue;
   // CNN was trained for handwriting, not scenes. Require strong separation.
   if(top.confidence<(window.__inkPrintReady?.36:.67)||
      top.confidence-(second?.confidence||0)<(window.__inkPrintReady?.12:.35))continue;
   accepted.push({text:top.char,box});
  }
  if(!accepted.length)continue;
  let current=[];
  const finish=()=>{
   if(!current.length)return;
   const text=current.map(a=>a.text).join("");
   const box={x0:Math.min(...current.map(a=>a.box.x0)),
    y0:Math.min(...current.map(a=>a.box.y0)),
    x1:Math.max(...current.map(a=>a.box.x1)),
    y1:Math.max(...current.map(a=>a.box.y1))};
   if(text.length>=2)words.push({text,box});
   current=[];
  };
  for(const a of accepted){
   const prev=current[current.length-1];
   const gap=prev?a.box.x0-prev.box.x1-1:0;
   const height=a.box.y1-a.box.y0+1;
   if(prev&&gap>Math.max(9,height*.53))finish();
   current.push(a);
  }
  finish();
 }
 return words;
}
function stabilize(words){
 // Confirmation is intentionally conservative: no text is displayed when
 // a camera view has no convincing letters.
 const result=[];
 for(const word of words){
  const prior=history.find(item=>item.text===word.text&&
   Math.abs(item.box.x0-word.box.x0)<25&&
   Math.abs(item.box.y0-word.box.y0)<18);
  word.hits=prior?prior.hits+1:1;
  if(word.hits>=2)result.push(word);
 }
 history=words;
 return result;
}
async function scan(id){
 if(!active||id!==epoch||reading)return;
 if(!window.__inkReady||!window.__inkCameraRecognize){
  show("Loading INK AI's local character model…");timer=setTimeout(()=>scan(id),550);return;
 }
 if(video.readyState<2||!video.videoWidth){timer=setTimeout(()=>scan(id),450);return}
 reading=true;
 try{
  const frame=extract();
  // Draw the white highlighter on visually detected glyphs whether or not
  // the classifier can transcribe them.
  const candidateBoxes=frame.lines.flatMap(line=>line.letters);
  paint(candidateBoxes,frame);
  const images=candidateBoxes.slice(0,64).map(box=>characterImage(box,frame));
  const predictions=images.length?await window.__inkCameraRecognize(images):[];
  if(!active||id!==epoch)return;
  // If too many character candidates, refuse partial transcription.
  const recognized=candidateBoxes.length<=64?stabilize(arrange(frame,predictions)):[];
  window.__inkCameraWords=recognized;
  const text=recognized.map(w=>w.text).join(" ").slice(0,3000);
  window.__inkCameraText=text;
  if(text){empty=0;show(text,false)}
  else{empty++;show(candidateBoxes.length?
   "Text detected — hold the camera steady for recognition.":
   "Point the camera at large, clear, high-contrast letters.")}
 }catch(err){
  if(active&&id===epoch)show("Camera recognition unavailable — check the INK model.");
 }finally{
  reading=false;
  if(active&&id===epoch)timer=setTimeout(()=>scan(id),650);
 }
}
async function start(){
 if(active)return;
 active=true;const id=++epoch;history=[];empty=0;
 window.__inkCameraActive=true;window.__inkCameraText="";window.__inkCameraWords=[];
 button.setAttribute("aria-pressed","true");
 board.classList.add("camera-active");
 show("Requesting camera access…");
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error("Camera access requires a secure browser context.");
  const incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{
   facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
  if(!active||id!==epoch){incoming.getTracks().forEach(t=>t.stop());return}
  stream=incoming;video.srcObject=stream;await video.play();
  show("Point your camera at clear, high-contrast text.");
  scan(id);
 }catch(err){
  if(!active||id!==epoch)return;
  const message=err.name==="NotAllowedError"?"Camera permission denied.":
   err.name==="NotFoundError"?"Camera not found.":String(err.message||err);
  stop();output.textContent=message;output.dataset.muted="true";
 }
}
button.addEventListener("click",()=>active?stop():start());
window.addEventListener("pagehide",()=>{if(active)stop()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stop()});
})();