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
 const w=Math.min(800,video.videoWidth);
 const h=Math.max(1,Math.round(w*video.videoHeight/video.videoWidth));
 c.width=w;c.height=h;g.drawImage(video,0,0,w,h);
 const image=g.getImageData(0,0,w,h),p=image.data;
 const grey=new Uint8Array(w*h),integral=new Uint32Array((w+1)*(h+1));
 for(let y=0;y<h;y++){
  let sum=0;
  for(let x=0;x<w;x++){
   const k=(y*w+x)*4;
   const value=Math.round(p[k]*.299+p[k+1]*.587+p[k+2]*.114);
   grey[y*w+x]=value;sum+=value;
   integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;
  }
 }
 // Local adaptive threshold handles uneven lighting more safely than a
 // single global cutoff. Explicitly avoid bright reflections/dark scenery.
 const mask=new Uint8Array(w*h);
 const radius=13;
 const sumBox=(x0,y0,x1,y1)=>integral[(y1+1)*(w+1)+x1+1]
 -integral[y0*(w+1)+x1+1]-integral[(y1+1)*(w+1)+x0]+integral[y0*(w+1)+x0];
 const row=new Uint16Array(h);
 for(let y=0;y<h;y++){
  const y0=Math.max(0,y-radius),y1=Math.min(h-1,y+radius);
  for(let x=0;x<w;x++){
   const x0=Math.max(0,x-radius),x1=Math.min(w-1,x+radius);
   const avg=sumBox(x0,y0,x1,y1)/((x1-x0+1)*(y1-y0+1));
   const v=grey[y*w+x];
   if(v<Math.min(193,avg-22)&&avg>72){mask[y*w+x]=1;row[y]++}
  }
 }
 const lineRuns=runs(row,Math.max(3,Math.round(w*.004)),3);
 const lines=[];
 for(const [top,bottom] of lineRuns){
  const lh=bottom-top+1;
  if(lh<11||lh>Math.min(h*.21,115))continue;
  const cols=new Uint16Array(w);
  for(let y=top;y<=bottom;y++)for(let x=0;x<w;x++)cols[x]+=mask[y*w+x];
  const spans=runs(cols,Math.max(2,Math.round(lh*.09)),1);
  const letters=[];
  for(const [left,right] of spans){
   let minY=bottom,maxY=top,ink=0;
   for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    if(mask[y*w+x]){ink++;minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
   }
   const bw=right-left+1,bh=maxY-minY+1;
   if(bw<3||bh<8||bw>lh*1.5||bh>100||ink<Math.max(12,bw*bh*.04))continue;
   if(ink/(bw*bh)>.82)continue;
   letters.push({x0:left,y0:minY,x1:right,y1:maxY});
  }
  if(!letters.length)continue;
  // Reject busy/irregular shapes rather than invent words from the scene.
  if(letters.length>40)continue;
  const heights=letters.map(t=>t.y1-t.y0+1).sort((a,b)=>a-b);
  const mid=heights[Math.floor(heights.length/2)];
  const plausible=letters.filter(t=>(t.y1-t.y0+1)>=mid*.42);
  if(plausible.length<2)continue;
  if(plausible.length>=4&&plausible.length/letters.length<.65)continue;
  lines.push({letters,top,bottom});
 }
 return {image,mask,w,h,lines};
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
  values[(y+oy)*32+x+ox]=frame.mask[sy*w+sx];
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
   if(top.confidence<.67||top.confidence-(second?.confidence||0)<.35)continue;
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