"use strict";
/* INK AI camera reader: rotation-aware first-party OCR with persistent text.
   Uses only the trained models already bundled in this repository. */
(()=>{
const button=document.getElementById("camera"),board=document.querySelector(".board");
const video=document.getElementById("cameraVideo"),overlay=document.getElementById("cameraHighlights");
const output=document.getElementById("guess"),Core=window.InkCameraCore,
 Detector=window.InkCameraDetector;
if(!button||!board||!video||!overlay||!output||!Core||!Detector)return;
const base=document.createElement("canvas"),bg=base.getContext("2d",{willReadFrequently:true});
const rotated=document.createElement("canvas"),rg=rotated.getContext("2d",{willReadFrequently:true});
const hg=overlay.getContext("2d");
const tracker=Core.createTracker();
const regionTracker=Core.createRegionTracker();
const cache=new Map();
const dictionaryByLength=new Map();
const vocabulary=document.getElementById("inkEnglishWords")?.textContent||"";
for(const word of vocabulary.toLowerCase().split(/\s+/)){
 if(!/^[a-z]{3,24}$/.test(word))continue;
 if(!dictionaryByLength.has(word.length))dictionaryByLength.set(word.length,[]);
 dictionaryByLength.get(word.length).push(word);
}

let active=false,stream=null,timer=0,frameCallback=0,reading=false,epoch=0,pass=0;

window.__inkCameraActive=false;
window.__inkCameraText="";
window.__inkCameraWords=[];
window.__inkCameraEngine="ink-print-cnn-rotated";
window.__inkCameraStats={scans:0,lastScanMs:null,cacheHits:0,lastAngles:[],modelReady:false,detectedLines:0,highlightedRegions:0};
function show(text,muted=true){
 if(!active)return;
 if(output.textContent!==text)output.textContent=text;
 output.dataset.muted=String(muted);
}
function clearMarks(){hg.clearRect(0,0,overlay.width,overlay.height)}
function stop(){
 active=false;epoch++;clearTimeout(timer);timer=0;
 if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
  video.cancelVideoFrameCallback(frameCallback);
 frameCallback=0;
 if(stream)stream.getTracks().forEach(t=>t.stop());
 stream=null;video.pause();video.srcObject=null;
 board.classList.remove("camera-active");button.setAttribute("aria-pressed","false");
 tracker.reset();regionTracker.reset();cache.clear();
 clearMarks();window.__inkCameraActive=false;window.__inkCameraText="";
 window.__inkCameraWords=[];
 output.textContent=window.__inkLastGuess||"Draw something";
 output.dataset.muted=String(!window.__inkLastGuess);
}
function runs(values,minimum=1,gap=0){
 const spans=[];let start=-1,last=-1;
 for(let i=0;i<=values.length;i++){
  if(i<values.length&&values[i]>=minimum){if(start<0)start=i;last=i}
  else if(start>=0&&(i===values.length||i-last>gap)){
   spans.push([start,last]);start=-1;last=-1;
  }
 }
 return spans;
}
function makeBase(){
 // Camera frames are downscaled before per-pixel RGB segmentation. The
 // original high-resolution video remains untouched in the preview.
 const w=Math.min(800,video.videoWidth);
 base.width=w;base.height=Math.max(1,Math.round(video.videoHeight*w/video.videoWidth));
 bg.drawImage(video,0,0,base.width,base.height);
}
function makeView(angle){
 if(!angle)return {canvas:base,width:base.width,height:base.height,angle:0};
 const radians=angle*Math.PI/180,cs=Math.abs(Math.cos(radians)),sn=Math.abs(Math.sin(radians));
 const w=Math.ceil(base.width*cs+base.height*sn);
 const h=Math.ceil(base.height*cs+base.width*sn);
 rotated.width=w;rotated.height=h;
 // Fill exposed corner areas with the actual video background rather than
 // black, which would otherwise create spurious character-like boundaries.
 const p=bg.getImageData(1,1,1,1).data;
 rg.fillStyle="rgb("+p[0]+","+p[1]+","+p[2]+")";
 rg.fillRect(0,0,w,h);
 rg.save();rg.translate(w/2,h/2);rg.rotate(radians);
 rg.drawImage(base,-base.width/2,-base.height/2);
 rg.restore();
 return {canvas:rotated,width:w,height:h,angle};
}
function extract(view){
 const w=view.width,h=view.height;
 const image=view.canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h);
 const lines=Detector.detect(image,w,h);
 return {w,h,image,view,lines};
}
function characterImage(item,frame){
 const {x0,y0,x1,y1}=item,w=frame.w,h=frame.h,iw=x1-x0+1,ih=y1-y0+1;
 const values=new Array(1024).fill(0);
 const scale=26/Math.max(iw,ih);
 const dw=Math.max(1,Math.round(iw*scale)),dh=Math.max(1,Math.round(ih*scale));
 const ox=Math.floor((32-dw)/2),oy=Math.floor((32-dh)/2);
 // Bilinear subpixel sampling matches the antialiased font inputs on
 // which the printed CNN was trained, instead of feeding jagged bitmaps.
 for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
  const sx=Math.min(w-1,Math.max(0,x0+(x+.5)*iw/dw-.5));
  const sy=Math.min(h-1,Math.max(0,y0+(y+.5)*ih/dh-.5));
  const ax=Math.floor(sx),bx=Math.min(w-1,ax+1),tx=sx-ax;
  const ay=Math.floor(sy),by=Math.min(h-1,ay+1),ty=sy-ay;
  const top=item.mask[ay*w+ax]*(1-tx)+item.mask[ay*w+bx]*tx;
  const bottom=item.mask[by*w+ax]*(1-tx)+item.mask[by*w+bx]*tx;
  values[(y+oy)*32+x+ox]=top*(1-ty)+bottom*ty;
 }
 return values;
}
function project(box,frame){
 return Core.projectBox(box,frame.view,{width:base.width,height:base.height});
}
function dedupe(boxes){
 const out=[];
 for(const item of boxes){
  if(!Core.visibility(item.polygon,base.width,base.height))continue;
  const a=item.box,areaA=Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
  if(out.some(old=>{
   const b=old.box;
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
     Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
   return overlap>areaA*.74;
  }))continue;
  out.push(item);
  if(out.length>=100)break;
 }
 return out;
}
function paint(candidateBoxes,frame){
 const bw=board.clientWidth,bh=board.clientHeight,dpr=window.devicePixelRatio||1;
 const cw=Math.max(1,Math.round(bw*dpr)),ch=Math.max(1,Math.round(bh*dpr));
 if(overlay.width!==cw||overlay.height!==ch){overlay.width=cw;overlay.height=ch}
 hg.setTransform(dpr,0,0,dpr,0,0);clearMarks();
 // Text-shaped regions are highlighted only after successive scans.
 // OCR transcription remains a separate, stricter confirmation.
 const accepted=[...regionTracker.snapshot(),...tracker.snapshot().words]
  .filter(t=>t.polygon?.length===4);
 if(!accepted.length||!video.videoWidth)return;
 const fit=Math.min(bw/video.videoWidth,bh/video.videoHeight);
 const dx=(bw-video.videoWidth*fit)/2,dy=(bh-video.videoHeight*fit)/2;
 const sx=video.videoWidth/frame.w*fit,sy=video.videoHeight/frame.h*fit;
 hg.fillStyle="rgba(255,255,255,0.30)";
 hg.strokeStyle="rgba(255,255,255,0.98)";
 hg.lineWidth=1.7;
 for(const item of accepted){
  const polygon=item.polygon;
  hg.beginPath();
  hg.moveTo(dx+polygon[0].x*sx,dy+polygon[0].y*sy);
  for(let i=1;i<polygon.length;i++)
   hg.lineTo(dx+polygon[i].x*sx,dy+polygon[i].y*sy);
  hg.closePath();hg.fill();hg.stroke();
 }
}
function detectedWordRegions(selected){
 const regions=[];
 for(const {line,frame} of selected){
  const letters=line.letters;
  if(letters.length<4)continue;
  const height=line.medianHeight||
    Math.max(10,letters.reduce((n,c)=>n+(c.y1-c.y0+1),0)/letters.length);
  let group=[];
  const flush=()=>{
   if(group.length<2){group=[];return}
   const box={x0:Math.min(...group.map(c=>c.x0)),
    x1:Math.max(...group.map(c=>c.x1)),
    y0:Math.min(...group.map(c=>c.y0)),
    y1:Math.max(...group.map(c=>c.y1))};
   const projected=project(box,frame);
   if(Core.visibility(projected.points,base.width,base.height))
    regions.push({box:projected.box,polygon:projected.points});
   group=[];
  };
  for(const c of letters){
   if(group.length&&c.x0-group[group.length-1].x1-1>Math.max(4,height*.34))flush();
   group.push(c);
  }
  flush();
 }
 return dedupe(regions);
}
function keyFor(image){
 // The old 1-bit every-other-pixel cache key conflated distinct letters.
 // Quantize every pixel into 16 levels using independent hash streams.
 let a=2166136261,b=2166136261;
 for(let i=0;i<image.length;i++){
  const x=Math.max(0,Math.min(15,Math.round(image[i]*15)));
  a=Math.imul(a^x,16777619);
  b=Math.imul(b^(x+(i&255)),2246822519);
 }
 return (a>>>0).toString(16)+":"+(b>>>0).toString(16);
}
async function classify(images){
 const output=new Array(images.length),misses=[],keys=[];
 for(let i=0;i<images.length;i++){
  const key=keyFor(images[i]);keys[i]=key;
  if(cache.has(key)){
   output[i]=cache.get(key);
   window.__inkCameraStats.cacheHits++;
  }else misses.push(i);
 }
 if(misses.length){
  const batch=await window.__inkCameraRecognize(misses.map(i=>images[i]));
  if(batch.length!==misses.length)throw Error("Camera CNN batch mismatch");
  for(let j=0;j<misses.length;j++){
   const i=misses[j];output[i]=batch[j];cache.set(keys[i],batch[j]);
  }
  if(cache.size>450)cache.clear();
 }
 return output;
}
function decode(lines,predictions){
 const words=[];let offset=0;
 for(const {line,frame} of lines){
  const letters=line.letters;
  const preds=predictions.slice(offset,offset+letters.length);
  offset+=letters.length;
  if(preds.length!==letters.length)continue;
  const groups=[];let group=[];
  const finish=()=>{if(group.length)groups.push(group);group=[]};
  for(let i=0;i<letters.length;i++){
   if(i){
    const prev=letters[i-1],next=letters[i];
    const typical=Math.max(3,(next.y1-next.y0+1)*.34);
    if(next.x0-prev.x1-1>typical)finish();
   }
   group.push({box:letters[i],prediction:preds[i]});
  }
  finish();
  for(const segment of groups){
   if(segment.length<3||segment.length>24)continue;
   const selected=segment.map(x=>x.prediction);
   let text="",confidence=0;
   const corrected=Core.decodePrintedWord(selected,dictionaryByLength.get(segment.length));
   if(corrected){
    text=corrected.text;confidence=corrected.confidence;
   }else{
    let failed=false;
    for(const {prediction} of segment){
     const top=prediction?.top?.[0],second=prediction?.top?.[1];
     if(!top||!/[A-Za-z]/.test(top.char)||top.char.length!==1||
        top.confidence<.58||
        top.confidence-(second?.confidence||0)<.22){failed=true;break}
     text+=top.char;confidence+=top.confidence;
    }
    if(failed)continue;
    confidence/=segment.length;
   }
   if(!Core.looksLikeWord(text,confidence))continue;
   const box={x0:Math.min(...segment.map(x=>x.box.x0)),
    y0:Math.min(...segment.map(x=>x.box.y0)),
    x1:Math.max(...segment.map(x=>x.box.x1)),
    y1:Math.max(...segment.map(x=>x.box.y1))};
   const transformed=project(box,frame);
   if(!Core.visibility(transformed.points,base.width,base.height))continue;
   words.push({text,confidence,box:transformed.box,
     polygon:transformed.points,angle:frame.view.angle});
  }
 }
 return words;
}
function schedule(id,delay=100){
 clearTimeout(timer);
 if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
  video.cancelVideoFrameCallback(frameCallback);
 frameCallback=0;
 if(!active||id!==epoch)return;
 // Prefer a new camera frame to a fixed polling delay. The fallback keeps
 // static canvas streams and older browsers working without frozen reads.
 if(typeof video.requestVideoFrameCallback==="function"){
  let fired=false;
  frameCallback=video.requestVideoFrameCallback(()=>{
   if(fired)return;
   fired=true;frameCallback=0;clearTimeout(timer);
   if(active&&id===epoch)scan(id);
  });
  timer=setTimeout(()=>{
   if(fired)return;
   fired=true;
   if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
    video.cancelVideoFrameCallback(frameCallback);
   frameCallback=0;
   if(active&&id===epoch)scan(id);
  },Math.max(180,delay));
 }else timer=setTimeout(()=>scan(id),delay);
}
async function scan(id){
 if(!active||id!==epoch||reading)return;
 if(!window.__inkReady||!window.__inkCameraRecognize){
  show("Loading INK AI's local character model…");schedule(id,150);return;
 }
 if(video.readyState<2||!video.videoWidth){schedule(id,110);return}
 reading=true;
 const t0=performance.now(),stats=window.__inkCameraStats;
 try{
  makeBase();
  const preferred=tracker.snapshot().activeAngle;
  const first=extract(makeView(0));
  const dominant=[...first.lines].sort((a,b)=>b.score-a.score)[0];
  const tilt=dominant?-Math.atan(dominant.slope)*180/Math.PI:null;
  const angles=[0];
  if(tilt!==null&&Math.abs(tilt)>=2&&Math.abs(tilt)<49){
   angles.push(Math.round(tilt));
  }else if(preferred!==null&&Math.abs(preferred)>=4&&pass%3!==0){
   angles.push(preferred);
  }else if(!dominant){
   const retries=[-20,20,-40,40,-60,60,-85,85];
   angles.push(retries[pass%retries.length]);
  }
  pass++;
  stats.lastAngles=angles;stats.modelReady=Boolean(window.__inkPrintReady);
  const frames=[],choices=[];
  for(const angle of angles){
   const frame=angle===0?first:extract(makeView(angle));
   frames.push(frame);
   for(const line of frame.lines){
    const region={x0:Math.min(...line.letters.map(l=>l.x0)),
     x1:Math.max(...line.letters.map(l=>l.x1)),
     y0:Math.min(...line.letters.map(l=>l.y0)),
     y1:Math.max(...line.letters.map(l=>l.y1))};
    const projected=project(region,frame);
    if(!Core.visibility(projected.points,base.width,base.height))continue;
    choices.push({frame,line,score:line.score+(angle===preferred ? 0.10 : 0),
     region:projected.box});
   }
  }
  choices.sort((a,b)=>b.score-a.score);
  const geometry=[];
  for(const option of choices){
   if(geometry.length>=12)break;
   const a=option.region;
   if(geometry.some(item=>{
    const b=item.region;
    const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
      Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
    const area=Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
    return overlap>area*.48;
   }))continue;
   geometry.push(option);
  }
  // Preserve highlighting for every convincing printed row. OCR inference
  // is budgeted separately and cycles through rows instead of permanently
  // overlooking small rows like "Thank you!!".
  const shift=geometry.length?(pass*2)%geometry.length:0;
  const scanOrder=[...geometry.slice(shift),...geometry.slice(0,shift)];
  const selected=[];let total=0;
  for(const option of scanOrder){
   const count=option.line.letters.length;
   if(count>40||total+count>45||selected.length>=5)continue;
   selected.push(option);total+=count;
  }
  const frame={w:base.width,h:base.height};
  const regions=regionTracker.update(detectedWordRegions(geometry),Date.now());
  stats.detectedLines=geometry.length;
  stats.highlightedRegions=regions.length;
  const images=selected.flatMap(item=>item.line.letters.map(box=>characterImage(box,item.frame)));
  const predictions=images.length?await classify(images):[];
  if(!active||id!==epoch)return;
  const found=decode(selected,predictions);
  const state=tracker.update(found,Date.now());
  window.__inkCameraWords=state.words;
  window.__inkCameraText=state.text;
  if(state.text)show(state.text,false);
  else if(regions.length)show("Printed text detected — character reading is uncertain.");
  else show("Point your camera at clearly printed text.");
  paint(regions,frame);
  stats.scans++;stats.lastScanMs=Math.round(performance.now()-t0);
 }catch(error){
  // A transient failed read must not wipe out words already recognized.
  const stable=tracker.snapshot();
  if(active&&id===epoch&&!stable.text)show("Camera is having trouble reading this frame.");
  if(stable.text)show(stable.text,false);
 }finally{
  reading=false;
  if(active&&id===epoch)schedule(id,110);
 }
}
async function start(){
 if(active)return;
 active=true;const id=++epoch;pass=0;tracker.reset();cache.clear();
 window.__inkCameraActive=true;
 window.__inkCameraText="";window.__inkCameraWords=[];
 window.__inkCameraStats={scans:0,lastScanMs:null,cacheHits:0,lastAngles:[],modelReady:false,detectedLines:0,highlightedRegions:0};
 board.classList.add("camera-active");button.setAttribute("aria-pressed","true");
 show("Requesting camera access…");
 try{
  if(!navigator.mediaDevices?.getUserMedia)
   throw Error("Camera requires HTTPS or a supported local browser file.");
  const incoming=await navigator.mediaDevices.getUserMedia({audio:false,
   video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
  if(!active||id!==epoch){incoming.getTracks().forEach(t=>t.stop());return}
  stream=incoming;video.srcObject=stream;await video.play();
  show("Point the camera at clear text.");schedule(id,20);
 }catch(error){
  if(!active||id!==epoch)return;
  const reason=error.name==="NotAllowedError"?"Camera permission denied.":
   error.name==="NotFoundError"?"No webcam found.":String(error.message||error);
  stop();output.textContent=reason;output.dataset.muted="true";
 }
}
button.addEventListener("click",()=>active?stop():start());
window.addEventListener("pagehide",()=>{if(active)stop()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stop()});
})();