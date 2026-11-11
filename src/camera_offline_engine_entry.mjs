// This module is compiled by GitHub Actions into one self-contained JS IIFE.
// Tesseract.js and its English model are bundled; ZERO runtime network calls.
// Tesseract.js and Tesseract are open-source third-party OCR engines (Apache-2.0).
// INK AI's handwriting recognizer and completer remain first-party systems.
import tesseract from "tesseract.js";
import {estimateTextAngle,rotatedSize,unrotateLines,rotationQueue} from "./camera_orientation_core.mjs";
import {centerDetailCrop,detailSize,remapDetailLines,enhanceInkRGBA,isCompactNumericRead,perspectiveQuad,rectifyPerspectiveRGBA,findDarkDisplayRGBA} from "./camera_detail_core.mjs";
import englishList from "../data/english-words.txt";
const vocabulary=new Set(englishList.trim().split(/\s+/));
import {set} from "idb-keyval";
import {simd} from "wasm-feature-detect";
import workerCode from "../.ocr-build/worker.bin";
import baselineCore from "../.ocr-build/core.bin";
import simdCore from "../.ocr-build/core-simd.bin";
import engData from "../.ocr-build/eng.bin";

const CACHE="ink-offline-v1";
let singleton=null,creation=null;
const urls=[];
function blobURL(bytes){
 const url=URL.createObjectURL(new Blob([bytes],{type:"text/javascript"}));
 urls.push(url);
 return url;
}
function extractWords(data){
 const blocks=data?.blocks||[];
 const lines=[];
 for(const [blockIndex,block] of blocks.entries()){
  for(const [paragraphIndex,paragraph] of (block.paragraphs||[]).entries()){
   for(const [lineIndex,line] of (paragraph.lines||[]).entries()){
    const words=(line.words||[])
      .filter(word=>word&&word.bbox&&typeof word.text==="string"&&
        /[A-Za-z0-9]/.test(word.text)&&Number(word.confidence)>=25)
      .map(word=>({
       text:word.text.trim(),
       confidence:Math.min(1,Math.max(0,Number(word.confidence)/100)),
       box:{
        x0:Number(word.bbox.x0),y0:Number(word.bbox.y0),
        x1:Number(word.bbox.x1),y1:Number(word.bbox.y1)
       }
      }));
    if(!words.length)continue;
    const bounds=line.bbox||{
     x0:Math.min(...words.map(w=>w.box.x0)),
     y0:Math.min(...words.map(w=>w.box.y0)),
     x1:Math.max(...words.map(w=>w.box.x1)),
     y1:Math.max(...words.map(w=>w.box.y1))
    };
    const text=words.map(w=>w.text).join(" ").trim();
    lines.push({
     text,blockIndex,paragraphIndex,lineIndex,
     confidence:Math.max(0,Math.min(1,Number(line.confidence||60)/100)),
     box:{x0:Number(bounds.x0),y0:Number(bounds.y0),
       x1:Number(bounds.x1),y1:Number(bounds.y1)},
     words
    });
   }
  }
 }
 return lines;
}
// Map OCR bounding boxes back to the original camera image after
// Tesseract automatically straightens a tilted printed line.
function restoreRotation(lines,angle,width,height){
 if(!Number.isFinite(angle)||Math.abs(angle)<.005)return lines;
 const c=Math.cos(-angle),q=Math.sin(-angle),cx=width/2,cy=height/2;
 const transform=(box)=>{
  const points=[
   [box.x0,box.y0],[box.x1,box.y0],[box.x1,box.y1],[box.x0,box.y1]
  ].map(([x,y])=>({
   x:cx+c*(x-cx)-q*(y-cy),
   y:cy+q*(x-cx)+c*(y-cy)
  }));
  return {points,box:{
   x0:Math.min(...points.map(p=>p.x)),
   y0:Math.min(...points.map(p=>p.y)),
   x1:Math.max(...points.map(p=>p.x)),
   y1:Math.max(...points.map(p=>p.y))
  }};
 };
 return lines.map(line=>{
  const lineRect=transform(line.box);
  return {...line,box:lineRect.box,points:lineRect.points,
   words:line.words.map(word=>{
    const p=transform(word.box);
    return {...word,box:p.box,points:p.points};
   })};
 });
}
// Correctly map 90°/180° OCR results back to the unrotated webcam. The
// standard camera path is never rotated unless ordinary OCR finds no text.
function strongPrintedRead(lines){
 return lines.some(line=>(line.words||[]).some(word=>
  (Number(word.confidence)||0)>=.68&&
  String(word.text||"").replace(/[^A-Za-z0-9]/g,"").length>=4));
}
function restoreRightAngle(lines,degrees,w,h){
 const back=(x,y)=>degrees===90?{x:y,y:h-x}:
  degrees===-90?{x:w-y,y:x}:{x:w-x,y:h-y};
 function corners(box){
  const points=[
   back(box.x0,box.y0),back(box.x1,box.y0),
   back(box.x1,box.y1),back(box.x0,box.y1)
  ];
  return {points,box:{
   x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),
   y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))
  }};
 }
 return lines.map(line=>{
  const projected=corners(line.box);
  return {...line,box:projected.box,points:projected.points,
   words:line.words.map(word=>{
    const wbox=corners(word.box);
    return {...word,box:wbox.box,points:wbox.points};
   })};
 });
}
async function create(){
 if(singleton)return singleton;
 if(creation)return creation;
 creation=(async()=>{
  // Tesseract worker uses the same IndexedDB key/value store as idb-keyval.
  // If this fails, do NOT silently fetch traineddata from the internet.
  await set(CACHE+"/eng.traineddata",engData);
  // Chrome opens file:// pages with an opaque origin. A Worker created as
  // blob:null may run, but a SECOND importScripts(blob:null) for the WASM
  // core fails. Preload the selected Emscripten core inside the same classic
  // Worker script, so Tesseract's getCore sees global.TesseractCore already.
  const selectedCore=(await simd())?simdCore:baselineCore;
  const workerPath=blobURL(new Blob([selectedCore,"\n;",workerCode],
    {type:"text/javascript"}));
  // The core has already been installed in the worker's global scope.
  // This path is not accessed, but prevents a default CDN fallback.
  const corePath="data:text/javascript,void%200#core.js";
  let worker=null;
  try{
   worker=await tesseract.createWorker("eng",1,{
    workerPath,corePath,workerBlobURL:false,
    cachePath:CACHE,cacheMethod:"readOnly",
    langPath:"offline://disabled",gzip:false,
    logger:()=>{}
   });
   await worker.setParameters({
    tessedit_pageseg_mode:String(tesseract.PSM.SPARSE_TEXT),
    preserve_interword_spaces:"1"
   });
   const sideCanvas=document.createElement("canvas");
   const sideContext=sideCanvas.getContext("2d",{alpha:false});
   const probeCanvas=document.createElement("canvas");
   probeCanvas.width=260;probeCanvas.height=146;
   const detailCanvas=document.createElement("canvas");
   const detailContext=detailCanvas.getContext("2d",{willReadFrequently:true,alpha:false});
   const displayPreview=document.createElement("canvas");
   displayPreview.width=160;displayPreview.height=90;
   const displayContext=displayPreview.getContext("2d",{willReadFrequently:true});
   const probeContext=probeCanvas.getContext("2d",{willReadFrequently:true});
   let previousAngle=null,previousStreak=0,attemptCursor=0,scanNumber=0;
   function candidateStrength(lines){
    let total=0,meaningful=0,best=0;
    for(const line of lines){
     for(const word of line.words||[]){
      const chars=String(word.text||"").replace(/[^A-Za-z0-9]/g,"").length;
      if(!chars)continue;
      const certainty=Math.max(0,Math.min(1,Number(word.confidence)||0));
      // Short random OCR fragments must not block an actually rotated word.
      if(chars>=3&&certainty>=.56)meaningful++;
      const numeric=/^\d{1,2}(?::\d{2})?$/.test(String(word.text||"").trim())&&
        certainty>=.78;
      if(numeric)meaningful++;
      // Prefer intact words over several implausible fragments, while
      // still accepting new brand names not included in the dictionary.
      const token=String(word.text||"").replace(/[^A-Za-z0-9]/g,"");
      const inVocabulary=token.length>=4&&
        vocabulary.has(token.toLowerCase());
      const brokenCase=/^[A-Z]{2,}[a-z]{2,}$/.test(token);
      const value=Math.min(18,chars)*certainty*
           (chars>=4?1.06:chars>=3?.67:.25)+
           (inVocabulary?2.7*certainty:0)-
           (brokenCase?1.0:0);
      const measured=value+(numeric?5.6:0);
      total+=measured;best=Math.max(best,measured);
     }
    }
    return {value:total,meaningful,best};
   }
   function clearRead(lines){
    const strength=candidateStrength(lines);
    return (strength.value>=6.8&&strength.meaningful>=1&&
      (strength.best>=5.3||strength.meaningful>=2)) ||
      (isCompactNumericRead(lines)&&strength.value>=4.7);
   }
   function looksUpsideDown(lines){
    // Mixed-case, mid-token capitals and inserted digits are often
    // upside-down OCR artifacts. Challenge their orientation, but keep the
    // original read if no verified improvement is found.
    return lines.some(line=>(line.words||[]).some(word=>{
     const token=String(word.text||"").replace(/[^A-Za-z0-9]/g,"");
     return token.length>=6&&(/[a-z][A-Z]/.test(token)||
       /[A-Z][a-z][A-Z]/.test(token)||/[A-Za-z][0-9][A-Za-z]/.test(token));
    }));
   }
   function direction(image,width,height){
    // Only 260x170 pixels are read back; no full webcam bitmap is copied.
    // Preserve the camera aspect ratio. Resizing 16:9 frames to a fixed
    // 260x170 warped slopes and made 30° text look like 35° text.
    const probeH=Math.max(48,Math.round(260*height/width));
    if(probeCanvas.height!==probeH)probeCanvas.height=probeH;
    probeContext.fillStyle="#fff";
    probeContext.fillRect(0,0,260,probeH);
    probeContext.drawImage(image,0,0,260,probeH);
    const rgba=probeContext.getImageData(0,0,260,probeH).data;
    return estimateTextAngle(rgba,260,probeH);
   }
   function backgroundColor(image,width,height){
    // Avoid introducing a false white diagonal when dark labels rotate
    // into a larger canvas. Sample the scene's actual border colors.
    try{
     const ctx=image.getContext?.("2d");
     if(ctx){
      const corners=[[1,1],[width-2,1],[1,height-2],[width-2,height-2]];
      const colors=corners.map(([x,y])=>{
       const p=ctx.getImageData(Math.max(0,x),Math.max(0,y),1,1).data;
       return [p[0],p[1],p[2]];
      });
      const values=[0,1,2].map(channel=>{
       const sorted=colors.map(color=>color[channel]).sort((a,b)=>a-b);
       return Math.round((sorted[1]+sorted[2])/2);
      });
      return "rgb("+values.join(",")+")";
     }
    }catch(_){}
    return "#ffffff";
   }
   async function tiltedRead(image,width,height,angle){
    const size=rotatedSize(angle,width,height);
    sideCanvas.width=size.width;sideCanvas.height=size.height;
    const background=backgroundColor(image,width,height);
    sideContext.fillStyle=background;
    sideContext.fillRect(0,0,size.width,size.height);
    sideContext.save();
    sideContext.translate(size.width/2,size.height/2);
    sideContext.rotate(angle*Math.PI/180);
    sideContext.drawImage(image,-width/2,-height/2,width,height);
    sideContext.restore();
    // On dark signs, feed the OCR recognizer black letters on light paper
    // after deskewing. It is the SAME pixels (no fake text), only inverted.
    // This avoids Tesseract interpreting a bright sign as a negative photo.
    const rgb=background.match(/\d+/g)?.map(Number)||[255,255,255];
    const luminance=.299*rgb[0]+.587*rgb[1]+.114*rgb[2];
    if(luminance<110){
     sideContext.globalCompositeOperation="difference";
     sideContext.fillStyle="#ffffff";
     sideContext.fillRect(0,0,size.width,size.height);
     sideContext.globalCompositeOperation="source-over";
    }
    const scan=await worker.recognize(sideCanvas,{}, {blocks:true});
    const lines=extractWords(scan.data);
    return {lines:unrotateLines(lines,angle,width,height,
       size.width,size.height),rotation:angle,
       rawLines:lines};
   }
   // Recovery for small distant signs and low-contrast colored/pencil ink.
   // Crops only the CENTER of the camera view and maps all OCR geometry back.
   // It never creates artificial letter shapes or sends frames over the network.
   async function detailRead(image,width,height,mode="center-detail"){
    let crop=centerDetailCrop(width,height);
    let darkDisplay=false;
    if(mode==="center-detail"){
     displayContext.drawImage(image,0,0,160,90);
     const sample=displayContext.getImageData(0,0,160,90).data;
     const region=findDarkDisplayRGBA(sample,160,90);
     if(region){
      crop={x:Math.round(region.x*width/160),y:Math.round(region.y*height/90),
       width:Math.round(region.width*width/160),
       height:Math.round(region.height*height/90)};
      darkDisplay=true;
     }
    }
    const output=detailSize(crop.width*1.7,crop.height*1.7,1920);
    detailCanvas.width=output.width;detailCanvas.height=output.height;
    detailContext.fillStyle="#fff";
    detailContext.fillRect(0,0,output.width,output.height);
    detailContext.imageSmoothingEnabled=true;
    detailContext.imageSmoothingQuality="high";
    detailContext.drawImage(image,crop.x,crop.y,crop.width,crop.height,
      0,0,output.width,output.height);
    if(darkDisplay){
     // White digits on a dark display become dark ink on light paper.
     detailContext.globalCompositeOperation="difference";
     detailContext.fillStyle="#ffffff";
     detailContext.fillRect(0,0,output.width,output.height);
     detailContext.globalCompositeOperation="source-over";
    }
    let quad=null;
    if(mode==="rgb"){
     const original=detailContext.getImageData(0,0,output.width,output.height);
     const processed=enhanceInkRGBA(original.data,output.width,output.height);
     if(processed.hasDetail){
      original.data.set(processed.data);
      detailContext.putImageData(original,0,0);
     }
    }else if(mode.startsWith("yaw")||mode.startsWith("pitch")){
     // Automatically trial bounded trapezoid hypotheses on hard reads.
     // Map any returned word boxes through the SAME projective transform.
     const axis=mode.startsWith("yaw")?"yaw":"pitch";
     quad=perspectiveQuad(output.width,output.height,axis,
       mode.endsWith("+")?1:-1);
     const bitmap=detailContext.getImageData(0,0,output.width,output.height);
     bitmap.data.set(rectifyPerspectiveRGBA(bitmap.data,output.width,
       output.height,quad));
     detailContext.putImageData(bitmap,0,0);
    }
    if(darkDisplay)await worker.setParameters({
      tessedit_pageseg_mode:String(tesseract.PSM.SINGLE_LINE)});
    let scan;
    try{
     scan=await worker.recognize(detailCanvas,{}, {blocks:true});
    }finally{
     if(darkDisplay)await worker.setParameters({
       tessedit_pageseg_mode:String(tesseract.PSM.SPARSE_TEXT)});
    }
    const lines=remapDetailLines(extractWords(scan.data),crop,
      output.width,output.height,quad);
    return {lines,rotation:0,detailUpscaled:true,
      enhancement:darkDisplay?"clock-display":mode};
   }
   const engine={
    kind:"bundled-tesseract-wasm",
    async recognize(image,width,height){
     const now=performance.now();
     scanNumber++;
     let candidate=null;
     let attempts=0;
     let hint=null;
     let deskewed=false;
     const query=async angle=>{
      attempts++;
      return tiltedRead(image,width,height,angle);
     };
     // For stable sideways text, reuse its accepted orientation first
     // instead of doing two complete Tesseract passes on every new frame.
     if(previousAngle!==null&&previousStreak>=2&&
        scanNumber%8!==0){
      const scan=await query(previousAngle);
      if(clearRead(scan.lines)){
       return {engine:engine.kind,width,height,deskewed:false,
        quarterTurn:previousAngle,rotationDegrees:previousAngle,
        attempts,angleSource:"tracked",
        elapsedMs:Math.round(performance.now()-now),
        lines:scan.lines,words:scan.lines.flatMap(x=>x.words),
        text:scan.lines.map(x=>x.text).join("\n")};
      }
      previousStreak=0;
      previousAngle=null;
     }
     let {data}=await worker.recognize(image,{}, {blocks:true});
     let lines=extractWords(data);
     let strongest=candidateStrength(lines);
     candidate={lines,rotation:0,source:"upright",value:strongest.value};
     // The image projection measures an angle without making assumptions
     // about individual letters or language-model guesses.
     const suspicious=looksUpsideDown(lines);
     const needsChallenge=!clearRead(lines)||scanNumber%7===0||suspicious;
     if(needsChallenge){
      try{hint=direction(image,width,height)}catch(_){}
     }
     const skewHint=hint?.angle!==null&&Number.isFinite(hint?.angle)&&
       hint.confidence>=.24&&Math.abs(hint.angle)>=7;
     // A horizontal, high-confidence read is the fast path. A strong
     // projection indicating tilted text can challenge a suspicious OCR.
     if(clearRead(lines)&&!suspicious&&
        !(skewHint&&Math.abs(hint.angle)>=16)){
      previousAngle=null;previousStreak=0;attemptCursor=0;
      return {engine:engine.kind,width,height,deskewed:false,
       quarterTurn:0,rotationDegrees:0,attempts:0,angleSource:"upright",
       elapsedMs:Math.round(performance.now()-now),
       lines,words:lines.flatMap(x=>x.words),
       text:lines.map(x=>x.text).join("\n")};
     }
     const consider=(next,source)=>{
      const strength=candidateStrength(next.lines);
      const requiredGain=(candidate.rotation===0&&
        clearRead(candidate.lines))?(looksUpsideDown(candidate.lines)?0.8:4.5):1.6;
      if(strength.value>candidate.value+requiredGain&&
         strength.meaningful>=1&&clearRead(next.lines)){
       candidate={...next,value:strength.value,source};
       return true;
      }
      return false;
     };
     // Alternate magnified and locally color-normalized center crops
     // while normal video recognition remains the fast path. This is useful
     // when a small clock/sign occupies only a fraction of a distant scene.
     if(!clearRead(candidate.lines)&&scanNumber%2===0){
      try{
       const modes=["center-detail","rgb","yaw+","yaw-","pitch+","pitch-"];
       const detail=await detailRead(image,width,height,
         modes[(Math.floor(scanNumber/2)-1)%modes.length]);
       consider(detail,"center-detail");
      }catch(_){/* Preserve ordinary/rotation OCR on unsupported canvases */}
     }
     // First let Tesseract try its own deskew on failed ordinary reads.
     if(!clearRead(candidate.lines)&&scanNumber%3===0){
      const auto=await worker.recognize(image,{rotateAuto:true},{blocks:true});
      const rotatedLines=extractWords(auto.data);
      if(clearRead(rotatedLines)){
       const rad=Number(auto.data.rotateRadians)||0;
       const projected=restoreRotation(rotatedLines,rad,width,height);
       consider({lines:projected,rotation:rad*180/Math.PI},"tesseract-deskew");
       deskewed=candidate.source==="tesseract-deskew";
      }
     }
     // Projection-estimated rotations first; if the image has too much
     // clutter to identify a dominant line, use an exhaustive rotation
     // ladder spread over a few scans without stalling the live video.
     const steep=Number.isFinite(hint?.angle)&&Math.abs(hint.angle)>=34;
     const queue=rotationQueue(steep?hint.angle:
       skewHint?hint.angle:null,previousAngle);
     const goodAngle=(steep||skewHint)?Math.round(-hint.angle/5)*5:null;
     // Rotate stronger perspectives through both signs. Blank rooms only
     // receive a single trial per frame to preserve webcam responsiveness.
     const options=suspicious&&!steep?[180]:
       goodAngle!==null?queue.slice(0,3):
       [queue[attemptCursor%queue.length]];
     attemptCursor=(attemptCursor+options.length)%queue.length;
     for(const angle of options){
      if(angle===0)continue;
      if(candidate.rotation&&Math.abs(angle-candidate.rotation)<5)continue;
      const result=await query(angle);
      if(consider(result,"angle-projection")&&
         candidate.value>=10)break;
     }
     lines=candidate.lines;
     const selected=candidate.rotation||0;
     if(selected&&clearRead(lines)){
      const difference=skewHint?
        Math.abs((((selected+hint.angle+90)%180)+180)%180-90):0;
      if(!skewHint||difference<8){
       if(previousAngle!==null&&Math.abs(previousAngle-selected)<7)
        previousStreak=Math.min(8,previousStreak+1);
       else previousStreak=1;
       previousAngle=selected;
      }else{
       previousStreak=0;previousAngle=null;
      }
      attemptCursor=0;
     }else if(selected===0&&clearRead(lines)){
      previousAngle=null;previousStreak=0;attemptCursor=0;
     }
     return {engine:engine.kind,width,height,deskewed,
      quarterTurn:Math.abs(selected)%90<.01?selected:0,
      rotationDegrees:selected,angleSource:candidate.source,
      projectionAngle:hint?.angle??null,
      detailUpscaled:!!candidate.detailUpscaled,
      enhancement:candidate.enhancement||null,
      attempts,elapsedMs:Math.round(performance.now()-now),
      lines,words:lines.flatMap(x=>x.words),
      text:lines.map(x=>x.text).join("\n")};
    },
    async terminate(){
     await worker.terminate();
     if(singleton===engine)singleton=null;
     creation=null;
     for(const url of urls.splice(0))URL.revokeObjectURL(url.split("#")[0]);
    }
   };
   singleton=engine;
   return engine;
  }catch(error){
   await worker?.terminate().catch(()=>{});
   for(const url of urls.splice(0))URL.revokeObjectURL(url.split("#")[0]);
   throw error;
  }
 })().catch(error=>{creation=null;throw error});
 return creation;
}
export {create};
export const source="bundled-open-source-tesseract";
