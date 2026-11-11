"use strict";
/* INK AI camera reader: rotation-aware first-party OCR with persistent text.
   Uses only the trained models already bundled in this repository. */
(()=>{
const button=document.getElementById("camera"),board=document.querySelector(".board");
const video=document.getElementById("cameraVideo"),overlay=document.getElementById("cameraHighlights");
const frozenCanvas=document.getElementById("cameraFrozen");
const frozenCtx=frozenCanvas?.getContext("2d");
const output=document.getElementById("guess"),Core=window.InkCameraCore,
 Detector=window.InkCameraDetector;
if(!button||!board||!video||!overlay||!frozenCanvas||!frozenCtx||!output||!Core||!Detector)return;
const base=document.createElement("canvas"),bg=base.getContext("2d",{willReadFrequently:true});
const rotated=document.createElement("canvas"),rg=rotated.getContext("2d",{willReadFrequently:true});
const hg=overlay.getContext("2d");
const tracker=Core.createTracker();
const glyphTracker=Core.createGlyphEvidenceTracker();
const regionTracker=Core.createRegionTracker();
const sceneMonitor=Core.createSceneMonitor();
const sceneCanvas=document.createElement("canvas");
sceneCanvas.width=24;sceneCanvas.height=14;
const sceneContext=sceneCanvas.getContext("2d",{willReadFrequently:true});
const cache=new Map();
let lineRuntime=null,lineInit=null,offlineClient=null,offlineFailures=0;
const motion=window.InkCameraMotion?.create?.()||null;
let latestOCRState=null,motionRAF=0,lastMotionPaint=0;
window.__inkCameraLineReady=false;
async function loadNativeLineOCR(){
 if(lineInit||!window.InkLineRuntime)return lineInit;
 lineInit=(async()=>{
  try{
   let model=null;
   const embedded=document.getElementById("inkLineModel");
   if(embedded)model=JSON.parse(embedded.textContent);
   else if(location.protocol!=="file:"){
    const response=await fetch("models/ink-native-line-ctc-v1.json");
    if(response.ok)model=await response.json();
   }
   if(model?.format!=="ink-line-ctc-v1"||!model.training?.eligible||
      model.training.heldout_font_count<2)return;
   const instance=await window.InkLineRuntime.create(model);
   if(!active){instance.terminate();return}
   lineRuntime=instance;window.__inkCameraLineReady=true;
  }catch(error){
   window.__inkCameraLineError=String(error?.message||error);
  }
 })();
 return lineInit;
}
const dictionaryByLength=new Map();
const vocabulary=document.getElementById("inkEnglishWords")?.textContent||"";
for(const word of vocabulary.toLowerCase().split(/\s+/)){
 if(!/^[a-z]{2,24}$/.test(word))continue;
 if(!dictionaryByLength.has(word.length))dictionaryByLength.set(word.length,[]);
 dictionaryByLength.get(word.length).push(word);
}

let active=false,stream=null,timer=0,frameCallback=0,reading=false,epoch=0,pass=0;
let frozen=false,freezeRevision=0;
let captureWidth=800,usedDocumentUpscale=false;

window.__inkCameraActive=false;
window.__inkCameraFrozen=false;
window.__inkCameraText="";
window.__inkCameraWords=[];
window.__inkCameraEngine="ink-print-cnn-rotated";
window.__inkCameraStats={scans:0,lastScanMs:null,cacheHits:0,lastAngles:[],modelReady:false,detectedLines:0,highlightedRegions:0,sceneChanges:0,fusedWordCandidates:0,documentUpscaled:false};
function show(text,muted=true){
 if(!active)return;
 if(output.textContent!==text)output.textContent=text;
 output.dataset.muted=String(muted);
}
function clearMarks(){hg.clearRect(0,0,overlay.width,overlay.height)}
// Track only OCR-verified rectangles between slow neural inference calls.
function shiftVerifiedState(state,dx,dy){
 if(!state?.words)return state;
 return {...state,words:state.words.map(word=>{
  const box=word.box?{x0:word.box.x0+dx,y0:word.box.y0+dy,
   x1:word.box.x1+dx,y1:word.box.y1+dy}:undefined;
  const points=Array.isArray(word.points)?word.points.map(p=>
   ({x:p.x+dx,y:p.y+dy})):undefined;
  return {...word,...(box?{box}:{}),...(points?{points}:{})};
 })};
}
function motionTick(now){
 motionRAF=0;
 if(!active)return;
 if(!frozen&&!document.hidden&&offlineClient&&latestOCRState&&motion&&
    video.readyState>=2&&now-lastMotionPaint>=85){
  lastMotionPaint=now;
  try{
   const position=motion.update(video,now);
   window.__inkCameraMotionStats={...position,at:now};
   if(position.valid)
    offlineClient.paint(overlay,video,board,
      shiftVerifiedState(latestOCRState,position.dx,position.dy));
   else offlineClient.paint(overlay,video,board,
      {...latestOCRState,words:[]});
  }catch(_){/* OCR continues if an optional tracking sample fails. */}
 }
 motionRAF=requestAnimationFrame(motionTick);
}
function startMotionLoop(){
 if(motionRAF||typeof requestAnimationFrame!=="function")return;
 motionRAF=requestAnimationFrame(motionTick);
}
function cancelCameraSchedule(){
 clearTimeout(timer);timer=0;
 if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
  video.cancelVideoFrameCallback(frameCallback);
 frameCallback=0;
}
function toggleFreeze(){
 if(!active)return;
 if(!frozen){
  if(video.readyState<2||!video.videoWidth)return;
  frozenCanvas.width=video.videoWidth;
  frozenCanvas.height=video.videoHeight;
  frozenCtx.drawImage(video,0,0,frozenCanvas.width,frozenCanvas.height);
  frozen=true;freezeRevision++;
  window.__inkCameraFrozen=true;
  board.classList.add("camera-frozen");
  cancelCameraSchedule();
  button.title="Camera frozen — press C to resume";
  if(!window.__inkCameraText)show("Camera frozen — press C to resume.",true);
 }else{
  frozen=false;freezeRevision++;
  window.__inkCameraFrozen=false;
  board.classList.remove("camera-frozen");
  button.title="Camera active — press C to freeze";
  if(!window.__inkCameraText)show("Scanning — press C to freeze.",true);
  if(active&&!document.hidden)schedule(epoch,30);
 }
}

function stop(){
 if(motionRAF&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(motionRAF);
 motionRAF=0;lastMotionPaint=0;latestOCRState=null;motion?.reset();
 active=false;epoch++;freezeRevision++;
 cancelCameraSchedule();
 if(stream)stream.getTracks().forEach(t=>t.stop());
 stream=null;video.pause();video.srcObject=null;
 board.classList.remove("camera-active","camera-frozen");
 button.setAttribute("aria-pressed","false");
 button.title="Read text with webcam";
 frozen=false;window.__inkCameraFrozen=false;
 frozenCtx.clearRect(0,0,frozenCanvas.width,frozenCanvas.height);
 frozenCanvas.width=0;frozenCanvas.height=0;
 tracker.reset();regionTracker.reset();glyphTracker.reset();sceneMonitor.reset();cache.clear();
 if(lineRuntime){lineRuntime.terminate();lineRuntime=null}
 if(offlineClient){offlineClient.reset();offlineClient=null}
 latestOCRState=null;motion?.reset();
 offlineFailures=0;window.__inkCameraEngine="ink-print-cnn-rotated";
 lineInit=null;window.__inkCameraLineReady=false;
 captureWidth=800;usedDocumentUpscale=false;
 clearMarks();window.__inkCameraActive=false;window.__inkCameraText="";
 window.__inkCameraWords=[];
 delete output.dataset.camera;
 output.textContent=window.__inkLastGuess||"Draw something";
 output.dataset.muted=String(!window.__inkLastGuess);
 window.__inkLeaveCameraMode?.();
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
 const w=Math.min(captureWidth,video.videoWidth);
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
 // Only OCR words supported by three consistent CNN reads may receive
 // a white highlight. A geometric region alone (hair, cabinet, jersey)
 // is not proof that the region contains printed text.
 const accepted=tracker.snapshot().words.filter(t=>t.polygon?.length===4);
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
  if(letters.length<2)continue;
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
    regions.push({box:projected.box,polygon:projected.points,
     frame,sourceBox:box});
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
// Crop text-region RGB evidence for the independent text-vs-clutter neural
// classifier. A crop that merely has plausible glyph geometry is not trusted.
function textnessInput(region){
 const frame=region.frame,box=region.sourceBox;
 const values=new Array(64*24),data=frame.image.data;
 const width=box.x1-box.x0+1,height=box.y1-box.y0+1;
 const px=Math.max(3,width*.055),py=Math.max(2,height*.16);
 for(let y=0;y<24;y++)for(let x=0;x<64;x++){
  const sx=Math.min(frame.w-1,Math.max(0,
    Math.floor(box.x0-px+(x+.5)*(width+px*2)/64)));
  const sy=Math.min(frame.h-1,Math.max(0,
    Math.floor(box.y0-py+(y+.5)*(height+py*2)/24)));
  const k=(sy*frame.w+sx)*4;
  values[y*64+x]=(data[k]*.299+data[k+1]*.587+data[k+2]*.114)/255;
 }
 return values;
}
// Convert a complete detected text line, including spaces and touching
// letters, into an image for the native CTC sequence model. The input is
// 32x256 white ink on black, normalized exactly as in synthetic training.
function lineImage(option){
 const {line,frame}=option,letters=line.letters;
 const minX=Math.min(...letters.map(x=>x.x0));
 const maxX=Math.max(...letters.map(x=>x.x1));
 const minY=Math.min(...letters.map(x=>x.y0));
 const maxY=Math.max(...letters.map(x=>x.y1));
 const height=maxY-minY+1,width=maxX-minX+1;
 const padX=Math.max(2,Math.round(height*.24));
 const padY=Math.max(2,Math.round(height*.29));
 const inputW=width+padX*2,inputH=height+padY*2;
 const scale=Math.min(247/inputW,26/inputH);
 const targetW=Math.max(1,Math.round(inputW*scale));
 const targetH=Math.max(1,Math.round(inputH*scale));
 const offX=Math.floor((256-targetW)/2),offY=Math.floor((32-targetH)/2);
 const values=new Array(8192).fill(0);
 const mask=letters[0].mask,pixels=frame.image.data;
 const luminance=(x,y)=>{
  const xx=Math.min(frame.w-1,Math.max(0,Math.round(x)));
  const yy=Math.min(frame.h-1,Math.max(0,Math.round(y)));
  const k=(yy*frame.w+xx)*4;
  return pixels[k]*.299+pixels[k+1]*.587+pixels[k+2]*.114;
 };
 const background=[
  luminance(minX-padX,minY-padY),
  luminance(maxX+padX,minY-padY),
  luminance(minX-padX,maxY+padY),
  luminance(maxX+padX,maxY+padY)
 ].reduce((a,b)=>a+b,0)/4;
 const inverted=background>=128;
 const divisor=inverted?Math.max(40,background*.58):
   Math.max(40,(255-background)*.58);
 for(let y=0;y<targetH;y++)for(let x=0;x<targetW;x++){
  const u=(x+.5)*inputW/targetW-padX;
  const v=(y+.5)*inputH/targetH-padY;
  const px=Math.round(minX+u),py=Math.round(minY+v);
  if(px<0||py<0||px>=frame.w||py>=frame.h)continue;
  const grey=luminance(px,py);
  const signal=(inverted?background-grey:grey-background)/divisor;
  const isolated=mask[py*frame.w+px]?0.38:0;
  values[(offY+y)*256+offX+x]=Math.min(1,Math.max(0,signal,isolated));
 }
 return values;
}
async function readNativeLines(options,verified,id){
 const subset=options.filter(option=>{
  if(!window.__inkTextnessReady)return true;
  return verified.some(region=>{
   const a=option.region,b=region.box;
   const area=Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
     Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
   return overlap/area>=.24;
  });
 }).slice(0,5);
 if(!subset.length)return [];
 const read=await lineRuntime.read(subset.map(lineImage));
 if(!active||id!==epoch)return [];
 const words=[];
 for(let i=0;i<read.length;i++){
  const value=read[i],text=String(value.text||"").trim().replace(/\s+/g," ");
  if(!/^[A-Za-z0-9][A-Za-z0-9 .,:/'-]{1,45}$/.test(text)||
     !/[A-Za-z]{2}|[0-9]{2}/.test(text)||
     !Number.isFinite(value.confidence)||value.confidence<.64)continue;
  const {line,frame}=subset[i],box={x0:Math.min(...line.letters.map(x=>x.x0)),
   y0:Math.min(...line.letters.map(x=>x.y0)),
   x1:Math.max(...line.letters.map(x=>x.x1)),
   y1:Math.max(...line.letters.map(x=>x.y1))};
  const projected=project(box,frame);
  words.push({text,confidence:value.confidence,angle:frame.view.angle,
   polygon:projected.points,box:projected.box});
 }
 window.__inkCameraStats.lineModelCandidates=subset.length;
 return words;
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
function decode(lines,predictions,verified,now=Date.now()){
 const candidates=[];let offset=0;
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
   if(segment.length<2||segment.length>32)continue;
   const box={x0:Math.min(...segment.map(x=>x.box.x0)),
    y0:Math.min(...segment.map(x=>x.box.y0)),
    x1:Math.max(...segment.map(x=>x.box.x1)),
    y1:Math.max(...segment.map(x=>x.box.y1))};
   const projected=project(box,frame);
   if(!Core.visibility(projected.points,base.width,base.height))continue;
   if(window.__inkTextnessReady){
    const p=projected.box,area=Math.max(1,(p.x1-p.x0)*(p.y1-p.y0));
    if(!verified.some(region=>{
     const r=region.box;
     const overlap=Math.max(0,Math.min(p.x1,r.x1)-Math.max(p.x0,r.x0))*
       Math.max(0,Math.min(p.y1,r.y1)-Math.max(p.y0,r.y0));
     return overlap/area>=.48;
    }))continue;
   }
   candidates.push({box:projected.box,polygon:projected.points,
    angle:frame.view.angle,predictions:segment.map(x=>x.prediction)});
  }
 }
 const fused=glyphTracker.update(candidates,now),words=[];
 for(const item of fused){
  const selected=item.predictions;
  let text="",confidence=0;
  // The lexicon may only correct a word when the original neural
  // probabilities support that correction. No invented confidence boost.
  const corrected=Core.decodePrintedWord(selected,
    dictionaryByLength.get(selected.length));
  if(corrected){
   text=corrected.text;confidence=corrected.confidence;
  }else{
   let failed=false;
   for(const prediction of selected){
    const top=prediction?.top?.[0],second=prediction?.top?.[1];
    if(!top||!/[A-Za-z]/.test(top.char)||top.char.length!==1||
       top.confidence<(selected.length===2?.80:.73)||
       top.confidence-(second?.confidence||0)<.24){failed=true;break}
    text+=top.char;confidence+=top.confidence;
   }
   if(failed)continue;
   confidence/=selected.length;
  }
  if(!Core.looksLikeWord(text,confidence))continue;
  words.push({text,confidence,box:item.box,polygon:item.polygon,
   angle:item.angle,evidenceFrames:item.frames});
 }
 window.__inkCameraStats.fusedWordCandidates=fused.length;
 return words;
}
function schedule(id,delay=100){
 clearTimeout(timer);
 if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
  video.cancelVideoFrameCallback(frameCallback);
 frameCallback=0;
 if(!active||id!==epoch||frozen||document.hidden)return;
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
 if(!active||id!==epoch||reading||frozen||document.hidden)return;
 const revision=freezeRevision;
 // The bundled offline WASM OCR runs without a companion or network.
 // Process only the newest live frame; discard completed reads when paused.
 if(offlineClient){
  if(video.readyState<2||!video.videoWidth){schedule(id,70);return}
  reading=true;
  const started=performance.now();
  // Reference pixels are sampled before OCR, not from a newer webcam frame.
  let sourceFrame=null;
  try{sourceFrame=motion?.capture(video)||null}catch(_){}
  try{
   const payload=await offlineClient.recognize(video);
   if(!active||id!==epoch||frozen||document.hidden||revision!==freezeRevision)return;
   if(payload){
    const current=offlineClient.track(payload,Date.now());
    window.__inkCameraText=current.text;
    window.__inkCameraWords=current.words;
    latestOCRState=current;
    if(motion&&sourceFrame)
     motion.setReference(sourceFrame,current.words,
      video.videoWidth,video.videoHeight);
    offlineClient.paint(overlay,video,board,current);
    if(current.text)show(current.text,false);
    else show("Point the camera at printed or handwritten text.");
    const metrics=window.__inkCameraStats;
    metrics.scans++;
    metrics.engine="offline-tesseract-wasm";
    metrics.lastScanMs=Math.round(performance.now()-started);
    metrics.ocrMs=Math.round(Number(payload.elapsedMs)||0);
    metrics.recognizedWords=current.words.length;
    offlineFailures=0;
   }
  }catch(error){
   if(frozen||document.hidden||revision!==freezeRevision)return;
   offlineFailures++;
   if(offlineFailures>=4){
    offlineClient.reset();offlineClient=null;
    window.__inkCameraEngine="ink-print-cnn-rotated";
    show("Bundled browser OCR failed — using experimental INK AI OCR.");
   }
  }finally{
   reading=false;
   if(active&&id===epoch&&!frozen&&!document.hidden)schedule(id,30);
  }
  return;
 }
 if(!window.__inkReady||!window.__inkCameraRecognize){
  show("Loading INK AI's local character model…");schedule(id,150);return;
 }
 if(video.readyState<2||!video.videoWidth){schedule(id,110);return}
 reading=true;
 const t0=performance.now(),stats=window.__inkCameraStats;
 try{
  makeBase();
  // A new document / moved camera must not inherit guesses from previous
  // scenes. Compare a tiny low-resolution color signature, never store video.
  sceneContext.drawImage(base,0,0,sceneCanvas.width,sceneCanvas.height);
  const signature=sceneContext.getImageData(0,0,sceneCanvas.width,sceneCanvas.height);
  const scene=sceneMonitor.update(signature.data,Date.now());
  if(scene.changed){
   tracker.reset();regionTracker.reset();glyphTracker.reset();
   stats.sceneChanges++;
   window.__inkCameraText="";window.__inkCameraWords=[];
  }
  const preferred=tracker.snapshot().activeAngle;
  const first=extract(makeView(0));
  // Small real document text becomes ~7-12 pixels tall at 800px. This
  // makes isolated-character CNN input too blurry. Switch once to native
  // camera detail, but keep a fixed coordinate system thereafter.
  if(!usedDocumentUpscale&&captureWidth<1200&&video.videoWidth>=1100&&
     first.lines.some(line=>line.letters.length>=5&&
       line.medianHeight>=6&&line.medianHeight<16)){
   captureWidth=1200;usedDocumentUpscale=true;
   tracker.reset();regionTracker.reset();glyphTracker.reset();cache.clear();
   stats.documentUpscaled=true;
   show("Document text found — switching to sharper camera detail…");
   return;
  }
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
  const frame={w:base.width,h:base.height};
  const proposed=detectedWordRegions(geometry);
  let verified=proposed;
  if(window.__inkTextnessReady&&proposed.length){
   const scores=await window.__inkCameraVerifyText(
     proposed.slice(0,14).map(textnessInput));
   if(!active||id!==epoch||frozen||document.hidden||revision!==freezeRevision)return;
   verified=proposed.slice(0,14).filter((item,i)=>
     Number.isFinite(scores?.[i])&&scores[i]>=.88);
  }
  const regions=regionTracker.update(verified,Date.now());
  stats.detectedLines=geometry.length;
  stats.highlightedRegions=regions.length;
  stats.textnessReady=Boolean(window.__inkTextnessReady);
  stats.verifiedRegions=verified.length;
  const source=window.__inkTextnessReady?
   scanOrder.filter(option=>verified.some(region=>region.frame===option.frame)):
   scanOrder;
  if(window.__inkCameraLineReady&&lineRuntime){
   const sequenceWords=await readNativeLines(scanOrder,verified,id);
   if(!active||id!==epoch||frozen||document.hidden||revision!==freezeRevision)return;
   const state=tracker.update(sequenceWords,Date.now());
   window.__inkCameraWords=state.words;
   window.__inkCameraText=state.text;
   if(state.text)show(state.text,false);
   else show(geometry.length?
     "Text located — confirming complete lines…":
     "Point your camera at clearly printed text.");
   paint(verified,{w:base.width,h:base.height});
   stats.scans++;stats.lastScanMs=Math.round(performance.now()-t0);
   stats.lineModelReady=true;
   return;
  }
  const selected=[];let total=0;
  for(const option of source){
   const count=option.line.letters.length;
   if(count>40||total+count>45||selected.length>=5)continue;
   selected.push(option);total+=count;
  }
  paint(regions,frame);
  if(regions.length&&!tracker.snapshot().text)
   show("Printed text found ("+geometry.length+" lines). Checking letters…");
  const images=selected.flatMap(item=>item.line.letters.map(
    box=>characterImage(box,item.frame)));
  const predictions=images.length?await classify(images):[];
  if(!active||id!==epoch||frozen||document.hidden||revision!==freezeRevision)return;
  const found=decode(selected,predictions,verified,Date.now());
  const state=tracker.update(found,Date.now());
  window.__inkCameraWords=state.words;
  window.__inkCameraText=state.text;
  if(state.text)show(state.text,false);
  else if(regions.length)show("Printed text located, but word recognition is uncertain. Hold steady or move closer.");
  else if(geometry.length)show("Found "+geometry.length+" possible text lines. Bring the document closer.");
  else show("Point your camera at clearly printed text.");
  paint(regions,frame);
  stats.scans++;stats.lastScanMs=Math.round(performance.now()-t0);
 }catch(error){
  // A transient failed read must not wipe out words already recognized.
  const stable=tracker.snapshot();
  if(active&&id===epoch&&!frozen&&!document.hidden&&revision===freezeRevision&&!stable.text)show("Camera is having trouble reading this frame.");
  if(stable.text&&!frozen&&!document.hidden&&revision===freezeRevision)show(stable.text,false);
 }finally{
  reading=false;
  if(active&&id===epoch&&!frozen&&!document.hidden)schedule(id,110);
 }
}
async function start(){
 if(active)return;
 active=true;frozen=false;freezeRevision++;
 board.classList.remove("camera-frozen");window.__inkCameraFrozen=false;
 const id=++epoch;pass=0;tracker.reset();cache.clear();
 window.__inkCameraActive=true;
 window.__inkEnterCameraMode?.();
 output.dataset.camera="true";
 window.__inkCameraText="";window.__inkCameraWords=[];
 window.__inkCameraStats={scans:0,lastScanMs:null,cacheHits:0,lastAngles:[],modelReady:false,detectedLines:0,highlightedRegions:0,sceneChanges:0,fusedWordCandidates:0,documentUpscaled:false};
 board.classList.add("camera-active");button.setAttribute("aria-pressed","true");
 show("Requesting camera access…");
 try{
  if(!navigator.mediaDevices?.getUserMedia)
   throw Error("Camera requires HTTPS or a supported local browser file.");
  const preferNative=Boolean(window.InkOfflineOCR?.create);
  const incoming=await navigator.mediaDevices.getUserMedia({audio:false,
   video:{facingMode:{ideal:"environment"},
    width:{ideal:preferNative?1920:1280},
    height:{ideal:preferNative?1080:720}}});
  if(!active||id!==epoch){incoming.getTracks().forEach(t=>t.stop());return}
  stream=incoming;video.srcObject=stream;await video.play();
  if(window.InkOfflineCamera?.connect){
   show("Loading fully offline text recognition…");
   try{
    offlineClient=await window.InkOfflineCamera.connect();
   }catch(error){
    window.__inkCameraOfflineError=String(error?.message||error);
    offlineClient=null;
   }
   if(!active||id!==epoch){offlineClient?.reset();offlineClient=null;return}
  }
  if(offlineClient){
   window.__inkCameraEngine="offline-tesseract-wasm";
   button.title="Offline OCR active — press C to freeze webcam";
   show("Offline OCR ready — point the camera at text.");
  }else{
   window.__inkCameraEngine="ink-print-cnn-rotated";
   button.title="Experimental OCR active — press C to freeze webcam";
   show("Point the camera at clear text.");
   loadNativeLineOCR();
  }
  startMotionLoop();
  schedule(id,20);
 }catch(error){
  if(!active||id!==epoch)return;
  const reason=error.name==="NotAllowedError"?"Camera permission denied.":
   error.name==="NotFoundError"?"No webcam found.":String(error.message||error);
  stop();output.textContent=reason;output.dataset.muted="true";
 }
}
window.__inkStopCamera=stop;
button.addEventListener("click",()=>active?stop():start());
window.addEventListener("keydown",e=>{
 if(!active||e.repeat||e.ctrlKey||e.metaKey||e.altKey||
    e.key.toLowerCase()!=="c")return;
 const target=e.target;
 if(target&&(target.isContentEditable||
    target instanceof HTMLInputElement||
    target instanceof HTMLTextAreaElement))return;
 e.preventDefault();
 toggleFreeze();
});
window.addEventListener("pagehide",()=>{if(active)stop()});
// Switching tabs must NOT stop the camera or deselect the tool.
// Suspend heavy recognition while hidden; resume without a new permission
// prompt when the tab becomes visible again.
document.addEventListener("visibilitychange",()=>{
 if(!active)return;
 if(document.hidden)cancelCameraSchedule();
 else if(!frozen){
  if(video.paused)video.play().catch(()=>{});
  schedule(epoch,40);
 }
});
})();