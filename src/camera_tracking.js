"use strict";
/* INK AI camera geometry and temporal memory. Pure first-party code. */
(()=>{
function pointFromRotated(x,y,view,source){
 const angle=(view.angle||0)*Math.PI/180;
 const dx=x-view.width/2,dy=y-view.height/2;
 const cs=Math.cos(angle),sn=Math.sin(angle);
 return {x:source.width/2+cs*dx+sn*dy,
         y:source.height/2-sn*dx+cs*dy};
}
function projectBox(box,view,source){
 const points=[
  pointFromRotated(box.x0,box.y0,view,source),
  pointFromRotated(box.x1,box.y0,view,source),
  pointFromRotated(box.x1,box.y1,view,source),
  pointFromRotated(box.x0,box.y1,view,source)
 ];
 return {points,box:{
  x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),
  y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))
 }};
}
function visibility(polygon,width,height){
 if(!polygon?.length)return false;
 const center=polygon.reduce((a,p)=>({x:a.x+p.x/polygon.length,y:a.y+p.y/polygon.length}),{x:0,y:0});
 return center.x>=0&&center.x<width&&center.y>=0&&center.y<height;
}
function normalize(text){return String(text||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function near(a,b){
 if(!a||!b)return false;
 const w=Math.max(a.x1-a.x0,b.x1-b.x0),h=Math.max(a.y1-a.y0,b.y1-b.y0);
 const cx=((a.x0+a.x1)-(b.x0+b.x1))/2;
 const cy=((a.y0+a.y1)-(b.y0+b.y1))/2;
 return Math.abs(cx)<Math.max(36,w*.75)&&Math.abs(cy)<Math.max(25,h*1.7);
}
function withinOneEdit(a,b){
 if(a===b)return true;
 if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){
  if(a[i]===b[j]){i++;j++;continue}
  if(++edits>1)return false;
  if(a.length>b.length)i++;
  else if(b.length>a.length)j++;
  else{i++;j++}
 }
 return edits+(a.length-i)+(b.length-j)<=1;
}
function median(values){
 if(!values.length)return 0;
 const ordered=[...values].sort((a,b)=>a-b);
 return ordered[Math.floor(ordered.length/2)];
}
// Reject shelf edges, door seams, reflections and isolated line fragments
// before passing any crop to the printed-character model.
function looksLikeTextLine(letters){
 if(!Array.isArray(letters)||letters.length<4||letters.length>38)return false;
 const a=[...letters].sort((p,q)=>p.x0-q.x0);
 const heights=a.map(t=>t.y1-t.y0+1),widths=a.map(t=>t.x1-t.x0+1);
 const h=median(heights),bottom=median(a.map(t=>t.y1));
 if(h<9||h>92)return false;
 const xSpan=a[a.length-1].x1-a[0].x0+1;
 if(xSpan<3.2*h)return false;
 let aligned=0,plausible=0,thin=0,wide=0;
 for(let i=0;i<a.length;i++){
  const hi=heights[i],wi=widths[i];
  if(wi<.12*h)thin++;
  if(wi>1.42*h)wide++;
  if(hi>=.52*h&&hi<=1.8*h&&wi>=.10*h&&wi<=1.42*h)plausible++;
  if(Math.abs(a[i].y1-bottom)<Math.max(5,h*.37))aligned++;
 }
 if(plausible/a.length<.78||aligned/a.length<.68||
    thin/a.length>.28||wide/a.length>.20)return false;
 const gaps=[];
 for(let i=1;i<a.length;i++)gaps.push(Math.max(0,a[i].x0-a[i-1].x1-1));
 if(median(gaps)>h*.56)return false;
 return true;
}
// The CNN is a character classifier, not a text/no-text detector. Its
// probability alone cannot establish that a cabinet edge is a letter.
function looksLikeWord(text,confidence){
 // Text can be an abbreviation, a brand name, a serial identifier, or a
 // dictionary word. Requiring vowels or dictionary membership rejects valid
 // labels such as NY, BMW, THREADS, XZ, and model numbers.
 const word=String(text||"").trim();
 if(!/^[A-Za-z0-9]{2,32}$/.test(word)||
    !Number.isFinite(confidence))return false;
 if(word.length===2)return confidence>=.79;
 if(/^[0-9]+$/.test(word))return confidence>=.83;
 if(/[0-9]/.test(word))return confidence>=.90;
 return confidence>=.74;
}
// Text-region highlights are tracked separately from neural transcription.
// Geometry must be present on successive scans; a missed frame does not flicker.
function createRegionTracker(){
 let regions=[];
 function update(boxes,now=Date.now()){
  const seen=new Set();
  for(const incoming of boxes||[]){
   if(!incoming?.box||!incoming?.polygon)continue;
   const b=incoming.box;
   let prior=regions.find(r=>near(r.box,b)&&
     Math.abs((r.box.x1-r.box.x0)-(b.x1-b.x0))<
       Math.max(26,(b.x1-b.x0)*.45)&&
     Math.abs((r.box.y1-r.box.y0)-(b.y1-b.y0))<
       Math.max(15,(b.y1-b.y0)*.45));
   if(!prior){prior={box:b,polygon:incoming.polygon,hits:0,lastSeen:0};regions.push(prior)}
   if(seen.has(prior))continue;
   seen.add(prior);prior.box=b;prior.polygon=incoming.polygon;
   prior.lastSeen=now;prior.hits=Math.min(8,prior.hits+1);
  }
  regions=regions.filter(r=>now-r.lastSeen<1500);
  return regions.filter(r=>r.hits>=2).map(r=>({...r}));
 }
 return {update,snapshot:(now=Date.now())=>regions.filter(r=>r.hits>=2&&now-r.lastSeen<1500).map(r=>({...r})),
 reset:()=>{regions=[]}};
}
// Context decoder: still uses the trained CNN's top probabilities. The
// repository's English-word list only helps resolve plausible character
// sequences; it never creates regions or processes webcam frames remotely.
// Probabilistic decoding: only correct a CNN word when each replacement
// character has genuine CNN support. Never inflate a model probability to
// manufacture a confident-looking English word.
function decodePrintedWord(predictions,words){
 if(!Array.isArray(predictions)||predictions.length<2||predictions.length>32)return null;
 const n=predictions.length;
 const options=predictions.map(p=>(p?.top||[]).filter(t=>t&&
   /^[a-zA-Z0-9]$/.test(t.char)&&Number.isFinite(t.confidence)));
 if(options.some(o=>!o.length))return null;
 const raw=options.map(o=>o[0].char).join("");
 const literal=raw.toLowerCase();
 const rawProb=Math.exp(options.reduce((s,o)=>s+Math.log(Math.max(.0001,o[0].confidence)),0)/n);
 if(rawProb<.52)return null;
 let best=null,runner=null;
 for(const word of words||[]){
  if(word.length!==n||!/^[a-z]+$/.test(word))continue;
  let edits=0,sum=0,valid=true;
  for(let i=0;i<n;i++){
   const ch=word[i],same=literal[i]===ch;
   if(!same&&++edits>(n>=9?2:1)){valid=false;break}
   const candidate=options[i].find(o=>o.char.toLowerCase()===ch);
   if(!candidate||candidate.confidence<(!same?.12:.22)){
    valid=false;break;
   }
   sum+=Math.log(Math.max(.0001,candidate.confidence));
  }
  if(!valid)continue;
  const score=Math.exp(sum/n);
  // Measured character likelihood and raw CNN margin outrank dictionary
  // frequency; a mismatched word needs almost as much evidence as raw.
  if(score<(n<=4?.62:.55)||score<rawProb*(edits===0?.75:edits===1?.84:.90))continue;
  const choice={text:word,confidence:score,changes:edits};
  if(!best||choice.confidence>best.confidence){
   runner=best;best=choice;
  }else if(!runner||choice.confidence>runner.confidence)runner=choice;
 }
 if(!best)return null;
 // Uncertain similarly scoring words should not become arbitrary guesses.
 if(runner&&runner.text!==best.text&&
   best.confidence<runner.confidence*1.08)return null;
 const allCaps=/^[A-Z0-9]+$/.test(raw)&&/[A-Z]/.test(raw);
 const titled=/^[A-Z]/.test(raw);
 return {text:allCaps?best.text.toUpperCase():
    titled?best.text[0].toUpperCase()+best.text.slice(1):best.text,
   confidence:best.confidence,lexicon:true,changes:best.changes};
}
// Accumulate original CNN probabilities across nearby camera frames. This
// is an actual probabilistic sequence estimator, not a dictionary guess.
// An uncertain glyph may become legible after several different views.
function createGlyphEvidenceTracker(){
 let regions=[],nextId=0;
 function fuse(frames,length){
  const predictions=[];
  for(let i=0;i<length;i++){
   const votes=new Map();
   for(const f of frames){
    for(const choice of f.predictions[i]?.top||[]){
     if(!/^[A-Za-z0-9]$/.test(choice.char)||
        !Number.isFinite(choice.confidence))continue;
     const old=votes.get(choice.char)||0;
     votes.set(choice.char,old+choice.confidence/frames.length);
    }
   }
   predictions.push({top:[...votes].map(([char,confidence])=>({char,confidence}))
     .sort((a,b)=>b.confidence-a.confidence).slice(0,5)});
  }
  return predictions;
 }
 function update(items,now=Date.now()){
  const visited=new Set();
  for(const item of items||[]){
   if(!item?.box||!item?.polygon||!Array.isArray(item.predictions))continue;
   const n=item.predictions.length;
   if(n<2||n>32)continue;
   let region=regions.find(t=>t.length===n&&near(t.box,item.box)&&!visited.has(t));
   if(!region){
    region={uid:++nextId,length:n,box:item.box,polygon:item.polygon,
      angle:item.angle||0,lastSeen:0,frames:[]};
    regions.push(region);
   }
   visited.add(region);
   region.box=item.box;region.polygon=item.polygon;
   region.angle=item.angle||0;region.lastSeen=now;
   region.frames=region.frames.filter(f=>now-f.when<=2600);
   region.frames.push({when:now,predictions:item.predictions});
   if(region.frames.length>6)region.frames.shift();
  }
  regions=regions.filter(t=>now-t.lastSeen<=3000);
  return regions.filter(t=>t.frames.length>=2&&now-t.lastSeen<2500)
   .map(t=>({uid:t.uid,box:t.box,polygon:t.polygon,angle:t.angle,
     frames:t.frames.length,predictions:fuse(t.frames,t.length)}));
 }
 function reset(){regions=[];nextId=0}
 return {update,reset};
}
// Track current on-screen words by position and temporal voting. Never
// append old guesses to an unlimited transcript after a page disappears.
function createTracker(){
 let tracks=[],nextId=0,lastAngle=null,lastAngleAt=0;
 const holdMs=3200,windowMs=2600;
 function update(detections,now=Date.now()){
  const visited=new Set();
  for(const item of detections||[]){
   const text=String(item?.text||"");
   const normalized=normalize(text);
   if(!/^[a-z0-9]{2,32}$/.test(normalized)||
      !Number.isFinite(item?.confidence)||item.confidence<.54||
      !item.box||!item.polygon)continue;
   let track=tracks.find(t=>!visited.has(t)&&near(t.box,item.box)&&
     (withinOneEdit(t.bestId,normalized)||t.bestId===normalized));
   if(!track){
    track={uid:++nextId,box:item.box,polygon:item.polygon,
      angle:item.angle||0,lastSeen:now,bestId:normalized,votes:[],
      text:"",confidence:0,confirmed:false};
    tracks.push(track);
   }
   visited.add(track);
   track.box=item.box;track.polygon=item.polygon;
   track.angle=item.angle||0;track.lastSeen=now;
   track.votes=track.votes.filter(v=>now-v.when<=windowMs);
   track.votes.push({id:normalized,text,confidence:item.confidence,when:now});
   const scores=new Map();
   for(const v of track.votes){
    const a=scores.get(v.id)||{weight:0,count:0,text:v.text};
    a.weight+=v.confidence;a.count++;a.text=v.text;scores.set(v.id,a);
   }
   let best=null,second=null;
   for(const [id,v] of scores){
    const entry={id,...v};
    if(!best||entry.weight>best.weight){second=best;best=entry}
    else if(!second||entry.weight>second.weight)second=entry;
   }
   if(!best)continue;
   track.bestId=best.id;
   // Three consistent reads within 2.6 seconds, average confidence >= 0.64.
   // A strong classifier prediction alone is never enough on camera scenes.
   track.confirmed=best.count>=3&&best.weight/best.count>=.64&&
     (!second||best.weight>=second.weight*1.55);
   if(track.confirmed){
    track.text=best.text;track.confidence=best.weight/best.count;
    lastAngle=track.angle;lastAngleAt=now;
   }
  }
  tracks=tracks.filter(t=>now-t.lastSeen<holdMs);
  return snapshot(now);
 }
 function snapshot(now=Date.now()){
  const visible=tracks.filter(t=>t.confirmed&&now-t.lastSeen<holdMs);
  const words=visible.map(t=>({...t})).sort((a,b)=>{
    const ah=a.box.y1-a.box.y0,bh=b.box.y1-b.box.y0;
    const ay=(a.box.y0+a.box.y1)/2,by=(b.box.y0+b.box.y1)/2;
    if(Math.abs(ay-by)>Math.max(10,(ah+bh)*.42))return ay-by;
    return a.box.x0-b.box.x0;
  });
  const rows=[];
  for(const word of words){
   const y=(word.box.y0+word.box.y1)/2,h=word.box.y1-word.box.y0;
   let row=rows.find(r=>Math.abs(r.y-y)<Math.max(12,(r.h+h)*.36));
   if(!row){row={y,h,items:[]};rows.push(row)}
   row.items.push(word);
  }
  const text=rows.sort((a,b)=>a.y-b.y).map(row=>
    row.items.sort((a,b)=>a.box.x0-b.box.x0).map(w=>w.text).join(" ")).join("\n");
  return {words,boxes:words,text:text.slice(0,2000),
    activeAngle:now-lastAngleAt<5000?lastAngle:null,
    totalWords:words.length};
 }
 function reset(){tracks=[];nextId=0;lastAngle=null;lastAngleAt=0}
 return {update,snapshot,reset};
}
// A 24x14 low-resolution color fingerprint detects when a printed page is
// taken away or replaced. No images are retained; only previous sampled RGB.
function createSceneMonitor(){
 let previous=null;
 function update(data,now=Date.now()){
  if(!data||!data.length)return {changed:false,mean:0,changedFraction:0};
  const sample=new Uint8Array(data.length);
  sample.set(data);
  if(!previous){previous=sample;return {changed:false,mean:0,changedFraction:0}}
  let total=0,changed=0,n=0;
  for(let i=0;i<data.length;i+=4){
   const delta=(Math.abs(data[i]-previous[i])+
    Math.abs(data[i+1]-previous[i+1])+
    Math.abs(data[i+2]-previous[i+2]))/3;
   total+=delta;changed+=(delta>36?1:0);n++;
  }
  const mean=total/n,fraction=changed/n;
  previous=sample;
  return {changed:mean>34&&fraction>.36,mean,changedFraction:fraction,when:now};
 }
 function reset(){previous=null}
 return {update,reset};
}
function anglesForPass(pass,preferred){
 // Each pass samples the straightforward view plus a rotated pair.
 // A recently successful angle gets priority, preventing sudden dropouts.
 const pairs=[[-20,20],[-40,40],[-60,60],[-85,85]];
 const pair=pairs[pass%pairs.length];
 const values=Number.isFinite(preferred)?[preferred,0,...pair]:[0,...pair];
 return [...new Set(values.map(n=>Math.round(n)))].slice(0,4);
}
const api={pointFromRotated,projectBox,visibility,createTracker,anglesForPass,normalize,near,looksLikeTextLine,looksLikeWord,createRegionTracker,decodePrintedWord,createSceneMonitor,createGlyphEvidenceTracker};
if(typeof window!=="undefined")window.InkCameraCore=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();