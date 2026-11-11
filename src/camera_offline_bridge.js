"use strict";
// INK AI browser-only OCR adapter. No localhost, API, CDN or remote fetch.
// The optional engine is embedded in the checked-in index.html at build time.
(()=>{
 const outputWidth=1280;
 const canvas=document.createElement("canvas");
 const context=canvas.getContext("2d",{alpha:false});
 const px=box=>(box.x0+box.x1)/2;
 const py=box=>(box.y0+box.y1)/2;
 function proximity(a,b){
  if(!a||!b)return false;
  const w=Math.max(1,Math.max(a.x1-a.x0,b.x1-b.x0));
  const h=Math.max(1,Math.max(a.y1-a.y0,b.y1-b.y0));
  return Math.abs(px(a)-px(b))<=Math.max(35,w*.6)&&
    Math.abs(py(a)-py(b))<=Math.max(15,h*1.15);
 }
 function createTracker(){
  let regions=[];
  return {
   update(payload,now=Date.now()){
    const entries=(payload?.lines||[]).filter(line=>
     line?.box&&typeof line.text==="string"&&
     /[A-Za-z0-9]/.test(line.text)&&
     Array.isArray(line.words)&&line.words.length);
    const visited=new Set();
    for(const line of entries){
     const cleaned=line.text.replace(/\s+/g," ").trim();
     const key=cleaned.toLowerCase();
     let tracked=regions.find(t=>!visited.has(t)&&proximity(t.box,line.box));
     if(!tracked){
      tracked={box:line.box,text:"",key:"",words:[],
       lastSeen:0,confidence:0,votes:0};
      regions.push(tracked);
     }
     visited.add(tracked);
     if(key===tracked.key)tracked.votes=Math.min(8,tracked.votes+1);
     else{
      tracked.votes=1;
      // Do not display yesterday's text over a new label or document
      // while the new lower-confidence OCR read is being confirmed.
      if(tracked.key&&!key.startsWith(tracked.key)&&
         !tracked.key.startsWith(key)){
       tracked.text="";tracked.words=[];
      }
     }
     // Correct high-confidence recognition appears on its FIRST frame.
     // Uncertain text requires two consistent results to avoid hallucination.
     const confidence=Number(line.confidence)||0;
     if(confidence>=.72||tracked.votes>=2){
      tracked.text=cleaned;
      tracked.words=line.words.filter(w=>w.box&&
       typeof w.text==="string"&&Number(w.confidence)>=.25);
      tracked.confidence=confidence;
     }
     tracked.key=key;tracked.box=line.box;tracked.lastSeen=now;
    }
    regions=regions.filter(t=>now-t.lastSeen<=1600);
    const active=regions.filter(t=>t.text&&now-t.lastSeen<=1600);
    active.sort((a,b)=>{
     const ya=py(a.box),yb=py(b.box);
     if(Math.abs(ya-yb)>Math.max(12,(a.box.y1-a.box.y0)*.5))
      return ya-yb;
     return a.box.x0-b.box.x0;
    });
    return {text:active.map(x=>x.text).join("\n").slice(0,4000),
     words:active.flatMap(x=>x.words),
     sourceWidth:payload?.width,sourceHeight:payload?.height};
   },
   reset(){regions=[]}
  };
 }
 function paint(overlay,video,board,state){
  const ctx=overlay.getContext("2d");
  const w=board.clientWidth,h=board.clientHeight,dpr=window.devicePixelRatio||1;
  const cw=Math.max(1,Math.round(w*dpr)),ch=Math.max(1,Math.round(h*dpr));
  if(overlay.width!==cw||overlay.height!==ch){overlay.width=cw;overlay.height=ch}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  if(!video.videoWidth||!state?.sourceWidth||!state.words?.length)return;
  const fit=Math.min(w/video.videoWidth,h/video.videoHeight);
  const dx=(w-video.videoWidth*fit)/2,dy=(h-video.videoHeight*fit)/2;
  const sx=video.videoWidth/state.sourceWidth*fit;
  const sy=video.videoHeight/state.sourceHeight*fit;
  ctx.fillStyle="rgba(255,255,255,.28)";
  ctx.strokeStyle="rgba(255,255,255,.94)";
  ctx.lineWidth=1.3;
  for(const word of state.words){
   const b=word.box;
   const x=dx+b.x0*sx,y=dy+b.y0*sy;
   const width=(b.x1-b.x0)*sx,height=(b.y1-b.y0)*sy;
   if(width<=2||height<=3||x>w||y>h||x+width<0||y+height<0)continue;
   ctx.beginPath();
   if(ctx.roundRect)ctx.roundRect(x-2,y-1,width+4,height+2,3);
   else ctx.rect(x-2,y-1,width+4,height+2);
   ctx.fill();ctx.stroke();
  }
 }
 async function connect(){
  if(!window.InkOfflineOCR?.create)return null;
  const engine=await window.InkOfflineOCR.create();
  const tracker=createTracker();
  return {
   engine:"offline-tesseract-wasm",
   async recognize(video){
    const width=Math.min(outputWidth,video.videoWidth);
    const height=Math.max(1,Math.round(video.videoHeight*width/video.videoWidth));
    if(canvas.width!==width||canvas.height!==height){
     canvas.width=width;canvas.height=height;
    }
    context.drawImage(video,0,0,width,height);
    // No queue of old video frames: each call awaits one existing worker.
    return engine.recognize(canvas,width,height);
   },
   track:tracker.update,
   reset:tracker.reset,
   paint
  };
 }
 window.InkOfflineCamera={connect,createTracker,paint};
})();
