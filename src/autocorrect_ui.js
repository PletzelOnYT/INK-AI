// INK AI: whole-character correction with CNN recognition and English word context.
// The preview proposes an entire character. Acceptance replaces that ink;
// it never attempts to extrapolate a partial neural stroke.
const dictionarySource=document.getElementById("englishWords");
const englishRank=new Map();
const englishPrefixes=new Set();
if(dictionarySource){
 const entries=dictionarySource.textContent.trim().split(/\s+/);
 for(let i=0;i<entries.length;i++){
  const w=entries[i].toLowerCase();
  if(!/^[a-z]+$/.test(w)||englishRank.has(w))continue;
  englishRank.set(w,i+1);
  for(let j=2;j<Math.min(w.length,24);j++)englishPrefixes.add(w.slice(0,j));
 }
}
window.__inkDictionaryWords=englishRank.size;
window.__inkDictionaryReady=englishRank.size>8500;
window.__inkAssistModel="cnn-word-autocorrect";
window.__inkAssistLabel="";
window.__inkGhostSource="none";
window.__inkGhostPoints=0;
window.__inkGhostSegments=0;
window.__inkSuggestionChoices=[];
window.__inkAcceptedCorrections=0;
window.__inkCorrectionConfidence=0;
window.__inkContextWord="";
window.__inkAutocorrectReady=true;
let glyphEpoch=0,correctionChoices=[],correctionIndex=0,correctionBox=null;
let suggestionVersion=0;

function clearGhost(){
 ghostCandidate=null;correctionChoices=[];correctionIndex=0;correctionBox=null;
 ++suggestionVersion;
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 window.__inkAssistLabel="";window.__inkGhostSource="none";
 window.__inkSuggestionChoices=[];window.__inkCorrectionConfidence=0;
}
function queueGhost(){
 // Predictions use the whole written character after pointerup; never infer
 // while an incomplete stroke is still moving, or resurrect stale previews.
 if(pointer!==null&&ghostCandidate)clearGhost();
}
function updateAssist(){
 assistEnabled=!assistEnabled;
 window.__inkAssistEnabled=assistEnabled;
 assistButton.setAttribute("aria-pressed",String(assistEnabled));
 assistButton.classList.toggle("assist-on",assistEnabled);
 ++glyphEpoch;clearGhost();
 if(assistEnabled&&loaded)schedule(60);
}
assistButton.addEventListener("click",updateAssist);

function rankCorrectionCandidates(options,prefix="",suffix="",preferred="",
                                  dictionary=englishRank,prefixes=englishPrefixes){
 const sorted=(options||[]).filter(x=>x&&typeof x.char==="string"&&
   [...x.char].length===1&&Number.isFinite(x.confidence)&&x.confidence>0);
 if(!sorted.length)return [];
 const best=sorted[0],baseP=best.confidence;
 const available=new Map();
 for(const o of sorted){
  const ch=o.char;
  if(available.has(ch)||o.confidence<baseP*.09)continue;
  // Strong visual evidence should not be overturned by a word list.
  if(baseP>=.87&&ch!==best.char)continue;
  let score=Math.log(Math.max(o.confidence,1e-6));
  const contextWord=(prefix+ch+suffix).toLowerCase();
  if(/^[a-z]$/i.test(best.char)&&/^[a-z]+$/.test(contextWord)&&contextWord.length>=3&&
     (prefix.length+suffix.length)>=2){
   const rank=dictionary.get(contextWord);
   if(rank!==undefined){
    // Exact common word: gentle prior, less than strong CNN evidence.
    score+=1.05+.30*Math.max(0,Math.log(10001/rank)/Math.log(10001));
   }else if(!suffix&&prefixes.has(contextWord)){
    score+=.24;
   }
  }
  if(ch===preferred)score+=.08;
  available.set(ch,{label:ch,score,confidence:o.confidence,
     contextWord:contextWord,wordMatch:dictionary.has(contextWord)});
 }
 return [...available.values()].sort((a,b)=>b.score-a.score)
   .slice(0,4);
}
function correctedContext(regions,predictions,index){
 let prefix="",suffix="",j=index-1;
 const r=regions[index];
 while(j>=0&&regions[j].line===r.line&&!regions[j+1].space){
  const ch=predictions[j]?.top?.[0]?.char||"";
  if(!/^[a-z]$/i.test(ch))break;
  prefix=ch+prefix;j--;
 }
 j=index+1;
 while(j<regions.length&&regions[j].line===r.line&&!regions[j].space){
  const ch=predictions[j]?.top?.[0]?.char||"";
  if(!/^[a-z]$/i.test(ch))break;
  suffix+=ch;j++;
 }
 return {prefix,suffix};
}
function drawCorrectionGlyph(context,char,box,preview){
 const [x0,y0,x1,y1]=box,w=x1-x0+1,h=y1-y0+1;
 const cx=(x0+x1)/2,cy=(y0+y1)/2;
 context.save();
 // Keep the original ink visible behind a soft gray, translucent preview.
 // Only an accepted correction clears the old glyph and draws permanent ink.
 if(!preview){
  context.fillStyle="#fff";
  context.fillRect(x0-4,y0-4,w+8,h+8);
 }
 context.fillStyle=preview?"rgba(72,72,72,0.28)":"#111";
 const fontSize=Math.max(25,Math.min(220,h*1.27));
 context.font="600 "+fontSize+"px Arial, Helvetica, sans-serif";
 context.textBaseline="middle";context.textAlign="center";
 // Fit a full character inside the selected handwritten region.
 const width=context.measureText(char).width;
 if(width>w+8){
  context.font="600 "+Math.max(17,fontSize*(w+8)/width)+"px Arial, Helvetica, sans-serif";
 }
 context.fillText(char,cx,cy+Math.min(6,h*.035),Math.max(w+8,12));
 context.restore();
}
function renderGhost(){
 ghostCtx.clearRect(0,0,ghostCanvas.width,ghostCanvas.height);
 window.__inkGhostPoints=0;window.__inkGhostSegments=0;
 if(!assistEnabled||tool!=="pen"||!ghostCandidate)return;
 drawCorrectionGlyph(ghostCtx,ghostCandidate.label,ghostCandidate.box,true);
 window.__inkGhostPoints=1;
 window.__inkGhostSegments=1;
 window.__inkGhostSource="complete-character-correction";
 window.__inkAssistLabel=ghostCandidate.label;
 window.__inkCorrectionConfidence=ghostCandidate.confidence;
}
function setGhostChoice(index){
 if(!assistEnabled||!correctionChoices.length||!correctionBox)return;
 correctionIndex=(index+correctionChoices.length)%correctionChoices.length;
 const option=correctionChoices[correctionIndex];
 ghostCandidate={...option,box:correctionBox.slice()};
 renderGhost();
}
function offerCorrection(regions,predictions,recognized){
 if(!assistEnabled||pointer!==null||tool!=="pen"){clearGhost();return}
 if(!regions?.length||!predictions?.length){clearGhost();return}
 // Do not offer to replace the just-accepted clean correction again.
 if(strokes.at(-1)?.type==="corrected-character"){clearGhost();return}
 const latest=[...strokes].reverse().find(s=>s.tool==="pen"&&
   s.type!=="corrected-character"&&s.points?.length);
 let index=regions.length-1;
 if(latest){
  const p=latest.points.at(-1);
  const distance=(r)=>{
   const [x0,y0,x1,y1]=r.box;
   return (Math.max(0,x0-p[0],p[0]-x1)**2)+
     (Math.max(0,y0-p[1],p[1]-y1)**2);
  };
  for(let i=0;i<regions.length;i++)
   if(distance(regions[i])<distance(regions[index]))index=i;
 }
 const r=regions[index],top=predictions[index]?.top||[];
 if(!top.length){clearGhost();return}
 const context=correctedContext(regions,predictions,index);
 const preferred=regions.length===1&&recognized.length===1?
   recognized:top[0].char;
 const ranked=rankCorrectionCandidates(
   top,context.prefix,context.suffix,preferred);
 if(!ranked.length){clearGhost();return}
 correctionBox=r.box.slice();
 correctionChoices=ranked;
 window.__inkSuggestionChoices=ranked.map(x=>x.label);
 window.__inkContextWord=context.prefix+"["+ranked[0].label+"]"+context.suffix;
 setGhostChoice(0);
}
function acceptGhost(){
 if(!assistEnabled||tool!=="pen"||pointer!==null||!ghostCandidate)return;
 const candidate=ghostCandidate;
 // A single undoable correction record redraws the selected area cleanly.
 // Surrounding letters and all original strokes remain recoverable by Undo.
 strokes.push({tool:"pen",type:"corrected-character",
  char:candidate.label,box:candidate.box.slice(),
  points:[[(candidate.box[0]+candidate.box[2])/2,
           (candidate.box[1]+candidate.box[3])/2]]});
 window.__inkAcceptedCorrections++;
 clearGhost();paint();schedule(65);
}
window.addEventListener("keydown",e=>{
 if(e.key==="Tab"&&assistEnabled&&correctionChoices.length>1){
  e.preventDefault();setGhostChoice(correctionIndex+1);return;
 }
 if((e.key.toLowerCase()==="g"||e.key==="Enter")&&!e.ctrlKey&&
    !e.altKey&&!e.metaKey&&!e.repeat&&
    !(e.target instanceof HTMLInputElement)&&
    !(e.target instanceof HTMLTextAreaElement))acceptGhost();
});
