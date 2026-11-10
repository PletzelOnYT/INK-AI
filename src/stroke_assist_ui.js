// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// English word context only reorders plausible CNN labels; it never draws
// letters, invents strokes, or changes high-confidence classifications.
const englishWords=document.getElementById("inkEnglishWords")?.textContent.trim().split(/\s+/)||[];
const englishRanks=new Map();
const englishPrefixes=new Set();
for(let i=0;i<englishWords.length;i++){
 const word=englishWords[i];
 if(!/^[a-z]+$/.test(word)||englishRanks.has(word))continue;
 englishRanks.set(word,i+1);
 for(let n=2;n<word.length;n++)englishPrefixes.add(word.slice(0,n));
}
window.__inkDictionaryWords=englishRanks.size;
window.__inkWordRegions=[];
function dictionaryRankOptions(incoming,box){
 if(incoming.length<2||!window.__inkWordRegions.length)return incoming;
 const regions=window.__inkWordRegions,choices=window.__inkTopCandidates;
 const cx=(box.l+box.r)/2,cy=(box.t+box.b)/2;
 let index=-1,bestDistance=Infinity;
 for(let i=0;i<regions.length;i++){
  const r=regions[i],b=r.box;
  const dx=Math.max(0,b[0]-cx,cx-b[2]),dy=Math.max(0,b[1]-cy,cy-b[3]);
  const distance=dx*dx+dy*dy;
  if(distance<bestDistance){bestDistance=distance;index=i}
 }
 if(index<0||bestDistance>400||!regions[index])return incoming;
 let prefix="",suffix="";
 for(let j=index-1;j>=0;j--){
  if(regions[j].line!==regions[index].line||regions[j+1].space)break;
  const char=choices[j]?.[0]?.char;
  if(!/^[a-z]$/i.test(char||""))break;
  prefix=char+prefix;
 }
 for(let j=index+1;j<regions.length;j++){
  if(regions[j].line!==regions[index].line||regions[j].space)break;
  const char=choices[j]?.[0]?.char;
  if(!/^[a-z]$/i.test(char||""))break;
  suffix+=char;
 }
 if(prefix.length+suffix.length<2)return incoming;
 const highest=Math.max(...incoming.map(x=>x.confidence||0));
 if(highest>=.87)return incoming;
 return incoming.map(option=>{
  const char=option.char;
  if(!/^[a-z]$/i.test(char)||(option.confidence||0)<highest*.12)
   return {...option,_languageScore:-100};
  const word=(prefix+char+suffix).toLowerCase(),rank=englishRanks.get(word);
  let bonus=0;
  if(rank&&word.length>=3)bonus=1.05+.30*Math.log(10001/rank)/Math.log(10001);
  else if(!suffix&&englishPrefixes.has(word))bonus=.24;
  return {...option,_languageScore:Math.log(Math.max(.00001,option.confidence))+bonus};
 }).sort((a,b)=>b._languageScore-a._languageScore);
}
function completedLowercaseH(input){
 if(!input?.group||input.group.length<2)return false;
 const box=input.box,range=box.b-box.t;
 if(range<70)return false;
 const last=input.group.at(-1).points.at(-1);
 return last[1]>=box.b-Math.max(12,range*.105);
}

const STROKE_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-sequence-v1.json";
const STROKE_V2_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-sequence-v2.json";
const STROKE_PREFIX_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-v1.json";
const STROKE_PREFIX_DOMAIN_V2_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-domain-v2.json";
const STROKE_PENLIFT_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-penlift-v3.json";
let glyphWorker=null,glyphReady=false,glyphLoading=false,glyphBusy=false;
let glyphTimer=0,glyphRetry=0,glyphSerial=0,glyphEpoch=0,glyphDirty=false;
let glyphRequestedAt=0,glyphLastPreviewAt=0,glyphStrokeSeed=0;
let glyphClassMemory=new Map();
let glyphLastReadAt=0,glyphCachedOptions=[],glyphReadCount=0;
window.__inkAssistOCRReads=0;
window.__inkAssistCacheHits=0;
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
window.__inkCompletionReranks=0;
window.__inkCompletionConfidence=0;
window.__inkCompletionModel="";
window.__inkLivePreviewUpdates=0;
window.__inkAssistRequests=0;
window.__inkLastPreviewLatencyMs=0;
window.__inkLastPreviewTime=0;
window.__inkAssistInFlight=false;
window.__inkFallbackReady=false;
window.__inkFallbackUsed=0;
window.__inkGhostTailDy=0;
window.__inkGhostTailRange=0;
let glyphFallbackLoading=false;
async function loadValidatedBackup(){
 if(glyphFallbackLoading||!glyphWorker)return;
 glyphFallbackLoading=true;
 try{
  // The backup generator is included in the standalone HTML.
  const embedded=document.getElementById("inkStrokeBackup");
  if(embedded){
   try{
    const model=JSON.parse(embedded.textContent);
    if(model.format==="ink-online-stroke-mdn-v1"&&
       model.parameter_count<1000000&&!model.training?.prefix_tuned){
     glyphWorker.postMessage({cmd:"fallback",model});
     return;
    }
   }catch(_){/* Fall through to repository model on older HTML files. */}
  }
  const urls=location.protocol==="file:"?[STROKE_URL]:
      ["models/ink-stroke-sequence-v1.json",STROKE_URL];
  for(const url of urls){
   try{
    const response=await fetch(url,{cache:"default"});
    if(!response.ok)continue;
    const model=await response.json();
    if(model.format!=="ink-online-stroke-mdn-v1"||
       model.parameter_count>=1000000||
       model.training?.prefix_tuned)continue;
    glyphWorker.postMessage({cmd:"fallback",model});
    return;
   }catch(_){/* Existing primary model stays usable */}
  }
 }finally{glyphFallbackLoading=false}
}

function clearGhost(){
 ghostCandidate=null;ghostOptions=[];ghostChoice=0;ghostPending=null;
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 window.__inkAssistLabel="";window.__inkGhostSource="none";
 window.__inkGhostTailDy=0;window.__inkGhostTailRange=0;
 window.__inkSuggestionChoices=[];
}
function beginAssistStroke(){
 glyphStrokeSeed=(glyphStrokeSeed+1)|0;
 glyphClassMemory.clear();
 glyphCachedOptions=[];glyphLastReadAt=0;
}
function queueGhost(){
 if(!assistEnabled||tool!=="pen"){clearGhost();return}
 if(!glyphReady)return;
 if(glyphBusy){glyphDirty=true;return}
 if(glyphTimer)return;
 // True trailing-edge coalescing: do not restart this timer on each
 // pointermove. Continuous drawing MUST eventually trigger inference.
 const since=performance.now()-glyphRequestedAt;
 const interval=pointer!==null?65:95;
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
  return {frame:f,prefix:short,box:b};
 }
 return {frame,prefix,box,group};
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
   window.__inkGlyphReady=true;
   window.__inkGlyphVersion=m.penLift?7:(m.prefixDomain?6:(m.prefixTuned?5:(m.parameters>=1000000?4:3)));
   window.__inkPenLiftCalibrated=Boolean(m.penLift);
   window.__inkPrefixDomain=Boolean(m.prefixDomain);
   window.__inkGlyphParameters=m.parameters;
   window.__inkPrefixTrained=Boolean(m.prefixTuned);
   assistButton.title=m.penLift?
     "Multi-stroke calibrated handwriting model · Live · Tab · G":
     m.prefixDomain?
     "Browser-prefix-trained handwriting · Live · Tab alternatives · G accept":
     m.prefixTuned?
     "Prefix-trained neural handwriting · per-character fallback · Tab alternatives · G accept":
     m.parameters>=1000000?
     "1M neural handwriting strokes · Live · Tab alternatives · G accept":
     "Neural handwriting strokes · Live · Tab alternatives · G accept";
   if(m.prefixTuned||m.parameters>=1000000)loadValidatedBackup();
   queueGhost();
  }else if(m.type==="fallback-ready"){
   window.__inkFallbackReady=true;
   if(assistEnabled)queueGhost();
  }else if(m.type==="preview"||m.type==="completion"){
   if(m.type==="completion"){
    glyphBusy=false;window.__inkAssistInFlight=false;
    if(m.fallback)window.__inkFallbackUsed++;
   }
   // Even when new pointer data arrived, DISPLAY the most recent completed
   // prediction rather than starving the preview by dropping every result.
   // Queue a fresher model call immediately afterwards.
   if(assistEnabled&&tool==="pen"&&m.neural===true&&
      m.epoch===glyphEpoch&&m.serial===glyphSerial&&
      ghostPending?.serial===m.serial){
     const possibilities=(m.alternatives||[]).filter(o=>o.paths?.some(p=>p.length>1));
     if(!possibilities.length&&m.type==="completion"){
      clearGhost();
     }
     if(possibilities.length){
      const serial=m.serial,epoch=m.epoch,pending=ghostPending;
      const publish=ordered=>{
       if(!assistEnabled||tool!=="pen"||glyphSerial!==serial||
          glyphEpoch!==epoch||ghostPending?.serial!==serial)return;
       if(!ordered.length){clearGhost();return}
       ghostOptions=ordered;
       window.__inkSuggestionChoices=ordered.map(o=>o.label);
       ghostChoice=0;setGhostChoice(0);
       if(ghostCandidate){
        glyphLastPreviewAt=performance.now();
        window.__inkLastPreviewTime=glyphLastPreviewAt;
        window.__inkLastPreviewLatencyMs=Math.round(glyphLastPreviewAt-glyphRequestedAt);
        if(pointer!==null)window.__inkLivePreviewUpdates++;
       }
      };
      if(m.type==="completion"&&pointer===null&&pending?.box){
       // The unverified raw rollout is often the ugly flash users see.
       // Wait for the independent handwritten-CNN critic BEFORE painting a
       // stationary ghost; still stream live neural strokes while drawing.
       scoreFinishedAlternatives(possibilities,pending).then(ordered=>{
        if(pointer===null)publish(ordered);
       }).catch(err=>{
        window.__inkLastGlyphError="Candidate scoring: "+String(err.message||err);
        if(glyphSerial===serial&&glyphEpoch===epoch&&pointer===null)clearGhost();
       });
      }else if(pointer!==null){
       publish(possibilities);
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
  // Prefix-trained generator has been evaluated on unseen writers'
  // *free-running* tail error. Prefer it over a bigger model selected only
  // by teacher-forced likelihood, when that checkpoint has been published.
  const sources=location.protocol==="file:"?
    [STROKE_PENLIFT_V3_URL,STROKE_PREFIX_DOMAIN_V2_URL,
     STROKE_PREFIX_URL,STROKE_V2_URL,STROKE_URL]:
    ["models/ink-stroke-penlift-v3.json",STROKE_PENLIFT_V3_URL,
     "models/ink-stroke-prefix-domain-v2.json",STROKE_PREFIX_DOMAIN_V2_URL,
     "models/ink-stroke-prefix-v1.json",STROKE_PREFIX_URL,
     "models/ink-stroke-sequence-v2.json",STROKE_V2_URL,
     "models/ink-stroke-sequence-v1.json",STROKE_URL];
  let model=null,lastError=null;
  const embedded=document.getElementById("inkStrokeModel");
  if(embedded){
   try{
    const saved=JSON.parse(embedded.textContent);
    if(saved.format==="ink-online-stroke-mdn-v1"&&
       saved.training?.prefix_domain_v2&&
       saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-v1.json")
       model=saved;
   }catch(_){/* Fall back to repository files when unavailable. */}
  }
  for(const source of sources){
   if(model)break;
   try{
    const r=await fetch(source,{cache:(source.includes("v2")||source.includes("v3")||source.includes("prefix"))?"no-store":"default"});
    if(!r.ok)throw Error("Model not published HTTP "+r.status);
    const candidate=await r.json();
    if(candidate.format!=="ink-online-stroke-mdn-v1")
      throw Error("Wrong sequence model");
    if(source.includes("v2") && !(candidate.training?.v2&&candidate.parameter_count>=1000000))
      throw Error("Unvalidated larger model");
    if(source.includes("penlift-v3")){
      if(!(candidate.training?.penlift_calibrated_v3 &&
         candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated multi-stroke model");
    }else if(source.includes("prefix-domain-v2")){
      if(!(candidate.training?.prefix_domain_v2 &&
         candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-v1.json"))
       throw Error("Unvalidated browser-domain model");
    }else if(source.includes("prefix") && !(
       candidate.training?.prefix_tuned &&
       candidate.training?.fine_tuned_own_model==="models/ink-stroke-sequence-v1.json")){
      throw Error("Unvalidated prefix-completion model");
    }
    model=candidate;break;
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
function stableCharacterOptions(incoming){
 // Partial glyphs are inherently ambiguous. Keep a short exponentially
 // decaying memory of the CNN class probabilities across successive pen
 // movements so the assistant doesn't switch letters every few pixels.
 for(const [char,score] of glyphClassMemory){
  const updated=score*.58;
  if(updated<.004)glyphClassMemory.delete(char);
  else glyphClassMemory.set(char,updated);
 }
 for(const candidate of incoming){
  if(typeof candidate.char!=="string")continue;
  const confidence=Math.max(.001,Math.min(1,Number(candidate.confidence)||0));
  glyphClassMemory.set(candidate.char,(glyphClassMemory.get(candidate.char)||0)+confidence);
 }
 // The board-level recognizer can see the WHOLE multi-stroke character,
 // while this assist query sees only a tighter partial-glyph crop. When the
 // recognized text clearly contains one glyph (as in the user's h screenshot),
 // include that identity so the completion model doesn't substitute n/r/l.
 const whole=window.__inkLastGuess;
 if(window.__inkDetectedRegions===1&&typeof whole==="string"&&
    whole.length===1&&!/\s/.test(whole)){
  glyphClassMemory.set(whole,(glyphClassMemory.get(whole)||0)+.84);
 }
 return [...glyphClassMemory.entries()].sort((a,b)=>b[1]-a[1])
  .slice(0,4).map(([char,score])=>({char,confidence:score}));
}
function isLiveCandidateRequired(input,label,live){
 if(live)return true;
 if(label==="h"&&completedLowercaseH(input))return false;
 return true;
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
  // Reuse a recent class prediction during continuous pointer movement.
  // Every request still uses the LATEST pen coordinates for neural generation.
  const live=pointer!==null,now=performance.now();
  let options;
  if(live&&glyphCachedOptions.length&&now-glyphLastReadAt<650){
   options=glyphCachedOptions.map(o=>({...o}));
   window.__inkAssistCacheHits++;
  }else{
   const bitmap=normalize([f.x,f.y,f.x+f.size,f.y+f.size],
        ctx.getImageData(0,0,canvas.width,canvas.height));
   const read=await request("read",{images:[bitmap]});
   if(epoch!==glyphEpoch||serial!==glyphSerial||!assistEnabled){
    glyphBusy=false;window.__inkAssistInFlight=false;return;
   }
   const fresh=read.predictions?.[0]?.top?.slice(0,4)||[];
   options=dictionaryRankOptions(stableCharacterOptions(fresh),input.box);
   glyphCachedOptions=options.map(o=>({...o}));
   glyphLastReadAt=performance.now();
   window.__inkAssistOCRReads=++glyphReadCount;
  }
  // A full multi-stroke glyph is much more informative than a partial crop.
  // In the screenshot the board OCR says "h" but the cropped assistant OCR
  // said L/H/k. Put h FIRST and insist on a neural completion of h.
  const whole=window.__inkDetectedRegions===1?window.__inkLastGuess:null;
  const preferred=typeof whole==="string"&&whole.length===1&&
    !/\s/.test(whole)?whole:null;
  if(preferred){
   options=[{char:preferred,confidence:1},
     ...options.filter(c=>c.char!==preferred)].slice(0,4);
  }
  // When the writer has already reached the ascender's baseline with
  // the right leg of h, don't append a meaningless extra tail.
  if(!isLiveCandidateRequired(input,preferred,pointer!==null)){
   clearGhost();glyphBusy=false;window.__inkAssistInFlight=false;
   return;
  }
  if(!options.length){
   glyphBusy=false;window.__inkAssistInFlight=false;
   if(pointer!==null)queueGhost();
   return;
  }
  ghostPending={frame:f,box:input.box,serial};
  const isLive=pointer!==null;
  const big=window.__inkGlyphParameters>=1000000;
  glyphWorker.postMessage({cmd:"generate",serial,epoch,
     prefix:input.prefix,options: isLive? options.slice(0,big?1:2):options,
     live:isLive,maxSteps:isLive?(big?18:24):52,
     preferred,searchFallback:!isLive,seed:glyphStrokeSeed});
 }catch(err){
  glyphBusy=false;window.__inkAssistInFlight=false;
  window.__inkLastGlyphError=String(err.message||err);
  if(glyphDirty||pointer!==null){glyphDirty=false;queueGhost()}
 }
}
// Final-ink recognition critic. The generative stroke model proposes the
// vectors; a separate CNN then checks how much each completed character
// actually looks like its intended label. All inference remains in-browser.
// This does NOT trace fonts or substitute reference/example images.
async function scoreFinishedAlternatives(alternatives,pending){
 if(!loaded||!pending?.box||alternatives.length<2)return alternatives;
 const valid=alternatives.slice(0,9).map(candidate=>({
   candidate,paths:toScreenPaths(candidate.paths,pending.frame)
 })).filter(x=>x.paths.length>0);
 if(valid.length<2)return alternatives;
 const masks=[];
 const temp=document.createElement("canvas");
 temp.width=canvas.width;temp.height=canvas.height;
 const t=temp.getContext("2d",{willReadFrequently:true});
 const b=pending.box;
 for(const item of valid){
  t.fillStyle="#fff";t.fillRect(0,0,temp.width,temp.height);
  t.drawImage(canvas,0,0);
  t.strokeStyle="#111";t.lineCap="round";t.lineJoin="round";
  t.lineWidth=Math.max(3,Math.min(8,pending.frame.size*.028));
  for(const path of item.paths)smoothStroke(t,path);
  let x0=b.l,x1=b.r,y0=b.t,y1=b.b;
  for(const path of item.paths)for(const p of path){
   x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);
   y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
  }
  x0=Math.max(0,Math.floor(x0-7));
  x1=Math.min(temp.width-1,Math.ceil(x1+7));
  y0=Math.max(0,Math.floor(y0-7));
  y1=Math.min(temp.height-1,Math.ceil(y1+7));
  if(x1<=x0||y1<=y0){masks.push(Array(1024).fill(0));continue}
  const crop=t.getImageData(x0,y0,x1-x0+1,y1-y0+1);
  masks.push(normalize([0,0,x1-x0,y1-y0],crop));
 }
 const predictions=await request("read",{images:masks});
 if(predictions.predictions?.length!==valid.length)return alternatives;
 for(let i=0;i<valid.length;i++){
  const item=valid[i];
  const top=predictions.predictions[i].top||[];
  const p=top.find(x=>x.char===item.candidate.label)?.confidence||.0005;
  item.candidate._finishedConfidence=p;
  const geometric=Math.max(-2.5,Math.min(2.5,item.candidate.quality||0));
  item.candidate._combinedScore=
    2.6*Math.log(p+.003)+.23*geometric+
    .08*Math.max(-5,Math.min(3,item.candidate.score||0));
 }
 valid.sort((a,b)=>b.candidate._combinedScore-a.candidate._combinedScore);
 const sorted=valid.map(x=>x.candidate);
 // A high-confidence wrong glyph should never win merely because the
 // decoder sampled it with a good local stroke likelihood.
 const preferred=window.__inkLastGuess;
 if(window.__inkDetectedRegions===1&&typeof preferred==="string"&&
    preferred.length===1){
  const matching=sorted.filter(c=>c.label===preferred);
  if(matching.length)sorted.splice(0,sorted.length,...matching,
     ...sorted.filter(c=>c.label!==preferred));
 }
 window.__inkCompletionReranks++;
 window.__inkCompletionConfidence=sorted[0]?._finishedConfidence||0;
 window.__inkCompletionModel=sorted[0]?.source||
   (window.__inkPrefixTrained?"prefix-trained":"neural");
 return sorted;
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
 const all=ghostCandidate.paths.flat();
 if(all.length>1){
  const initial=all[0],last=all[all.length-1],frame=ghostPending.frame;
  window.__inkGhostTailDy=(last[1]-initial[1])/frame.size;
  window.__inkGhostTailRange=(Math.max(...all.map(p=>p[1]))-
    Math.min(...all.map(p=>p[1])))/frame.size;
 }
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
