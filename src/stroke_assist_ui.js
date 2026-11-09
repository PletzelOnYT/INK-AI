// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
const STROKE_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-sequence-v1.json";
let glyphWorker=null,glyphReady=false,glyphLoading=false,glyphBusy=false;
let glyphTimer=0,glyphRetry=0,glyphSerial=0,glyphEpoch=0,glyphDirty=false;
let glyphRequestedAt=0,glyphLastPreviewAt=0,glyphPenRevision=0;
let ghostPending=null,ghostOptions=[],ghostChoice=0;
window.__inkGlyphReady=false;
window.__inkAssistModel="online-stroke-gru";
window.__inkGlyphVersion=0;
window.__inkGlyphParameters=0;
window.__inkLastGlyphError="";
window.__inkHumanExamples=0;
window.__inkAssistLabel="";
window.__inkGhostSource="none";
window.__inkGhostSegments=0;
window.__inkGhostStrokeWidth=0;
window.__inkAcceptedVectorCount=0;
window.__inkSuggestionChoices=[];
window.__inkLivePreviewUpdates=0;
window.__inkAssistRequests=0;
window.__inkLastPreviewLatencyMs=0;
window.__inkLastPreviewTime=0;
window.__inkAssistInFlight=false;
function clearGhost(){
 ghostCandidate=null;ghostOptions=[];ghostChoice=0;ghostPending=null;
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 window.__inkAssistLabel="";window.__inkGhostSource="none";
 window.__inkSuggestionChoices=[];
}
function queueGhost(){
 if(!assistEnabled||tool!=="pen"){clearGhost();return}
 if(!glyphReady)return;
 if(glyphBusy){glyphDirty=true;return}
 if(glyphTimer)return;
 // True trailing-edge coalescing: do not restart this timer on each
 // pointermove. Continuous drawing MUST eventually trigger inference.
 const since=performance.now()-glyphRequestedAt;
 const interval=pointer!==null?105:135;
 const delay=Math.max(0,interval-since);
 glyphTimer=setTimeout(()=>{glyphTimer=0;generateGlyph()},delay);
}
function updateAssist(){
 assistEnabled=!assistEnabled;
 window.__inkAssistEnabled=assistEnabled;
 assistButton.setAttribute("aria-pressed",String(assistEnabled));
 assistButton.classList.toggle("assist-on",assistEnabled);
 ++glyphEpoch;
 if(!assistEnabled){
  clearTimeout(glyphTimer);glyphTimer=0;glyphDirty=false;clearGhost();
 }else{
  if(!glyphReady)loadGlyphModel();
  queueGhost();
 }
}
assistButton.addEventListener("click",updateAssist);
function bounds(stroke){
 let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;
 for(const [x,y] of stroke.points){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
 return {l,r,t,b};
}
function completionInput(){
 const list=current?[...strokes,current]:strokes;
 let start=0;
 for(let i=list.length-1;i>=0;i--)if(list[i].tool==="eraser"){start=i+1;break}
 const recent=list.slice(start).filter(s=>s.tool==="pen"&&s.points?.length>=2);
 if(!recent.length)return null;
 const group=[recent[recent.length-1]];
 let box=bounds(group[0]);
 for(let i=recent.length-2;i>=Math.max(0,recent.length-7);i--){
  const n=bounds(recent[i]);
  const dx=Math.max(0,n.l-box.r,box.l-n.r),dy=Math.max(0,n.t-box.b,box.t-n.b);
  if(dx>48||dy>65||Math.max(box.r,n.r)-Math.min(box.l,n.l)>280)break;
  group.unshift(recent[i]);
  box={l:Math.min(box.l,n.l),r:Math.max(box.r,n.r),
       t:Math.min(box.t,n.t),b:Math.max(box.b,n.b)};
 }
 const frameSize=Math.max(105,Math.min(290,Math.max(box.r-box.l,box.b-box.t)*1.4));
 const frame={x:box.l-frameSize*.16,y:box.t-frameSize*.16,size:frameSize};
 const prefix=[];let prev=[frame.x,frame.y];
 for(const stroke of group){
  const pts=stroke.points,selected=[pts[0]];
  for(let j=1;j<pts.length;j++){
   const p=pts[j],q=selected[selected.length-1];
   if(Math.hypot(p[0]-q[0],p[1]-q[1])>=Math.max(4,frameSize*.019)||
      j===pts.length-1)selected.push(p);
  }
  for(let j=0;j<selected.length;j++){
   const p=selected[j];
   prefix.push([(p[0]-prev[0])/frameSize,(p[1]-prev[1])/frameSize,j?1:0]);
   prev=p;
  }
 }
 if(prefix.length<2)return null;
 if(prefix.length>85){
  // Reframe only the current stroke; never truncate away the absolute token.
  const p=group[group.length-1].points,selected=[];
  const stride=Math.max(1,Math.ceil(p.length/55));
  for(let j=0;j<p.length;j+=stride)selected.push(p[j]);
  if(selected.length<2)return null;
  const b=bounds(group[group.length-1]);
  const sz=Math.max(105,Math.min(290,Math.max(b.r-b.l,b.b-b.t)*1.4));
  const f={x:b.l-sz*.16,y:b.t-sz*.16,size:sz};
  let prev=[f.x,f.y],short=[];
  selected.forEach((p,j)=>{
   short.push([(p[0]-prev[0])/sz,(p[1]-prev[1])/sz,j?1:0]);
   prev=p;
  });
  return {frame:f,prefix:short};
 }
 return {frame,prefix};
}
function createGlyphWorker(){
 if(glyphWorker)glyphWorker.terminate();
 const source=document.getElementById("strokeWorkerSource").textContent;
 const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
 glyphWorker=new Worker(url);URL.revokeObjectURL(url);
 glyphWorker.onmessage=e=>{
  const m=e.data;
  if(m.type==="ready"){
   glyphReady=true;glyphBusy=false;
   window.__inkGlyphReady=true;window.__inkGlyphVersion=3;
   window.__inkGlyphParameters=m.parameters;
   assistButton.title="Neural handwriting strokes · Tab alternatives · G accept";
   queueGhost();
  }else if(m.type==="preview"||m.type==="completion"){
   if(m.type==="completion"){
    glyphBusy=false;window.__inkAssistInFlight=false;
   }
   // Even when new pointer data arrived, DISPLAY the most recent completed
   // prediction rather than starving the preview by dropping every result.
   // Queue a fresher model call immediately afterwards.
   if(assistEnabled&&tool==="pen"&&m.neural===true&&
      m.epoch===glyphEpoch&&m.serial===glyphSerial&&
      ghostPending?.serial===m.serial){
     const possibilities=(m.alternatives||[]).filter(o=>o.paths?.some(p=>p.length>1));
     if(possibilities.length){
      ghostOptions=possibilities;
      window.__inkSuggestionChoices=ghostOptions.map(o=>o.label);
      ghostChoice=0;setGhostChoice(0);
      if(ghostCandidate){
       glyphLastPreviewAt=performance.now();
       window.__inkLastPreviewTime=glyphLastPreviewAt;
       window.__inkLastPreviewLatencyMs=Math.round(glyphLastPreviewAt-glyphRequestedAt);
       if(pointer!==null)window.__inkLivePreviewUpdates++;
      }
     }
   }
   if(m.type==="completion"){
    const dirty=glyphDirty;glyphDirty=false;
    if(dirty||pointer!==null)queueGhost();
   }
  }else if(m.type==="error"){
   glyphBusy=false;window.__inkAssistInFlight=false;
   window.__inkLastGlyphError=m.message||"Neural generation failed";
   assistButton.title=window.__inkLastGlyphError;
   const dirty=glyphDirty;glyphDirty=false;
   if(dirty||pointer!==null)queueGhost();
  }
 };
 glyphWorker.onerror=()=>{
  glyphReady=false;glyphBusy=false;window.__inkGlyphReady=false;
  window.__inkLastGlyphError="Neural trajectory worker failed";
 };
}
async function loadGlyphModel(){
 if(glyphReady||glyphLoading)return;
 glyphLoading=true;
 assistButton.title="Loading trained pen-trajectory model…";
 try{
  const sources=location.protocol==="file:"?[STROKE_URL]:
    ["models/ink-stroke-sequence-v1.json",STROKE_URL];
  let model=null,lastError=null;
  for(const source of sources){
   try{
    const r=await fetch(source,{cache:"no-store"});
    if(!r.ok)throw Error("Model not published HTTP "+r.status);
    model=await r.json();
    if(model.format!=="ink-online-stroke-mdn-v1")throw Error("Wrong sequence model");
    break;
   }catch(err){lastError=err;model=null}
  }
  if(!model)throw lastError||Error("No generative weights found");
  createGlyphWorker();
  glyphWorker.postMessage({cmd:"init",model});
  window.__inkLastGlyphError="";
 }catch(err){
  window.__inkLastGlyphError=String(err.message||err);
  assistButton.title="Neural sequence model not published yet; checking again";
  clearGhost();
  if(assistEnabled){
   clearTimeout(glyphRetry);
   glyphRetry=setTimeout(()=>{if(assistEnabled&&!glyphReady)loadGlyphModel()},30000);
  }
 }finally{glyphLoading=false}
}
async function generateGlyph(){
 if(!assistEnabled||tool!=="pen"||!glyphReady||glyphBusy||!loaded)return;
 const input=completionInput();
 if(!input){clearGhost();return}
 glyphBusy=true;window.__inkAssistInFlight=true;
 glyphRequestedAt=performance.now();window.__inkAssistRequests++;
 const serial=++glyphSerial,epoch=glyphEpoch;
 try{
  // The CNN supplies only class probabilities, NEVER proposed geometry.
  const f=input.frame;
  const bitmap=normalize([f.x,f.y,f.x+f.size,f.y+f.size],
       ctx.getImageData(0,0,canvas.width,canvas.height));
  const read=await request("read",{images:[bitmap]});
  if(epoch!==glyphEpoch||serial!==glyphSerial||!assistEnabled){
   glyphBusy=false;window.__inkAssistInFlight=false;return;
  }
  const options=read.predictions?.[0]?.top?.slice(0,4)||[];
  if(!options.length){glyphBusy=false;window.__inkAssistInFlight=false;return}
  ghostPending={frame:f,serial};
  glyphWorker.postMessage({cmd:"generate",serial,epoch,
     prefix:input.prefix,options: pointer!==null? options.slice(0,2):options,
     live:pointer!==null,maxSteps:pointer!==null?26:52});
 }catch(err){
  glyphBusy=false;window.__inkAssistInFlight=false;
  window.__inkLastGlyphError=String(err.message||err);
  if(glyphDirty||pointer!==null){glyphDirty=false;queueGhost()}
 }
}
function toScreenPaths(paths,frame){
 const result=[];
 for(const path of paths){
  if(path.length<2)continue;
  const points=path.map(p=>[frame.x+p[0]*frame.size,frame.y+p[1]*frame.size]);
  if(points.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])||
      p[0]<0||p[0]>canvas.width||p[1]<0||p[1]>canvas.height))continue;
  let length=0;
  for(let i=1;i<points.length;i++)
   length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  if(length>=5&&length<400)result.push(points);
 }
 return result;
}
function setGhostChoice(index){
 if(!assistEnabled||!ghostPending||!ghostOptions.length)return;
 let candidate=null;
 for(let offset=0;offset<ghostOptions.length;offset++){
  const ix=(index+offset)%ghostOptions.length,o=ghostOptions[ix];
  const paths=toScreenPaths(o.paths,ghostPending.frame);
  if(paths.length){
   ghostChoice=ix;candidate={label:o.label,paths,source:"neural-stroke-sequence"};
   break;
  }
 }
 ghostCandidate=candidate;renderGhost();
}
function smoothStroke(g,points){
 if(points.length<2)return;
 g.beginPath();g.moveTo(points[0][0],points[0][1]);
 for(let i=1;i<points.length-1;i++){
  const p=points[i],q=points[i+1];
  g.quadraticCurveTo(p[0],p[1],(p[0]+q[0])/2,(p[1]+q[1])/2);
 }
 const last=points[points.length-1];g.lineTo(last[0],last[1]);
 g.stroke();
}
function renderGhost(){
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 if(!assistEnabled||tool!=="pen"||!ghostCandidate)return;
 const width=Math.max(3,Math.min(8,ghostPending.frame.size*.028));
 ghostCtx.save();
 ghostCtx.strokeStyle="rgba(55,55,55,0.30)";
 ghostCtx.lineWidth=width;ghostCtx.lineCap="round";ghostCtx.lineJoin="round";
 for(const p of ghostCandidate.paths)smoothStroke(ghostCtx,p);
 ghostCtx.restore();
 window.__inkGhostPoints=ghostCandidate.paths.reduce((n,p)=>n+p.length,0);
 window.__inkGhostSegments=ghostCandidate.paths.length;
 window.__inkGhostStrokeWidth=width;
 window.__inkAssistLabel=ghostCandidate.label;
 window.__inkGhostSource="neural-stroke-sequence";
}
function acceptGhost(){
 if(!assistEnabled||tool!=="pen"||pointer!==null||!ghostCandidate)return;
 const paths=ghostCandidate.paths;
 for(const points of paths)
  strokes.push({tool:"pen",type:"vector-completion",
    width:window.__inkGhostStrokeWidth,points:points.map(p=>p.slice())});
 window.__inkAcceptedVectorCount+=paths.length;
 clearGhost();paint();schedule(70);
}
window.addEventListener("keydown",e=>{
 if(e.key==="Tab"&&assistEnabled&&ghostOptions.length>1){
  e.preventDefault();setGhostChoice((ghostChoice+1)%ghostOptions.length);return;
 }
 if((e.key.toLowerCase()==="g"||e.key==="Enter")&&!e.ctrlKey&&!e.altKey&&
    !e.metaKey&&!e.repeat&&
    !(e.target instanceof HTMLInputElement)&&
    !(e.target instanceof HTMLTextAreaElement))acceptGhost();
});
