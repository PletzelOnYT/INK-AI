"use strict";
/* Optional macOS Vision bridge. Apple Vision runs locally on the user's Mac.
   Browser-only INK AI remains fully functional without the companion.
   No cloud OCR, image upload, or third-party JS dependencies.
 */
(()=>{
 const params=new URLSearchParams(location.hash.replace(/^#/,""));
 const token=params.get("ink-vision-token");
 const ROOT="http://127.0.0.1:17861";
 if(!token||token.length<24){
  window.InkVisionBridge={connect:async()=>null};
  return;
 }
 const normalize=s=>String(s||"").toLowerCase().replace(/\s+/g," ").trim();
 const overlap=(a,b)=>{
  if(!a||!b)return 0;
  const intersection=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
    Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const ar=(r)=>Math.max(1,(r.x1-r.x0)*(r.y1-r.y0));
  return intersection/Math.min(ar(a),ar(b));
 };
 function createTracker(){
  let tracks=[];
  function update(payload,now=Date.now()){
   const incoming=(payload?.lines||[]).filter(line=>
      line&&typeof line.text==="string"&&
      /[A-Za-z0-9\u00c0-\u024f]/.test(line.text)&&
      Number(line.confidence)>=.34&&line.box);
   const visited=new Set();
   for(const line of incoming){
    const value=normalize(line.text);
    const match=tracks.find(t=>!visited.has(t)&&
      overlap(t.box,line.box)>.30&&
      (t.value===value||t.value.startsWith(value)||value.startsWith(t.value)||
       Math.abs(t.value.length-value.length)<=3));
    const track=match||{seen:0,confidence:0,text:"",value:"",box:null,words:[],last:0};
    if(!match)tracks.push(track);
    visited.add(track);
    if(track.value===value)track.seen=Math.min(15,track.seen+1);
    else track.seen=1;
    track.value=value;
    track.text=line.text;
    track.confidence=Number(line.confidence);
    track.box=line.box;
    track.words=(line.words||[]).filter(x=>x.box&&typeof x.text==="string");
    track.last=now;
   }
   // Keep a missing region for a short time to avoid flicker. Previous
   // documents must not accumulate into an endless transcript.
   tracks=tracks.filter(t=>now-t.last<1200);
   const visible=tracks.filter(t=>t.seen>=2||t.confidence>=.86);
   const sorted=[...visible].sort((a,b)=>{
     const ay=(a.box.y0+a.box.y1)/2,by=(b.box.y0+b.box.y1)/2;
     if(Math.abs(ay-by)>Math.max(12,Math.min(a.box.y1-a.box.y0,b.box.y1-b.box.y0)*.50))
      return ay-by;
     return a.box.x0-b.box.x0;
   });
   const text=sorted.map(t=>t.text).join("\n").slice(0,5000);
   const boxes=sorted.flatMap(t=>t.words.length?t.words:[{
       text:t.text,confidence:t.confidence,box:t.box
   }]);
   return {text,lines:sorted,words:boxes,sourceWidth:payload.width,
     sourceHeight:payload.height};
  }
  return {update,reset:()=>{tracks=[]}};
 }
 function draw(overlay,video,board,state){
  const context=overlay.getContext("2d"),ratio=window.devicePixelRatio||1;
  const width=board.clientWidth,height=board.clientHeight;
  const cw=Math.max(1,Math.round(width*ratio)),ch=Math.max(1,Math.round(height*ratio));
  if(overlay.width!==cw||overlay.height!==ch){overlay.width=cw;overlay.height=ch}
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,width,height);
  if(!video.videoWidth||!state?.sourceWidth||!state.words.length)return;
  const fit=Math.min(width/video.videoWidth,height/video.videoHeight);
  const ox=(width-video.videoWidth*fit)/2;
  const oy=(height-video.videoHeight*fit)/2;
  const sx=video.videoWidth/state.sourceWidth*fit;
  const sy=video.videoHeight/state.sourceHeight*fit;
  context.fillStyle="rgba(255,255,255,.27)";
  context.strokeStyle="rgba(255,255,255,.95)";
  context.lineWidth=1.5;
  for(const word of state.words){
   const b=word.box;
   const x=ox+b.x0*sx,y=oy+b.y0*sy;
   const w=Math.max(2,(b.x1-b.x0)*sx),h=Math.max(2,(b.y1-b.y0)*sy);
   if(x+w<0||y+h<0||x>width||y>height)continue;
   context.beginPath();
   const polygon=word.points;
   if(Array.isArray(polygon)&&polygon.length===4){
    context.moveTo(ox+polygon[0].x*sx,oy+polygon[0].y*sy);
    for(let i=1;i<4;i++)
     context.lineTo(ox+polygon[i].x*sx,oy+polygon[i].y*sy);
    context.closePath();
   }else if(context.roundRect)context.roundRect(x-2,y-1,w+4,h+2,3);
   else context.rect(x-2,y-1,w+4,h+2);
   context.fill();context.stroke();
  }
 }
 async function connect(){
  let response=null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),900);
  try{
   response=await fetch(ROOT+"/health",{
    mode:"cors",headers:{"X-Ink-Token":token},
    cache:"no-store",signal:controller.signal
   });
   if(!response.ok)return null;
   const data=await response.json();
   if(data.engine!=="apple-vision-local")return null;
  }catch(_){return null}finally{clearTimeout(timer)}
  const capture=document.createElement("canvas");
  const ctx=capture.getContext("2d",{alpha:false});
  const tracker=createTracker();
  let count=0;
  async function recognize(video){
   const w=Math.min(1440,video.videoWidth),h=Math.max(1,
     Math.round(video.videoHeight*w/video.videoWidth));
   if(capture.width!==w||capture.height!==h){capture.width=w;capture.height=h}
   ctx.drawImage(video,0,0,w,h);
   const image=await new Promise((resolve,reject)=>{
    capture.toBlob(blob=>blob?resolve(blob):reject(Error("JPEG frame unavailable")),
      "image/jpeg",.86);
   });
   // Accurate recognition is prioritized. Fast mode can be selected in
   // a future UI option; the preview itself remains at full frame rate.
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),3500);
   try{
    const result=await fetch(ROOT+"/ocr?mode=accurate",{
     method:"POST",mode:"cors",cache:"no-store",
     headers:{"X-Ink-Token":token},
     body:image,signal:controller.signal
    });
    if(result.status===503)return null;
    if(!result.ok)throw Error("Local Vision HTTP "+result.status);
    const payload=await result.json();
    count++;
    return {...payload,count};
   }finally{clearTimeout(timer)}
  }
  return {engine:"apple-vision-local",recognize,track:tracker.update,
    reset:tracker.reset,paint:draw};
 }
 window.InkVisionBridge={connect};
})();
