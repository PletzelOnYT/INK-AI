"use strict";
/* Camera handwriting fallback. Uses the same real, writer-trained CNN as
 * the drawing pad, never font templates, external services or text guessing.
 * The printed Tesseract OCR remains primary on ordinary readable text.
 */
(()=>{
 const Detector=window.InkCameraDetector;
 if(!Detector)return;
 const working=document.createElement("canvas");
 const ctx=working.getContext("2d",{willReadFrequently:true,alpha:false});
 const WIDTH=960,MAX_GLYPHS=24,MAX_LINES=2;
 // Optional offline vocabulary changes only readings supported by CNN
 // alternatives. It never supplies unseen/missing letters or whole phrases.
 const rawVocabulary=document.getElementById?.("inkEnglishWords")?.textContent||"";
 const dictionary=new Map();
 for(const word of rawVocabulary.toLowerCase().split(/\s+/)){
  if(!/^[a-z]{4,24}$/.test(word))continue;
  if(!dictionary.has(word.length))dictionary.set(word.length,[]);
  dictionary.get(word.length).push(word);
 }
 function refineCaseAndConfusions(raw,predictions){
  if(!/^[a-z][a-zA-Z]{3,23}$/.test(raw)||!/[A-Z]/.test(raw))
   return raw;
  const upper=(raw.match(/[A-Z]/g)||[]).length;
  if(upper>Math.max(3,Math.floor(raw.length*.40)))return raw;
  const lower=raw.toLowerCase();
  const known=dictionary.get(lower.length)||[];
  if(known.includes(lower))return lower;
  // One visually ambiguous character may be refined using an explicitly
  // ranked model alternative plus a known spelling. Never insert characters
  // or rewrite an unfamiliar word to an unrelated dictionary entry.
  let best=null,bestRatio=0;
  for(const word of known){
   if(word.slice(0,2)!==lower.slice(0,2))continue;
   let count=0,ratio=1,valid=true;
   for(let i=0;i<word.length;i++){
    if(word[i]===lower[i])continue;
    if(++count>1){valid=false;break}
    const top=predictions[i]?.top||[];
    const alt=top.find(x=>x.char===word[i]);
    const first=top[0];
    if(!alt||!first||alt.confidence<.10||
       alt.confidence/Math.max(.001,first.confidence)<.16){
     valid=false;break;
    }
    ratio*=alt.confidence/Math.max(.001,first.confidence);
   }
   if(valid&&count===1&&ratio>bestRatio){
    best=word;bestRatio=ratio;
   }
  }
  return best||lower;
 }

 function median(values){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)];
 }
 function bounds(letters){
  return {x0:Math.min(...letters.map(c=>c.x0)),
   y0:Math.min(...letters.map(c=>c.y0)),
   x1:Math.max(...letters.map(c=>c.x1+1)),
   y1:Math.max(...letters.map(c=>c.y1+1))};
 }
 function overlap(a,b){
  const w=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const h=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const intersection=w*h;
  const aa=(a.x1-a.x0)*(a.y1-a.y0);
  const bb=(b.x1-b.x0)*(b.y1-b.y0);
  return intersection/Math.max(1,Math.min(aa,bb));
 }
 function candidates(image,width,height){
  const found=Detector.detect(image,width,height).filter(line=>
   line.letters?.length>=3&&line.letters.length<=32&&
   line.medianHeight>=7&&line.medianHeight<=65);
  found.sort((a,b)=>b.score-a.score);
  const selected=[];
  let total=0;
  for(const line of found){
   const letters=[...line.letters].sort((a,b)=>a.x0-b.x0);
   const box=bounds(letters),count=letters.length;
   if(total+count>MAX_GLYPHS||selected.length>=MAX_LINES)continue;
   if(selected.some(item=>overlap(item.box,box)>.56))continue;
   selected.push({letters,box,medianHeight:line.medianHeight});
   total+=count;
  }
  return selected;
 }
 function normalizeGlyph(component,width,height,image){
  const iw=component.x1-component.x0+1;
  const ih=component.y1-component.y0+1;
  if(iw<2||ih<4)return new Array(1024).fill(0);
  const result=new Array(1024).fill(0);
  const scale=26/Math.max(iw,ih);
  const dw=Math.max(1,Math.round(iw*scale));
  const dh=Math.max(1,Math.round(ih*scale));
  const ox=Math.floor((32-dw)/2),oy=Math.floor((32-dh)/2);
  const sample=(xx,yy)=>{
   const x=Math.max(0,Math.min(width-1,xx));
   const y=Math.max(0,Math.min(height-1,yy));
   return component.mask[y*width+x]?1:0;
  };
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
   const sx=Math.max(0,Math.min(width-1,
    component.x0+(x+.5)*iw/dw-.5));
   const sy=Math.max(0,Math.min(height-1,
    component.y0+(y+.5)*ih/dh-.5));
   const x0=Math.floor(sx),x1=Math.min(width-1,x0+1),fx=sx-x0;
   const y0=Math.floor(sy),y1=Math.min(height-1,y0+1),fy=sy-y0;
   const v=(sample(x0,y0)*(1-fx)+sample(x1,y0)*fx)*(1-fy)+
     (sample(x0,y1)*(1-fx)+sample(x1,y1)*fx)*fy;
   // Thin real pencil strokes must survive reducing a large glyph to 32px.
   // Preserve sampled ink without drawing synthetic character templates.
   const nearest=scale<1?sample(Math.round(sx),Math.round(sy)):0;
   result[(oy+y)*32+(ox+x)]=Math.max(v,nearest*.94);
  }
  return result;
 }
 function decodeLine(line,predictions,sourceWidth,sourceHeight,scaleX,scaleY,engine="ink-handwriting-cnn"){
  if(predictions.length!==line.letters.length)return [];
  const heights=line.letters.map(c=>c.y1-c.y0+1);
  const h=median(heights);
  const gaps=line.letters.slice(1).map((c,i)=>
   Math.max(0,c.x0-line.letters[i].x1-1));
  const typical=median(gaps.filter(v=>v<Math.max(8,h*.70)));
  const spaceGap=Math.max(4,h*.60,typical*1.90);
  const groups=[];
  let group=[];
  function finish(){if(group.length)groups.push(group);group=[]}
  for(let i=0;i<line.letters.length;i++){
   if(i&&gaps[i-1]>spaceGap)finish();
   group.push({glyph:line.letters[i],prediction:predictions[i]});
  }
  finish();
  const words=[];
  for(const items of groups){
   if(items.length<3||items.length>24)continue;
   let text="",confidence=0,min=1,clear=0,margins=0;
   let invalid=false;
   for(const item of items){
    const top=item.prediction?.top?.[0];
    const runner=item.prediction?.top?.[1];
    if(!top||!(/^[A-Za-z0-9]$/.test(top.char))||
       !Number.isFinite(top.confidence)){invalid=true;break}
    const p=top.confidence;
    confidence+=p;min=Math.min(min,p);
    if(p>=.55)clear++;
    margins+=p-(runner?.confidence||0);
    text+=top.char;
   }
   if(invalid)continue;
   const n=items.length;
   confidence/=n;
   // Reject low-evidence strings instead of pretending to read cursive.
   if(confidence<.61||min<.27||clear<Math.ceil(n*.57)||
      margins/n<.12)continue;
   const box=bounds(items.map(item=>item.glyph));
   const projected={x0:box.x0*scaleX,y0:box.y0*scaleY,
    x1:box.x1*scaleX,y1:box.y1*scaleY};
   text=refineCaseAndConfusions(text,items.map(item=>item.prediction));
   words.push({text,confidence,box:projected,
    recognitionEngine:engine});
  }
  if(!words.length)return [];
  const box=bounds(words.map(w=>({...w.box,x1:w.box.x1-1,y1:w.box.y1-1})));
  const confidence=words.reduce((sum,w)=>sum+w.confidence,0)/words.length;
  return [{text:words.map(w=>w.text).join(" "),words,box,confidence,
   recognitionEngine:engine}];
 }
 async function recognize(canvas,width,height){
  if(!window.__inkHandwritingReady||
     typeof window.__inkCameraRecognizeHandwriting!=="function")
   return {lines:[],attempted:false,reason:"model-not-ready"};
  if(width<140||height<80)return {lines:[],attempted:false,reason:"too-small"};
  const scanWidth=Math.min(WIDTH,width);
  const scanHeight=Math.max(1,Math.round(height*scanWidth/width));
  if(working.width!==scanWidth||working.height!==scanHeight){
   working.width=scanWidth;working.height=scanHeight;
  }
  ctx.drawImage(canvas,0,0,scanWidth,scanHeight);
  const image=ctx.getImageData(0,0,scanWidth,scanHeight);
  const lines=candidates(image,scanWidth,scanHeight);
  if(!lines.length)return {lines:[],attempted:true,regions:0,glyphs:0};
  const images=lines.flatMap(line=>line.letters.map(glyph=>
    normalizeGlyph(glyph,scanWidth,scanHeight,image)));
  const predictions=await window.__inkCameraRecognizeHandwriting(images);
  if(predictions.length!==images.length)throw Error("Handwriting batch mismatch");
  let index=0;
  const translated=[],unread=[];
  const scaleX=width/scanWidth,scaleY=height/scanHeight;
  for(const line of lines){
   const count=line.letters.length;
   const values=decodeLine(line,predictions.slice(index,index+count),
    width,height,scaleX,scaleY);
   if(values.length)translated.push(...values);
   else unread.push({line,start:index,count});
   index+=count;
  }
  // Camera rasterization and pen trajectories have different statistics.
  // When the handwriting-trained model abstains, let the already-loaded
  // printed CNN challenge only those missing glyphs, not every live frame.
  // It is a second trained neural model, never procedural text replacement.
  let printAssistedGlyphs=0;
  if(unread.length&&window.__inkPrintReady&&
     typeof window.__inkCameraRecognize==="function"){
   const unresolved=unread.flatMap(x=>images.slice(x.start,x.start+x.count));
   try{
    const rescue=await window.__inkCameraRecognize(unresolved);
    if(rescue.length===unresolved.length){
     let at=0;
     for(const item of unread){
      const values=decodeLine(item.line,rescue.slice(at,at+item.count),
       width,height,scaleX,scaleY,"ink-print-cnn-fallback");
      translated.push(...values);
      if(values.length)printAssistedGlyphs+=item.count;
      at+=item.count;
     }
    }
   }catch(_){/* Keep confirmed handwriting reads if print model fails. */}
  }
  return {lines:translated,attempted:true,regions:lines.length,
   glyphs:images.length,printAssistedGlyphs};
 }
 window.InkCameraHandwriting={recognize,decodeLine,normalizeGlyph,candidates,refineCaseAndConfusions};
})();
