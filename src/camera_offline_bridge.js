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
     const cleaned=Layout?.lineText?Layout.lineText(line):line.text.replace(/\s+/g," ").trim();
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
     // A genuine high-confidence printed phrase should appear on the
     // first read. A suspicious single-word result over a wall/shoulder
     // must repeat at the same position in a new frame before display.
     const confidence=Number(line.confidence)||0;
     const quality=Number(line.visualQuality);
     const hasPixels=Number.isFinite(quality);
     const chars=cleaned.replace(/[^\p{L}\p{N}]/gu,"").length;
     const multiWord=line.words.length>=2;
     const strongVisual=hasPixels&&quality>=.79;
     const instant=confidence>=.84&&strongVisual&&
       (multiWord||(chars>=5&&quality>=.87));
     const verified=tracked.votes>=2&&confidence>=.48&&
       (!hasPixels||quality>=.43);
     if(instant||verified||(!hasPixels&&confidence>=.88)){
      tracked.text=cleaned;
      tracked.words=line.words.filter(w=>w.box&&
       typeof w.text==="string"&&Number(w.confidence)>=.25);
      tracked.confidence=confidence;
      tracked.blockIndex=line.blockIndex;
      tracked.paragraphIndex=line.paragraphIndex;
      tracked.lineIndex=line.lineIndex;
     }
     tracked.key=key;tracked.box=line.box;tracked.lastSeen=now;
    }
    // Slow neural OCR passes should not erase an otherwise static document
    // between updates; tracked boxes have a bounded 2.8s TTL.
    regions=regions.filter(t=>now-t.lastSeen<=2800);
    const active=regions.filter(t=>t.text&&now-t.lastSeen<=2800);
    active.sort((a,b)=>{
     const ya=py(a.box),yb=py(b.box);
     if(Math.abs(ya-yb)>Math.max(12,(a.box.y1-a.box.y0)*.5))
      return ya-yb;
     return a.box.x0-b.box.x0;
    });
    const transcript=Layout?.formatDocument?Layout.formatDocument(active):
     active.map(x=>x.text).join("\n");
    return {text:transcript.slice(0,6000),
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
  const nativeZones=["lower-right","lower-left","upper-right","upper-left"];
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
    const ox=nativeFocus&&zone.endsWith("right")?nativeW-sw:0;
    const oy=nativeFocus&&zone.startsWith("lower")?nativeH-sh:0;
    const width=Math.max(1,Math.min(regularWidth,sw));
    const height=Math.max(1,Math.round(sh*width/sw));
    if(canvas.width!==width||canvas.height!==height){
     canvas.width=width;canvas.height=height;
    }
    context.drawImage(video,ox,oy,sw,sh,0,0,width,height);
    const result=await engine.recognize(canvas,width,height,
     nativeFocus?{fastRegion:true,documentMode:scan%4===0}:
      {skipOptionalDetail:scan%12!==7});
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
