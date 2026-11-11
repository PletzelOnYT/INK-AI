"use strict";
// INK AI browser-only OCR adapter. No localhost, API, CDN or remote fetch.
// The optional engine is embedded in the checked-in index.html at build time.
(()=>{
 // Keep native 1080p detail when available: downsampling a room clock to
 // 1280px made its digits too small for the pretrained LSTM OCR.
 const outputWidth=1920;
 const regularWidth=1280;
 const canvas=document.createElement("canvas");
 const context=canvas.getContext("2d",{alpha:false});
 const Evidence=window.InkTextEvidence;
 const Layout=window.InkCameraLayout;
 const Handwriting=window.InkCameraHandwriting;
 function overlaps(a,b){
  if(!a||!b)return false;
  const w=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const h=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  // Score against the proposed handwritten word, not the smaller box:
  // a short incorrect Tesseract fragment must not hide a full handwritten line.
  const candidateArea=Math.max(1,(b.x1-b.x0)*(b.y1-b.y0));
  return w*h/candidateArea>.68;
 }
 function hasReliableText(payload){
  const words=payload?.words||[];
  const strong=words.filter(w=>Number(w.confidence)>=.68&&
   /^[A-Za-z][A-Za-z0-9'-]{2,}$/.test(String(w.text||"")));
  return strong.some(w=>w.text.length>=5)||
    strong.reduce((sum,w)=>sum+w.text.length,0)>=9;
 }

 // Tight, small printed glyph boxes can have >72% edge pixels even
 // when they contain genuine numbers. A broad relaxation would hallucinate
 // text on textured backgrounds, so this exception requires strong OCR
 // certainty, multiple independent ink bands, and either a full numeric
 // token or surrounding words in the very same Tesseract line.
 function compactPrintedEvidence(word,lineWords,metrics){
  const text=String(word?.text||"").trim(),b=word?.box;
  if(!b||!metrics)return false;
  const w=b.x1-b.x0,h=b.y1-b.y0,confidence=Number(word.confidence);
  if(!Number.isFinite(w+h)||w<8||h<5||h>24||w/h<1.12||
     !Number.isFinite(confidence)||confidence<.92||
     metrics.contrast<45||metrics.score<.84||
     metrics.edgeRate<.08||metrics.edgeRate>.86||
     metrics.verticalStrokeRate<.045)return false;
  const chars=text.replace(/[^A-Za-z0-9]/g,"").length;
  const wellGroupedNumeric=/^\d{4,10}$/.test(text)&&metrics.bands>=2;
  const supportedInLine=lineWords>=3&&chars>=3&&
   metrics.bands>=1;
  return wellGroupedNumeric||supportedInLine;
 }
 function checkedPayload(payload,width,height){
  if(!payload||!Array.isArray(payload.lines))return {
   width,height,lines:[],words:[],engine:"bundled-tesseract-wasm"};
  // In a real browser all OCR outputs must be supported by visible ink-like
  // edges, not only a language model's guess. Word boxes are evaluated
  // independently so a real label isn't hidden by a false adjacent token.
  if(!Evidence?.evidence||!context.getImageData)
   return {...payload,words:payload.lines.flatMap(line=>line.words||[])};
  const lines=[];
  let rejected=0,accepted=0;
  const diagnostic=[];
  const report=(w,reason,score=0,detail=null)=>{
   if(window.__inkDebugOCR===true&&diagnostic.length<32)
    diagnostic.push({text:w.text,confidence:w.confidence,reason,score,
     contrast:detail?.contrast,edgeRate:detail?.edgeRate,
     verticalStrokeRate:detail?.verticalStrokeRate,bands:detail?.bands});
  };
  for(const line of payload.lines){
   if(!Array.isArray(line?.words)||!line.words.length)continue;
   const supported=[];
   for(const word of line.words){
    if(!Evidence.plausibleWord(word,line.words.length,width,height)){
     rejected++;report(word,"geometry");continue;
    }
    const confidence=Number(word.confidence);
    if(!Number.isFinite(confidence)||confidence<.32){rejected++;report(word,"confidence");continue}
    const metrics=Evidence.evidence(context,word.box,width,height,word.points);
    if((!metrics.ok&&!compactPrintedEvidence(word,line.words.length,metrics))||metrics.score<.43){
     rejected++;report(word,metrics.reason,metrics.score,metrics);continue
    }
    supported.push({...word,visualQuality:metrics.score});
    accepted++;
   }
   if(!supported.length)continue;
   const text=Layout?.formatWords?Layout.formatWords(supported):supported.map(word=>word.text).join(" ").trim();
   const quality=supported.reduce((sum,w)=>sum+w.visualQuality,0)/supported.length;
   const measuredConfidence=supported.reduce((sum,w)=>sum+w.confidence,0)/supported.length;
   // A low-confidence word can still be read on the second camera frame,
   // but won't appear instantly merely because it looks like a common word.
   const confidence=Math.min(Number(line.confidence)||0,
    Math.min(1,measuredConfidence+.16));
   lines.push({...line,text,words:supported,visualQuality:quality,confidence});
  }
  window.__inkCameraEvidence={accepted,rejected};
  if(window.__inkDebugOCR===true)window.__inkCameraRejectedWords=diagnostic;
  return {...payload,lines,words:lines.flatMap(line=>line.words)};
 }
 const px=box=>(box.x0+box.x1)/2;
 const py=box=>(box.y0+box.y1)/2;
 function proximity(a,b){
  if(!a||!b)return false;
  const ha=Math.max(1,a.y1-a.y0),hb=Math.max(1,b.y1-b.y0);
  // Adjacent lines are not the same line, even if x centers overlap.
  const verticalOverlap=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  if(verticalOverlap/Math.min(ha,hb)<.28)return false;
  const w=Math.max(1,Math.max(a.x1-a.x0,b.x1-b.x0));
  return Math.abs(px(a)-px(b))<=Math.max(34,w*.64);
 }
 const normalized=value=>String(value||"").toLowerCase()
  .replace(/[^a-z0-9]+/g," ").trim();
 function relatedText(a,b){
  const aa=normalized(a),bb=normalized(b);
  if(!aa||!bb)return false;
  if(aa===bb||aa.includes(bb)||bb.includes(aa))return true;
  const aset=new Set(aa.split(" "));
  return bb.split(" ").some(token=>token.length>=3&&aset.has(token));
 }
 function moveBox(box,dx,dy){
  return {x0:box.x0+dx,y0:box.y0+dy,x1:box.x1+dx,y1:box.y1+dy};
 }
 function createTracker(){
  let regions=[];
  function snapshot(width,height,now){
   regions=regions.filter(t=>now-t.lastSeen<=6500);
   const present=regions.filter(t=>t.text&&now-t.lastSeen<=6500);
   // OCR crops can recognize both an old short fragment and its longer
   // replacement. Display the more complete reading, never duplicate boxes.
   const active=present.filter(t=>!present.some(other=>
    other!==t&&proximity(other.box,t.box)&&
    relatedText(other.text,t.text)&&
    other.text.length>t.text.length&&
    other.lastSeen>=t.lastSeen-2100));
   active.sort((a,b)=>{
    const dy=py(a.box)-py(b.box);
    if(Math.abs(dy)>Math.max(11,(a.box.y1-a.box.y0)*.45))return dy;
    return a.box.x0-b.box.x0;
   });
   const transcript=Layout?.formatDocument?Layout.formatDocument(active):
    active.map(t=>t.text).join("\n");
   return {text:transcript.slice(0,6000),
    words:active.flatMap(t=>t.words),
    sourceWidth:width,sourceHeight:height};
  }
  return {
   update(payload,now=Date.now()){
    const entries=(payload?.lines||[]).filter(line=>
      line?.box&&typeof line.text==="string"&&
      /[A-Za-z0-9]/.test(line.text)&&
      Array.isArray(line.words)&&line.words.length);
    const visited=new Set();
    for(const line of entries){
     const cleaned=Layout?.lineText?
      Layout.lineText(line):line.text.replace(/\s+/g," ").trim();
     const key=normalized(cleaned);
     if(!key)continue;
     let tracked=regions.find(t=>!visited.has(t)&&
       proximity(t.box,line.box)&&relatedText(t.text||t.candidate||t.key,cleaned));
     if(!tracked){
      tracked={box:line.box,text:"",key:"",words:[],candidate:"",votes:0,
       lastSeen:0,confidence:0,lastCandidate:0};
      regions.push(tracked);
     }
     visited.add(tracked);
     const confidence=Number(line.confidence)||0;
     const quality=Number(line.visualQuality);
     const hasPixels=Number.isFinite(quality);
     const chars=cleaned.replace(/[^\p{L}\p{N}]/gu,"").length;
     const enoughInk=!hasPixels||quality>=.43;
     const instant=confidence>=.82&&enoughInk&&
      (line.words.length>=2||chars>=4)&&
      (!hasPixels||quality>=.72);
     // Tilted single words often have mediocre aggregate LINE confidence
     // even when the model verified every character with visible ink.
     // Avoid discarding them merely because a second OCR pass changes
     // its rotation box. Keep single digits and short guesses conservative.
     const strongestWord=line.words.reduce((n,w)=>Math.max(n,
      Number(w.confidence)||0),0);
     const trustedLongWord=line.words.length===1&&chars>=7&&
      strongestWord>=.72&&confidence>=.53&&
      hasPixels&&quality>=.88;
     const same=key===tracked.key;
     const compatible=relatedText(tracked.text,cleaned);
     if(key===tracked.candidate)tracked.votes=Math.min(8,tracked.votes+1);
     else{tracked.candidate=key;tracked.votes=1}
     const verified=tracked.votes>=2&&confidence>=.43&&enoughInk;
     const accepted=(instant||trustedLongWord||verified||
      (!hasPixels&&confidence>=.88));
     if(accepted){
      // Partial OCR on a later pass must not destroy a fuller earlier line
      // (e.g., "Open House" -> "House" -> "Open House").
      const incomingChars=key.replace(/ /g,"").length;
      const oldChars=tracked.key.replace(/ /g,"").length;
      const keepFull=compatible&&tracked.text&&
       (incomingChars<oldChars||
        (!same&&incomingChars<=oldChars&&tracked.votes<2))&&
       now-tracked.lastSeen<6500;
      if(keepFull){
       // If at least one identical word moved, translate the retained
       // whole phrase to the new location rather than flashing its boxes.
       const common=tracked.words.find(old=>line.words.some(current=>
        normalized(old.text)===normalized(current.text)&&normalized(old.text)));
       const fresh=common&&line.words.find(word=>
        normalized(word.text)===normalized(common.text));
       if(common&&fresh){
        const dx=px(fresh.box)-px(common.box);
        const dy=py(fresh.box)-py(common.box);
        tracked.box=moveBox(tracked.box,dx,dy);
        tracked.words=tracked.words.map(w=>({...w,
         box:moveBox(w.box,dx,dy),
         ...(Array.isArray(w.points)?{
          points:w.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:{})}));
       }
      }else{
       tracked.text=cleaned;
       tracked.key=key;
       tracked.box=line.box;
       tracked.words=line.words.filter(w=>w.box&&
        typeof w.text==="string"&&Number(w.confidence)>=.25);
       tracked.confidence=confidence;
       tracked.blockIndex=line.blockIndex;
       tracked.paragraphIndex=line.paragraphIndex;
       tracked.lineIndex=line.lineIndex;
      }
      tracked.lastSeen=now;
     }else if(compatible&&tracked.text){
      // An uncertain partial read confirms the same physical line is still
      // visible; do not erase or reset confidence on this single frame.
      tracked.lastSeen=now;
     }
    }
    return snapshot(payload?.width,payload?.height,now);
   },
   snapshot(now=Date.now(),width=0,height=0){
    return snapshot(width,height,now);
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
   const points=word.points;
   if(Array.isArray(points)&&points.length===4){
    ctx.moveTo(dx+points[0].x*sx,dy+points[0].y*sy);
    for(let k=1;k<4;k++)
     ctx.lineTo(dx+points[k].x*sx,dy+points[k].y*sy);
    ctx.closePath();
   }else if(ctx.roundRect)ctx.roundRect(x-2,y-1,width+4,height+2,3);
   else ctx.rect(x-2,y-1,width+4,height+2);
   ctx.fill();ctx.stroke();
  }
 }
 async function connect(){
  if(!window.InkOfflineOCR?.create)return null;
  const engine=await window.InkOfflineOCR.create();
  const tracker=createTracker();
  let scan=0,handAttempts=0,handAccepted=0;
  const nativeZones=["center","lower-right","lower-left","upper-right","upper-left"];
  function transformRegion(item,offsetX,offsetY,scaleX,scaleY){
   const project=point=>({x:offsetX+point.x*scaleX,
    y:offsetY+point.y*scaleY});
   const box=item.box?{x0:offsetX+item.box.x0*scaleX,
    y0:offsetY+item.box.y0*scaleY,
    x1:offsetX+item.box.x1*scaleX,
    y1:offsetY+item.box.y1*scaleY}:undefined;
   const points=Array.isArray(item.points)?
    item.points.map(project):undefined;
   return {...item,...(box?{box}:{}),
    ...(points?{points}:{}),
    ...(item.words?{words:item.words.map(w=>
     transformRegion(w,offsetX,offsetY,scaleX,scaleY))}:{})};
  }
  return {
   engine:"offline-tesseract-wasm",
   async recognize(video){
    ++scan;
    const nativeW=video.videoWidth,nativeH=video.videoHeight;
    if(!nativeW||!nativeH)throw Error("Camera video has no frame dimensions");
    // Every third pass covers the entire camera view for quick new-text
    // discovery; intervening passes see native pixels from overlapping
    // ~65% focus regions. This preserves distant glyph pixels without
    // running full-frame 1920px Tesseract on every webcam frame.
    const nativeFocus=nativeW>=1500&&scan%3!==1;
    const zone=nativeZones[(Math.floor((scan-2)/3)*2+
      (scan%3===0?1:0)+nativeZones.length*10)%nativeZones.length];
    const frac=nativeFocus?.66:1;
    const sw=Math.round(nativeW*frac),sh=Math.round(nativeH*frac);
    const ox=!nativeFocus?0:zone==="center"?
     Math.round((nativeW-sw)/2):zone.endsWith("right")?nativeW-sw:0;
    const oy=!nativeFocus?0:zone==="center"?
     Math.round((nativeH-sh)/2):zone.startsWith("lower")?nativeH-sh:0;
    const width=Math.max(1,Math.min(regularWidth,sw));
    const height=Math.max(1,Math.round(sh*width/sw));
    if(canvas.width!==width||canvas.height!==height){
     canvas.width=width;canvas.height=height;
    }
    context.drawImage(video,ox,oy,sw,sh,0,0,width,height);
    const result=await engine.recognize(canvas,width,height,
     nativeFocus?{fastRegion:true,documentMode:scan%4===0,
      layoutRescue:zone==="center",clockProbe:zone==="center"}:
      // Below 1500px there is no spare native detail for a fast ROI.
      // Preserve the proven perspective and page-layout recovery there.
      {skipOptionalDetail:nativeW>=1500&&scan%12!==7});
    let accepted=checkedPayload(result,width,height);
    // Primary path remains the bundled Tesseract LSTM, which handles
    // printed and joined text better. On weak/partial reads, also run the
    // handwriting-trained CNN on segmented ink; occasionally check mixed
    // printed and handwritten pages without slowing every frame.
    const reliable=hasReliableText(accepted);
    const tryHandwriting=!nativeFocus&&Handwriting?.recognize&&
     window.__inkHandwritingReady===true&&
     ((!reliable&&(scan===2||scan%6===4))||
      (reliable&&scan%12===4));
    if(tryHandwriting){
     const started=performance.now();
     handAttempts++;
     try{
      const supplement=await Handwriting.recognize(canvas,width,height);
      const extra=(supplement.lines||[]).map(line=>{
       // Retain non-overlapping handwritten words even when a printed label
       // or an incorrect Tesseract fragment sits on the same physical row.
       const words=line.words.filter(word=>
        !accepted.words.some(existing=>overlaps(existing.box,word.box)));
       if(!words.length)return null;
       const box={x0:Math.min(...words.map(w=>w.box.x0)),
        y0:Math.min(...words.map(w=>w.box.y0)),
        x1:Math.max(...words.map(w=>w.box.x1)),
        y1:Math.max(...words.map(w=>w.box.y1))};
       return {...line,words,box,text:words.map(w=>w.text).join(" ")};
      }).filter(Boolean);
      if(extra.length){
       const combined=checkedPayload({...result,
        lines:[...accepted.lines,...extra]},width,height);
       handAccepted+=combined.words.filter(w=>
        w.recognitionEngine==="ink-handwriting-cnn").length;
       accepted=combined;
      }
      window.__inkCameraHandwritingStats={
       attempts:handAttempts,acceptedWords:handAccepted,
       candidateLines:supplement.lines?.length||0,
       segmentedGlyphs:supplement.glyphs||0,
       lastMs:Math.round(performance.now()-started),
       engine:"ink-handwriting-cnn",modelReady:true};
     }catch(error){
      window.__inkCameraHandwritingStats={
       attempts:handAttempts,acceptedWords:handAccepted,
       error:String(error?.message||error),modelReady:true};
     }
    }
    // Use one stable native coordinate system for the transcript and
    // highlights, even when the OCR input alternates full-frame and crops.
    // Do not reset the tracker when its source sampling resolution changes.
    const nativeLines=accepted.lines.map(line=>
     transformRegion(line,ox,oy,sw/width,sh/height));
    accepted={...accepted,width:nativeW,height:nativeH,
     lines:nativeLines,words:nativeLines.flatMap(line=>line.words||[]),
     elapsedMs:result.elapsedMs};
    window.__inkCameraDetailRecovery={
     used:nativeFocus||!!result.detailUpscaled,
     enhancement:nativeFocus?"native-focus-"+zone:result.enhancement||null,
     captureWidth:width,captureHeight:height,
     sourceWidth:nativeW,sourceHeight:nativeH,
     nativeFocus,zone:nativeFocus?zone:null,highResolution:nativeFocus
    };
    return accepted;
   },
   track:tracker.update,
   reset(){tracker.reset();scan=0;handAttempts=0;handAccepted=0},
   clearTranscript(){tracker.reset()},
   paint
  };
 }
 window.InkOfflineCamera={connect,createTracker,paint,checkedPayload};
})();
