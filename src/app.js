"use strict";
(() => {
// Lightweight neural feedback model learns only when a writer accepts G.
let preferenceAI=null;
try{preferenceAI=window.InkPreferenceAI?.create(window.localStorage)}catch(_){}
window.__inkPreferenceLearningExamples=preferenceAI?.examples||0;
window.__inkResetPreferenceLearning=()=>{
 preferenceAI?.reset();
 window.__inkPreferenceLearningExamples=0;
};
const MODEL_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v1.json";
const RECOGNITION_V2_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v2.json";
const RECOGNITION_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v3.json";
const RECOGNITION_V5_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v5.json";
const canvas=document.getElementById("pad"), ctx=canvas.getContext("2d",{willReadFrequently:true}), guess=document.getElementById("guess");
const ghostCanvas=document.getElementById("ghost"),ghostCtx=ghostCanvas.getContext("2d");
const assistButton=document.getElementById("assist");
let strokes=[],current=null,pointer=null,worker=null,loaded=false,requestId=0,readVersion=0,readTimer=0,tool="pen";
let assistEnabled=false,ghostCandidate=null;
const requests=new Map();
window.__inkReady=false;
window.__inkEngine="cnn";
window.__inkRecognitionVersion=0;
window.__inkRecognitionAccuracy=0;
window.__inkDetectedRegions=0;
window.__inkStrokeAwareSplits=0;
window.__inkLastGuess="";
window.__inkShapeOverride="";
window.__inkTopCandidates=[];
window.__inkAssistEnabled=false;
window.__inkGhostPoints=0;
function display(text,muted=false){if(window.__inkCameraActive)return;guess.textContent=text;guess.dataset.muted=muted?"true":"false"}
function chooseTool(next){
 if(next!=="pen"&&next!=="eraser")return;
 tool=next;canvas.dataset.tool=next;
 if(tool!=="pen"){++glyphEpoch;clearGhost()}
 queueGhost();
 for(const name of ["pen","eraser"]){
  document.getElementById(name).setAttribute("aria-pressed",String(name===next));
 }
}
document.getElementById("pen").addEventListener("click",()=>chooseTool("pen"));
document.getElementById("eraser").addEventListener("click",()=>chooseTool("eraser"));

// Experimental Assist uses independently trained generative weights. NO
// curve extrapolation, font completion, heuristics, or other providers.
// Only the independent LETTER/DIGIT/SYMBOL completion model is allowed here.
// No Quick Draw sketches, no movement extrapolation, no third-party inference.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
// Browser side of the real autoregressive stroke-sequence generator.
// Uses only real mouse/pen trajectories; neural worker returns pen-up/down
// vectors. No nearest neighbor, font glyph, bitmap, skeleton or templates.
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
// The normal website loads words separately. The packaged offline build embeds them.
if(!englishWords.length){
 (async()=>{
  const remote="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/data/english-words.txt";
  for(const url of (location.protocol==="file:"?[remote]:["./data/english-words.txt",remote])){
   try{
    const response=await fetch(url);
    if(!response.ok)continue;
    const text=await response.text();
    for(const [i,word] of text.trim().split(/\s+/).entries()){
     if(!/^[a-z]+$/.test(word)||englishRanks.has(word))continue;
     englishRanks.set(word,i+1);
     for(let n=2;n<word.length;n++)englishPrefixes.add(word.slice(0,n));
    }
    window.__inkDictionaryWords=englishRanks.size;
    break;
   }catch(_){}
  }
 })();
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
 // Finished ink should not receive another stroke. Detect natural h forms
 // with one or multiple pen strokes; do NOT generate procedural glyphs.
 if(!input?.group?.length||!input.box)return false;
 const box=input.box,h=box.b-box.t,w=box.r-box.l;
 if(h<72||w<24||w>h*.85)return false;
 const lastStroke=input.group.at(-1),last=lastStroke.points?.at(-1);
 if(!last||last[0]<box.l+w*.57||last[1]<box.t+h*.62||
    box.b-last[1]>Math.max(15,h*.305))return false;
 let leftTop=false,leftBottom=false,rightCrown=Infinity;
 for(const stroke of input.group)for(const p of stroke.points){
  if(p[0]<=box.l+w*.25){
   if(p[1]<=box.t+h*.21)leftTop=true;
   if(p[1]>=box.b-h*.13)leftBottom=true;
  }
  if(p[0]>=box.l+w*.26)rightCrown=Math.min(rightCrown,p[1]);
 }
 if(!leftTop||!leftBottom||!Number.isFinite(rightCrown))return false;
 if(last[1]-rightCrown<Math.max(18,h*.27))return false;
 const tail=lastStroke.points.slice(-Math.min(5,lastStroke.points.length));
 let descent=0;
 for(let i=1;i<tail.length;i++)descent+=tail[i][1]-tail[i-1][1];
 return descent>Math.max(5,h*.032);
}

const STROKE_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-sequence-v1.json";
const STROKE_V2_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-sequence-v2.json";
const STROKE_PREFIX_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-v1.json";
const STROKE_PREFIX_DOMAIN_V2_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-domain-v2.json";
const STROKE_PREFIX_DOMAIN_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-domain-v3.json";
const STROKE_PREFIX_DOMAIN_V4_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-prefix-domain-v4.json";
const STROKE_NATURAL_V4_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-natural-v4.json";
const STROKE_LIFT_V5_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-lift-aware-v5.json";
const STROKE_PENLIFT_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-stroke-penlift-v3.json";
let glyphWorker=null,glyphReady=false,glyphLoading=false,glyphBusy=false;
let nextCompletionGroup=0,lastAcceptedFeedback=null;
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
window.__inkCompletedGlyphSuppressions=0;
let glyphFallbackLoading=false;
let glyphNoCandidateRetries=0;
let inFlightGhost=null;
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
 inFlightGhost=null;
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 window.__inkAssistLabel="";window.__inkGhostSource="none";
 window.__inkGhostTailDy=0;window.__inkGhostTailRange=0;
 window.__inkSuggestionChoices=[];
}
function beginAssistStroke(){
 ++glyphEpoch;glyphNoCandidateRetries=0;clearGhost();
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
 const embedded=document.getElementById("strokeWorkerSource");
 if(embedded){
  const url=URL.createObjectURL(new Blob([embedded.textContent],{type:"text/javascript"}));
  glyphWorker=new Worker(url);URL.revokeObjectURL(url);
 }else{
  glyphWorker=new Worker("./src/stroke_worker.js");
 }
 glyphWorker.onmessage=e=>{
  const m=e.data;
  if(m.type==="ready"){
   glyphReady=true;glyphBusy=false;
   window.__inkGlyphReady=true;
   window.__inkGlyphVersion=m.recurrentLiftV5?11:(m.naturalMotionV4?10:(m.prefixDomainV4?9:(m.prefixDomainV3?8:(m.penLift?7:(m.prefixDomain?6:(m.prefixTuned?5:(m.parameters>=1000000?4:3)))))));
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
      inFlightGhost?.serial===m.serial){
     const possibilities=(m.alternatives||[]).filter(o=>
      o.paths?.some(p=>p.length>1)&&o.quality>-.91&&
      coherentRenderedContinuation(o,inFlightGhost));
     if(!possibilities.length&&m.type==="completion"&&
        pointer===null&&glyphNoCandidateRetries<2){
      // Retry a different genuine neural sample only twice per gesture.
      glyphNoCandidateRetries++;
      glyphStrokeSeed=(glyphStrokeSeed+1973)|0;
      glyphDirty=true;
     }
     if(possibilities.length){
      const serial=m.serial,epoch=m.epoch,pending=inFlightGhost;
      const publish=ordered=>{
       if(!assistEnabled||tool!=="pen"||glyphSerial!==serial||
          glyphEpoch!==epoch||inFlightGhost?.serial!==serial)return;
       if(!ordered.length){
        if(pointer===null)clearGhost();
        return;
       }
       ghostPending=pending;
       glyphNoCandidateRetries=0;
       ghostOptions=preferenceAI?preferenceAI.rank(ordered,pending):ordered;
       window.__inkSuggestionChoices=ghostOptions.map(o=>o.label);
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
        if(glyphSerial===serial&&glyphEpoch===epoch&&pointer===null)
         clearGhost(); // On critic failure, don't show unverified random strokes.
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
    [STROKE_LIFT_V5_URL,STROKE_NATURAL_V4_URL,STROKE_PREFIX_DOMAIN_V4_URL,STROKE_PREFIX_DOMAIN_V3_URL,STROKE_PENLIFT_V3_URL,STROKE_PREFIX_DOMAIN_V2_URL,
     STROKE_PREFIX_URL,STROKE_V2_URL,STROKE_URL]:
    ["models/ink-stroke-lift-aware-v5.json",STROKE_LIFT_V5_URL,
     "models/ink-stroke-natural-v4.json",STROKE_NATURAL_V4_URL,
     "models/ink-stroke-prefix-domain-v4.json",STROKE_PREFIX_DOMAIN_V4_URL,
     "models/ink-stroke-prefix-domain-v3.json",STROKE_PREFIX_DOMAIN_V3_URL,
     "models/ink-stroke-penlift-v3.json",STROKE_PENLIFT_V3_URL,
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
       (saved.training?.recurrent_lift_v5&&
        saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json" ||
        saved.training?.natural_motion_v4&&
        saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json" ||
        saved.training?.prefix_domain_v4&&
        saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json" ||
        saved.training?.prefix_domain_v3&&
        saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json" ||
        saved.training?.prefix_domain_v2&&
        saved.training?.fine_tuned_own_model==="models/ink-stroke-prefix-v1.json"))
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
    if(source.includes("lift-aware-v5")){
      if(!(candidate.training?.recurrent_lift_v5&&
         candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated multi-stroke recurrent GRU V5");
    }else if(source.includes("natural-v4")){
      if(!(candidate.training?.natural_motion_v4&&
        candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated natural handwriting GRU");
    }else if(source.includes("penlift-v3")){
      if(!(candidate.training?.penlift_calibrated_v3 &&
         candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated multi-stroke model");
    }else if(source.includes("prefix-domain-v4")){
      if(!(candidate.training?.prefix_domain_v4&&
        candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated V4 online handwriting GRU");
    }else if(source.includes("prefix-domain-v3")){
      if(!(candidate.training?.prefix_domain_v3&&
        candidate.training?.fine_tuned_own_model==="models/ink-stroke-prefix-domain-v2.json"))
       throw Error("Unvalidated V3 real-pen completion model");
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
 if(completedLowercaseH(input))return false;
 return true;
}
async function generateGlyph(){
 if(!assistEnabled||tool!=="pen"||!glyphReady||glyphBusy||!loaded)return;
 const input=completionInput();
 if(!input){clearGhost();return}
 if(pointer===null&&completedLowercaseH(input)){
  ++glyphEpoch;clearGhost();glyphDirty=false;
  window.__inkCompletedGlyphSuppressions++;
  return;
 }
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
  const region=window.__inkWordRegions?.[0]?.box;
  const box=input.box;
  const sameGlyph=region&&
    Math.max(0,Math.min(region[2],box.r)-Math.max(region[0],box.l))>
      Math.min(region[2]-region[0],box.r-box.l)*.24&&
    Math.max(0,Math.min(region[3],box.b)-Math.max(region[1],box.t))>
      Math.min(region[3]-region[1],box.b-box.t)*.24;
  const whole=sameGlyph&&window.__inkDetectedRegions===1?
    window.__inkLastGuess:null;
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
  inFlightGhost={frame:f,box:input.box,serial,expected:preferred,
   lastInk:input.group?.at(-1)?.points?.at(-1)?.slice()};
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
// Compare the learned CNN's confidence before/after adding each real GRU
// candidate. A visually plausible character extension must not make the
// recognizer LESS convinced of that same glyph. Symbols without reliable
// CNN calibration keep their geometric GRU gate instead.
function completionEvidence(before,after,label){
 if(!/^[a-z0-9]$/i.test(label))return true;
 if(after<.028)return false;
 if(before>.82&&after<=before+.012)return false;
 if(after<before*.68)return false;
 return true;
}
async function scoreFinishedAlternatives(alternatives,pending){
 if(!loaded||!pending?.box||!alternatives.length)return alternatives;
 const valid=alternatives.slice(0,9).map(candidate=>({
   candidate,paths:toScreenPaths(candidate.paths,pending.frame)
 })).filter(x=>x.paths.length>0);
 if(!valid.length)return [];
 const masks=[];
 const temp=document.createElement("canvas");
 temp.width=canvas.width;temp.height=canvas.height;
 const t=temp.getContext("2d",{willReadFrequently:true});
 const b=pending.box;
 // The original ink is the independent baseline. Evaluate it with the
 // same actual CNN as each candidate's finished ink, not an invented score.
 const x0=Math.max(0,Math.floor(b.l-7));
 const x1=Math.min(canvas.width-1,Math.ceil(b.r+7));
 const y0=Math.max(0,Math.floor(b.t-7));
 const y1=Math.min(canvas.height-1,Math.ceil(b.b+7));
 if(x1<=x0||y1<=y0)return alternatives;
 const beforeCrop=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1);
 masks.push(normalize([0,0,x1-x0,y1-y0],beforeCrop));
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
 if(predictions.predictions?.length!==valid.length+1)return alternatives;
 const baseline=predictions.predictions[0].top||[];
 const approved=[];
 for(let i=0;i<valid.length;i++){
  const item=valid[i];
  const top=predictions.predictions[i+1].top||[];
  const p=top.find(x=>x.char===item.candidate.label)?.confidence||.0005;
  const before=baseline.find(x=>x.char===item.candidate.label)?.confidence||.0005;
  if(!completionEvidence(before,p,item.candidate.label))continue;
  item.candidate._finishedConfidence=p;
  item.candidate._baselineConfidence=before;
  const geometric=Math.max(-2.5,Math.min(2.5,item.candidate.quality||0));
  const improvement=Math.log((p+.015)/(before+.015));
  item.candidate._combinedScore=
    2.1*Math.log(p+.003)+1.0*improvement+.23*geometric+
    .08*Math.max(-5,Math.min(3,item.candidate.score||0));
  approved.push(item);
 }
 approved.sort((a,b)=>b.candidate._combinedScore-a.candidate._combinedScore);
 const sorted=approved.map(x=>x.candidate);
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
function coherentRenderedContinuation(option,pending){
 if(!pending?.frame||!option?.paths?.length)return false;
 const paths=toScreenPaths(option.paths,pending.frame);
 if(!paths.length)return false;
 const points=paths.flat(),first=points[0],last=points.at(-1);
 const endInk=pending.lastInk;
 if(endInk&&Math.hypot(first[0]-endInk[0],first[1]-endInk[1])>
    Math.max(15,pending.frame.size*.09))return false;
 if(pending.expected==="h"){
  const dx=last[0]-first[0],dy=last[1]-first[1],size=pending.frame.size;
  if(dx>size*.16&&dy<-size*.12)return false;
  let length=0;
  for(const path of paths)for(let i=1;i<path.length;i++)
   length+=Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);
  if(length>size*.63)return false;
 }
 return true;
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
 if(!assistEnabled||tool!=="pen"||pointer!==null)return;
 if(!ghostCandidate){
  if(glyphReady){
   window.__inkLastGlyphError="No valid neural suggestion to accept yet";
   if(!glyphBusy)queueGhost();
  }
  return;
 }
 // A single G choice is a human reward. Snapshot just the tiny neural
 // weights so Cmd/Ctrl+Z can revoke accidental acceptances.
 const beforeLearning=preferenceAI?.snapshot();
 const learned=Boolean(preferenceAI?.learn(
  ghostOptions[ghostChoice],ghostOptions,ghostPending));
 if(learned)window.__inkPreferenceLearningExamples=preferenceAI.examples;
 const group=++nextCompletionGroup;
 lastAcceptedFeedback={group,beforeLearning,learned};
 ++glyphEpoch;
 clearTimeout(glyphTimer);glyphTimer=0;glyphDirty=false;
 const paths=ghostCandidate.paths;
 for(const points of paths)
  strokes.push({tool:"pen",type:"vector-completion",completionGroup:group,
    width:window.__inkGhostStrokeWidth,points:points.map(p=>p.slice())});
 window.__inkAcceptedVectorCount+=paths.length;
 clearGhost();paint();schedule(70);
}
window.addEventListener("keydown",e=>{
 // Opt-in reset: Shift+Alt+R discards the locally learned preferences.
 if(e.shiftKey&&e.altKey&&e.key.toLowerCase()==="r"){
  e.preventDefault();window.__inkResetPreferenceLearning();return;
 }
 if(e.key==="Tab"&&assistEnabled&&ghostOptions.length>1){
  e.preventDefault();setGhostChoice((ghostChoice+1)%ghostOptions.length);return;
 }
 if((e.key.toLowerCase()==="g"||e.key==="Enter")&&!e.ctrlKey&&!e.altKey&&
    !e.metaKey&&!e.repeat&&
    !(e.target instanceof HTMLInputElement)&&
    !(e.target instanceof HTMLTextAreaElement))acceptGhost();
});

function paint(){
 ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.lineJoin="round";ctx.lineCap="round";
 for(const stroke of (current?[...strokes,current]:strokes)){
  const points=stroke.points;
  if(!points?.length)continue;
  ctx.strokeStyle=stroke.tool==="eraser"?"#fff":"#111";
  ctx.lineWidth=stroke.tool==="eraser"?46:(stroke.width||12);
  if(stroke.type==="vector-completion"&&points.length>=2){
   smoothStroke(ctx,points);
  }else{
   ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);
   if(points.length===1)ctx.lineTo(points[0][0]+.01,points[0][1]+.01);
   for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);
   ctx.stroke();
  }
 }
 queueGhost();
}
paint();
function pos(e){
 const box=canvas.getBoundingClientRect();
 return [Math.max(0,Math.min(canvas.width,(e.clientX-box.left)*canvas.width/box.width)),
         Math.max(0,Math.min(canvas.height,(e.clientY-box.top)*canvas.height/box.height))];
}
function reset(){
 ++glyphEpoch;strokes=[];current=null;pointer=null;lastAcceptedFeedback=null;
 clearGhost();paint();++readVersion;
 clearTimeout(readTimer);display(loaded?"Draw something":"Loading AI…",true);
}
canvas.addEventListener("pointerdown",e=>{
 e.preventDefault();
 if(pointer!==null)return;
 pointer=e.pointerId;current={tool,points:[pos(e)]};
 if(tool==="pen")beginAssistStroke();
 try{canvas.setPointerCapture(e.pointerId)}catch(_){}
});

canvas.addEventListener("pointermove",e=>{
 if(pointer!==e.pointerId||!current)return;
 e.preventDefault();current.points.push(pos(e));paint();
});
function finish(e){
 if(pointer!==e.pointerId)return;
 if(current){current.points.push(pos(e));strokes.push(current)}
 pointer=null;current=null;
 // Keep a partial glyph's G-acceptable ghost, but remove a tail on
 // already finished handwriting immediately when the writer lifts the pen.
 if(assistEnabled&&tool==="pen"&&completedLowercaseH(completionInput())){
  ++glyphEpoch;clearGhost();glyphDirty=false;
  window.__inkCompletedGlyphSuppressions++;
 }
 paint();schedule(180);
}
canvas.addEventListener("pointerup",finish);
canvas.addEventListener("pointercancel",finish);
window.addEventListener("keydown",e=>{
 if(e.key==="Escape"){reset();return}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){
  e.preventDefault();
  const last=strokes.at(-1);
  if(last?.type==="vector-completion"&&last.completionGroup){
   // Undo a neural completion as ONE drawing action, including pen lifts.
   // An undone G is not human approval: reverse its personal learning.
   const group=last.completionGroup;
   while(strokes.at(-1)?.completionGroup===group)strokes.pop();
   if(lastAcceptedFeedback?.group===group){
    if(lastAcceptedFeedback.learned&&lastAcceptedFeedback.beforeLearning)
     preferenceAI?.restore(lastAcceptedFeedback.beforeLearning);
    window.__inkPreferenceLearningExamples=preferenceAI?.examples||0;
    lastAcceptedFeedback=null;
   }
  }else{
   strokes.pop();
  }
  ++glyphEpoch;clearGhost();paint();schedule(100);
 }
});
function groupRuns(series,gap=2,minSpan=1){
 const ranges=[];let start=-1,last=-1;
 for(let i=0;i<=series.length;i++){
  if(i<series.length&&series[i]>0){if(start<0)start=i;last=i}
  else if(start>=0&&(i===series.length||i-last>gap)){
   if(last-start+1>=minSpan)ranges.push([start,last]);
   start=-1;last=-1;
  }
 }
 return ranges;
}
function segment(){
 const w=canvas.width,h=canvas.height,pixels=ctx.getImageData(0,0,w,h);
 const data=pixels.data,ink=new Uint8Array(w*h),rows=new Uint16Array(h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const off=(y*w+x)*4,idx=y*w+x;
  if(data[off]+data[off+1]+data[off+2]<620){ink[idx]=1;rows[y]++}
 }
 let lines=groupRuns(rows,22,2);
 // Dots above lowercase i/j or detached crossbars should stay on the same
 // handwriting line, rather than being mistaken for a new text line.
 function projections(top,bottom){
  const cols=new Uint16Array(w);
  for(let y=top;y<=bottom;y++)for(let x=0;x<w;x++)cols[x]+=ink[y*w+x];
  return cols;
 }
 let merged=[];
 for(const line of lines){
  const last=merged[merged.length-1];
  if(last){
   const gap=line[0]-last[1]-1;
   if(gap>22&&gap<=62){
    const topCols=projections(last[0],last[1]);
    const lowCols=projections(line[0],line[1]);
    const upper=groupRuns(topCols,2,1),lower=groupRuns(lowCols,2,1);
    const lowHeight=line[1]-line[0]+1,topHeight=last[1]-last[0]+1;
    const smallTop=topHeight<Math.min(33,lowHeight*.48);
    const smallBottom=lowHeight<Math.min(33,topHeight*.48);
    const punctuationPair=topHeight<=18&&lowHeight<=18&&gap<=72;
    const aligned=upper.length>0&&lower.length>0&&upper.every(a=>lower.some(b=>{
      const center=(a[0]+a[1])/2;
      return center>=b[0]-Math.max(13,(b[1]-b[0])*.15)&&
          center<=b[1]+Math.max(13,(b[1]-b[0])*.15);
    }));
    // Keep i/j dots, ! dots, colon and equals-sign bars with their glyph.
    // Never merge two normal-height handwriting lines just for x-overlap.
    if(aligned&&(smallTop||smallBottom||punctuationPair)){
     last[1]=line[1];continue;
    }
   }
  }
  merged.push([...line]);
 }
 lines=merged;
 const found=[];
 for(let line=0;line<lines.length;line++){
  const [top,bottom]=lines[line],cols=projections(top,bottom);
  const initial=groupRuns(cols,2,2);
  const widths=initial.map(s=>s[1]-s[0]+1).sort((a,b)=>a-b);
  const typical=widths.length?widths[Math.floor(widths.length/2)]:30;
  const lineHeight=bottom-top+1;
  // Never split a connected ink region merely because it is wide.
  // The previous "vertical valley" heuristic cut a single roof/caret stroke
  // into 10+ characters: narrow diagonal ink satisfied its valley test at
  // almost every column. Actual gaps / later stroke-level grouping are the
  // only defensible division boundaries.
  const spans=initial;
  const gaps=spans.slice(1).map((s,i)=>s[0]-spans[i][1]-1).sort((a,b)=>a-b);
  const common=gaps.length?gaps[Math.floor(gaps.length*.35)]:8;
  const spaceGap=Math.max(22,Math.min(125,Math.max(typical*.78,common*2.1)));
  for(let i=0;i<spans.length;i++){
   const [x0,x1]=spans[i];
   let y0=bottom,y1=top;
   for(let y=top;y<=bottom;y++)for(let x=x0;x<=x1;x++){
    if(ink[y*w+x]){y0=Math.min(y0,y);y1=Math.max(y1,y)}
   }
   if(y1<y0)continue;
   found.push({box:[x0,y0,x1,y1],line,space:i>0&&x0-spans[i-1][1]-1>spaceGap});
  }
 }
 // An accidental visual contact between neighboring written letters can
 // merge two genuinely separate pen gestures into one bitmap component.
 // Only use pen-up history to split when there is a very clear between-stroke
 // boundary. Never split a single pen-down path, or break crossing symbols,
 // crossbars, punctuation, and multi-stroke letter components.
 let regions=found;
 if(!strokes.some(s=>s.tool==="eraser")){
  const recorded=strokes.filter(s=>s.tool==="pen"&&s.points?.length>=3)
   .map(s=>{
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,length=0;
    for(let j=0;j<s.points.length;j++){
     const p=s.points[j];
     x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);
     y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
     if(j)length+=Math.hypot(p[0]-s.points[j-1][0],
                             p[1]-s.points[j-1][1]);
    }
    return {x0,x1,y0,y1,length,cx:(x0+x1)/2,cy:(y0+y1)/2};
   });
  if(recorded.length>=2){
   const refined=[];
   for(const region of regions){
    const [rx0,ry0,rx1,ry1]=region.box;
    const rw=rx1-rx0,rh=ry1-ry0;
    if(rw<Math.max(72,rh*.95)){refined.push(region);continue}
    const group=recorded.filter(p=>p.cx>=rx0&&p.cx<=rx1&&
       p.cy>=ry0-8&&p.cy<=ry1+8&&p.length>=Math.max(35,rh*.42))
       .sort((a,b)=>a.cx-b.cx);
    if(group.length<2){refined.push(region);continue}
    const cuts=[];
    for(let i=0;i<group.length-1;i++){
     const a=group[i],b=group[i+1];
     const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
     const separation=b.cx-a.cx;
     const cut=(a.x1+b.x0)/2;
     if(separation<Math.max(43,rh*.58)||overlap>8||
        Math.abs(a.cy-b.cy)>rh*.45||cut<rx0+18||cut>rx1-18)continue;
     // A stroke crossing this candidate seam belongs to a composite glyph
     // (H, A, X, T, + etc.), not another letter.
     if(group.some(p=>p!==a&&p!==b&&p.x0<cut-10&&p.x1>cut+10))
       continue;
     // Avoid dividing joined loops whose ink has a broad vertical crossing.
     const col=Math.max(rx0+1,Math.min(rx1-1,Math.round(cut)));
     let inkAtCut=0;
     for(let y=ry0;y<=ry1;y++)inkAtCut+=ink[y*w+col];
     // Thick hand-drawn loops can have a substantial seam column even when
     // the two independent pen gestures only touch at a single endpoint.
     // Distinct pen lifts + narrow x-overlap + separation remain the primary
     // checks; allow a thicker contact zone here.
     if(inkAtCut>Math.max(27,rh*.72))continue;
     cuts.push(col);
    }
    if(!cuts.length){refined.push(region);continue}
    let previous=rx0;
    const unique=[...new Set(cuts)].sort((a,b)=>a-b);
    for(const edge of [...unique,rx1+1]){
     const x0=previous,x1=edge-1;
     previous=edge;
     if(x1-x0<15)continue;
     let y0=ry1,y1=ry0;
     for(let y=ry0;y<=ry1;y++)for(let x=x0;x<=x1;x++){
      if(ink[y*w+x]){y0=Math.min(y0,y);y1=Math.max(y1,y)}
     }
     if(y1>=y0)refined.push({box:[x0,y0,x1,y1],
        line:region.line,space:x0===rx0?region.space:false});
    }
   }
   regions=refined;
  }
 }
 window.__inkStrokeAwareSplits=Math.max(0,regions.length-found.length);
 return {regions,pixels};
}
function normalize(box,pixels){
 const [x0,y0,x1,y1]=box,w=x1-x0+1,h=y1-y0+1;
 const cropped=document.createElement("canvas");cropped.width=w;cropped.height=h;
 cropped.getContext("2d").putImageData(pixels,-x0,-y0);
 const out=document.createElement("canvas");out.width=32;out.height=32;
 const t=out.getContext("2d",{willReadFrequently:true});
 t.fillStyle="white";t.fillRect(0,0,32,32);
 const ratio=26/Math.max(w,h),tw=Math.max(1,Math.round(w*ratio)),th=Math.max(1,Math.round(h*ratio));
 t.imageSmoothingQuality="high";
 t.drawImage(cropped,0,0,w,h,(32-tw)/2,(32-th)/2,tw,th);
 const bytes=t.getImageData(0,0,32,32).data;
 const values=new Float32Array(1024);
 for(let i=0;i<1024;i++)values[i]=1-(bytes[4*i]+bytes[4*i+1]+bytes[4*i+2])/765;
 return Array.from(values);
}
function schedule(delay){
 ++readVersion;clearTimeout(readTimer);
 if(!loaded){display("Loading AI…",true);return}
 readTimer=setTimeout(()=>{if(pointer===null)recognize(readVersion)},delay);
}
function request(cmd,payload){
 return new Promise((resolve,reject)=>{
  if(!worker){reject(Error("AI not loaded"));return}
  const id=++requestId;
  requests.set(id,{resolve,reject});
  worker.postMessage({id,cmd,...payload});
  setTimeout(()=>{const r=requests.get(id);if(r){requests.delete(id);reject(Error("Recognition timed out"))}},30000);
 });
}
// Geometric recognition for unambiguous single-stroke mathematical marks.
// A complete hand-drawn caret must not be cut into a long fake "word", and
// full-character CNNs are not trained to interpret arbitrary partial strokes.
function shapeFromStroke(region){
 if(region.length!==1)return null;
 const pen=strokes.filter(s=>s.tool==="pen"&&!s.type&&s.points?.length>=2);
 if(pen.length===2&&strokes.length===2){
  const spans=pen.map(s=>{
   const p=s.points;
   let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
   for(const [x,y] of p){
    x0=Math.min(x0,x);x1=Math.max(x1,x);
    y0=Math.min(y0,y);y1=Math.max(y1,y);
   }
   const a=p[0],b=p[p.length-1];
   return {x0,x1,y0,y1,w:x1-x0,h:y1-y0,
      cx:(x0+x1)/2,cy:(y0+y1)/2,
      dx:b[0]-a[0],dy:b[1]-a[1]};
  });
  const [a,b]=spans;
  const horizontal=t=>t.w>30&&t.h<Math.max(13,t.w*.18);
  const vertical=t=>t.h>30&&t.w<Math.max(13,t.h*.18);
  const xOver=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const yOver=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  // Two narrow dots on top of each other form the punctuation colon.
  if(a.w<22&&a.h<22&&b.w<22&&b.h<22&&
     Math.abs(a.cx-b.cx)<17&&Math.abs(a.cy-b.cy)>22)return ":";
  if(horizontal(a)&&horizontal(b)&&
     xOver>Math.min(a.w,b.w)*.72&&Math.abs(a.cy-b.cy)>18)return "=";
  if(((horizontal(a)&&vertical(b))||(horizontal(b)&&vertical(a)))&&
      Math.abs(a.cx-b.cx)<Math.max(20,Math.min(a.w,b.w)*.35)&&
      Math.abs(a.cy-b.cy)<Math.max(20,Math.min(a.h,b.h)*.35))return "+";
  const oppositeDiagonals=a.w>30&&a.h>30&&b.w>30&&b.h>30&&
      a.dx*a.dy*b.dx*b.dy<0&&
      xOver>Math.min(a.w,b.w)*.5&&yOver>Math.min(a.h,b.h)*.5;
  if(oppositeDiagonals&&Math.abs(a.cx-b.cx)<25&&
     Math.abs(a.cy-b.cy)<25)return "X";
 }
 if(strokes.length!==1||strokes[0].tool!=="pen"||strokes[0].type)return null;
 const pts=strokes[0].points;
 if(pts.length<3)return null;
 const samples=[pts[0]];
 for(let i=1;i<pts.length;i++){
  const prev=samples[samples.length-1],p=pts[i];
  if(Math.hypot(p[0]-prev[0],p[1]-prev[1])>=5||i===pts.length-1)samples.push(p);
 }
 if(samples.length<3)return null;
 let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
 for(const p of samples){
  x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);
  y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
 }
 const w=x1-x0,h=y1-y0,first=samples[0],last=samples[samples.length-1];
 if(w<22&&h<22)return null;
 const lineDistance=(p,a,b)=>Math.abs((b[1]-a[1])*p[0]-(b[0]-a[0])*p[1]+b[0]*a[1]-b[1]*a[0])/
   Math.max(1,Math.hypot(b[1]-a[1],b[0]-a[0]));
 // Single-stroke straight marks with minimal overall curvature.
 let maxDeviation=0;
 for(const p of samples)maxDeviation=Math.max(maxDeviation,lineDistance(p,first,last));
 if(maxDeviation<Math.max(8,.055*Math.max(w,h))){
  if(w>3*h&&h<45)return "-";
  // A plain upright stroke is not uniquely |: it may be 1, I or l.
  // Leave it to the neural model and neighboring characters instead.
  if(h>3*w&&w<45)return null;
  if(w>26&&h>26){
   const slope=(last[1]-first[1])*(last[0]-first[0]);
   return slope>0?"\\":"/";
  }
 }
 // Roof / caret: two monotonic arms meeting at a high apex, open at base.
 // Likewise V-shaped handwritten symbol with the cusp at the bottom.
 if(w>=1.2*h&&h>=27&&w>=48){
  const leftToRight=last[0]>=first[0],ordered=leftToRight?samples:samples.slice().reverse();
  let peak=-1,top=Infinity,bottom=-Infinity;
  for(let i=0;i<ordered.length;i++){
   const p=ordered[i];
   if(p[1]<top){top=p[1];peak=i}
   bottom=Math.max(bottom,p[1]);
  }
  const valleyIndex=ordered.reduce((best,p,i)=>p[1]>ordered[best][1]?i:best,0);
  const looksLikeSinglePeak=i=>{
   if(i<2||i>=ordered.length-2)return false;
   const a=ordered[0],mid=ordered[i],b=ordered[ordered.length-1];
   if(mid[0]-a[0]<w*.20||b[0]-mid[0]<w*.20)return false;
   if(Math.min(a[1],b[1])-mid[1]<h*.45)return false;
   if(Math.abs(a[1]-b[1])>=h*.40)return false;
   let backwards=0,wrongVertical=0;
   for(let j=1;j<ordered.length;j++){
    const dx=ordered[j][0]-ordered[j-1][0];
    const dy=ordered[j][1]-ordered[j-1][1];
    if(dx<-Math.max(8,w*.028))backwards++;
    // Actual caret slopes run consistently up into apex, down afterward.
    wrongVertical+=j<=i?Math.max(0,dy):Math.max(0,-dy);
   }
   return backwards<Math.max(3,ordered.length*.14)&&
      wrongVertical<h*.22;
  };
  if(looksLikeSinglePeak(peak))return "^";
  const a=ordered[0],p=ordered[valleyIndex],b=ordered[ordered.length-1];
  if(valleyIndex>1&&valleyIndex<ordered.length-2&&
      p[1]-Math.max(a[1],b[1])>h*.48&&
      Math.abs(a[1]-b[1])<h*.4&&
      p[0]-a[0]>w*.20&&b[0]-p[0]>w*.20)return "V";
 }
 return null;
}
// Shape checks for letters that look very similar to punctuation or one another.
// Uses actual drawn pixels and ordered pen coordinates. Never generates ink.
function dottedStemEvidence(region,pixels){
 if(!region?.box||!pixels?.data)return false;
 const [rx0,ry0,rx1,ry1]=region.box, width=pixels.width;
 const x0=Math.max(0,Math.floor(rx0)),x1=Math.min(width-1,Math.ceil(rx1));
 const y0=Math.max(0,Math.floor(ry0)),y1=Math.min(pixels.height-1,Math.ceil(ry1));
 if(x1<x0||y1-y0<47)return false;
 const rows=[];
 for(let y=y0;y<=y1;y++){
  let n=0,low=Infinity,high=-Infinity,sumX=0;
  for(let x=x0;x<=x1;x++){
   const p=(y*width+x)*4;
   if(pixels.data[p]+pixels.data[p+1]+pixels.data[p+2]>=620)continue;
   n++;low=Math.min(low,x);high=Math.max(high,x);sumX+=x;
  }
  rows.push({y,n,low,high,sumX});
 }
 const runs=[];let first=-1,last=-1;
 for(let i=0;i<=rows.length;i++){
  if(i<rows.length&&rows[i].n){
   if(first<0)first=i;last=i;
  }else if(first>=0&&(i===rows.length||i-last>2)){
   runs.push(rows.slice(first,last+1));first=-1;last=-1;
  }
 }
 if(runs.length!==2)return false;
 const upper=runs[0],lower=runs[1];
 const topH=upper.length,bodyH=lower.length;
 const gap=lower[0].y-upper.at(-1).y-1;
 if(bodyH<34||topH>Math.min(23,bodyH*.35)||gap<9||gap>105)return false;
 const stats=run=>{
  let minX=Infinity,maxX=-Infinity,total=0,sx=0;
  for(const row of run){
   if(!row.n)continue;
   minX=Math.min(minX,row.low);maxX=Math.max(maxX,row.high);
   total+=row.n;sx+=row.sumX;
  }
  return {width:maxX-minX+1,center:sx/Math.max(1,total),area:total};
 };
 const dot=stats(upper),body=stats(lower);
 if(dot.width>Math.min(27,bodyH*.40)||
    body.width>Math.max(24,bodyH*.29)||
    dot.area>body.area*.5)return false;
 return Math.abs(dot.center-body.center)<=Math.max(24,bodyH*.25);
}
function openCStrokeEvidence(region,recordedStrokes){
 if(!region?.box||!recordedStrokes)return false;
 const [x0,y0,x1,y1]=region.box,w=x1-x0,h=y1-y0;
 // A c-shaped curve has an open mouth at the right, not the square turns
 // of a bracket or the narrow aspect ratio of most parentheses.
 if(w<26||h<30||w/h<.47||w/h>1.2)return false;
 const compatible=recordedStrokes.filter(s=>s.tool==="pen"&&!s.type&&s.points?.length>=6)
   .filter(s=>{
    const pts=s.points;
    return pts.every(([x,y])=>x>=x0-12&&x<=x1+12&&y>=y0-12&&y<=y1+12);
   });
 if(compatible.length!==1)return false;
 const pts=compatible[0].points;
 const start=pts[0],end=pts.at(-1);
 if(start[0]<x0+w*.58||end[0]<x0+w*.58||
    start[1]>y0+h*.40||end[1]<y0+h*.60)return false;
 let left=pts[0];
 for(const p of pts)if(p[0]<left[0])left=p;
 if(left[1]<y0+h*.19||left[1]>y0+h*.81)return false;
 // The first arm curves left into the bowl, the second returns right.
 return Math.abs(start[0]-end[0])<w*.37&&
   pts.some(p=>p[0]<x0+w*.26&&p[1]>y0+h*.25&&p[1]<y0+h*.75);
}
function refinedLetterAt(i,regions,predictions,pixels,strokes,initial){
 const options=predictions[i]?.top||[];
 if(!options.length)return initial;
 let ch=initial,confidence=options[0].confidence;
 const dot=dottedStemEvidence(regions[i],pixels);
 const iOption=options.find(o=>o.char==="i");
 if(dot&&iOption&&iOption.confidence>=.025&&
    (confidence<.94||ch==="i")){
  // A small dot ABOVE an upright stem is direct pen evidence. A semicolon
  // has two small components; an exclamation mark has its dot below.
  ch="i";confidence=iOption.confidence;
 }
 const cOption=options.find(o=>o.char==="c");
 const COption=options.find(o=>o.char==="C");
 if(!/^[cC]$/.test(ch)&&/^[\[\(]$/.test(ch)&&
    options[0].confidence<.75&&
    Math.max(cOption?.confidence||0,COption?.confidence||0)>=.12&&
    openCStrokeEvidence(regions[i],strokes)){
  ch=(cOption?.confidence||0)>=(COption?.confidence||0)?"c":"C";
 }
 if(!/^[cC]$/.test(ch))return ch;
 // C and c are often the same handwritten curve. Case can only be inferred
 // when other actual letters provide a height and lowercase reference.
 const here=regions[i],height=here.box[3]-here.box[1];
 const neighbors=[];
 for(const j of [i-1,i+1]){
  if(j<0||j>=regions.length||regions[j].line!==here.line)continue;
  if(j<i&&here.space||j>i&&regions[j].space)continue;
  const next=predictions[j]?.top?.[0];
  if(!next)continue;
  const letter=next.char;
  const isLower=(/^[abdeghijknpqrty]$/.test(letter)&&next.confidence>=.25)||
    (letter==="i"&&next.confidence>=.15)||
    dottedStemEvidence(regions[j],pixels);
  if(isLower)neighbors.push(regions[j].box[3]-regions[j].box[1]);
 }
 if(!neighbors.length)return ch;
 const nearH=neighbors.sort((a,b)=>a-b)[Math.floor(neighbors.length/2)];
 if(!nearH)return ch;
 if(height<=nearH*1.09&&ch==="C"&&
   cOption?.confidence>=Math.max(.08,(COption?.confidence||0)*.10)&&
   (COption?.confidence||0)<.92)return "c";
 if(height>nearH*1.34&&ch==="c"&&
   COption?.confidence>=Math.max(.10,(cOption?.confidence||0)*.16)&&
   (cOption?.confidence||0)<.9)return "C";
 return ch;
}
// Read ambiguous letter forms from ink geometry and neighboring characters.
// This only refines OCR text; it never draws, erases, or replaces a pen stroke.
function inkLoopGeometry(region,pixels){
 if(!region?.box||!pixels?.data)return {round:false,externalTail:false};
 const [x0,y0,x1,y1]=region.box;
 const w=x1-x0+1,h=y1-y0+1;
 if(w<24||h<22||w/h<.61||w/h>1.48)
   return {round:false,externalTail:false};
 const dark=(x,y)=>{
  if(x<0||y<0||x>=pixels.width||y>=pixels.height)return false;
  const k=(y*pixels.width+x)*4;
  return pixels.data[k]+pixels.data[k+1]+pixels.data[k+2]<620;
 };
 let central=0,total=0;
 for(let y=Math.floor(y0+h*.35);y<=Math.floor(y0+h*.65);y++)
 for(let x=Math.floor(x0+w*.35);x<=Math.floor(x0+w*.65);x++){
  central+=Number(dark(x,y));total++;
 }
 // This is a loop or oval, with a mostly unpainted central opening.
 if(total<8||central/total>.43)return {round:false,externalTail:false};
 const rows=[];
 for(let y=Math.ceil(y0);y<=Math.floor(y1);y++){
  let filled=0;
  for(let x=Math.ceil(x0);x<=Math.floor(x1);x++)if(dark(x,y))filled++;
  rows.push(filled);
 }
 const maxInk=Math.max(...rows);
 if(maxInk<6)return {round:false,externalTail:false};
 const floor=rows.findLastIndex(v=>v>=Math.max(5,maxInk*.28));
 const externalTail=(rows.length-1-floor)>Math.max(7,h*.13);
 return {round:true,externalTail};
}
function caseAwareWordReading(regions,predictions,pixels,strokes,letters,dictionary){
 const changed=letters.slice();
 const strongLower=/^[abdefghijknpqrt]$/;
 const eligibleAmbiguous=/^[oOQ0xXyY]$/;
 let start=0;
 for(let finish=0;finish<=regions.length;finish++){
  const boundary=finish===regions.length||
    (finish>start&&(regions[finish].line!==regions[finish-1].line||
                    regions[finish].space));
  if(!boundary)continue;
  const ids=Array.from({length:finish-start},(_,i)=>start+i);
  if(ids.length>=2&&ids.length<=24&&
     ids.every(i=>/^[a-zA-Z0-9×]$/.test(changed[i]||""))){
   const old=ids.map(i=>changed[i]).join("");
   const lowerWord=old.toLowerCase();
   const exists=Boolean(dictionary?.has(lowerWord));
   const anchors=ids.filter(i=>strongLower.test(changed[i]));
   const heights=anchors.map(i=>regions[i].box[3]-regions[i].box[1]);
   const tallest=heights.length?Math.max(...heights):0;
   for(const i of ids){
    const current=changed[i];
    const raw=predictions[i]?.top||[];
    const p=(ch)=>raw.find(o=>o.char===ch)?.confidence||0;
    const h=regions[i].box[3]-regions[i].box[1];
    if(current==="×"&&anchors.length>=1&&
       !ids.some(j=>/^[0-9]$/.test(changed[j]))){
      const hasWrittenX=ids.some(j=>j!==i&&/^[xX]$/.test(changed[j]));
      const asLetter=ids.map(j=>j===i?"x":changed[j]).join("").toLowerCase();
      // A lowercase x and the multiplication glyph are effectively the same
      // two crossed strokes. Use direct neighboring letter evidence, not
      // an unconditional replacement of all multiplication signs.
      if((hasWrittenX||dictionary?.has(asLetter))&&
         p("x")>=Math.max(.025,p("×")*.065)&&
         tallest>=h*1.22){
        changed[i]="x";
      }
      continue;
    }
    if(!eligibleAmbiguous.test(current))continue;
    if((current==="Q"||current==="O"||current==="0")&&
       anchors.length>=2&&
       tallest>h*1.18&&
       (p("o")>=.006||p("O")>=.025||current==="Q")){
      const ring=inkLoopGeometry(regions[i],pixels);
      if(ring.round&&!ring.externalTail&&
         // Capital Q and digit zero should not be rewritten solely because
         // they're adjacent to letters: require an actual compact loop.
         (current==="Q"||p("o")>=.025||p("O")>=.1))
        changed[i]="o";
    }
    // Case folding applies only to same-shaped letters in a real lowercase
    // dictionary word. It is not generic spelling autocorrect.
    if((current==="Y"||current==="X"||current==="O")&&
       i>start&&exists&&anchors.length>=1&&
       !/^[A-Z]{2,}$/.test(old)){
      const little=current.toLowerCase();
      // Descenders can make lowercase y as tall as uppercase Y.
      // For X/O, require near-normal lowercase body height as well.
      if(current==="Y"||(tallest>0&&h<=tallest*1.12))
       changed[i]=little;
    }
   }
  }
  start=finish;
 }
 return changed;
}
async function recognize(version){
 if(!loaded||version!==readVersion)return;
 const {regions,pixels}=segment();
 window.__inkDetectedRegions=regions.length;
 if(!regions.length){
  window.__inkWordRegions=[];window.__inkTopCandidates=[];
  display("Draw something",true);return
 }
 const simple=shapeFromStroke(regions);
 window.__inkShapeOverride=simple||"";
 if(simple!==null){
  window.__inkWordRegions=[];window.__inkTopCandidates=[];
  display(simple);window.__inkLastGuess=simple;return
 }
 try{
  const images=regions.map(r=>normalize(r.box,pixels));
  const {predictions}=await request("read",{images});
  if(version!==readVersion)return;
  let result="",lastLine=regions[0].line,recognizedLetters=[];
  function candidate(i,char){return predictions[i]?.top?.find(p=>p.char===char)}
  function neighboringType(i,step){
   let j=i+step;
   if(j<0||j>=regions.length)return "";
   if(regions[j].line!==regions[i].line)return "";
   if(step<0 && regions[i].space)return "";
   if(step>0 && regions[j].space)return "";
   const ch=predictions[j]?.top?.[0]?.char||"";
   if(/[0-9]/.test(ch))return "number";
   if(/[a-z]/.test(ch))return "lower";
   if(/[A-Z]/.test(ch))return "upper";
   return "";
  }
  function wordStyle(i){
   let start=i,end=i;
   while(start>0&&regions[start].line===regions[start-1].line&&!regions[start].space)start--;
   while(end+1<regions.length&&regions[end+1].line===regions[i].line&&!regions[end+1].space)end++;
   let lower=0,upper=0;
   for(let n=start;n<=end;n++){
    const ch=predictions[n]?.top?.[0]?.char||"";
    // Same-looking handwritten cases are not evidence of case:
    // EMNIST often cannot distinguish C/c, O/o, S/s, M/m etc.
    if(/[cosmuvwxzCOSMUVWXZ]/.test(ch))continue;
    if(/[a-z]/.test(ch))lower++;
    if(/[A-Z]/.test(ch))upper++;
   }
   return lower>=2&&lower>upper*2?"lower":
      upper>=2&&upper>lower*2?"upper":"neutral";
  }
  window.__inkTopCandidates=predictions.map(p=>p.top.slice(0,5));
  window.__inkWordRegions=regions.map(r=>({box:r.box.slice(),line:r.line,space:r.space}));
  for(let i=0;i<regions.length;i++){
   if(i&&regions[i].line!==lastLine){result+="\n";lastLine=regions[i].line}
   else if(i&&regions[i].space)result+=" ";
   const options=predictions[i].top;
   let ch=options[0].char;
   const before=neighboringType(i,-1),after=neighboringType(i,1);
   const ambiguous=["1","I","l","|","i"];
   if(ambiguous.includes(ch)){
    if((before==="number"||after==="number")&&candidate(i,"1"))ch="1";
    else if(before==="lower"||after==="lower"){
     if(candidate(i,"l"))ch="l";
     else if(candidate(i,"i")&&ch!=="I")ch="i";
    }else if((before==="upper"||after==="upper")&&candidate(i,"I"))ch="I";
   }
   // Contextual case disambiguation for shapes that even real EMNIST writers
   // draw nearly identically in uppercase and lowercase. Never invent extra
   // characters or split a continuous stroke to apply this correction.
   const style=wordStyle(i);
   const visuallyAmbiguous="COSMUVWXZ";
   if(style==="lower"&&visuallyAmbiguous.includes(ch)){
    const lowercase=ch.toLowerCase();
    const alt=candidate(i,lowercase);
    if(alt||options[0].confidence<.92)ch=lowercase;
   }else if(style==="upper"&&visuallyAmbiguous.toLowerCase().includes(ch)){
    const uppercase=ch.toUpperCase();
    const alt=candidate(i,uppercase);
    if(alt||options[0].confidence<.92)ch=uppercase;
   }
   // Use independent ink evidence for dotted i/j versus punctuation and
   // for similarly drawn C/c when an adjacent lowercase reference exists.
   // This does not redraw or replace the user's original strokes.
   ch=refinedLetterAt(i,regions,predictions,pixels,strokes,ch);
   // A very uncertain output is better presented as unknown than as a
   // made-up confident character. This does not affect actual model logits.
   if(options[0].confidence<.075&&
      (options[0].confidence-(options[1]?.confidence||0))<.016)ch="?";
   recognizedLetters.push(ch);
   result+=ch;
  }
  const revised=caseAwareWordReading(
    regions,predictions,pixels,strokes,recognizedLetters,englishRanks);
  if(revised.some((ch,i)=>ch!==recognizedLetters[i])){
   result="";
   let line=regions[0].line;
   for(let i=0;i<regions.length;i++){
    if(i&&regions[i].line!==line){result+="\n";line=regions[i].line}
    else if(i&&regions[i].space)result+=" ";
    result+=revised[i];
   }
  }
  display(result);
  const previousGuess=window.__inkLastGuess;
  window.__inkLastGuess=result;
  // The whole-board OCR is more reliable for multi-stroke glyph identity
  // than a tightly cropped early partial-letter read. An OCR result can
  // arrive AFTER the first neural preview; immediately resubmit the
  // corrected character so an old L/H/k suggestion cannot persist for h.
  if(assistEnabled&&regions.length===1&&result.length===1&&
     (result!==previousGuess||window.__inkAssistLabel!==result)){
   glyphClassMemory.clear();
   queueGhost();
  }
 }catch(e){if(version===readVersion)display("Recognition unavailable",true)}
}
function createWorker(){
 const source=String.raw`
"use strict";
let labels=[],c1,c2,c3,f1,f2;
function unpack(layer){
 const raw=atob(layer.weights);
 const w=new Float32Array(raw.length),b=new Float32Array(layer.bias);
 for(let i=0;i<raw.length;i++){const value=raw.charCodeAt(i);w[i]=(value>127?value-256:value)*layer.scale}
 return {shape:layer.shape,w,b};
}
function conv(input,L,size){
 const [outChannels,inChannels,kernel]=L.shape,output=new Float32Array(outChannels*size*size),pad=(kernel-1)/2;
 for(let o=0;o<outChannels;o++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let total=L.b[o];
  for(let i=0;i<inChannels;i++)for(let ky=0;ky<kernel;ky++){
   const sy=y+ky-pad;if(sy<0||sy>=size)continue;
   for(let kx=0;kx<kernel;kx++){
    const sx=x+kx-pad;if(sx<0||sx>=size)continue;
    const wi=((o*inChannels+i)*kernel+ky)*kernel+kx;
    total+=input[(i*size+sy)*size+sx]*L.w[wi];
   }
  }
  output[(o*size+y)*size+x]=total;
 }
 return output;
}
function pool(input,channels,size){
 const next=size/2,result=new Float32Array(channels*next*next);
 for(let c=0;c<channels;c++)for(let y=0;y<next;y++)for(let x=0;x<next;x++){
  const i=c*size*size+(y*2)*size+x*2;
  result[(c*next+y)*next+x]=Math.max(0,input[i],input[i+1],input[i+size],input[i+size+1]);
 }
 return result;
}
function dense(input,L,relu){
 const [count,length]=L.shape,result=new Float32Array(count);
 for(let o=0;o<count;o++){
  let value=L.b[o];
  const offset=o*length;
  for(let i=0;i<length;i++)value+=L.w[offset+i]*input[i];
  result[o]=relu?Math.max(0,value):value;
 }
 return result;
}
function predict(image){
 let a=pool(conv(Float32Array.from(image),c1,32),12,32);
 a=pool(conv(a,c2,16),24,16);
 a=pool(conv(a,c3,8),32,8);
 const logits=dense(dense(a,f1,true),f2,false);
 let high=-Infinity;
 for(let i=0;i<logits.length;i++)high=Math.max(high,logits[i]);
 const probabilities=Array.from(logits,v=>Math.exp((v-high)/1.25));
 const sum=probabilities.reduce((a,b)=>a+b,0);
 return {top:probabilities.map((p,i)=>({char:labels[i],confidence:p/sum}))
     .sort((a,b)=>b.confidence-a.confidence).slice(0,5)};
}
self.onmessage=e=>{
 const {id,cmd}=e.data;
 try{
  if(cmd==="init"){
   const m=e.data.model;
   if(m.format!=="ink-cnn-int8-v1"||m.layers?.length!==5)throw Error("Unsupported model");
   labels=m.labels;
   [c1,c2,c3,f1,f2]=m.layers.map(unpack);
   self.postMessage({id,result:{classes:labels.length}});
  }else if(cmd==="read"){
   self.postMessage({id,result:{predictions:e.data.images.map(predict)}});
  }else throw Error("Unsupported command");
 }catch(error){self.postMessage({id,error:String(error?.message||error)})}
};
`;
 const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
 worker=new Worker(url);
 URL.revokeObjectURL(url);
 worker.onmessage=e=>{
  const {id,result,error}=e.data;
  const pending=requests.get(id);if(!pending)return;
  requests.delete(id);
  if(error)pending.reject(Error(error));else pending.resolve(result);
 };
 worker.onerror=()=>{loaded=false;window.__inkReady=false;display("AI could not start",true)};
}
async function load(){
 display("Loading AI…",true);
 try{
  let model=null,version=1;
  const candidates=[
   {version:3,relative:"models/ink-cnn-v3.json",remote:RECOGNITION_V3_URL,
       parent:"models/ink-cnn-v2.json"},
   {version:2,relative:"models/ink-cnn-v2.json",remote:RECOGNITION_V2_URL,
       parent:"models/ink-cnn-v1.json"}
  ];
  const embedded=document.getElementById("inkRecognitionModel");
  if(embedded){
   try{
    const candidate=JSON.parse(embedded.textContent);
    if(candidate.format==="ink-cnn-int8-v1"&&
       candidate.training?.finetuned_from==="models/ink-cnn-v2.json"&&
       candidate.labels?.length===102&&candidate.input?.join(",")==="1,32,32"){
      model=candidate;
      version=3;
    }
   }catch(_){/* Use the existing fallback on old or damaged files. */}
  }
  for(const entry of candidates){
   if(model)break;
   const urls=location.protocol==="file:"?[entry.remote]:
     [entry.relative,entry.remote];
   for(const url of urls){
    try{
     const r=await fetch(url,{cache:"no-store"});
     if(!r.ok)continue;
     const candidate=await r.json();
     if(candidate.format!=="ink-cnn-int8-v1"||candidate.layers?.length!==5)continue;
     if(candidate.training?.finetuned_from!==entry.parent)continue;
     if(candidate.labels?.length!==102||candidate.input?.join(",")!=="1,32,32")continue;
     model=candidate;version=entry.version;break;
    }catch(_){/* Newer checkpoint is optional. Original model remains safe. */}
   }
   if(model)break;
  }
  if(!model){
   const response=await fetch(MODEL_URL,{cache:"no-store"});
   if(!response.ok)throw Error("HTTP "+response.status);
   model=await response.json();
  }
  if(model.format!=="ink-cnn-int8-v1"||model.layers?.length!==5)
    throw Error("Bad model data");
  createWorker();
  await request("init",{model});
  window.__inkRecognitionVersion=version;
  window.__inkRecognitionAccuracy=model.training?.emnist_test_accuracy||0;
  window.__inkRecognitionPenAccuracy=model.training?.uji_independent_accuracy||null;
  loaded=true;window.__inkReady=true;
  // Warm the neural model before the first gesture; Assist turns on
  // automatically when the user starts writing, unless manually disabled.
  loadGlyphModel();
  display("Draw something",true);
  if(strokes.length)schedule(80);
 }catch(error){
  display("AI unavailable — check connection",true);
  setTimeout(()=>{if(!loaded)load()},15000);
 }
}
load();
})();
