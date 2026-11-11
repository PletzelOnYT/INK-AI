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
   if(track.confidence>=(id.length>=3?.65:.80)||track.hits>=2)
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
const api={pointFromRotated,projectBox,visibility,createTracker,anglesForPass,normalize,near};
if(typeof window!=="undefined")window.InkCameraCore=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();