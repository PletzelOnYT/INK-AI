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
function createTracker(){
 let tracks=[],captured=[],lastAngle=0,lastAngleAt=0;
 function update(detections,now=Date.now()){
  const incoming=new Map();
  for(const item of detections||[]){
   const id=normalize(item.text);
   if(id.length<2||!item.box||!Number.isFinite(item.confidence))continue;
   if(item.confidence<.44)continue;
   const old=incoming.get(id);
   if(!old||item.confidence>old.confidence)incoming.set(id,item);
  }
  for(const item of incoming.values()){
   const id=normalize(item.text);
   let track=tracks.find(t=>t.id===id&&near(t.box,item.box));
   if(!track){
    track={id,text:item.text,box:item.box,polygon:item.polygon,
      angle:item.angle||0,confidence:item.confidence,lastSeen:now,
      hits:0,confirmed:false};
    tracks.push(track);
   }
   track.hits=Math.min(12,track.hits+1);
   track.lastSeen=now;
   if(item.confidence>=track.confidence||!track.polygon){
    track.text=item.text;track.box=item.box;track.polygon=item.polygon;
    track.angle=item.angle||0;
   }
   track.confidence=Math.max(track.confidence,item.confidence);
   // High-confidence words are shown on the first inference. A low-confidence
   // guess must survive a second independently processed frame.
   if(track.confidence>=(id.length>=3?.65:.80)||track.hits>=2)
    track.confirmed=true;
   if(track.confirmed){
    lastAngle=track.angle;lastAngleAt=now;
    const recent=captured.find(x=>x.id===id);
    if(!recent){
     captured.push({id,text:track.text,when:now});
     if(captured.length>90)captured.shift();
    }
   }
  }
  // Unreliable boxes should expire from the highlighter, but NEVER erase
  // committed words from the session transcript.
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
 function reset(){tracks=[];captured=[];lastAngle=0;lastAngleAt=0}
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