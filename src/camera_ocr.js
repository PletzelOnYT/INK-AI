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
const glyphTracker=Core.createGlyphEvidenceTracker();
const regionTracker=Core.createRegionTracker();
const sceneMonitor=Core.createSceneMonitor();
const sceneCanvas=document.createElement("canvas");
sceneCanvas.width=24;sceneCanvas.height=14;
const sceneContext=sceneCanvas.getContext("2d",{willReadFrequently:true});
const cache=new Map();
const dictionaryByLength=new Map();
const vocabulary=document.getElementById("inkEnglishWords")?.textContent||"";
for(const word of vocabulary.toLowerCase().split(/\s+/)){
 if(!/^[a-z]{2,24}$/.test(word))continue;
 if(!dictionaryByLength.has(word.length))dictionaryByLength.set(word.length,[]);
 dictionaryByLength.get(word.length).push(word);
}

let active=false,stream=null,timer=0,frameCallback=0,reading=false,epoch=0,pass=0;
let captureWidth=800,usedDocumentUpscale=false;

window.__inkCameraActive=false;
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
function stop(){
 active=false;epoch++;clearTimeout(timer);timer=0;
 if(frameCallback&&typeof video.cancelVideoFrameCallback==="function")
  video.cancelVideoFrameCallback(frameCallback);
 frameCallback=0;
 if(stream)stream.getTracks().forEach(t=>t.stop());
 stream=null;video.pause();video.srcObject=null;
 board.classList.remove("camera-active");button.setAttribute("aria-pressed","false");
 tracker.reset();regionTracker.reset();glyphTracker.reset();sceneMonitor.reset();cache.clear();
 captureWidth=800;usedDocumentUpscale=false;
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
   if(!active||id!==epoch)return;
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
  const selected=[];let total=0;
  for(const option of source){
   const count=option.line.letters.length;
   if(count>40||total+count>45||selected.length>=5)continue;
   selected.push(option);total+=count;
  }
  paint(regions,frame);
  if(regions.length&&!tracker.snapshot().text)
   show("Verifying printed characters…");
  const images=selected.flatMap(item=>item.line.letters.map(
    box=>characterImage(box,item.frame)));
  const predictions=images.length?await classify(images):[];
  if(!active||id!==epoch)return;
  const found=decode(selected,predictions,verified,Date.now());
  const state=tracker.update(found,Date.now());
  window.__inkCameraWords=state.words;
  window.__inkCameraText=state.text;
  if(state.text)show(state.text,false);
  else if(regions.length)show("Scanning for reliable words…");
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
 window.__inkCameraStats={scans:0,lastScanMs:null,cacheHits:0,lastAngles:[],modelReady:false,detectedLines:0,highlightedRegions:0,sceneChanges:0,fusedWordCandidates:0,documentUpscaled:false};
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