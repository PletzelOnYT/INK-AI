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
 const word=String(text||"");
 if(!Number.isFinite(confidence))return false;
 if(/^[A-Za-z]{4,32}$/.test(word)){
  // Common printed words contain vowels; this rejects most strings made
  // from spurious geometric edges, including "JmzS".
  return /[aeiouy]/i.test(word)&&confidence>=.70;
 }
 if(/^[A-Za-z]{3}$/.test(word))
  return confidence>=.93&&/[aeiouy]/i.test(word);
 if(/^[0-9]{4,12}$/.test(word))return confidence>=.91;
 if(/^[A-Za-z0-9]{7,32}$/.test(word)&&/[A-Za-z]/.test(word)&&/[0-9]/.test(word))
  return confidence>=.95;
 return false;
}
function createTracker(){
 let tracks=[],captured=[],nextId=0,lastAngle=0,lastAngleAt=0;
 function update(detections,now=Date.now()){
  const incoming=[];
  for(const item of detections||[]){
   const id=normalize(item.text);
   if(id.length<2||!item.box||!Number.isFinite(item.confidence)||
      item.confidence<.44)continue;
   const same=incoming.find(x=>normalize(x.text)===id&&near(x.box,item.box));
   if(same){if(item.confidence>same.confidence)Object.assign(same,item)}
   else incoming.push({...item});
  }
  for(const item of incoming){
   const id=normalize(item.text);
   let track=tracks.find(t=>withinOneEdit(t.id,id)&&near(t.box,item.box));
   if(!track){
    track={uid:++nextId,id,text:item.text,box:item.box,polygon:item.polygon,
      angle:item.angle||0,confidence:item.confidence,lastSeen:now,
      hits:0,confirmed:false,recorded:false};
    tracks.push(track);
   }
   // Update the highlight's position on EVERY matching frame, even if
   // classification confidence fluctuates. Otherwise rectangles get stuck.
   track.box=item.box;track.polygon=item.polygon;
   track.angle=item.angle||0;
   track.hits=Math.min(12,track.hits+1);
   track.lastSeen=now;
   if(item.confidence>=track.confidence){
    track.id=id;track.text=item.text;track.confidence=item.confidence;
   }
   // High-confidence words appear immediately; borderline words are
   // confirmed across two reads, with no arbitrary fixed delay.
   if(track.hits>=2&&track.confidence>=.65)
    track.confirmed=true;
   if(!track.confirmed)continue;
   lastAngle=track.angle;lastAngleAt=now;
   if(!track.recorded){
    // Do not duplicate a tracked word every frame, but allow a repeated
    // word at a different text position to appear in a real sentence.
    const recent=captured.find(x=>x.id===track.id&&near(x.box,track.box)&&
      now-x.when<30000);
    if(!recent){
     captured.push({uid:track.uid,id:track.id,text:track.text,
       box:{...track.box},when:now,confidence:track.confidence});
     if(captured.length>90)captured.shift();
    }
    track.recorded=true;
   }else{
    const record=captured.find(x=>x.uid===track.uid);
    if(record&&track.confidence>record.confidence){
     record.text=track.text;record.id=track.id;record.confidence=track.confidence;
    }
   }
  }
  // Lost camera boxes expire, but committed words never vanish from text.
  tracks=tracks.filter(t=>now-t.lastSeen<2400);
  return snapshot(now);
 }
 function snapshot(now=Date.now()){
  const visible=tracks.filter(t=>now-t.lastSeen<2400);
  return {
   words:visible.filter(t=>t.confirmed).map(t=>({...t})),
   boxes:visible.map(t=>({...t})),
   text:captured.map(t=>t.text).join(" ").slice(-3000),
   activeAngle:now-lastAngleAt<5000?lastAngle:null,
   totalWords:captured.length
  };
 }
 function reset(){tracks=[];captured=[];nextId=0;lastAngle=0;lastAngleAt=0}
 return {update,snapshot,reset};
}
function anglesForPass(pass,preferred){
 // Each pass samples the straightforward view plus a rotated pair.
 // A recently successful angle gets priority, preventing sudden dropouts.
 const pairs=[[-20,20],[-40,40],[-60,60],[-85,85]];
 const pair=pairs[pass%pairs.length];
 const values=Number.isFinite(preferred)?[preferred,0,...pair]:[0,...pair];
 return [...new Set(values.map(n=>Math.round(n)))].slice(0,4);
}
const api={pointFromRotated,projectBox,visibility,createTracker,anglesForPass,normalize,near,looksLikeTextLine,looksLikeWord};
if(typeof window!=="undefined")window.InkCameraCore=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();