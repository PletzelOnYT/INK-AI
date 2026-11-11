"use strict";
/*
 * Pixel-evidence checks for camera OCR. OCR confidence alone is not proof of
 * visible text: smooth skin, painted walls and glare can receive plausible
 * character guesses. This small local verifier samples the actual image
 * inside the OCR word's bounding box and requires real, sharp stroke edges.
 *
 * It is deliberately permissive about colors and vocabulary. It does not
 * try to classify human faces/skin, or reject words by their dictionary.
 * Costs O(<=120*48) sampled pixels per word and makes no network requests.
 */
(()=>{
 function evidence(context,box,frameW,frameH,points=null){
  const bad={ok:false,score:0,contrast:0,edgeRate:0,reason:"no-text-pixels"};
  if(!box||!Number.isFinite(box.x0+box.y0+box.x1+box.y1))return bad;
  const x0=Math.max(0,Math.floor(box.x0)),y0=Math.max(0,Math.floor(box.y0));
  const x1=Math.min(frameW,Math.ceil(box.x1)),y1=Math.min(frameH,Math.ceil(box.y1));
  const width=x1-x0,height=y1-y0;
  if(width<3||height<4)return bad;
  let bitmap;
  try{bitmap=context.getImageData(x0,y0,width,height)}
  catch(_){return bad}
  // OCR on a rotated frame returns a real four-corner quadrilateral.
  // Sampling its large axis-aligned bounding box diluted thin, slanted
  // letters with background and caused them to fail the visual-quality test.
  // Rectify the *sample*, not the camera image, preserving fast OCR frames.
  const polygon=Array.isArray(points)&&points.length===4&&
    points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
  const corners=polygon?points:null;
  const sourceW=polygon?Math.hypot(corners[1].x-corners[0].x,
    corners[1].y-corners[0].y):width;
  const sourceH=polygon?Math.hypot(corners[3].x-corners[0].x,
    corners[3].y-corners[0].y):height;
  const sw=Math.min(120,Math.max(3,Math.round(sourceW))),
    sh=Math.min(48,Math.max(4,Math.round(sourceH)));
  const sample=new Float32Array(sw*sh),rgb=new Uint8Array(sw*sh*3),rgba=bitmap.data;
  for(let y=0;y<sh;y++){
   const v=(y+.5)/sh;
   for(let x=0;x<sw;x++){
    const u=(x+.5)/sw;
    const xx=polygon?(corners[0].x+
      u*(corners[1].x-corners[0].x)+
      v*(corners[3].x-corners[0].x)):(x0+u*width);
    const yy=polygon?(corners[0].y+
      u*(corners[1].y-corners[0].y)+
      v*(corners[3].y-corners[0].y)):(y0+v*height);
    const px=Math.max(0,Math.min(width-1,Math.round(xx-x0)));
    const py=Math.max(0,Math.min(height-1,Math.round(yy-y0)));
    const k=(py*width+px)*4;
    const at=y*sw+x;
    sample[at]=.299*rgba[k]+.587*rgba[k+1]+.114*rgba[k+2];
    rgb[at*3]=rgba[k];rgb[at*3+1]=rgba[k+1];rgb[at*3+2]=rgba[k+2];
   }
  }
  const histogram=new Uint32Array(256);
  const channelHist=Array.from({length:3},()=>new Uint32Array(256));
  for(let i=0;i<sample.length;i++){
   histogram[Math.max(0,Math.min(255,Math.round(sample[i])))]++;
   for(let channel=0;channel<3;channel++)channelHist[channel][rgb[i*3+channel]]++;
  }
  const quantile=(p,hist=histogram)=>{
   const threshold=Math.ceil(sample.length*p);
   let cumulative=0;
   for(let i=0;i<256;i++)if((cumulative+=hist[i])>=threshold)return i;
   return 255;
  };
  // Opposite-colored glyphs can have identical grayscale brightness.
  const contrast=Math.max(quantile(.91)-quantile(.09),
   ...channelHist.map(hist=>quantile(.91,hist)-quantile(.09,hist)));
  const threshold=Math.max(12,Math.min(34,contrast*.29));
  let edges=0,vertical=0,horizontal=0,pairs=0;
  const columns=new Uint16Array(sw);
  const y0_inner=Math.max(1,Math.floor(sh*.08));
  const y1_inner=Math.min(sh-1,Math.ceil(sh*.92));
  for(let y=y0_inner;y<y1_inner;y++){
   for(let x=1;x<sw-1;x++){
    const i=y*sw+x;
    let dx=Math.abs(sample[i+1]-sample[i-1])*.5;
    let dy=Math.abs(sample[i+sw]-sample[i-sw])*.5;
    for(let channel=0;channel<3;channel++){
     dx=Math.max(dx,Math.abs(rgb[(i+1)*3+channel]-rgb[(i-1)*3+channel])*.5);
     dy=Math.max(dy,Math.abs(rgb[(i+sw)*3+channel]-rgb[(i-sw)*3+channel])*.5);
    }
    if(dx>threshold){horizontal++;columns[x]++}
    if(dy>threshold)vertical++;
    if(Math.max(dx,dy)>threshold)edges++;
    pairs++;
   }
  }
  const edgeRate=edges/Math.max(1,pairs);
  const verticalStrokeRate=horizontal/Math.max(1,pairs);
  // A few isolated hard edges (shelf seam, garment boundary) are not a
  // printed word; real letters have edges in multiple x-position bands.
  let bands=0,was=false;
  for(let x=0;x<sw;x++){
   const strong=columns[x]>=Math.max(1,Math.ceil((y1_inner-y0_inner)*.06));
   if(strong&&!was)bands++;
   was=strong;
  }
  const score=Math.min(1,
   .34*Math.min(1,contrast/75)+
   .38*Math.min(1,edgeRate/.12)+
   .16*Math.min(1,verticalStrokeRate/.055)+
   .12*Math.min(1,bands/5));
  const ok=contrast>=19&&edgeRate>=.018&&verticalStrokeRate>=.007&&
   bands>=2&&edgeRate<=.72;
  return {ok,score,contrast,edgeRate,verticalStrokeRate,bands,
   reason:ok?"visible-strokes":"too-smooth-or-not-textlike"};
 }
 // The character shape is just a secondary safeguard; do not require that
 // text be an ordinary dictionary word. Leave one-letter words available
 // inside multiword lines, but not as isolated high-confidence hallucinations.
 function plausibleWord(word,lineWords,frameW,frameH){
  const raw=String(word?.text||"").trim();
  if(!raw||!/[\p{L}\p{N}]/u.test(raw)||!word?.box)return false;
  const chars=[...raw].filter(ch=>/[\p{L}\p{N}]/u.test(ch)).length;
  if(chars===0)return false;
  // Isolated clock digits need stronger OCR confidence and repeated scans.
  if(chars===1&&lineWords<=1&&
     !(/^\d$/.test(raw)&&Number(word.confidence)>=.85))return false;
  const b=word.box;
  const corners=word.points;
  const oriented=Array.isArray(corners)&&corners.length===4&&
    corners.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
  const w=oriented?Math.hypot(corners[1].x-corners[0].x,
    corners[1].y-corners[0].y):b.x1-b.x0;
  const h=oriented?Math.hypot(corners[3].x-corners[0].x,
    corners[3].y-corners[0].y):b.y1-b.y0;
  if(!Number.isFinite(w+h)||w<2||h<3||h>frameH*.65)return false;
  const ratio=w/h/Math.max(1,chars);
  return ratio>=.10&&ratio<=3.0&&w<=Math.hypot(frameW,frameH)*.99;
 }
 // An early-frame check for truly uniform views can save a full WASM scan.
 // This never labels people; it solely detects whether the scene has ANY
 // sufficiently sharp contrast to contain readable print.
 function sceneHasDetail(context,width,height){
  if(!context?.getImageData)return true;
  const sampleW=Math.min(96,width),sampleH=Math.min(54,height);
  if(sampleW<2||sampleH<2)return true;
  let data;
  try{data=context.getImageData(0,0,width,height).data}
  catch(_){return true}
  const get=(x,y)=>{
   const sx=Math.min(width-1,Math.floor((x+.5)*width/sampleW));
   const sy=Math.min(height-1,Math.floor((y+.5)*height/sampleH));
   const k=(sy*width+sx)*4;
   return .299*data[k]+.587*data[k+1]+.114*data[k+2];
  };
  let sharp=0,total=0;
  for(let y=1;y<sampleH-1;y++)for(let x=1;x<sampleW-1;x++){
   const a=get(x,y),b=get(x+1,y),c=get(x,y+1);
   if(Math.abs(a-b)>=25||Math.abs(a-c)>=25)sharp++;
   total++;
  }
  return sharp/Math.max(1,total)>.003;
 }
 window.InkTextEvidence={evidence,plausibleWord,sceneHasDetail};
})();
